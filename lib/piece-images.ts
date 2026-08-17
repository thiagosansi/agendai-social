import type { Prisma } from "@prisma/client";

// Shared `include` shape so every route returning a Piece (or a list of
// them) exposes `images` in a consistent, publish-order-safe shape —
// index 0 is the carousel's first slide / the single-image formats' cover.
export const orderedImagesInclude = {
  images: { orderBy: { sortOrder: "asc" } },
} satisfies Prisma.PieceInclude;
