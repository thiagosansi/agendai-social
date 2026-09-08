import { ASPECT_DIMENSIONS, type ImageAspect, type ImageProvider } from "./provider";
import { sniffImageContentType } from "./bytes";

// fal.ai text-to-image adapter — used to compare open Chinese models
// (Z-Image-Turbo, Qwen-Image 2) against Cloudflare's flux-2-klein via
// scripts/image-gen-compare.mjs. Sync endpoint per
// https://fal.ai/models/<id>/api: POST https://fal.run/<model-id>,
// `Authorization: Key ${FAL_KEY}`. The response only carries a `url` to the
// generated image (expires), so generate() downloads it immediately.
export const DEFAULT_FAL_IMAGE_MODEL = "fal-ai/z-image/turbo";

const GENERATE_TIMEOUT_MS = 120_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

// fal's `image_size` also accepts a documented enum of presets. Most
// endpoints accept a custom {width, height} object too (tried first, so
// every candidate renders at the app's exact ASPECT_DIMENSIONS), but a
// model that rejects the custom shape with 422 falls back to the closest
// enum preset below.
const ASPECT_TO_ENUM: Record<ImageAspect, string> = {
  "1:1": "square_hd",
  "4:5": "portrait_4_3",
  "9:16": "portrait_16_9",
};

type FalImage = {
  url: string;
  content_type?: string;
  width?: number;
  height?: number;
};

type FalRunResponse = {
  images?: FalImage[];
  detail?: unknown;
};

function buildRequestBody(
  model: string,
  prompt: string,
  imageSize: { width: number; height: number } | string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt,
    image_size: imageSize,
    output_format: "jpeg",
    num_images: 1,
    enable_safety_checker: true,
  };

  // z-image/turbo defaults to 8 inference steps already, but we set it
  // explicitly for reproducibility; "regular" acceleration is the model's
  // documented default speed/quality tradeoff. Qwen-Image 2 uses the
  // endpoint's own defaults — its guidance_scale/steps tuning is model-
  // specific and undocumented for the "2" variant, so we don't guess.
  if (model.includes("z-image")) {
    body.num_inference_steps = 8;
    body.acceleration = "regular";
  }

  return body;
}

async function postJson(
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Response> {
  try {
    return await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("fal.ai: tempo limite excedido");
    }
    throw err;
  }
}

async function readJsonSafe(res: Response): Promise<FalRunResponse | null> {
  try {
    const text = await res.text();
    return JSON.parse(text) as FalRunResponse;
  } catch {
    return null;
  }
}

/** Maps an unsuccessful HTTP status to the user-facing fal.ai error message. */
function errorMessageForStatus(status: number, body: FalRunResponse | null): string | null {
  const detail = body?.detail;
  const detailText = typeof detail === "string" ? detail : detail ? JSON.stringify(detail) : undefined;

  // Check for account lock/credit issues (TOP_UP or locked)
  if ((status === 401 || status === 402 || status === 403) && detailText) {
    const detailLower = detailText.toLowerCase();
    if (detailLower.includes("top_up") || detailLower.includes("locked")) {
      return `fal.ai: conta sem créditos — adicione saldo em fal.ai/dashboard/billing (detalhe: ${detailText})`;
    }
  }

  if (status === 401 || status === 403) {
    return `fal.ai: chave inválida ou sem permissão${detailText ? ` (detalhe: ${detailText})` : ""}`;
  }
  if (status === 402) {
    return "fal.ai: sem créditos";
  }
  if (status === 429) {
    return "fal.ai: limite de requisições atingido (429)";
  }
  if (status >= 500) {
    return `fal.ai: erro do servidor (${status})`;
  }
  if (status === 422) {
    return `fal.ai: entrada inválida (422)${detailText ? ` — ${detailText}` : ""}`;
  }
  if (status < 200 || status >= 300) {
    return `fal.ai: falha na requisição (HTTP ${status})`;
  }
  return null;
}

export function createFalImageProvider(input: { apiKey: string; model?: string }): ImageProvider {
  const { apiKey } = input;
  const model = input.model || DEFAULT_FAL_IMAGE_MODEL;
  const endpoint = `https://fal.run/${model}`;

  return {
    name: `fal:${model}`,

    async generate({ prompt, aspect, signal }) {
      const { width, height } = ASPECT_DIMENSIONS[aspect];
      const genSignal = signal ?? AbortSignal.timeout(GENERATE_TIMEOUT_MS);

      let res = await postJson(endpoint, apiKey, buildRequestBody(model, prompt, { width, height }), genSignal);
      let json = await readJsonSafe(res);

      if (res.status === 422) {
        // The custom {width, height} object isn't accepted by every fal
        // endpoint — retry once with the documented enum preset closest to
        // our target aspect before giving up.
        res = await postJson(
          endpoint,
          apiKey,
          buildRequestBody(model, prompt, ASPECT_TO_ENUM[aspect]),
          genSignal,
        );
        json = await readJsonSafe(res);
      }

      const errorMessage = errorMessageForStatus(res.status, json);
      if (errorMessage) {
        throw new Error(errorMessage);
      }

      const image = json?.images?.[0];
      if (!image?.url) {
        throw new Error("fal.ai: resposta sem imagem");
      }

      let downloadRes: Response;
      try {
        downloadRes = await fetch(image.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new Error("fal.ai: tempo limite excedido ao baixar imagem gerada");
        }
        throw err;
      }

      if (!downloadRes.ok) {
        throw new Error(`fal.ai: falha ao baixar imagem gerada (HTTP ${downloadRes.status})`);
      }

      const bytes = new Uint8Array(await downloadRes.arrayBuffer());
      if (bytes.length < 100) {
        throw new Error("fal.ai: imagem baixada vazia");
      }

      const contentType =
        downloadRes.headers.get("content-type") || image.content_type || sniffImageContentType(bytes);

      return { bytes, contentType, model };
    },
  };
}
