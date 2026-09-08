#!/usr/bin/env node
// Real smoke test for the Cloudflare Workers AI image provider
// (lib/image-gen/cloudflare.ts). Generates 3 images with pt-BR overlay text
// so we can eyeball whether flux-2-klein-4b renders Portuguese text legibly
// before building the piece-generation UI on top of it.
//
// This script is plain .mjs (no TS import), so the multipart POST logic
// below deliberately mirrors lib/image-gen/cloudflare.ts rather than
// importing it — keep the two in sync if either changes.
//
// Usage: pnpm image-gen:check

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const OUT_DIR = join(REPO_ROOT, "tmp", "image-gen-check");

// Minimal .env reader (no dotenv dependency in this project, same pattern
// as scripts/publish-dry-run.mjs and scripts/insights-fixture.mjs) — only
// used as a fallback when the variable isn't already set in the shell.
function readEnvValue(key) {
  if (process.env[key]) return process.env[key];
  try {
    const raw = readFileSync(join(REPO_ROOT, ".env"), "utf8");
    const match = raw.match(new RegExp(`^${key}=(.*)$`, "m"));
    if (!match) return undefined;
    return match[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}

const ACCOUNT_ID = readEnvValue("CLOUDFLARE_ACCOUNT_ID");
const API_TOKEN = readEnvValue("CLOUDFLARE_API_TOKEN");
const MODEL = readEnvValue("CLOUDFLARE_IMAGE_MODEL") || "@cf/black-forest-labs/flux-2-klein-4b";

const ASPECT_DIMENSIONS = {
  "1:1": { width: 1024, height: 1024 },
  "4:5": { width: 1024, height: 1280 },
  "9:16": { width: 1080, height: 1920 },
};

const CASES = [
  {
    aspect: "4:5",
    prompt:
      'Real photo of a small beauty salon reception, sage green and off-white palette, soft natural window light, clean modern interior, shallow depth of field. Large bold headline text at the top reading exactly: "Sua agenda cheia de buracos?" — render the text clearly, correct Portuguese spelling, high legibility. Instagram feed post, vertical 4:5.',
  },
  {
    aspect: "1:1",
    prompt:
      "Real photo of a manicurist working on a client's hands at a bright nail studio, sage green accents, off-white walls, natural light, candid, no AI look. Bold overlay text centered at the bottom reading exactly: \"Confirmação em 1 toque\". Square 1:1 Instagram post.",
  },
  {
    aspect: "9:16",
    prompt:
      'Close-up of a smartphone held in hand showing a weekly appointment calendar app, blurred spa background in sage green and off-white, soft light. Large overlay text at the top reading exactly: "30 dias grátis, sem cartão". Vertical 9:16 Instagram story.',
  },
];

function decodeImage(base64) {
  const bytes = Uint8Array.from(Buffer.from(base64, "base64"));

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return { bytes, extension: "jpg" };
  }
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { bytes, extension: "png" };
  }
  return { bytes, extension: "jpg" };
}

async function generateOne(index, { aspect, prompt }) {
  const { width, height } = ASPECT_DIMENSIONS[aspect];
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${MODEL}`;

  const form = new FormData();
  form.set("prompt", prompt);
  form.set("width", String(width));
  form.set("height", String(height));

  const startedAt = Date.now();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_TOKEN}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const elapsedMs = Date.now() - startedAt;

  if (res.status === 429) {
    throw new Error("Cloudflare Workers AI: limite de requisições atingido (429)");
  }
  if (res.status >= 500) {
    throw new Error(`Cloudflare Workers AI: erro do servidor (${res.status})`);
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    // handled below
  }

  if (!res.ok) {
    const detail = body?.errors?.map((e) => e.message).join("; ");
    throw new Error(`Cloudflare Workers AI: falha na requisição (HTTP ${res.status})${detail ? ` — ${detail}` : ""}`);
  }
  if (!body || body.success === false) {
    const detail = body?.errors?.map((e) => e.message).join("; ");
    throw new Error(`Cloudflare Workers AI: falha na geração${detail ? ` — ${detail}` : ""}`);
  }

  const base64 = body.result?.image;
  if (!base64) {
    throw new Error("Cloudflare Workers AI: resposta sem imagem");
  }

  const { bytes, extension } = decodeImage(base64);
  if (bytes.length < 100) {
    throw new Error("Cloudflare Workers AI: resposta sem imagem");
  }

  const filename = `${index}-${aspect.replace(":", "x")}.${extension}`;
  const filePath = join(OUT_DIR, filename);
  writeFileSync(filePath, bytes);

  return { filePath, bytes: bytes.length, elapsedMs };
}

async function main() {
  const missing = [];
  if (!ACCOUNT_ID) missing.push("CLOUDFLARE_ACCOUNT_ID");
  if (!API_TOKEN) missing.push("CLOUDFLARE_API_TOKEN");

  if (missing.length > 0) {
    console.error(
      `Faltam variáveis de ambiente para testar a geração de imagens: ${missing.join(", ")}.\n` +
        "Defina-as no .env (veja .env.example) ou no ambiente do shell e rode novamente:\n" +
        "  pnpm image-gen:check",
    );
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Gerando ${CASES.length} imagens de teste com o modelo ${MODEL}...\n`);

  let hadFailure = false;
  for (let i = 0; i < CASES.length; i += 1) {
    const caseInput = CASES[i];
    try {
      const { filePath, bytes, elapsedMs } = await generateOne(i + 1, caseInput);
      console.log(`  ok - [${caseInput.aspect}] ${filePath} (${bytes} bytes, ${elapsedMs}ms)`);
    } catch (err) {
      hadFailure = true;
      console.error(`  FAIL - [${caseInput.aspect}] ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (hadFailure) {
    process.exit(1);
  }

  console.log(`\nImagens salvas em ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
