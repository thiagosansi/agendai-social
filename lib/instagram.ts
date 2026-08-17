// Typed client for the Instagram Graph API (Meta Graph API), used by the
// daily publish cron (app/api/cron/publish/route.ts) to push approved
// Pieces to Instagram. Every function reads the IG Business account id and
// access token from env (META_IG_USER_ID / META_IG_TOKEN) rather than
// taking them as parameters — this app only ever publishes to a single
// account.
//
// Meta's publish flow is always two calls: create a "container" (a pending
// media object) via POST /{ig-user-id}/media, then publish it via
// POST /{ig-user-id}/media_publish?creation_id=<container-id>. Containers
// are processed asynchronously server-side (Meta fetches the image), so a
// container must reach status_code=FINISHED before it can be published —
// see waitForContainerReady, called internally by publishContainer.
//
// Bump GRAPH_API_VERSION when Meta deprecates the pinned version.
const GRAPH_API_VERSION = "v23.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

const CONTAINER_READY_POLL_ATTEMPTS = 5;
const CONTAINER_READY_POLL_DELAY_MS = 5000;

// Meta error code for an expired/invalid OAuth token (OAuthException).
const META_ERROR_CODE_TOKEN_EXPIRED = 190;

/**
 * Typed error for any failed Meta Graph API call. Carries the raw
 * `code`/`error_subcode` from Meta's error body so callers can branch on
 * specific failure classes (e.g. expired token) instead of string-matching
 * the message.
 */
export class InstagramApiError extends Error {
  readonly code?: number;
  readonly errorSubcode?: number;
  readonly isTokenExpired: boolean;

  constructor(message: string, options: { code?: number; errorSubcode?: number } = {}) {
    super(message);
    this.name = "InstagramApiError";
    this.code = options.code;
    this.errorSubcode = options.errorSubcode;
    this.isTokenExpired = options.code === META_ERROR_CODE_TOKEN_EXPIRED;
  }

  /** User-facing message suitable for Piece.lastError. */
  toActionableMessage(): string {
    if (this.isTokenExpired) {
      return "Token Meta expirado — renove em /config";
    }
    if (this.code === undefined) {
      return this.message;
    }
    return `Erro Meta (${this.code}${this.errorSubcode ? `/${this.errorSubcode}` : ""}): ${this.message}`;
  }
}

interface MetaErrorBody {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
  };
}

interface InstagramConfig {
  igUserId: string;
  token: string;
}

function getConfig(): InstagramConfig {
  const igUserId = process.env.META_IG_USER_ID;
  const token = process.env.META_IG_TOKEN;
  if (!igUserId || !token) {
    throw new InstagramApiError(
      "Credenciais Meta não configuradas (META_IG_USER_ID/META_IG_TOKEN) — configure antes de publicar.",
    );
  }
  return { igUserId, token };
}

async function parseMetaError(res: Response): Promise<InstagramApiError> {
  let body: MetaErrorBody | null = null;
  try {
    body = (await res.json()) as MetaErrorBody;
  } catch {
    // Non-JSON error body — fall through to the generic message below.
  }
  const message = body?.error?.message || `Meta Graph API request failed with status ${res.status}`;
  return new InstagramApiError(message, {
    code: body?.error?.code,
    errorSubcode: body?.error?.error_subcode,
  });
}

async function graphPost<T>(path: string, token: string, params: Record<string, string>): Promise<T> {
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${GRAPH_API_BASE}${path}`, { method: "POST", body });
  if (!res.ok) throw await parseMetaError(res);
  return (await res.json()) as T;
}

async function graphGet<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const query = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${GRAPH_API_BASE}${path}?${query.toString()}`, { method: "GET" });
  if (!res.ok) throw await parseMetaError(res);
  return (await res.json()) as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CreateImageContainerInput {
  imageUrl: string;
  caption: string;
}

/** Creates a single-image post container. Returns the container id. */
export async function createImageContainer({ imageUrl, caption }: CreateImageContainerInput): Promise<string> {
  const { igUserId, token } = getConfig();
  const { id } = await graphPost<{ id: string }>(`/${igUserId}/media`, token, {
    image_url: imageUrl,
    caption,
  });
  return id;
}

export interface CreateStoryContainerInput {
  imageUrl: string;
}

/** Creates a Stories container (no caption support on Stories). */
export async function createStoryContainer({ imageUrl }: CreateStoryContainerInput): Promise<string> {
  const { igUserId, token } = getConfig();
  const { id } = await graphPost<{ id: string }>(`/${igUserId}/media`, token, {
    image_url: imageUrl,
    media_type: "STORIES",
  });
  return id;
}

