// Provider-agnostic interface for AI image generation, used by the piece
// image-generation flow to fall back gracefully when no provider is
// configured (manual upload keeps working either way — see lib/uploads.ts).
// Cloudflare Workers AI is the only implementation today
// (lib/image-gen/cloudflare.ts); getImageProvider() is the single place that
// decides which one to build, so adding a second provider later only means
// extending the switch below.

import { createCloudflareImageProvider } from "./cloudflare";

export type ImageAspect = "1:1" | "4:5" | "9:16";

export interface ImageProvider {
  readonly name: string;
  generate(input: {
    prompt: string;
    aspect: ImageAspect;
    signal?: AbortSignal;
  }): Promise<{ bytes: Uint8Array; contentType: string }>;
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

    return createCloudflareImageProvider({
      accountId,
      apiToken,
      model: process.env.CLOUDFLARE_IMAGE_MODEL,
    });
  }

  return null;
}

export function isImageGenConfigured(): boolean {
  return getImageProvider() !== null;
}
