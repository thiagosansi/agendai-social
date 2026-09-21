import type { NextRequest } from "next/server";
import { Prisma, PieceFormat, PieceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePieceEditor } from "@/lib/session";
import { checkText, loadRules } from "@/lib/claim-check";
import { isVideoMedia, orderedImagesInclude } from "@/lib/piece-images";
import { pickNextFreeSlot } from "@/lib/generation-schedule";
import { getCadenceConfig, type CadenceConfig } from "@/lib/settings";
import {
  MAX_STORY_VIDEO_DURATION_SEC,
  MIN_CARROSSEL_IMAGES_TO_APPROVE,
  patchPieceSchema,
} from "@/lib/validation";

export const runtime = "nodejs";

const STALE_SCHEDULE_MS = 24 * 60 * 60 * 1000;
const STALE_APPROVE_ERROR = "cannot approve a piece whose publishAt is more than 24h in the past";

// True for a Prisma serialization failure under the Serializable isolation
// level (concurrent transactions both read the same "occupied slots"
// snapshot) — the only error code the reschedule transaction below retries.
function isSerializationConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034";
}

// Runs the approve-time reschedule as one Serializable transaction: reads
// every OTHER piece's still-upcoming publishAt (the "occupied" set), picks
// the next free cadence slot (lib/generation-schedule.ts's pickNextFreeSlot),
// and writes the approval + new publishAt together. Serializable isolation
// (rather than a plain read-then-write) is what prevents two concurrent
// approvals from both reading the same occupied set and picking the same
// slot — one of the two transactions will fail with P2034 and the caller
// retries once (see PATCH below).
async function runRescheduleTransaction(
  id: string,
  data: Prisma.PieceUpdateInput,
  cadence: CadenceConfig,
) {
  return prisma.$transaction(
    async (tx) => {
      const now = new Date();
      const others = await tx.piece.findMany({
        where: {
          id: { not: id },
          status: { in: [PieceStatus.draft, PieceStatus.approved] },
          publishAt: { gt: now },
        },
        select: { publishAt: true },
      });

      const slot = pickNextFreeSlot(
        now,
        cadence.postingWeekdays,
        cadence.postingTime,
        others.map((other) => other.publishAt),
      );
      if (!slot) {
        return {
          errorResponse: Response.json(
            { error: "cadência não tem dias de postagem configurados — não é possível reagendar" },
            { status: 422 },
          ),
        } as const;
      }

      const piece = await tx.piece.update({
        where: { id },
        data: { ...data, status: PieceStatus.approved, publishAt: slot },
        include: orderedImagesInclude,
      });
      return { piece } as const;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

// PATCH /api/pieces/[id]
// Updates caption, publishAt and/or status. Status transitions accepted here:
// draft <-> approved, and failed -> draft (recovery after a failed publish
// attempt). published is exclusively set by the daily publish cron, and the
// zod schema rejects any other status value before we get here.
// Owner/approver only (lib/session.ts requirePieceEditor) — this route was
// previously unauthenticated, then owner-only; approvers now share full
// piece-editing rights with the owner.
//
// Approving a piece whose STORED publishAt has drifted more than 24h into
// the past (it sat in draft past its slot) no longer hard-fails: as long as
// the caller didn't also send an explicit `publishAt` in this PATCH, the
// piece is atomically moved to the next free cadence slot instead
// (response: `{ piece, rescheduled: true }`). An explicit stale `publishAt`
// (or a no-status PATCH touching an already-approved piece's `publishAt`)
// still 422s — the reschedule only kicks in for the "just approve it"
// case, never silently overriding a date the caller set on purpose.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requirePieceEditor(req);
  if (authError) return authError;

  const { id } = await params;

  const existing = await prisma.piece.findUnique({ where: { id }, include: orderedImagesInclude });
  if (!existing) {
    return Response.json({ error: "piece not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = patchPieceSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { caption, imagePrompt, imagePrompts, overlayText, overlayTexts, publishAt, status } = parsed.data;

  // imagePrompts (one prompt per carrossel slide) only makes sense for the
  // carrossel format — every other format drives off imagePrompt alone.
  if (imagePrompts !== undefined && existing.format !== PieceFormat.carrossel) {
    return Response.json({ error: "imagePrompts só é permitido em carrossel" }, { status: 400 });
  }

  // overlayTexts (one overlay per carrossel slide) mirrors imagePrompts.
  // Pairs against imagePrompts if both are provided in this PATCH, otherwise
  // against the piece's existing imagePrompts — so `PATCH {overlayTexts}`
  // alone is allowed as long as it matches what's already stored.
  if (overlayTexts !== undefined) {
    if (existing.format !== PieceFormat.carrossel) {
      return Response.json({ error: "overlayTexts só é permitido em carrossel" }, { status: 400 });
    }
    const effectiveImagePrompts = imagePrompts ?? existing.imagePrompts;
    if (overlayTexts.length !== effectiveImagePrompts.length) {
      return Response.json(
        { error: "overlayTexts deve ter o mesmo tamanho de imagePrompts" },
        { status: 400 },
      );
    }
  }

  // Re-run claim-check whenever the caption changes; abort entirely (no
  // partial update) if it fails, same as POST /api/pieces.
  let claimCheckPassed = existing.claimCheckPassed;
  if (caption !== undefined) {
    const { ok, violations } = checkText(caption, loadRules());
    if (!ok) {
      return Response.json({ error: "caption violates forbidden claims", violations }, { status: 422 });
    }
    claimCheckPassed = true;
  }

  // Guard: a PATCH that doesn't touch status but sets an explicit publishAt
  // on an already-approved piece more than 24h in the past is rejected the
  // same way an approve-with-stale-date is — an approved piece shouldn't be
  // able to drift stale again via a bare publishAt PATCH (this path never
  // reschedules; the caller explicitly chose this date).
  if (
    status === undefined &&
    existing.status === PieceStatus.approved &&
    publishAt !== undefined &&
    publishAt.getTime() < Date.now() - STALE_SCHEDULE_MS
  ) {
    return Response.json({ error: STALE_APPROVE_ERROR }, { status: 422 });
  }

  // Set below, inside the approved branch, when the stored (not explicit)
  // publishAt has drifted stale — triggers the reschedule transaction after
  // every other approve-time validation has passed.
  let needsReschedule = false;

  if (status === PieceStatus.approved) {
    if (existing.status !== PieceStatus.draft && existing.status !== PieceStatus.approved) {
      return Response.json(
        { error: `cannot approve a piece with status "${existing.status}"` },
        { status: 422 },
      );
    }
    // Media rules per format (lib/piece-images.ts's isVideoMedia,
    // lib/validation.ts's VIDEO_FORMATS): reels holds exactly 1 video;
    // stories holds exactly 1 image OR 1 video (capped at
    // MAX_STORY_VIDEO_DURATION_SEC); estatico/carrossel stay image-only.
    const videoCount = existing.images.filter(isVideoMedia).length;

    if (existing.format === PieceFormat.reels) {
      if (existing.images.length !== 1 || videoCount !== 1) {
        return Response.json({ error: "reels exige exatamente 1 vídeo" }, { status: 422 });
      }
    } else if (existing.format === PieceFormat.stories) {
      if (existing.images.length !== 1) {
        return Response.json(
          { error: "stories exige exatamente 1 mídia (imagem ou vídeo)" },
          { status: 422 },
        );
      }
      const [media] = existing.images;
      if (isVideoMedia(media) && (media.durationSec ?? 0) > MAX_STORY_VIDEO_DURATION_SEC) {
        return Response.json(
          { error: `vídeo de stories não pode ultrapassar ${MAX_STORY_VIDEO_DURATION_SEC}s` },
          { status: 422 },
        );
      }
    } else {
      // estatico / carrossel — images only.
      if (videoCount > 0) {
        return Response.json(
          { error: "vídeo só é permitido em reels/stories" },
          { status: 422 },
        );
      }
      if (existing.images.length === 0) {
        return Response.json(
          { error: "pelo menos uma imagem é necessária antes de aprovar — envie via POST /api/pieces/[id]/image" },
          { status: 422 },
        );
      }
      if (existing.format === PieceFormat.carrossel && existing.images.length < MIN_CARROSSEL_IMAGES_TO_APPROVE) {
        return Response.json(
          { error: "Carrossel precisa de pelo menos 2 imagens" },
          { status: 422 },
        );
      }
    }
    if (!claimCheckPassed) {
      return Response.json({ error: "claim-check must pass before approving" }, { status: 422 });
    }
    if (publishAt !== undefined) {
      // Caller explicitly set publishAt in this same PATCH — the 24h safety
      // rail still applies, but there's no reschedule fallback here: an
      // explicit stale date is a caller mistake, not a drifted queue, so it
      // hard-fails same as before.
      if (publishAt.getTime() < Date.now() - STALE_SCHEDULE_MS) {
        return Response.json({ error: STALE_APPROVE_ERROR }, { status: 422 });
      }
    } else if (existing.publishAt.getTime() < Date.now() - STALE_SCHEDULE_MS) {
      // No explicit publishAt this PATCH, but the stored one has drifted
      // stale (piece sat in draft past its slot) — reschedule to the next
      // free cadence slot instead of blocking the approval.
      needsReschedule = true;
    }
  } else if (status === PieceStatus.draft) {
    // approved -> draft: unapprove. failed -> draft: recovery after a failed
    // publish attempt (e.g. missing Meta credentials), so the founder can
    // fix the issue and re-approve for the next cron run.
    if (
      existing.status !== PieceStatus.approved &&
      existing.status !== PieceStatus.draft &&
      existing.status !== PieceStatus.failed
    ) {
      return Response.json(
        { error: `cannot unapprove a piece with status "${existing.status}"` },
        { status: 422 },
      );
    }
  }

  const data: Prisma.PieceUpdateInput = {
    ...(caption !== undefined ? { caption, claimCheckPassed } : {}),
    ...(imagePrompt !== undefined ? { imagePrompt } : {}),
    ...(imagePrompts !== undefined ? { imagePrompts } : {}),
    ...(overlayText !== undefined ? { overlayText } : {}),
    ...(overlayTexts !== undefined ? { overlayTexts } : {}),
    ...(publishAt !== undefined ? { publishAt } : {}),
    ...(status !== undefined ? { status } : {}),
  };

  if (needsReschedule) {
    const cadence = await getCadenceConfig();

    // Retry once on a serialization conflict (Prisma P2034): two concurrent
    // approvals could both read the same occupied-slots snapshot under
    // Serializable isolation, and only one of them commits — the loser
    // simply retries the whole transaction (fresh read of occupied slots).
    let result: Awaited<ReturnType<typeof runRescheduleTransaction>>;
    try {
      result = await runRescheduleTransaction(id, data, cadence);
    } catch (err) {
      if (!isSerializationConflict(err)) throw err;
      try {
        result = await runRescheduleTransaction(id, data, cadence);
      } catch (retryErr) {
        if (!isSerializationConflict(retryErr)) throw retryErr;
        return Response.json(
          { error: "conflito ao reagendar — outra aprovação concorrente ocupou o horário, tente novamente" },
          { status: 409 },
        );
      }
    }

    if ("errorResponse" in result) return result.errorResponse;
    return Response.json({ piece: result.piece, rescheduled: true });
  }

  const piece = await prisma.piece.update({ where: { id }, data, include: orderedImagesInclude });

  return Response.json({ piece, rescheduled: false });
}
