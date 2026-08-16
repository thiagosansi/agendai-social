import type { NextRequest } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { ALLOWED_IMAGE_CONTENT_TYPES, MAX_IMAGE_BYTES } from "@/lib/validation";

export const runtime = "nodejs";

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// POST /api/pieces/[id]/image (multipart/form-data, field name "file")
// Uploads the image the founder generated/selected from the piece's
// imagePrompt during approval. Not gated by the generation token — see
// lib/auth.ts for why.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const existing = await prisma.piece.findUnique({ where: { id } });
  if (!existing) {
    return Response.json({ error: "piece not found" }, { status: 404 });
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

  let imageUrl: string;
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

  if (blobToken) {
    const blob = await put(`pieces/${id}-${Date.now()}.${extension}`, Buffer.from(bytes), {
      access: "public",
      token: blobToken,
      contentType,
    });
    imageUrl = blob.url;
  } else {
    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadsDir, { recursive: true });
    const filename = `${id}.${extension}`;
    await writeFile(path.join(uploadsDir, filename), bytes);
    imageUrl = `/uploads/${filename}`;
  }

  const piece = await prisma.piece.update({ where: { id }, data: { imageUrl } });

  return Response.json({ piece });
}
