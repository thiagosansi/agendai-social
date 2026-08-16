import { z } from "zod";

// PieceFormat values, kept in sync with the `PieceFormat` enum in
// prisma/schema.prisma.
export const PIECE_FORMATS = ["carrossel", "reels", "estatico", "stories"] as const;

// Only draft/approved are ever settable by a client. published/failed are
// exclusively set by the daily publish cron (a later task).
export const CLIENT_SETTABLE_STATUSES = ["draft", "approved"] as const;

export const createPieceSchema = z.object({
  pillar: z.string().trim().min(1, "pillar is required"),
  segment: z.string().trim().min(1, "segment is required"),
  format: z.enum(PIECE_FORMATS),
  caption: z.string().trim().min(1, "caption is required"),
  imagePrompt: z.string().trim().min(1, "imagePrompt is required"),
  publishAt: z.coerce.date({ error: "publishAt must be a valid date" }),
});

export type CreatePieceInput = z.infer<typeof createPieceSchema>;

export const patchPieceSchema = z
  .object({
    caption: z.string().trim().min(1).optional(),
    imagePrompt: z.string().trim().min(1).optional(),
    publishAt: z.coerce.date().optional(),
    status: z.enum(CLIENT_SETTABLE_STATUSES).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "at least one of caption, imagePrompt, publishAt, status must be provided",
  });

export type PatchPieceInput = z.infer<typeof patchPieceSchema>;

export const ALLOWED_IMAGE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
