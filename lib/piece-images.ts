import type { Prisma, PieceImage } from "@prisma/client";

// Shared `include` shape so every route returning a Piece (or a list of
// them) exposes `images` in a consistent, publish-order-safe shape —
// index 0 is the carousel's first slide / the single-image formats' cover.
// `images: { orderBy }` (rather than a `select`) still returns every
// PieceImage column, so the video fields (kind/contentType/durationSec/
// coverUrl) added alongside url/sortOrder are included automatically —
// no change needed here when those columns were added.
export const orderedImagesInclude = {
  images: { orderBy: { sortOrder: "asc" } },
} satisfies Prisma.PieceInclude;

// True when a PieceImage row is a video (reels/stories only — see
// lib/validation.ts's VIDEO_FORMATS). Centralized here instead of every
// caller string-comparing `kind === "video"` directly.
export function isVideoMedia(media: Pick<PieceImage, "kind">): boolean {
  return media.kind === "video";
}
