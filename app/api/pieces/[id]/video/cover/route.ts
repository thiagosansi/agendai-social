import type { NextRequest } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { put } from "@vercel/blob";
import { PieceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePieceEditor } from "@/lib/session";
import { isVideoMedia, orderedImagesInclude } from "@/lib/piece-images";
import { deleteLocalUploadFile } from "@/lib/uploads";
import { ALLOWED_IMAGE_CONTENT_TYPES, MAX_IMAGE_BYTES } from "@/lib/validation";

export const runtime = "nodejs";

// Mirrors app/api/pieces/[id]/image/route.ts's map — kept local since that
// route doesn't export it and this is the only other place that needs it.
const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// POST /api/pieces/[id]/video/cover (multipart/form-data, field "file")
// Sets an optional still-image thumbnail on the piece's video media (Meta's
// `cover_url` param on createReelsContainer — lib/instagram.ts). Only valid
// once a video already exists (422 otherwise) and only while status=draft,
// same freeze-after-approval rule as the other image/video mutation routes.
// A second call replaces the previous cover (old file removed if local).
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
        error: `não é possível alterar mídia de uma peça com status "${existing.status}" — apenas rascunhos`,
      },
      { status: 409 },
    );
  }

  const video = existing.images.find(isVideoMedia);
  if (!video) {
    return Response.json(
      { error: "peça não possui vídeo — envie o vídeo antes da capa" },
      { status: 422 },
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

  const extension = EXTENSION_BY_CONTENT_TYPE[contentType];
  const bytes = new Uint8Array(await file.arrayBuffer());

  let coverUrl: string;
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (blobToken) {
    const blob = await put(`pieces/${id}-video-cover-${Date.now()}.${extension}`, Buffer.from(bytes), {
      access: "public",
      token: blobToken,
      contentType,
    });
    coverUrl = blob.url;
  } else {
    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadsDir, { recursive: true });
    const filename = `${id}-video-cover-${Date.now()}.${extension}`;
    await writeFile(path.join(uploadsDir, filename), bytes);
    coverUrl = `/uploads/${filename}`;
  }

  if (video.coverUrl) {
    await deleteLocalUploadFile(video.coverUrl);
  }

  await prisma.pieceImage.update({ where: { id: video.id }, data: { coverUrl } });

  const piece = await prisma.piece.findUniqueOrThrow({ where: { id }, include: orderedImagesInclude });

  return Response.json({ piece });
}
