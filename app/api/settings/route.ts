import type { NextRequest } from "next/server";
import { requireSameOrigin } from "@/lib/auth";
import {
  DEFAULT_GENERATION_INTERVAL_WEEKS,
  getSetting,
  getSettingString,
  setSetting,
  setSettingString,
} from "@/lib/settings";
import { patchSettingsSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GENERATION_KEY = "generationPaused";
const PUBLISHING_KEY = "publishingPaused";
const GENERATION_INTERVAL_KEY = "generationIntervalWeeks";
const FORCE_NEXT_GENERATION_KEY = "forceNextGeneration";

interface SettingsPayload {
  generationPaused: boolean;
  publishingPaused: boolean;
  generationIntervalWeeks: number;
  forceNextGeneration: boolean;
}

async function readSettings(): Promise<SettingsPayload> {
  const [generationPaused, publishingPaused, generationIntervalWeeksRaw, forceNextGeneration] = await Promise.all([
    getSetting(GENERATION_KEY),
    getSetting(PUBLISHING_KEY),
    getSettingString(GENERATION_INTERVAL_KEY, DEFAULT_GENERATION_INTERVAL_WEEKS),
    getSetting(FORCE_NEXT_GENERATION_KEY),
  ]);
  return {
    generationPaused,
    publishingPaused,
    generationIntervalWeeks: Number(generationIntervalWeeksRaw),
    forceNextGeneration,
  };
}

// GET /api/settings
// Current state of the pause/kill-switches, consumed by the Config page.
export async function GET() {
  return Response.json(await readSettings());
}

// PATCH /api/settings
// Partial update of the kill-switches from the Config page toggles. Same-origin
// only (see lib/auth.ts requireSameOrigin) — this single-user app has no bearer
// token for browser-originated writes, so the Fetch Metadata Sec-Fetch-Site
// header stands in for auth here.
export async function PATCH(req: NextRequest) {
  const authError = requireSameOrigin(req);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = patchSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { generationPaused, publishingPaused, generationIntervalWeeks, forceNextGeneration } = parsed.data;

  await Promise.all([
    generationPaused !== undefined ? setSetting(GENERATION_KEY, generationPaused) : Promise.resolve(),
    publishingPaused !== undefined ? setSetting(PUBLISHING_KEY, publishingPaused) : Promise.resolve(),
    generationIntervalWeeks !== undefined
      ? setSettingString(GENERATION_INTERVAL_KEY, String(generationIntervalWeeks))
      : Promise.resolve(),
    forceNextGeneration !== undefined
      ? setSetting(FORCE_NEXT_GENERATION_KEY, forceNextGeneration)
      : Promise.resolve(),
  ]);

  return Response.json(await readSettings());
}
