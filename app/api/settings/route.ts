import type { NextRequest } from "next/server";
import { requireSameOrigin } from "@/lib/auth";
import { requireOwner } from "@/lib/session";
import {
  DEFAULT_GENERATION_INTERVAL_WEEKS,
  getMarketConfig,
  getSetting,
  getSettingString,
  setMarketConfig,
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
  marketCompetitors: string[];
  marketHashtags: string[];
}

async function readSettings(): Promise<SettingsPayload> {
  const [generationPaused, publishingPaused, generationIntervalWeeksRaw, forceNextGeneration, marketConfig] =
    await Promise.all([
      getSetting(GENERATION_KEY),
      getSetting(PUBLISHING_KEY),
      getSettingString(GENERATION_INTERVAL_KEY, DEFAULT_GENERATION_INTERVAL_WEEKS),
      getSetting(FORCE_NEXT_GENERATION_KEY),
      getMarketConfig(),
    ]);
  return {
    generationPaused,
    publishingPaused,
    generationIntervalWeeks: Number(generationIntervalWeeksRaw),
    forceNextGeneration,
    marketCompetitors: marketConfig.competitors,
    marketHashtags: marketConfig.hashtags,
  };
}

// GET /api/settings
// Current state of the pause/kill-switches, consumed by the Config page.
export async function GET() {
  return Response.json(await readSettings());
}

// PATCH /api/settings
// Partial update of the kill-switches from the Config page toggles. Same-origin
// (see lib/auth.ts requireSameOrigin) plus owner-only (lib/session.ts
// requireOwner) — this route was previously reachable by any same-origin
// caller, including a logged-in viewer.
export async function PATCH(req: NextRequest) {
  const authError = requireSameOrigin(req);
  if (authError) return authError;

  const ownerError = await requireOwner(req);
  if (ownerError) return ownerError;

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

  const {
    generationPaused,
    publishingPaused,
    generationIntervalWeeks,
    forceNextGeneration,
    marketCompetitors,
    marketHashtags,
  } = parsed.data;

  await Promise.all([
    generationPaused !== undefined ? setSetting(GENERATION_KEY, generationPaused) : Promise.resolve(),
    publishingPaused !== undefined ? setSetting(PUBLISHING_KEY, publishingPaused) : Promise.resolve(),
    generationIntervalWeeks !== undefined
      ? setSettingString(GENERATION_INTERVAL_KEY, String(generationIntervalWeeks))
      : Promise.resolve(),
    forceNextGeneration !== undefined
      ? setSetting(FORCE_NEXT_GENERATION_KEY, forceNextGeneration)
      : Promise.resolve(),
    marketCompetitors !== undefined || marketHashtags !== undefined
      ? setMarketConfig({ competitors: marketCompetitors, hashtags: marketHashtags })
      : Promise.resolve(),
  ]);

  return Response.json(await readSettings());
}
