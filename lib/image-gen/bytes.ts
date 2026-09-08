// Byte-level image helpers shared by every lib/image-gen provider adapter.

/**
 * Sniffs an image's content type from its magic bytes (JPEG/PNG/WebP).
 * Provider response envelopes (Cloudflare's JSON, fal.ai's download) don't
 * always carry a trustworthy content-type, so every adapter falls back to
 * this instead of trusting the model's declared format.
 *
 * Falls back to "image/jpeg" when the bytes don't match a known format —
 * matches the image models' own default encoding for unrecognized output.
 */
export function sniffImageContentType(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return "image/jpeg";
}
