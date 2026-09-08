import type { NextRequest } from "next/server";
import { Prisma, PieceFormat, PieceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePieceEditor } from "@/lib/session";
import { checkText, loadRules } from "@/lib/claim-check";
import { isVideoMedia, orderedImagesInclude } from "@/lib/piece-images";
import {
  MAX_STORY_VIDEO_DURATION_SEC,
  MIN_CARROSSEL_IMAGES_TO_APPROVE,
  patchPieceSchema,
} from "@/lib/validation";

export const runtime = "nodejs";

const STALE_SCHEDULE_MS = 24 * 60 * 60 * 1000;

// PATCH /api/pieces/[id]
// Updates caption, publishAt and/or status. Status transitions accepted here:
// draft <-> approved, and failed -> draft (recovery after a failed publish
// attempt). published is exclusively set by the daily publish cron, and the
// zod schema rejects any other status value before we get here.
// Owner/approver only (lib/session.ts requirePieceEditor) — this route was
// previously unauthenticated, then owner-only; approvers now share full
// piece-editing rights with the owner.
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

  const effectivePublishAt = publishAt ?? existing.publishAt;

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
    if (effectivePublishAt.getTime() < Date.now() - STALE_SCHEDULE_MS) {
      return Response.json(
        { error: "cannot approve a piece whose publishAt is more than 24h in the past" },
        { status: 422 },
      );
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

  const piece = await prisma.piece.update({ where: { id }, data, include: orderedImagesInclude });

  return Response.json({ piece });
}
