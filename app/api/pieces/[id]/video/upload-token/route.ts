import type { NextRequest } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { PieceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePieceEditor } from "@/lib/session";
import { isVideoMedia, orderedImagesInclude } from "@/lib/piece-images";
import { ALLOWED_VIDEO_CONTENT_TYPES, MAX_VIDEO_BYTES, VIDEO_FORMATS } from "@/lib/validation";

export const runtime = "nodejs";

// POST /api/pieces/[id]/video/upload-token
// Issues a client upload token for @vercel/blob/client's upload() helper —
// the video (up to MAX_VIDEO_BYTES) goes straight from the browser to Blob
// storage, bypassing this server entirely, since a serverless function's
// request body limit is far smaller than 200MB. Only reels/stories in
// draft, and only when the piece doesn't already hold a video (remove it
// via DELETE /api/pieces/[id]/image/[imageId] first — see route.ts).
//
// When BLOB_READ_WRITE_TOKEN is unset (local dev with no Blob store
// configured), returns { mode: "local" } instead of a token — the client
// then falls back to POSTing multipart/form-data directly to
// POST /api/pieces/[id]/video, same as the local-dev image upload path.
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

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    return Response.json({ mode: "local" });
  }

  let body: HandleUploadBody;
  try {
    body = (await req.json()) as HandleUploadBody;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      token: blobToken,
      onBeforeGenerateToken: async (pathname) => {
        // Every video for this piece must land under this prefix — prevents
        // a client token minted for piece A from being reused to write into
        // piece B's (or an unrelated) blob path.
        if (!pathname.startsWith(`pieces/${id}-video`)) {
          throw new Error(`invalid pathname: expected prefix "pieces/${id}-video"`);
        }
        return {
          allowedContentTypes: [...ALLOWED_VIDEO_CONTENT_TYPES],
          maximumSizeInBytes: MAX_VIDEO_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ pieceId: id }),
        };
      },
      onUploadCompleted: async () => {
        // No-op: Vercel's client-upload completion webhook can't reach a
        // localhost dev server, and in production the browser explicitly
        // calls POST /api/pieces/[id]/video right after upload() resolves
        // to register the blob as a PieceImage — registration never depends
        // on this callback actually firing.
      },
    });
    return Response.json(jsonResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 400 });
  }
}
