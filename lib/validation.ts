import { z } from "zod";

// PieceFormat values, kept in sync with the `PieceFormat` enum in
// prisma/schema.prisma.
export const PIECE_FORMATS = ["carrossel", "reels", "estatico", "stories"] as const;

// Only draft/approved are ever settable by a client. published/failed are
// exclusively set by the daily publish cron (a later task).
export const CLIENT_SETTABLE_STATUSES = ["draft", "approved"] as const;

// Piece.imageGenStatus lifecycle (prisma/schema.prisma): idle -> queued ->
// running -> done/failed. Only meaningful for the automated image
// generation pipeline (a later task); kept here so callers importing
// validation types don't need to hand-roll the union.
export const IMAGE_GEN_STATUSES = ["idle", "queued", "running", "done", "failed"] as const;
export type ImageGenStatus = (typeof IMAGE_GEN_STATUSES)[number];

// POST /api/pieces/[id]/image/generate (JSON body, optional — an
// empty/absent body defaults to "replace"). "replace" deletes every
// existing generated image and regenerates the full set; "resume" only
// fills in the slide indices that don't have an image yet (same
// idempotent-by-sortOrder behavior generatePieceImages already has for the
// automatic pipeline). "recompose" never calls the image provider — it
// reapplies the piece's current overlayText/overlayTexts on top of each
// existing PieceImage.sourceUrl (see lib/image-generation.ts's
// recomposePieceImages), so it works even without an image provider
// configured.
export const generateImagesSchema = z.object({
  mode: z.enum(["replace", "resume", "recompose"]).optional().default("replace"),
});

export type GenerateImagesInput = z.infer<typeof generateImagesSchema>;

// imagePrompts: one prompt per carrossel slide, for the automated image
// generation pipeline. Only accepted when format=carrossel — enforced in
// the route (needs the piece's format), not here. 2-10 mirrors
// MIN/MAX_CARROSSEL_IMAGES_TO_APPROVE below.
const imagePromptsSchema = z.array(z.string().trim().min(1)).min(2).max(10);

// overlayText/overlayTexts: the text the app draws on top of the piece's
// photo(s) — see prisma/schema.prisma's Piece.overlayText for why this isn't
// left to the image model. 200 chars is generous for a short hook/caption
// overlay; "" is a valid overlayTexts entry (that slide gets no text).
export const MAX_OVERLAY_TEXT_LEN = 200;
const overlayTextSchema = z.string().trim().max(MAX_OVERLAY_TEXT_LEN);
const overlayTextsSchema = z.array(overlayTextSchema).max(10);

export const createPieceSchema = z.object({
  pillar: z.string().trim().min(1, "pillar is required"),
  segment: z.string().trim().min(1, "segment is required"),
  format: z.enum(PIECE_FORMATS),
  caption: z.string().trim().min(1, "caption is required"),
  imagePrompt: z.string().trim().min(1, "imagePrompt is required"),
  imagePrompts: imagePromptsSchema.optional(),
  overlayText: overlayTextSchema.optional(),
  overlayTexts: overlayTextsSchema.optional(),
  publishAt: z.coerce.date({ error: "publishAt must be a valid date" }),
});

export type CreatePieceInput = z.infer<typeof createPieceSchema>;

export const patchPieceSchema = z
  .object({
    caption: z.string().trim().min(1).optional(),
    imagePrompt: z.string().trim().min(1).optional(),
    imagePrompts: imagePromptsSchema.optional(),
    overlayText: overlayTextSchema.optional(),
    overlayTexts: overlayTextsSchema.optional(),
    publishAt: z.coerce.date().optional(),
    status: z.enum(CLIENT_SETTABLE_STATUSES).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message:
      "at least one of caption, imagePrompt, imagePrompts, overlayText, overlayTexts, publishAt, status must be provided",
  });

export type PatchPieceInput = z.infer<typeof patchPieceSchema>;

