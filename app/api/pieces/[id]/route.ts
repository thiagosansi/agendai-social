import type { NextRequest } from "next/server";
import { Prisma, PieceFormat, PieceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePieceEditor } from "@/lib/session";
import { checkText, loadRules } from "@/lib/claim-check";
import { orderedImagesInclude } from "@/lib/piece-images";
import { MIN_CARROSSEL_IMAGES_TO_APPROVE, patchPieceSchema } from "@/lib/validation";

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

  const { caption, imagePrompt, publishAt, status } = parsed.data;

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
    ...(publishAt !== undefined ? { publishAt } : {}),
    ...(status !== undefined ? { status } : {}),
  };

  const piece = await prisma.piece.update({ where: { id }, data, include: orderedImagesInclude });

  return Response.json({ piece });
}
