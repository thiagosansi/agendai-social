import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { put } from "@vercel/blob";

// Local dev image uploads (app/api/pieces/[id]/image falls back to
// public/uploads when BLOB_READ_WRITE_TOKEN is unset) are served under this
// prefix and are NOT reachable by Meta's servers — only a real host (Vercel
// Blob) can fetch image_url. Shared by lib/cron-publish.ts (reachability
// check before publishing) and the image mutation routes (file cleanup).
export const LOCAL_UPLOAD_PREFIX = "/uploads/";

/** Maps MIME type to file extension for media uploads. */
export const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function isLocalUploadUrl(url: string): boolean {
  return url.startsWith(LOCAL_UPLOAD_PREFIX);
}

/** Deletes a local /uploads/... file if it exists; no-ops for Blob URLs. */
export async function deleteLocalUploadFile(url: string): Promise<void> {
  if (!isLocalUploadUrl(url)) return;
  const filename = url.slice(LOCAL_UPLOAD_PREFIX.length);
  await unlink(path.join(process.cwd(), "public", "uploads", filename)).catch(() => {});
}

/**
 * Stores media bytes for a piece (image or generated media) and returns the URL.
 * When BLOB_READ_WRITE_TOKEN is set, uploads to Vercel Blob with public access.
 * Otherwise, writes to public/uploads/ locally (dev mode).
 *
 * `variant` is an optional suffix (e.g. "source") appended to the filename
 * stem so two bytes stored for the same pieceId/sortOrder in the same
 * millisecond — the clean source photo and its text-composed counterpart,
 * see lib/image-generation.ts — never collide on the same name.
 *
 * Shared by image upload routes and server-side media generation.
 */
export async function storePieceMediaBytes(input: {
  pieceId: string;
  sortOrder: number;
  contentType: string;
  bytes: Uint8Array;
  variant?: string;
}): Promise<string> {
  const extension = EXTENSION_BY_CONTENT_TYPE[input.contentType];
  if (!extension) {
    throw new Error(`unsupported content type: ${input.contentType}`);
  }

  const stem = `${input.pieceId}-${input.sortOrder}-${Date.now()}${input.variant ? `-${input.variant}` : ""}`;
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

  if (blobToken) {
    const blob = await put(`pieces/${stem}.${extension}`, Buffer.from(input.bytes), {
      access: "public",
      token: blobToken,
      contentType: input.contentType,
    });
    return blob.url;
  } else {
    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadsDir, { recursive: true });
    const filename = `${stem}.${extension}`;
    await writeFile(path.join(uploadsDir, filename), input.bytes);
    return `${LOCAL_UPLOAD_PREFIX}${filename}`;
  }
}
