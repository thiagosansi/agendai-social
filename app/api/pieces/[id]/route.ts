import type { NextRequest } from "next/server";
import { Prisma, PieceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkText, loadRules } from "@/lib/claim-check";
import { patchPieceSchema } from "@/lib/validation";

export const runtime = "nodejs";

const STALE_SCHEDULE_MS = 24 * 60 * 60 * 1000;

// PATCH /api/pieces/[id]
// Updates caption, publishAt and/or status (draft <-> approved only —
// published/failed are exclusively set by the daily publish cron, and the
// zod schema rejects any other status value before we get here). Not gated
// by the generation token — see lib/auth.ts for why.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const existing = await prisma.piece.findUnique({ where: { id } });
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

  const { caption, publishAt, status } = parsed.data;

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
  const effectiveImageUrl = existing.imageUrl; // never settable through this route

  if (status === PieceStatus.approved) {
    if (existing.status !== PieceStatus.draft && existing.status !== PieceStatus.approved) {
      return Response.json(
        { error: `cannot approve a piece with status "${existing.status}"` },
        { status: 422 },
      );
    }
    if (!effectiveImageUrl) {
      return Response.json(
        { error: "imageUrl is required before approving — upload one via POST /api/pieces/[id]/image" },
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
    if (existing.status !== PieceStatus.approved && existing.status !== PieceStatus.draft) {
      return Response.json(
        { error: `cannot unapprove a piece with status "${existing.status}"` },
        { status: 422 },
      );
    }
  }

  const data: Prisma.PieceUpdateInput = {
    ...(caption !== undefined ? { caption, claimCheckPassed } : {}),
    ...(publishAt !== undefined ? { publishAt } : {}),
    ...(status !== undefined ? { status } : {}),
  };

  const piece = await prisma.piece.update({ where: { id }, data });

  return Response.json({ piece });
}
