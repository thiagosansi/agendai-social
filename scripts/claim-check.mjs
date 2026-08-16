#!/usr/bin/env node
// Guardrail script for the Instagram content pipeline: checks a single
// caption/legenda string against the "promessas proibidas" (forbidden
// claims) list at docs/promessas-proibidas.json, so a piece never ships a
// claim the product cannot back up (e.g. an automatic reminder that was
// disabled in production, or Pix as a deposit payment method that isn't
// enabled).
//
// Unlike the original agendatmstudio script (which scanned Markdown files
// under content/instagram/), this one validates a single text string —
// pieces now live in the database, not in files. The `checkText` function
// is exported so the piece-creation API route can reuse the exact same
// logic (see docs/02-playbook-conteudo.md section 4, step 4).
//
// Usage:
//   node scripts/claim-check.mjs --text "<caption>"
//   echo "<caption>" | node scripts/claim-check.mjs
//
// Exit code: 1 if a forbidden claim is found (JSON with violations printed
// to stdout), 0 otherwise (prints `{"ok":true}`).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const RULES_PATH = join(REPO_ROOT, "docs", "promessas-proibidas.json");

function normalize(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Loaded rule shape after compiling patterns/allow lists into RegExp. */
function loadRules(rulesPath = RULES_PATH) {
  const raw = readFileSync(rulesPath, "utf8");
  const parsed = JSON.parse(raw);
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  return items.map((item) => ({
    id: item.id,
    label: item.label,
    substitute: item.substitute,
    patterns: (item.patterns || []).map((p) => new RegExp(normalize(p), "i")),
    allow: (item.allow || []).map((p) => new RegExp(normalize(p), "i")),
  }));
}

/**
 * Checks a caption string against the forbidden-claims rules.
 * Matching is accent- and case-insensitive (both text and patterns are
 * normalized via NFD + strip combining marks + lowercase) and line by line,
 * so a caption spanning multiple lines reports which line matched. If a
 * line also matches one of a rule's `allow` patterns, it is treated as an
 * accepted exception and not reported.
 *
 * @param {string} text - the caption/legenda to validate.
 * @param {ReturnType<typeof loadRules>} rules - pre-loaded, compiled rules.
 * @returns {{ok: boolean, violations: Array<{id: string, label: string, substitute: string, line: number, snippet: string}>}}
 */
export function checkText(text, rules) {
  const lines = text.split("\n");
  const violations = [];

  lines.forEach((line, index) => {
    const normalizedLine = normalize(line);
    if (!normalizedLine.trim()) return;

    for (const rule of rules) {
      const matchesForbidden = rule.patterns.some((pattern) => pattern.test(normalizedLine));
      if (!matchesForbidden) continue;

      const isAllowed = rule.allow.some((pattern) => pattern.test(normalizedLine));
      if (isAllowed) continue;

      violations.push({
        id: rule.id,
        label: rule.label,
        substitute: rule.substitute,
        line: index + 1,
        snippet: line.trim().slice(0, 160),
      });
    }
  });

  return { ok: violations.length === 0, violations };
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main() {
  const args = process.argv.slice(2);
  const textFlagIndex = args.indexOf("--text");
  const text = textFlagIndex >= 0 ? args[textFlagIndex + 1] ?? "" : readStdin();

  if (!text.trim()) {
    process.stderr.write(
      'Usage: node scripts/claim-check.mjs --text "<caption>"  (or pipe text via stdin)\n',
    );
    process.exit(2);
  }

  const rules = loadRules();
  const result = checkText(text, rules);

  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(result.ok ? 0 : 1);
}

// Only run as a CLI when executed directly, so the API route can import
// `checkText`/`loadRules` without triggering process.exit.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
