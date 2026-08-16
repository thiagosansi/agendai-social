#!/usr/bin/env node
// Convenience CLI for the publish cron's dry-run mode
// (GET /api/cron/publish?dry=1). Hits a locally running dev server and
// pretty-prints the response, so you can see what the daily cron would do
// without touching the DB or calling the Meta Graph API.
//
// Usage: PORT=3020 pnpm dev   (in one terminal)
//        pnpm publish:dry     (in another)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");

// Minimal .env reader (no dotenv dependency in this project) — only used as
// a fallback when the variable isn't already set in the shell environment.
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

const PORT = process.env.PORT || 3020;
const BASE_URL = `http://localhost:${PORT}`;
const CRON_SECRET = readEnvValue("CRON_SECRET");

async function main() {
  if (!CRON_SECRET) {
    console.error(
      "CRON_SECRET is not set (checked process.env and .env) — cannot call the publish cron.",
    );
    process.exit(2);
  }

  const res = await fetch(`${BASE_URL}/api/cron/publish?dry=1`, {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });

  const body = await res.json().catch(() => null);
  console.log(`GET /api/cron/publish?dry=1 -> ${res.status}\n`);
  console.log(JSON.stringify(body, null, 2));

  if (!res.ok) process.exit(1);
}

main().catch((error) => {
  console.error("publish-dry-run crashed:", error);
  process.exit(1);
});