export interface CreateCarouselContainerInput {
  imageUrls: string[];
  caption: string;
}

/**
 * Creates a true multi-image carousel: one child container per image
 * (is_carousel_item=true), then a parent CAROUSEL container referencing all
 * children. Not called by the v1 publish cron yet — Piece only stores a
 * single `imageUrl`, so carrossel pieces currently publish as a plain image
 * post via createImageContainer (see route.ts). This function exists for
 * when Piece gains multi-image support.
 */
export async function createCarouselContainer({
  imageUrls,
  caption,
}: CreateCarouselContainerInput): Promise<string> {
  if (imageUrls.length < 2) {
    throw new InstagramApiError("carousel requires at least 2 images");
  }
  const { igUserId, token } = getConfig();

  const childIds: string[] = [];
  for (const imageUrl of imageUrls) {
    const { id } = await graphPost<{ id: string }>(`/${igUserId}/media`, token, {
      image_url: imageUrl,
      is_carousel_item: "true",
    });
    childIds.push(id);
  }

  const { id: parentId } = await graphPost<{ id: string }>(`/${igUserId}/media`, token, {
    media_type: "CAROUSEL",
    children: childIds.join(","),
    caption,
  });
  return parentId;
}

interface ContainerStatus {
  status_code?: "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED" | "PUBLISHED";
}

/**
 * Polls a container's status_code until FINISHED, up to
 * CONTAINER_READY_POLL_ATTEMPTS times with CONTAINER_READY_POLL_DELAY_MS
 * between attempts. Throws InstagramApiError on ERROR/EXPIRED or on
 * exhausting the retry budget without reaching FINISHED.
 */
async function waitForContainerReady(containerId: string, token: string): Promise<void> {
  for (let attempt = 1; attempt <= CONTAINER_READY_POLL_ATTEMPTS; attempt += 1) {
    const status = await graphGet<ContainerStatus>(`/${containerId}`, token, { fields: "status_code" });
    if (status.status_code === "FINISHED") return;
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
      throw new InstagramApiError(
        `container ${containerId} failed to process (status_code=${status.status_code})`,
      );
    }
    if (attempt < CONTAINER_READY_POLL_ATTEMPTS) {
      await sleep(CONTAINER_READY_POLL_DELAY_MS);
    }
  }
  throw new InstagramApiError(
    `container ${containerId} did not finish processing within ${CONTAINER_READY_POLL_ATTEMPTS * CONTAINER_READY_POLL_DELAY_MS}ms`,
  );
}

export interface PublishedMedia {
  mediaId: string;
}

/** Waits for the container to be ready, then publishes it. */
export async function publishContainer(containerId: string): Promise<PublishedMedia> {
  const { igUserId, token } = getConfig();
  await waitForContainerReady(containerId, token);
  const { id } = await graphPost<{ id: string }>(`/${igUserId}/media_publish`, token, {
    creation_id: containerId,
  });
  return { mediaId: id };
}

/** Returns the public permalink for a published media, or null if absent. */
export async function getMediaPermalink(mediaId: string): Promise<string | null> {
  const { token } = getConfig();
  const { permalink } = await graphGet<{ permalink?: string }>(`/${mediaId}`, token, {
    fields: "permalink",
  });
  return permalink ?? null;
}

// --- Insights (app/api/cron/insights/route.ts) ---------------------------
//
// Meta's insights metric set differs by media product type, and older API
// versions reject the whole /insights call if ANY requested metric is
// unsupported for that specific media (a metric added in a later API
// version, or a Stories metric requested after its 24h insights window has
// closed). getMediaInsights below requests the full set first, and only
// falls back to fetching metrics one at a time if that batched call fails
// — so a single unsupported metric never costs the ones that ARE available.

/** Which Graph API metric set to request — mirrors media_product_type. */
export type MediaProductType = "FEED" | "STORY" | "REELS";

// Feed (single image / carrossel-as-single-image, per README "v1
// simplification"): reach, saves and interactions are stable metrics;
// `views` was added in a later API version and isn't valid on every media,
// hence the per-metric fallback.
const FEED_INSIGHTS_METRICS = ["reach", "saved", "likes", "comments", "shares", "views"];

// Stories: only available while the story exists (~24h). `navigation`
// replaced the older tap-forward/tap-back/exit breakdown metrics.
const STORY_INSIGHTS_METRICS = ["reach", "navigation"];

