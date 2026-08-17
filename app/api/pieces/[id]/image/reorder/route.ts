import type { NextRequest } from "next/server";
import { PieceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { orderedImagesInclude } from "@/lib/piece-images";
import { reorderImagesSchema } from "@/lib/validation";

export const runtime = "nodejs";

// PATCH /api/pieces/[id]/image/reorder
// Body: { imageOrder: string[] } — the piece's current PieceImage ids, in
// the desired publish order. Index 0 becomes the carousel's first slide
// (and the "cover" thumbnail everywhere a single image is shown). Rejects
// any payload that isn't exactly the same id set the piece currently has
// (no partial reorders, no smuggling in another piece's image id). Only
// allowed while status=draft — same freeze-after-approval rule as
// POST/DELETE .../image. Not gated by the generation token or same-origin
// check — consistent with every other piece-mutation route in this app
// (see lib/auth.ts for why the approval UI's routes stay ungated for now).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const existing = await prisma.piece.findUnique({ where: { id }, include: orderedImagesInclude });
  if (!existing) {
    return Response.json({ error: "piece not found" }, { status: 404 });
  }
  if (existing.status !== PieceStatus.draft) {
    return Response.json(
      {
        error: `não é possível reordenar imagens de uma peça com status "${existing.status}" — apenas rascunhos`,
      },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = reorderImagesSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  const { imageOrder } = parsed.data;
  const currentIds = existing.images.map((image) => image.id);
  const isSameIdSet =
    imageOrder.length === currentIds.length &&
    new Set(imageOrder).size === imageOrder.length &&
    currentIds.every((imageId) => imageOrder.includes(imageId));

  if (!isSameIdSet) {
    return Response.json(
      { error: "imageOrder must contain exactly the piece's current image ids, each exactly once" },
      { status: 422 },
    );
  }

  await prisma.$transaction(
    imageOrder.map((imageId, index) =>
      prisma.pieceImage.update({ where: { id: imageId }, data: { sortOrder: index } }),
    ),
  );

  const piece = await prisma.piece.findUniqueOrThrow({ where: { id }, include: orderedImagesInclude });

  return Response.json({ piece });
}
