import type { NextRequest } from "next/server";
import { PieceFormat, PieceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePieceEditor } from "@/lib/session";
import { orderedImagesInclude } from "@/lib/piece-images";
import { deleteLocalUploadFile, storePieceMediaBytes } from "@/lib/uploads";
import { ALLOWED_IMAGE_CONTENT_TYPES, MAX_CARROSSEL_IMAGES, MAX_IMAGE_BYTES } from "@/lib/validation";

export const runtime = "nodejs";

// POST /api/pieces/[id]/image (multipart/form-data, field name "file")
// Adds one image to the piece. `carrossel` pieces accept up to
// MAX_CARROSSEL_IMAGES, appended in upload order (sortOrder = current
// count); every other format holds a single "cover" image, so a second
// upload REPLACES the first (old PieceImage row deleted, and its local file
// removed if it was a /uploads/... upload). Owner/approver only
// (lib/session.ts requirePieceEditor) — this route was previously
// unauthenticated, then owner-only.
//
// Only allowed while status=draft: once a piece is approved its images are
// frozen, so the queued publish always ships exactly what was reviewed
// (DELETE and the reorder route below enforce the same rule).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requirePieceEditor(req);
  if (authError) return authError;

  const { id } = await params;

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

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "missing file field" }, { status: 400 });
  }

  const contentType = file.type;
  if (!ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
    return Response.json(
      { error: `unsupported content type: ${contentType || "unknown"} (allowed: jpeg, png, webp)` },
      { status: 400 },
    );
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return Response.json(
      { error: `file too large: ${file.size} bytes (max ${MAX_IMAGE_BYTES} bytes)` },
      { status: 400 },
    );
  }

  const isCarrossel = existing.format === PieceFormat.carrossel;
  let nextSortOrder = existing.images.length;

  if (!isCarrossel && existing.images.length >= 1) {
    // Replace semantics: a non-carrossel piece holds exactly one image.
    for (const image of existing.images) {
      await deleteLocalUploadFile(image.url);
    }
    await prisma.pieceImage.deleteMany({ where: { pieceId: id } });
    nextSortOrder = 0;
  } else if (isCarrossel && existing.images.length >= MAX_CARROSSEL_IMAGES) {
    return Response.json(
      { error: `carrossel aceita no máximo ${MAX_CARROSSEL_IMAGES} imagens` },
      { status: 422 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  const url = await storePieceMediaBytes({
    pieceId: id,
    sortOrder: nextSortOrder,
    contentType,
    bytes,
  });

  await prisma.pieceImage.create({ data: { pieceId: id, url, sortOrder: nextSortOrder } });

  const piece = await prisma.piece.findUniqueOrThrow({ where: { id }, include: orderedImagesInclude });

  return Response.json({ piece });
}