// Reels: not published by this app yet (see README "Publicação" — reels
// always fails with "vídeo ainda não suportado"), kept here so the insights
// cron degrades gracefully instead of crashing if a Reels media ever shows
// up (e.g. after a future feature adds video support).
const REELS_INSIGHTS_METRICS = ["reach", "saved", "likes", "comments", "shares", "plays"];

function metricsForProductType(mediaProductType: MediaProductType): string[] {
  switch (mediaProductType) {
    case "STORY":
      return STORY_INSIGHTS_METRICS;
    case "REELS":
      return REELS_INSIGHTS_METRICS;
    case "FEED":
    default:
      return FEED_INSIGHTS_METRICS;
  }
}

export interface MediaInsights {
  reach?: number;
  saved?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
  navigation?: number;
  plays?: number;
}

interface InsightsApiValue {
  name: string;
  values?: Array<{ value: number }>;
  total_value?: { value: number };
}

interface InsightsApiResponse {
  data?: InsightsApiValue[];
}

function collectInsights(response: InsightsApiResponse): MediaInsights {
  const result: MediaInsights = {};
  for (const entry of response.data ?? []) {
    const value = entry.total_value?.value ?? entry.values?.[0]?.value;
    if (value !== undefined) {
      (result as Record<string, number>)[entry.name] = value;
    }
  }
  return result;
}

/**
 * Fetches insights for a single published media. Tolerates individual
 * unsupported/unavailable metrics (returning fewer fields) instead of
 * throwing — only a genuinely broken request (expired token, deleted
 * media, rate limit) surfaces as an InstagramApiError. Callers should
 * treat an empty result as "nothing available yet", not an error.
 */
export async function getMediaInsights(
  mediaId: string,
  mediaProductType: MediaProductType = "FEED",
): Promise<MediaInsights> {
  const { token } = getConfig();
  const metricNames = metricsForProductType(mediaProductType);

  try {
    const response = await graphGet<InsightsApiResponse>(`/${mediaId}/insights`, token, {
      metric: metricNames.join(","),
    });
    return collectInsights(response);
  } catch {
    // At least one requested metric isn't available for this media — retry
    // metric by metric so the ones that ARE available aren't lost too.
  }

  const result: MediaInsights = {};
  for (const metric of metricNames) {
    try {
      const response = await graphGet<InsightsApiResponse>(`/${mediaId}/insights`, token, { metric });
      Object.assign(result, collectInsights(response));
    } catch {
      // Tolerate: this single metric isn't available for this media (e.g.
      // a Stories metric requested after the 24h insights window closed).
    }
  }
  return result;
}

export interface AccountInfo {
  followersCount: number | null;
}

/** Fetches the IG Business account's current follower count. */
export async function getAccountInfo(): Promise<AccountInfo> {
  const { igUserId, token } = getConfig();
  const { followers_count: followersCount } = await graphGet<{ followers_count?: number }>(
    `/${igUserId}`,
    token,
    { fields: "followers_count" },
  );
  return { followersCount: followersCount ?? null };
}

// --- Market scan (lib/market-scan.ts, GET /api/analysis/market) ----------
//
// The monthly analysis routine runs as an isolated cloud agent that never
// holds META_IG_TOKEN, so market/competitor research must be mediated by
// this app the same way GET /api/analysis/source mediates performance
// data. These helpers wrap two read-only Graph endpoints: Business
// Discovery (public profile + recent media of another Business/Creator
// account) and hashtag top-media search. Both require the connected
// account to itself be a Business/Creator account with
// instagram_basic + instagram_manage_insights permissions.

/** True when META_IG_USER_ID/META_IG_TOKEN are both set — never reads or returns the token value itself. */
export function hasInstagramCredentials(): boolean {
  return !!process.env.META_IG_USER_ID && !!process.env.META_IG_TOKEN;
}

export interface BusinessDiscoveryMedia {
  caption: string | null;
  commentsCount: number;
  likeCount: number;
  mediaType: string;
  mediaProductType?: string;
  timestamp: string;
  permalink: string;
}

export interface BusinessDiscoveryResult {
  username: string;
  followersCount: number;
  mediaCount: number;
  media: BusinessDiscoveryMedia[];
}

interface RawBusinessDiscoveryMedia {
  caption?: string;
  like_count?: number;
  comments_count?: number;
  media_type?: string;
  media_product_type?: string;
  timestamp?: string;
  permalink?: string;
}

