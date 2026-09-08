import { ASPECT_DIMENSIONS, type ImageProvider } from "./provider";
import { sniffImageContentType } from "./bytes";

// Cloudflare Workers AI text-to-image adapter. Free tier: 10k neurons/day —
// klein-9b costs enough neurons per image that the free tier only covers
// ~7 images/day on it, so it's paired with the cheaper klein-4b as an
// automatic same-generation fallback (see withFallback in ./provider and
// CLOUDFLARE_IMAGE_FALLBACK_MODEL in .env.example) once the quota runs out.
//
// flux-2-klein's step count is fixed on Cloudflare's hosted endpoint; the
// API rejects (or ignores) a "steps" field, so we don't send one.
// Width/height accept 256-1920 for these models — see ASPECT_DIMENSIONS in
// ./provider for the values we request per aspect.
export const DEFAULT_CLOUDFLARE_IMAGE_MODEL = "@cf/black-forest-labs/flux-2-klein-9b";
export const CLOUDFLARE_FALLBACK_IMAGE_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";

// A carrossel's first slide once failed outright with "The operation was
// aborted due to timeout" at the old 60s budget, with no retry — a single
// slow Workers AI response killed the whole generation run. 120s gives the
// model more room, and one retry (after a short backoff) absorbs a single
// transient timeout/429/5xx without doubling latency on every call.
const TIMEOUT_MS = 120_000;
const RETRY_DELAY_MS = 3_000;
const MAX_ATTEMPTS = 2;

type CloudflareRunResponse = {
  success: boolean;
  result?: { image?: string };
  errors?: { code: number; message: string }[];
};

/**
 * Thrown when the provider is out of quota/capacity for the requested
 * model — HTTP 429, a 5xx/timeout that persisted after the retry, or a
 * `success:false` body whose error message mentions quota/neurons/limit/
 * capacity. withFallback() (./provider) checks for this type to decide
 * whether to retry the same generation on a cheaper fallback model; any
 * other error (400/401/403/422, malformed response, ...) propagates as a
 * plain Error and is never retried on the fallback.
 */
export class ImageProviderQuotaError extends Error {
  readonly quotaExceeded = true as const;
}

const QUOTA_MESSAGE_PATTERN = /quota|neuron|limit|capacity/i;

/** Marks an error as worth retrying once (timeout, 429, or 5xx); once retries are exhausted this becomes an ImageProviderQuotaError. */
class RetryableCloudflareError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Decodes base64 image bytes and sniffs the content type from magic bytes —
 * Cloudflare's response envelope doesn't carry a content-type, only the
 * model's chosen format.
 */
function decodeImage(base64: string): { bytes: Uint8Array; contentType: string } {
  const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  return { bytes, contentType: sniffImageContentType(bytes) };
}

async function runOnce(input: {
  endpoint: string;
  apiToken: string;
  prompt: string;
  width: number;
  height: number;
  signal: AbortSignal;
}): Promise<{ bytes: Uint8Array; contentType: string }> {
  const { endpoint, apiToken, prompt, width, height, signal } = input;

  const form = new FormData();
  form.set("prompt", prompt);
  form.set("width", String(width));
  form.set("height", String(height));

  let res: Response;
  try {
    // fetch sets the multipart Content-Type (with boundary) itself when
    // given a FormData body — setting it manually breaks the boundary.
    res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}` },
      body: form,
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new RetryableCloudflareError("Cloudflare Workers AI: tempo limite excedido");
    }
    throw err;
  }

  if (res.status === 429) {
    throw new RetryableCloudflareError("Cloudflare Workers AI: limite de requisições atingido (429)");
  }
  if (res.status >= 500) {
    throw new RetryableCloudflareError(`Cloudflare Workers AI: erro do servidor (${res.status})`);
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
    const message = `Cloudflare Workers AI: falha na geração${detail ? ` — ${detail}` : ""}`;
    if (detail && QUOTA_MESSAGE_PATTERN.test(detail)) {
      throw new ImageProviderQuotaError(message);
    }
    throw new Error(message);
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
    name: `cloudflare:${model}`,

    async generate({ prompt, aspect, signal }) {
      const { width, height } = ASPECT_DIMENSIONS[aspect];

      let lastErr: unknown;
      let attempts = 0;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        attempts = attempt;
        // A fresh per-attempt timeout — AbortSignal.timeout() can't be
        // reused across attempts once it has fired. When the caller passes
        // its own signal, combine it so an external cancellation still
        // takes effect on the retry.
        const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);
        const attemptSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

        try {
          const result = await runOnce({ endpoint, apiToken, prompt, width, height, signal: attemptSignal });
          return { ...result, model };
        } catch (err) {
          lastErr = err;
          const retryable = err instanceof RetryableCloudflareError;
          if (attempt < MAX_ATTEMPTS && retryable) {
            await sleep(RETRY_DELAY_MS);
            continue;
          }
          break;
        }
      }

      const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
      const suffix = attempts > 1 ? " (2 tentativas)" : "";
      // A 429, or a 5xx/timeout that survived the retry, means this model
      // is out of quota/capacity right now — classify it (or re-wrap the
      // ImageProviderQuotaError runOnce already threw for a quota-worded
      // success:false body) so withFallback() can retry the same
      // generation on the fallback model. Any other error (400/401/403/
      // 422, malformed response, ...) passes through as a plain Error.
      if (lastErr instanceof RetryableCloudflareError || lastErr instanceof ImageProviderQuotaError) {
        throw new ImageProviderQuotaError(`${message}${suffix}`);
      }
      throw new Error(`${message}${suffix}`);
    },
  };
}
