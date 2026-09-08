import { ASPECT_DIMENSIONS, type ImageProvider } from "./provider";

// Cloudflare Workers AI text-to-image adapter. Free tier: 10k neurons/day,
// enough for a handful of images per generation round — see .env.example
// for how to get an account id + API token.
//
// flux-2-klein-4b's step count is fixed at 4 on Cloudflare's hosted
// endpoint; the API rejects (or ignores) a "steps" field, so we don't send
// one. Width/height accept 256-1920 for this model — see
// ASPECT_DIMENSIONS in ./provider for the values we request per aspect.
export const DEFAULT_CLOUDFLARE_IMAGE_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";

type CloudflareRunResponse = {
  success: boolean;
  result?: { image?: string };
  errors?: { code: number; message: string }[];
};

/**
 * Decodes base64 image bytes and sniffs the content type from magic bytes —
 * Cloudflare's response envelope doesn't carry a content-type, only the
 * model's chosen format.
 */
function decodeImage(base64: string): { bytes: Uint8Array; contentType: string } {
  const bytes = Uint8Array.from(Buffer.from(base64, "base64"));

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return { bytes, contentType: "image/jpeg" };
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { bytes, contentType: "image/png" };
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
    return { bytes, contentType: "image/webp" };
  }

  // Fallback: Workers AI defaults to JPEG for this model when the magic
  // bytes don't match a known format.
  return { bytes, contentType: "image/jpeg" };
}

export function createCloudflareImageProvider(input: {
  accountId: string;
  apiToken: string;
  model?: string;
}): ImageProvider {
  const { accountId, apiToken } = input;
  const model = input.model || DEFAULT_CLOUDFLARE_IMAGE_MODEL;
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

  return {
    name: "cloudflare",

    async generate({ prompt, aspect, signal }) {
      const { width, height } = ASPECT_DIMENSIONS[aspect];

      const form = new FormData();
      form.set("prompt", prompt);
      form.set("width", String(width));
      form.set("height", String(height));

      // fetch sets the multipart Content-Type (with boundary) itself when
      // given a FormData body — setting it manually breaks the boundary.
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}` },
        body: form,
        signal: signal ?? AbortSignal.timeout(60_000),
      });

      if (res.status === 429) {
        throw new Error("Cloudflare Workers AI: limite de requisições atingido (429)");
      }
      if (res.status >= 500) {
        throw new Error(`Cloudflare Workers AI: erro do servidor (${res.status})`);
      }

      let body: CloudflareRunResponse | null = null;
      try {
        body = (await res.json()) as CloudflareRunResponse;
      } catch {
        // fall through — body stays null, handled by the checks below
      }

      if (!res.ok) {
        const detail = body?.errors?.map((e) => e.message).join("; ");
        throw new Error(
          `Cloudflare Workers AI: falha na requisição (HTTP ${res.status})${detail ? ` — ${detail}` : ""}`,
        );
      }

      if (!body || body.success === false) {
        const detail = body?.errors?.map((e) => e.message).join("; ");
        throw new Error(`Cloudflare Workers AI: falha na geração${detail ? ` — ${detail}` : ""}`);
      }

      const base64 = body.result?.image;
      if (!base64) {
        throw new Error("Cloudflare Workers AI: resposta sem imagem");
      }

      const decoded = decodeImage(base64);
      if (decoded.bytes.length < 100) {
        throw new Error("Cloudflare Workers AI: resposta sem imagem");
      }

      return decoded;
    },
  };
}