export const ALLOWED_IMAGE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// Video support (reels/stories only — app/api/pieces/[id]/video/*.ts).
// MP4 and MOV are the two containers Meta's Content Publishing API accepts
// for video (H.264/AAC encoded); 200MB mirrors Meta's own Reels/Stories
// video upload cap.
const VIDEO_CONTENT_TYPES = ["video/mp4", "video/quicktime"] as const;
export const ALLOWED_VIDEO_CONTENT_TYPES = new Set<string>(VIDEO_CONTENT_TYPES);
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

// Meta's published limits: Reels up to 15min, Stories video up to 60s.
export const MAX_REELS_DURATION_SEC = 900;
export const MAX_STORY_VIDEO_DURATION_SEC = 60;

// PieceFormat values that accept video media (lib/piece-images.ts's
// isVideoMedia). estatico/carrossel stay image-only.
export const VIDEO_FORMATS = ["reels", "stories"] as const;

// POST /api/pieces/[id]/video (JSON body) — registers a video already
// uploaded directly to Vercel Blob via the client upload token flow
// (app/api/pieces/[id]/video/upload-token/route.ts). `size` is validated
// here but not persisted (PieceImage has no size column); it exists purely
// so an oversized direct-to-Blob upload can still be rejected server-side.
export const registerVideoSchema = z.object({
  url: z.string().url("url must be a valid URL"),
  contentType: z.enum(VIDEO_CONTENT_TYPES),
  size: z.number().int().positive().max(MAX_VIDEO_BYTES, "file too large"),
  durationSec: z.number().int().positive().optional(),
});

export type RegisterVideoInput = z.infer<typeof registerVideoSchema>;

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

// Normalizers for the market intelligence lists below — strip the leading
// @/# a user is likely to paste from Instagram, and lowercase so the same
// handle/tag doesn't end up duplicated by case alone.
export function normalizeInstagramUsername(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

// Internal spaces are intentionally NOT stripped here — "#Salão de Beleza"
// is a multi-word phrase, not a hashtag, and must fail the regex below
// rather than be silently squashed into one word.
export function normalizeHashtag(raw: string): string {
  return raw.trim().replace(/^#/, "").toLowerCase();
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items));
}

function dedupeNumbers(items: number[]): number[] {
  return Array.from(new Set(items)).sort((a, b) => a - b);
}

// Instagram usernames: letters, digits, periods and underscores, 1-30 chars.
export const marketCompetitorsSchema = z
  .array(
    z
      .string()
      .transform(normalizeInstagramUsername)
      .pipe(z.string().regex(/^[a-z0-9._]{1,30}$/, "invalid instagram username")),
  )
  .max(8)
  .transform(dedupe);

// Hashtags: letters (incl. accented, via \p{L}) and digits/underscore, no
// spaces or leading #, 1-60 chars.
export const marketHashtagsSchema = z
  .array(
    z
      .string()
      .transform(normalizeHashtag)
      .pipe(z.string().regex(/^[\p{L}\p{N}_]{1,60}$/u, "invalid hashtag")),
  )
  .max(10)
  .transform(dedupe);

// Posting cadence — pieces per round and the weekday/time slots the
// generation routine distributes publishAt across (lib/settings.ts's
// CadenceConfig). postingWeekdays is deduped + sorted ascending so
// downstream consumers (computeNextPublishSlots) never see duplicates or an
// unsorted list.
const postingWeekdaysSchema = z.array(z.number().int().min(0).max(6)).min(1).max(7).transform(dedupeNumbers);

const postingTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "postingTime must be HH:MM");

