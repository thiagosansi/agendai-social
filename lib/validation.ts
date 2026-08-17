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

// Per-format image count limits (app/api/pieces/[id]/image/route.ts).
// carrossel needs at least 2 images to publish as a real Instagram carousel
// (see docs on lib/instagram.ts's createCarouselContainer); other formats
// use a single "cover" image, so a second upload replaces the first instead
// of appending.
export const MAX_CARROSSEL_IMAGES = 10;
export const MIN_CARROSSEL_IMAGES_TO_APPROVE = 2;

// PATCH /api/pieces/[id]/image/reorder — reorders the images of a draft
// piece. imageOrder must contain exactly the same PieceImage ids currently
// stored for the piece (validated in the route, not here, since it needs a
// DB read).
export const reorderImagesSchema = z.object({
  imageOrder: z.array(z.string().min(1)).min(1, "imageOrder must not be empty"),
});

export type ReorderImagesInput = z.infer<typeof reorderImagesSchema>;

// PATCH /api/settings — partial update of the pause/kill-switch flags and
// generation cadence in AppSetting (lib/settings.ts). All fields optional so
// the Config page can update one control at a time, and the Fila page's
// "Gerar rodada agora" button can PATCH only forceNextGeneration.
export const patchSettingsSchema = z
  .object({
    generationPaused: z.boolean().optional(),
    publishingPaused: z.boolean().optional(),
    generationIntervalWeeks: z.number().int().min(1).max(4).optional(),
    forceNextGeneration: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message:
      "at least one of generationPaused, publishingPaused, generationIntervalWeeks, forceNextGeneration must be provided",
  });

export type PatchSettingsInput = z.infer<typeof patchSettingsSchema>;

// POST /api/push/subscribe — the shape a browser's PushSubscription
// serialises to (`JSON.parse(JSON.stringify(subscription))`). Only the fields
// we persist are declared; `expirationTime` and friends are ignored.
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url("endpoint must be a valid URL"),
  keys: z.object({
    p256dh: z.string().min(1, "keys.p256dh is required"),
    auth: z.string().min(1, "keys.auth is required"),
  }),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

// POST /api/push/unsubscribe — the endpoint alone identifies the subscription.
export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url("endpoint must be a valid URL"),
});