interface RawBusinessDiscoveryResponse {
  business_discovery?: {
    username?: string;
    followers_count?: number;
    media_count?: number;
    media?: { data?: RawBusinessDiscoveryMedia[] };
  };
}

/**
 * Fetches a public competitor profile + up to 12 recent posts via Business
 * Discovery. Throws InstagramApiError if `business_discovery` is absent
 * from the response (private account, not found, or not a Business/Creator
 * account) instead of crashing on the destructure.
 */
// Mirrors marketCompetitorsSchema in lib/validation.ts. Settings writes are
// already validated against this shape, but getBusinessDiscovery is an
// exported function with no guard of its own — a value containing `)`,
// `}` or `,` would break the Graph `fields` selector below, so re-check
// here rather than trust the caller.
const USERNAME_PATTERN = /^[a-z0-9._]{1,30}$/;

export async function getBusinessDiscovery(username: string): Promise<BusinessDiscoveryResult> {
  if (!USERNAME_PATTERN.test(username)) {
    throw new InstagramApiError("invalid instagram username");
  }
  const { igUserId, token } = getConfig();
  const response = await graphGet<RawBusinessDiscoveryResponse>(`/${igUserId}`, token, {
    fields: `business_discovery.username(${username}){username,followers_count,media_count,media.limit(12){caption,like_count,comments_count,media_type,media_product_type,timestamp,permalink}}`,
  });

  const discovery = response.business_discovery;
  if (!discovery) {
    throw new InstagramApiError(
      `business discovery unavailable for @${username} — private, not found, or not a Business/Creator account`,
    );
  }

  return {
    username: discovery.username ?? username,
    followersCount: discovery.followers_count ?? 0,
    mediaCount: discovery.media_count ?? 0,
    media: (discovery.media?.data ?? []).map((item) => ({
      caption: item.caption ?? null,
      commentsCount: item.comments_count ?? 0,
      likeCount: item.like_count ?? 0,
      mediaType: item.media_type ?? "UNKNOWN",
      mediaProductType: item.media_product_type,
      timestamp: item.timestamp ?? "",
      permalink: item.permalink ?? "",
    })),
  };
}

export interface HashtagMediaItem {
  caption: string | null;
  likeCount: number;
  commentsCount: number;
  mediaType: string;
  timestamp: string;
  permalink: string;
}

export interface HashtagTopMediaResult {
  tag: string;
  hashtagId: string;
  media: HashtagMediaItem[];
}

interface RawHashtagSearchResponse {
  data?: Array<{ id?: string }>;
}

interface RawHashtagMediaItem {
  caption?: string;
  like_count?: number;
  comments_count?: number;
  media_type?: string;
  permalink?: string;
  timestamp?: string;
}

interface RawHashtagTopMediaResponse {
  data?: RawHashtagMediaItem[];
}

/**
 * Resolves a hashtag to its Graph id via ig_hashtag_search, then fetches up
 * to 15 top-media posts for it. Throws InstagramApiError if the search
 * returns no id (hashtag doesn't exist / no matching hashtag object).
 */
// Mirrors marketHashtagsSchema in lib/validation.ts — same rationale as
// USERNAME_PATTERN above (getHashtagTopMedia is exported and shouldn't
// trust its caller either).
const HASHTAG_PATTERN = /^[\p{L}\p{N}_]{1,60}$/u;

export async function getHashtagTopMedia(tag: string): Promise<HashtagTopMediaResult> {
  if (!HASHTAG_PATTERN.test(tag)) {
    throw new InstagramApiError("invalid hashtag");
  }
  const { igUserId, token } = getConfig();

  const search = await graphGet<RawHashtagSearchResponse>("/ig_hashtag_search", token, {
    user_id: igUserId,
    q: tag,
  });
  const hashtagId = search.data?.[0]?.id;
  if (!hashtagId) {
    throw new InstagramApiError(`hashtag not found: #${tag}`);
  }

  const topMedia = await graphGet<RawHashtagTopMediaResponse>(`/${hashtagId}/top_media`, token, {
    user_id: igUserId,
    fields: "caption,like_count,comments_count,media_type,permalink,timestamp",
    limit: "15",
  });

  return {
    tag,
    hashtagId,
    media: (topMedia.data ?? []).map((item) => ({
      caption: item.caption ?? null,
      likeCount: item.like_count ?? 0,
      commentsCount: item.comments_count ?? 0,
      mediaType: item.media_type ?? "UNKNOWN",
      timestamp: item.timestamp ?? "",
      permalink: item.permalink ?? "",
    })),
  };
}
