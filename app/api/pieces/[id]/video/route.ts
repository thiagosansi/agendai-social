import type { NextRequest } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { put } from "@vercel/blob";
import { PieceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePieceEditor } from "@/lib/session";
import { isVideoMedia, orderedImagesInclude } from "@/lib/piece-images";
import {
  ALLOWED_VIDEO_CONTENT_TYPES,
  MAX_VIDEO_BYTES,
  VIDEO_FORMATS,
  registerVideoSchema,
} from "@/lib/validation";

export const runtime = "nodejs";

const EXTENSION_BY_VIDEO_CONTENT_TYPE: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

// A Vercel Blob "store" URL's hostname is always
// <store-id>.public.blob.vercel-storage.com — this suffix check accepts any
// store on the account without hardcoding the store id.
const BLOB_HOSTNAME_SUFFIX = ".public.blob.vercel-storage.com";

// POST /api/pieces/[id]/video
// Registers the piece's video as a PieceImage (kind="video", sortOrder 0 —
// reels/stories hold exactly one media item, see PATCH /api/pieces/[id]'s
// approval rules). Two request shapes:
//
// 1. `application/json` (registerVideoSchema) — the video was already
//    uploaded directly to Vercel Blob via POST .../video/upload-token +
//    @vercel/blob/client's upload(); this just persists the resulting URL.
//    `url` must be a real Blob URL under this piece's upload prefix, so a
//    client can't register an arbitrary/unrelated URL as the piece's video.
// 2. `multipart/form-data` (field `file`, optional `durationSec`) — local
//    dev fallback when BLOB_READ_WRITE_TOKEN is unset (mirrors
//    POST /api/pieces/[id]/image's local-upload path), or a direct server
//    upload when it is set.
//
// Same guard rails as the upload-token route: only reels/stories, only
// draft, and only when no video exists yet for the piece.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requirePieceEditor(req);
  if (authError) return authError;

  const { id } = await params;

  const existing = await prisma.piece.findUnique({ where: { id }, include: orderedImagesInclude });
  if (!existing) {
    return Response.json({ error: "piece not found" }, { status: 404 });
  }
  if (!(VIDEO_FORMATS as readonly string[]).includes(existing.format)) {
    return Response.json(
      { error: `vídeo só é permitido em reels/stories (formato atual: ${existing.format})` },
      { status: 422 },
    );
  }
  if (existing.status !== PieceStatus.draft) {
    return Response.json(
      {
        error: `não é possível alterar mídia de uma peça com status "${existing.status}" — apenas rascunhos`,
      },
      { status: 409 },
    );
  }
  if (existing.images.some(isVideoMedia)) {
    return Response.json(
      { error: "peça já possui um vídeo — remova antes de enviar outro" },
      { status: 409 },
    );
  }

  const contentTypeHeader = req.headers.get("content-type") ?? "";

  let url: string;
  let contentType: string;
  let durationSec: number | null = null;

  if (contentTypeHeader.startsWith("multipart/form-data")) {
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

    contentType = file.type;
    if (!ALLOWED_VIDEO_CONTENT_TYPES.has(contentType)) {
      return Response.json(
        { error: `unsupported content type: ${contentType || "unknown"} (allowed: mp4, mov)` },
        { status: 400 },
      );
    }
    if (file.size > MAX_VIDEO_BYTES) {
      return Response.json(
        { error: `file too large: ${file.size} bytes (max ${MAX_VIDEO_BYTES} bytes)` },
        { status: 400 },
      );
    }

    const durationRaw = formData.get("durationSec");
    if (durationRaw !== null) {
      const parsedDuration = Number(durationRaw);
      if (!Number.isInteger(parsedDuration) || parsedDuration <= 0) {
        return Response.json({ error: "durationSec must be a positive integer" }, { status: 400 });
      }
      durationSec = parsedDuration;
    }

    const extension = EXTENSION_BY_VIDEO_CONTENT_TYPE[contentType];
    const bytes = new Uint8Array(await file.arrayBuffer());

    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    if (blobToken) {
      const blob = await put(`pieces/${id}-video-${Date.now()}.${extension}`, Buffer.from(bytes), {
        access: "public",
        token: blobToken,
        contentType,
      });
      url = blob.url;
    } else {
      const uploadsDir = path.join(process.cwd(), "public", "uploads");
      await mkdir(uploadsDir, { recursive: true });
      const filename = `${id}-video-${Date.now()}.${extension}`;
      await writeFile(path.join(uploadsDir, filename), bytes);
      url = `/uploads/${filename}`;
    }
  } else {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }

    const parsed = registerVideoSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(parsed.data.url);
    } catch {
      return Response.json({ error: "url must be a valid URL" }, { status: 400 });
    }
    if (!parsedUrl.hostname.endsWith(BLOB_HOSTNAME_SUFFIX)) {
      return Response.json({ error: "url must be a Vercel Blob URL" }, { status: 400 });
    }
    if (!parsedUrl.pathname.includes(`pieces/${id}-video`)) {
      return Response.json(
        { error: `url must belong to this piece's upload prefix (pieces/${id}-video...)` },
        { status: 400 },
      );
    }

    url = parsed.data.url;
    contentType = parsed.data.contentType;
    durationSec = parsed.data.durationSec ?? null;
  }

  await prisma.pieceImage.create({
    data: { pieceId: id, url, sortOrder: 0, kind: "video", contentType, durationSec },
  });

  const piece = await prisma.piece.findUniqueOrThrow({ where: { id }, include: orderedImagesInclude });

  return Response.json({ piece });
}