// PATCH /api/settings — partial update of the pause/kill-switch flags,
// generation cadence and market intelligence lists in AppSetting
// (lib/settings.ts). All fields optional so the Config page can update one
// control at a time, and the Fila page's "Gerar rodada agora" button can
// PATCH only forceNextGeneration.
export const patchSettingsSchema = z
  .object({
    generationPaused: z.boolean().optional(),
    publishingPaused: z.boolean().optional(),
    generationIntervalWeeks: z.number().int().min(1).max(4).optional(),
    forceNextGeneration: z.boolean().optional(),
    marketCompetitors: marketCompetitorsSchema.optional(),
    marketHashtags: marketHashtagsSchema.optional(),
    piecesPerRound: z.number().int().min(1).max(4).optional(),
    postingWeekdays: postingWeekdaysSchema.optional(),
    postingTime: postingTimeSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message:
      "at least one of generationPaused, publishingPaused, generationIntervalWeeks, forceNextGeneration, marketCompetitors, marketHashtags, piecesPerRound, postingWeekdays, postingTime must be provided",
  });

export type PatchSettingsInput = z.infer<typeof patchSettingsSchema>;

// Viewer usernames: lowercase letters, digits, periods and underscores,
// 3-30 chars. "admin" is reserved for the owner (lib/session.ts's
// OWNER_USERNAME) and rejected here so a viewer row can never collide with
// the owner's identity.
//
// The messages here are user-facing: POST /api/users surfaces the first zod
// issue verbatim, and the Config page renders it under the form. Keep them in
// Portuguese and actionable, and keep them in sync with the hints next to the
// fields in components/config/ViewersControls.tsx.
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9._]{3,30}$/,
    "Usuário inválido: use 3 a 30 caracteres, apenas letras minúsculas, números, ponto ou _.",
  )
  .refine((username) => username !== "admin", 'Usuário reservado: "admin" é a conta do dono.');

export const MIN_VIEWER_PASSWORD_LENGTH = 8;

export const viewerPasswordSchema = z
  .string()
  .min(
    MIN_VIEWER_PASSWORD_LENGTH,
    `A senha precisa ter pelo menos ${MIN_VIEWER_PASSWORD_LENGTH} caracteres.`,
  )
  .max(200, "A senha pode ter no máximo 200 caracteres.");

// ViewerUser.role values (prisma/schema.prisma), kept in sync with
// lib/session.ts's SessionRole minus "owner" (the owner is not a
// ViewerUser row). "viewer" is read-only; "approver" gets the full piece
// workflow (caption/prompt, images, approve/disapprove) but no Config, no
// manual round, no settings/push/users API.
export const USER_ROLES = ["viewer", "approver"] as const;
export type UserRole = (typeof USER_ROLES)[number];

