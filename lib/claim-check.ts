// Server-side port of scripts/claim-check.mjs for use inside Next.js route
// handlers. Kept as a separate, standalone module (not imported by the CLI
// script, and not importing anything from the CLI script) because the CLI
// script resolves docs/promessas-proibidas.json relative to its own
// `import.meta.url` at runtime via fs — a path that breaks once bundled by
// the Next.js build. This module instead imports the JSON directly
// (resolveJsonModule is enabled in tsconfig.json), so the rules are inlined
// at build time and no filesystem access is needed at request time.
//
// Keep the matching logic identical to scripts/claim-check.mjs. If the
// rules format or matching semantics change, update both files.
import rulesFile from "@/docs/promessas-proibidas.json";

export interface ClaimCheckRule {
  id: string;
  label: string;
  substitute: string;
  patterns: RegExp[];
  allow: RegExp[];
}

export interface ClaimCheckViolation {
  id: string;
  label: string;
  substitute: string;
  line: number;
  snippet: string;
}

export interface ClaimCheckResult {
  ok: boolean;
  violations: ClaimCheckViolation[];
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

let cachedRules: ClaimCheckRule[] | null = null;

export function loadRules(): ClaimCheckRule[] {
  if (cachedRules) return cachedRules;

  const items = Array.isArray(rulesFile.items) ? rulesFile.items : [];
  cachedRules = items.map((item) => ({
    id: item.id,
    label: item.label,
    substitute: item.substitute,
    patterns: (item.patterns ?? []).map((p: string) => new RegExp(normalize(p), "i")),
    allow: (item.allow ?? []).map((p: string) => new RegExp(normalize(p), "i")),
  }));

  return cachedRules;
}

export function checkText(text: string, rules: ClaimCheckRule[] = loadRules()): ClaimCheckResult {
  const lines = text.split("\n");
  const violations: ClaimCheckViolation[] = [];

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
