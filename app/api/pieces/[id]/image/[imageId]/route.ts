import type { NextRequest } from "next/server";
import { PieceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePieceEditor } from "@/lib/session";
import { orderedImagesInclude } from "@/lib/piece-images";
import { deleteLocalUploadFile } from "@/lib/uploads";

export const runtime = "nodejs";

// DELETE /api/pieces/[id]/image/[imageId]
// Removes one media item (image or video, kind field — lib/piece-images.ts
// isVideoMedia) from a draft piece, and its local file(s) if it was a
// /uploads/... upload — the video's own `url` and, if set, its `coverUrl`
// thumbnail (POST .../video/cover) are both cleaned up the same way; Blob
// uploads are left in place either way, same as image uploads always have
// been. Then resequences the remaining media's sortOrder to stay 0-based
// and contiguous. Only allowed while status=draft — see POST .../image for
// the same freeze-after-approval rule. Owner/approver only
// (lib/session.ts requirePieceEditor) — this route was previously
// unauthenticated, then owner-only.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; imageId: string }> },
) {
  const authError = await requirePieceEditor(req);
  if (authError) return authError;

  const { id, imageId } = await params;

  const existing = await prisma.piece.findUnique({ where: { id }, include: orderedImagesInclude });
  if (!existing) {
    return Response.json({ error: "piece not found" }, { status: 404 });
  }
  if (existing.status !== PieceStatus.draft) {
    return Response.json(
      {
        error: `não é possível alterar imagens de uma peça com status "${existing.status}" — apenas rascunhos`,
      },
      { status: 409 },
    );
  }

  const target = existing.images.find((image) => image.id === imageId);
  if (!target) {
    return Response.json({ error: "image not found" }, { status: 404 });
  }

  await deleteLocalUploadFile(target.url);
  if (target.coverUrl) {
    await deleteLocalUploadFile(target.coverUrl);
  }
  await prisma.pieceImage.delete({ where: { id: imageId } });

  const remaining = existing.images.filter((image) => image.id !== imageId);
  if (remaining.length > 0) {
    await prisma.$transaction(
      remaining.map((image, index) =>
        prisma.pieceImage.update({ where: { id: image.id }, data: { sortOrder: index } }),
      ),
    );
  }

  const piece = await prisma.piece.findUniqueOrThrow({ where: { id }, include: orderedImagesInclude });

  return Response.json({ piece });
}
