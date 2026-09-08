#!/usr/bin/env node
// Real side-by-side comparison of every configured image-gen candidate
// (Cloudflare's flux-2-klein-4b/9b, fal.ai's Z-Image-Turbo and Qwen-Image 2)
// using the same 3 new-format scene prompts (English, no embedded text) as
// scripts/overlay-check.mjs's Part B, with the pt-BR overlay composited on
// top exactly like the real piece pipeline (lib/image-generation.ts).
//
// Why this exists: production images came out bad because they were
// generated with old-format prompts (pt-BR, storyboard, embedded text)
// before the new no-text-suffix contract had ever run against them. Before
// picking a production model, we want every open-model candidate rendered
// from the *same* new-format prompts side by side.
//
// This script imports the real lib/image-gen/{provider,overlay}.ts via
// Node's type stripping (same trick as scripts/overlay-check.mjs), so there
// is no duplicated pipeline to keep in sync. See that script's header
// comment for why the resolve hooks below are needed (next/og has no
// exports map outside Next's bundler; relative TS imports need the
// extension nudged in).
//
// Usage: pnpm image-gen:compare

import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/og") return nextResolve("next/og.js", context);
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

const { listComparisonCandidates } = await import("../lib/image-gen/provider.ts");
const { composeOverlay, NO_TEXT_PROMPT_SUFFIX } = await import("../lib/image-gen/overlay.ts");

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const OUT_DIR = join(REPO_ROOT, "tmp", "compare");

// Minimal .env reader, same as scripts/overlay-check.mjs and
// scripts/image-gen-check.mjs — no dotenv dependency in this project. Only
// needed here so this standalone script sees the same env as `pnpm dev`
// without requiring the caller to export every var by hand.
function loadDotEnvIntoProcessEnv() {
  let raw;
  try {
    raw = readFileSync(join(REPO_ROOT, ".env"), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
}

loadDotEnvIntoProcessEnv();

// The 3 new-format scenes from scripts/overlay-check.mjs's Part B: English,
// no text/letters described, NO_TEXT_PROMPT_SUFFIX appended — the exact
// shape lib/image-generation.ts sends today.
const SCENES = [
  {
    aspect: "4:5",
    text: "Sua agenda cheia de buracos?",
    scene:
      "Real photo of a small beauty salon reception, sage green and off-white palette, soft natural window light, clean modern interior, shallow depth of field. Instagram feed post, vertical 4:5.",
  },
  {
    aspect: "1:1",
    text: "Confirmação em 1 toque",
    scene:
      "Real photo of a manicurist working on a client's hands at a bright nail studio, sage green accents, off-white walls, natural light, candid, no AI look. Square 1:1 Instagram post.",
  },
  {
    aspect: "9:16",
    text: "30 dias grátis, sem cartão",
    scene:
      "Close-up of a smartphone held in hand showing a weekly appointment calendar app, blurred spa background in sage green and off-white, soft light. Vertical 9:16 Instagram story.",
  },
];

function extForContentType(contentType) {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

async function runCandidate(label, provider, outDir) {
  mkdirSync(outDir, { recursive: true });
  const results = [];

  for (let i = 0; i < SCENES.length; i += 1) {
    const n = i + 1;
    const { aspect, text, scene } = SCENES[i];
    const prompt = scene + NO_TEXT_PROMPT_SUFFIX;
    const startedAt = Date.now();

    try {
      const { bytes: sourceBytes, contentType } = await provider.generate({ prompt, aspect });
      const sourceExt = extForContentType(contentType);
      const sourcePath = join(outDir, `${n}-${aspect.replace(":", "x")}-source.${sourceExt}`);
      writeFileSync(sourcePath, sourceBytes);

      const { bytes: composedBytes } = await composeOverlay({ photo: sourceBytes, aspect, text });
      const composedPath = join(outDir, `${n}-${aspect.replace(":", "x")}.jpg`);
      writeFileSync(composedPath, composedBytes);

      const elapsedMs = Date.now() - startedAt;
      console.log(
        `  ok  - ${label} cena ${n} [${aspect}] ${composedPath} (${composedBytes.length} bytes, ${elapsedMs}ms)`,
      );
      results.push({ label, scene: n, aspect, ms: elapsedMs, bytes: composedBytes.length, ok: true });
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  FAIL - ${label} cena ${n} [${aspect}] (${elapsedMs}ms): ${message}`);
      results.push({ label, scene: n, aspect, ms: elapsedMs, bytes: 0, ok: false, error: message });
    }
  }

  return results;
}

function printTable(rows) {
  const header = ["label", "cena", "ms", "bytes", "status"];
  const widths = header.map((h) => h.length);
  const cells = rows.map((r) => [
    r.label,
    `${r.scene} (${r.aspect})`,
    String(r.ms),
    String(r.bytes),
    r.ok ? "ok" : `erro: ${r.error}`,
  ]);
  for (const row of cells) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i], cell.length);
    });
  }

  const printRow = (row) => console.log(row.map((cell, i) => cell.padEnd(widths[i])).join("  |  "));

  console.log("\nResultado final\n");
  printRow(header);
  printRow(widths.map((w) => "-".repeat(w)));
  for (const row of cells) printRow(row);
}

async function main() {
  const candidates = listComparisonCandidates();

  if (candidates.length === 0) {
    console.error(
      "Nenhum candidato configurado — defina CLOUDFLARE_ACCOUNT_ID+CLOUDFLARE_API_TOKEN e/ou " +
        "FAL_KEY no .env (veja .env.example) para comparar pelo menos um provider.",
    );
    process.exit(1);
  }

  const expectedLabels = [
    "cloudflare-flux-2-klein-4b",
    "cloudflare-flux-2-klein-9b",
    "fal-z-image-turbo",
    "fal-qwen-image-2",
  ];
  const availableLabels = new Set(candidates.map((c) => c.label));
  for (const label of expectedLabels) {
    if (!availableLabels.has(label)) {
      console.log(`  aviso - ${label} pulado: credenciais ausentes no .env`);
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });

  let allResults = [];
  let hadFailure = false;

  for (const { label, provider } of candidates) {
    console.log(`\nGerando com ${label} (${provider.name})...\n`);
    const outDir = join(OUT_DIR, label);
    const results = await runCandidate(label, provider, outDir);
    allResults = allResults.concat(results);
    if (results.some((r) => !r.ok)) hadFailure = true;
  }

  printTable(allResults);
  console.log(`\nImagens salvas em ${OUT_DIR}`);

  if (hadFailure) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
