#!/usr/bin/env node
// Real smoke test for the text-overlay compositor (lib/image-gen/overlay.ts).
//
// Part A composites pt-BR headlines over the photos scripts/image-gen-check.mjs
// already produced in tmp/image-gen-check/, so we can eyeball spelling,
// accents and legibility without spending Workers AI credits.
//
// Part B (skipped when CLOUDFLARE_* is unset) regenerates the same 3 scenes
// with every "render this text" instruction stripped out and
// NO_TEXT_PROMPT_SUFFIX appended, then composites the headlines on top — the
// end-to-end shape the piece pipeline will use.
//
// This script imports the real lib/image-gen/overlay.ts via Node's type
// stripping (same trick as scripts/schedule-check.mjs), so there is no
// duplicated pipeline to keep in sync. Two caveats that shape the code below:
//   - the "@/" path alias is a Next/tsc thing, so overlay.ts must import its
//     siblings relatively (it does);
//   - outside Next's bundler, bare "next/og" does not resolve (the next
//     package has no exports map and Node's ESM resolver will not append the
//     .js extension), so we register a resolve hook that maps it to
//     "next/og.js" — the very file `require('next/og')` would load.
//
// Usage: pnpm overlay:check

import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/og") return nextResolve("next/og.js", context);
    // Node's ESM resolver never guesses extensions, so overlay.ts's
    // `import ... from "./provider"` (idiomatic for Next/tsc) needs a nudge.
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        // fall through to the default resolution below
      }
    }
    return nextResolve(specifier, context);
  },
});

const { readFileSync, mkdirSync, writeFileSync } = await import("node:fs");
const { join } = await import("node:path");
const { fileURLToPath } = await import("node:url");

const { composeOverlay, NO_TEXT_PROMPT_SUFFIX } = await import("../lib/image-gen/overlay.ts");

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const SOURCE_DIR = join(REPO_ROOT, "tmp", "image-gen-check");
const OUT_DIR = join(REPO_ROOT, "tmp", "overlay-check");

const MAX_BYTES = 8 * 1024 * 1024;

// Same minimal .env reader as scripts/image-gen-check.mjs — no dotenv
// dependency in this project.
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

// The 3 scenes from scripts/image-gen-check.mjs with every text instruction
// removed; the headline that used to be baked into the prompt is now the
// `text` we composite.
const CASES = [
  {
    aspect: "4:5",
    source: "1-4x5.jpg",
    text: "Sua agenda cheia de buracos?",
    scene:
      "Real photo of a small beauty salon reception, sage green and off-white palette, soft natural window light, clean modern interior, shallow depth of field. Instagram feed post, vertical 4:5.",
  },
  {
    aspect: "1:1",
    source: "2-1x1.jpg",
    text: "Confirmação em 1 toque",
    scene:
      "Real photo of a manicurist working on a client's hands at a bright nail studio, sage green accents, off-white walls, natural light, candid, no AI look. Square 1:1 Instagram post.",
  },
  {
    aspect: "9:16",
    source: "3-9x16.jpg",
    text: "30 dias grátis, sem cartão",
    scene:
      "Close-up of a smartphone held in hand showing a weekly appointment calendar app, blurred spa background in sage green and off-white, soft light. Vertical 9:16 Instagram story.",
  },
];

// Two-line headline with a manual break, to check \n survives the layer.
const LONG_CASE = {
  aspect: "4:5",
  source: "1-4x5.jpg",
  text: "Cliente sumiu\nsem avisar de novo?",
  outName: "composed-old-long.jpg",
};

function assertJpeg(label, bytes, filePath) {
  const problems = [];
  if (!(bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8)) {
    problems.push("não é JPEG");
  }
  if (bytes.length > MAX_BYTES) {
    problems.push(`${bytes.length} bytes > 8MB`);
  }
  if (problems.length > 0) {
    throw new Error(`${label} (${filePath}): ${problems.join("; ")}`);
  }
}

async function compose(label, photo, aspect, text, outName) {
  const startedAt = Date.now();
  const { bytes, contentType } = await composeOverlay({ photo, aspect, text });
  const elapsedMs = Date.now() - startedAt;

  const filePath = join(OUT_DIR, outName);
  writeFileSync(filePath, bytes);
  assertJpeg(label, bytes, filePath);

  console.log(`  ok  - ${label} ${filePath} (${bytes.length} bytes, ${contentType}, ${elapsedMs}ms)`);
  return filePath;
}

function decodeImage(base64) {
  const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    return { bytes, extension: "png" };
  }
  return { bytes, extension: "jpg" };
}

// Mirrors lib/image-gen/cloudflare.ts's multipart POST (the .mjs script can't
// import the TS adapter's provider factory without the env plumbing).
async function generateScene(index, { aspect, scene }) {
  const { width, height } = ASPECT_DIMENSIONS[aspect];
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${MODEL}`;

  const form = new FormData();
  form.set("prompt", scene + NO_TEXT_PROMPT_SUFFIX);
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

  let body = null;
  try {
    body = await res.json();
  } catch {
    // handled below
  }

  if (!res.ok || !body || body.success === false) {
    const detail = body?.errors?.map((e) => e.message).join("; ");
    throw new Error(
      `Cloudflare Workers AI: falha na geração (HTTP ${res.status})${detail ? ` — ${detail}` : ""}`,
    );
  }

  const base64 = body.result?.image;
  if (!base64) throw new Error("Cloudflare Workers AI: resposta sem imagem");

  const { bytes, extension } = decodeImage(base64);
  if (bytes.length < 100) throw new Error("Cloudflare Workers AI: resposta sem imagem");

  const filePath = join(OUT_DIR, `scene-${index}.${extension}`);
  writeFileSync(filePath, bytes);
  console.log(`  ok  - cena ${index} [${aspect}] ${filePath} (${bytes.length} bytes, ${elapsedMs}ms)`);

  return bytes;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  console.log("Parte A — compondo sobre as fotos já geradas em tmp/image-gen-check/\n");

  for (let i = 0; i < CASES.length; i += 1) {
    const c = CASES[i];
    const photo = readFileSync(join(SOURCE_DIR, c.source));
    await compose(`[${c.aspect}] "${c.text}"`, photo, c.aspect, c.text, `composed-old-${i + 1}.jpg`);
  }

  const longPhoto = readFileSync(join(SOURCE_DIR, LONG_CASE.source));
  await compose(
    `[${LONG_CASE.aspect}] duas linhas`,
    longPhoto,
    LONG_CASE.aspect,
    LONG_CASE.text,
    LONG_CASE.outName,
  );

  if (!ACCOUNT_ID || !API_TOKEN) {
    console.log(
      "\nParte B pulada: defina CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_API_TOKEN no .env " +
        "(veja .env.example) para gerar cenas novas sem texto.",
    );
    console.log(`\nImagens salvas em ${OUT_DIR}`);
    return;
  }

  console.log(`\nParte B — gerando 3 cenas sem texto com ${MODEL} e compondo o headline\n`);

  let hadFailure = false;
  for (let i = 0; i < CASES.length; i += 1) {
    const c = CASES[i];
    try {
      const scene = await generateScene(i + 1, c);
      await compose(
        `[${c.aspect}] "${c.text}" sobre cena nova`,
        scene,
        c.aspect,
        c.text,
        `composed-new-${i + 1}.jpg`,
      );
    } catch (err) {
      hadFailure = true;
      console.error(`  FAIL - [${c.aspect}] ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\nImagens salvas em ${OUT_DIR}`);
  if (hadFailure) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
