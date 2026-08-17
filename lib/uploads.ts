import { unlink } from "node:fs/promises";
import path from "node:path";

// Local dev image uploads (app/api/pieces/[id]/image falls back to
// public/uploads when BLOB_READ_WRITE_TOKEN is unset) are served under this
// prefix and are NOT reachable by Meta's servers — only a real host (Vercel
// Blob) can fetch image_url. Shared by lib/cron-publish.ts (reachability
// check before publishing) and the image mutation routes (file cleanup).
export const LOCAL_UPLOAD_PREFIX = "/uploads/";

export function isLocalUploadUrl(url: string): boolean {
  return url.startsWith(LOCAL_UPLOAD_PREFIX);
}

/** Deletes a local /uploads/... file if it exists; no-ops for Blob URLs. */
export async function deleteLocalUploadFile(url: string): Promise<void> {
  if (!isLocalUploadUrl(url)) return;
  const filename = url.slice(LOCAL_UPLOAD_PREFIX.length);
  await unlink(path.join(process.cwd(), "public", "uploads", filename)).catch(() => {});
}