// POST /api/auth/login — accepts both the owner (username "admin") and
// viewer credentials; usernameSchema's stricter shape/length is enforced
// separately at viewer-creation time (createViewerUserSchema below), not
// here, since "admin" itself must be allowed through this schema.
export const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1, "username is required"),
  password: z.string().min(1, "password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;

// POST /api/users — creates a new ViewerUser (managed on /config by the
// owner). `role` defaults to "viewer" (read-only) when omitted.
export const createViewerUserSchema = z.object({
  username: usernameSchema,
  password: viewerPasswordSchema,
  role: z.enum(USER_ROLES).optional().default("viewer"),
});

export type CreateViewerUserInput = z.infer<typeof createViewerUserSchema>;

// PATCH /api/users/[id] — toggles a ViewerUser's active flag and/or changes
// its role. At least one field must be provided.
export const patchViewerUserSchema = z
  .object({
    active: z.boolean().optional(),
    role: z.enum(USER_ROLES).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "at least one of active, role must be provided",
  });

export type PatchViewerUserInput = z.infer<typeof patchViewerUserSchema>;

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

// AnalysisReport.recommendations[].type values (prisma/schema.prisma).
export const ANALYSIS_RECOMMENDATION_TYPES = ["promote", "avoid", "test", "caption", "image"] as const;

// AnalysisReport.schemaVersion values. v1 is summary + insights +
// recommendations only; v2 adds insights.market (competitor/hashtag/web
// research) and root-level contentProposals (see analysisMarketSchema and
// contentProposalSchema below).
export const ANALYSIS_SCHEMA_VERSIONS = [1, 2] as const;

// POST /api/analysis — creates an AnalysisReport. `insights` and
// `recommendations` are validated against fixed shapes (rather than left as
// free-form Json) so downstream consumers (the generation routine reading
// GET /api/analysis/latest) can rely on the structure without re-checking
// it themselves.
const rawDeltaSchema = z.object({
  current: z.number(),
  previous: z.number(),
  deltaPct: z.number().nullable(),
});

const analysisInsightsSchema = z.object({
  topCombos: z.array(
    z.object({
      pillar: z.string(),
      format: z.string(),
      avgEngagement: z.number(),
      pieces: z.number(),
    }),
  ),
  hookPatterns: z.array(
    z.object({
      pattern: z.string(),
      evidence: z.string(),
    }),
  ),
  captionPatterns: z.array(
    z.object({
      pattern: z.string(),
      evidence: z.string(),
    }),
  ),
  formatTactics: z.array(
    z.object({
      format: z.string(),
      tactic: z.string(),
      evidence: z.string(),
    }),
  ),
  imagePromptGuidelines: z.array(z.string()),
  rawDeltas: z.object({
    reach: rawDeltaSchema,
    engagement: rawDeltaSchema,
    followers: rawDeltaSchema,
  }),
  // schemaVersion 2 only — market intelligence gathered from competitors,
  // hashtags and web research. Absent on v1 reports and optional on v2 ones
  // (a v2 report may still omit it if the routine found nothing useful).
  market: z
    .object({
      competitors: z.array(
        z.object({
          username: z.string(),
          followers: z.number(),
          avgLikes: z.number(),
          avgComments: z.number(),
          themes: z.array(z.string()),
          topPosts: z.array(
            z.object({
              permalink: z.string(),
              likes: z.number(),
              comments: z.number(),
              hookType: z.string(),
            }),
          ),
        }),
      ),
      hashtags: z.array(
        z.object({
          tag: z.string(),
          themes: z.array(z.string()),
          samplePermalinks: z.array(z.string()),
        }),
      ),
      webTrends: z.array(
        z.object({
          title: z.string(),
          url: z.string(),
          takeaway: z.string(),
        }),
      ),
    })
    .optional(),
});

export type AnalysisMarketInput = NonNullable<z.infer<typeof analysisInsightsSchema>["market"]>;

const analysisRecommendationSchema = z.object({
  type: z.enum(ANALYSIS_RECOMMENDATION_TYPES),
  text: z.string().trim().min(1, "text is required"),
  evidence: z.string(),
  priority: z.number().int().min(0).max(2),
});

// schemaVersion 2 only — a ready-to-review content proposal the founder can
// turn into a Piece, backed by the market research above.
const contentProposalSchema = z.object({
  pillar: z.string().trim().min(1, "pillar is required"),
  segment: z.string().trim().min(1, "segment is required"),
  format: z.enum(PIECE_FORMATS),
  hook: z.string().trim().min(1, "hook is required"),
  captionDraft: z.string().trim().min(1, "captionDraft is required").max(2200),
  imagePrompt: z.string().trim().min(1, "imagePrompt is required"),
  rationale: z.string(),
  sources: z.array(z.string()),
});

export type ContentProposalInput = z.infer<typeof contentProposalSchema>;

export const createAnalysisReportSchema = z
  .object({
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
    summaryMarkdown: z.string().trim().min(1, "summaryMarkdown is required").max(20000),
    insights: analysisInsightsSchema,
    recommendations: z.array(analysisRecommendationSchema).max(5),
    // schemaVersion 2 only — validated the same as recommendations (max 5).
    contentProposals: z.array(contentProposalSchema).max(5).optional(),
    schemaVersion: z.union([z.literal(1), z.literal(2)]).optional().default(1),
  })
  .refine((data) => new Date(data.periodEnd) >= new Date(data.periodStart), {
    message: "periodEnd must be after periodStart",
    path: ["periodEnd"],
  });

export type CreateAnalysisReportInput = z.infer<typeof createAnalysisReportSchema>;
