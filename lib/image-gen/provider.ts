// Provider-agnostic interface for AI image generation, used by the piece
// image-generation flow to fall back gracefully when no provider is
// configured (manual upload keeps working either way — see lib/uploads.ts).
// getImageProvider() is the single place that decides which implementation
// to build (lib/image-gen/cloudflare.ts, the production default, or
// lib/image-gen/fal.ts) based on IMAGE_PROVIDER.

import {
  CLOUDFLARE_FALLBACK_IMAGE_MODEL,
  createCloudflareImageProvider,
  DEFAULT_CLOUDFLARE_IMAGE_MODEL,
  ImageProviderQuotaError,
} from "./cloudflare";
import { createFalImageProvider, DEFAULT_FAL_IMAGE_MODEL } from "./fal";

export type ImageAspect = "1:1" | "4:5" | "9:16";

export interface ImageProvider {
  readonly name: string;
  generate(input: {
    prompt: string;
    aspect: ImageAspect;
    signal?: AbortSignal;
  }): Promise<{ bytes: Uint8Array; contentType: string; model?: string }>;
}

/**
 * Wraps a primary provider with a fallback that only kicks in when the
 * primary throws ImageProviderQuotaError (out of quota/capacity for the
 * requested model) — see lib/image-gen/cloudflare.ts. Any other error
 * (invalid input, auth, malformed response, ...) propagates unchanged; a
 * fallback failure is re-thrown with a prefix naming both providers so the
 * caller can tell the whole generation (not just the primary) failed.
 */
export function withFallback(primary: ImageProvider, fallback: ImageProvider): ImageProvider {
  return {
    name: `${primary.name} -> fallback ${fallback.name}`,

    async generate(input) {
      try {
        return await primary.generate(input);
      } catch (err) {
        if (!(err instanceof ImageProviderQuotaError)) {
          throw err;
        }
        console.warn(
          `image-gen: ${primary.name} sem cota/capacidade, tentando fallback ${fallback.name}`,
        );
        try {
          return await fallback.generate(input);
        } catch (fallbackErr) {
          const fallbackMessage =
            fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          throw new Error(
            `image-gen: ${primary.name} e ${fallback.name} falharam — ${fallbackMessage}`,
          );
        }
      }
    },
  };
}

// Pixel dimensions per aspect ratio, tuned for Instagram feed posts (1:1,
// 4:5) and stories/reels (9:16). Shared by every provider so callers don't
// need to know provider-specific sizing rules.
export const ASPECT_DIMENSIONS: Record<ImageAspect, { width: number; height: number }> = {
  "1:1": { width: 1024, height: 1024 },
  "4:5": { width: 1024, height: 1280 },
  "9:16": { width: 1080, height: 1920 },
};

/**
 * Builds the configured image provider, or null when the feature is off
 * (unset/unknown IMAGE_PROVIDER, or missing required env for the selected
 * provider). Never throws — a misconfigured or absent provider just means
 * the caller falls back to manual image upload.
 */
export function getImageProvider(): ImageProvider | null {
  const providerName = process.env.IMAGE_PROVIDER || "cloudflare";

  if (providerName === "cloudflare") {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !apiToken) return null;

    const model = process.env.CLOUDFLARE_IMAGE_MODEL || DEFAULT_CLOUDFLARE_IMAGE_MODEL;
    const primary = createCloudflareImageProvider({ accountId, apiToken, model });

    // CLOUDFLARE_IMAGE_FALLBACK_MODEL="" (empty string, set explicitly)
    // turns the fallback off; unset falls back to klein-4b only when the
    // primary model is klein-9b — the free tier's ~7 images/day pairing
    // this file's comment on DEFAULT_CLOUDFLARE_IMAGE_MODEL describes.
    const fallbackEnv = process.env.CLOUDFLARE_IMAGE_FALLBACK_MODEL;
    const fallbackModel =
      fallbackEnv !== undefined
        ? fallbackEnv
        : model === DEFAULT_CLOUDFLARE_IMAGE_MODEL
          ? CLOUDFLARE_FALLBACK_IMAGE_MODEL
          : "";

    if (!fallbackModel || fallbackModel === model) return primary;

    const fallback = createCloudflareImageProvider({ accountId, apiToken, model: fallbackModel });
    return withFallback(primary, fallback);
  }

  if (providerName === "fal") {
    const apiKey = process.env.FAL_KEY;
    if (!apiKey) return null;

    return createFalImageProvider({
      apiKey,
      model: process.env.FAL_IMAGE_MODEL,
    });
  }

  return null;
}

export function isImageGenConfigured(): boolean {
  return getImageProvider() !== null;
}

/**
 * Every image provider/model combination this app has credentials for right
 * now, independent of IMAGE_PROVIDER — used by
 * scripts/image-gen-compare.mjs to render the same scenes across every
 * available candidate in one run. A candidate is only included when its
 * required env vars are present; the script warns and skips the rest.
 */
export function listComparisonCandidates(): { label: string; provider: ImageProvider }[] {
  const candidates: { label: string; provider: ImageProvider }[] = [];

  const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const cfApiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (cfAccountId && cfApiToken) {
    candidates.push({
      label: "cloudflare-flux-2-klein-4b",
      provider: createCloudflareImageProvider({
        accountId: cfAccountId,
        apiToken: cfApiToken,
        model: CLOUDFLARE_FALLBACK_IMAGE_MODEL,
      }),
    });
    candidates.push({
      label: "cloudflare-flux-2-klein-9b",
      provider: createCloudflareImageProvider({
        accountId: cfAccountId,
        apiToken: cfApiToken,
        model: DEFAULT_CLOUDFLARE_IMAGE_MODEL,
      }),
    });
  }

  const falApiKey = process.env.FAL_KEY;
  if (falApiKey) {
    candidates.push({
      label: "fal-z-image-turbo",
      provider: createFalImageProvider({ apiKey: falApiKey, model: DEFAULT_FAL_IMAGE_MODEL }),
    });
    candidates.push({
      label: "fal-qwen-image-2",
      provider: createFalImageProvider({
        apiKey: falApiKey,
        model: "fal-ai/qwen-image-2/text-to-image",
      }),
    });
  }

  return candidates;
}
