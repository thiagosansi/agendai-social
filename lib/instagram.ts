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
