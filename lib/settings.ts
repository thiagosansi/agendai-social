import { prisma } from "@/lib/prisma";

/**
 * Generic key/value settings store backed by AppSetting. Boolean keys are
 * stored as the string "true"/"false" — an absent row means "false", so
 * every known boolean key (see app/api/settings/route.ts) defaults to
 * unpaused without a seed migration. `generationIntervalWeeks` reuses the
 * same table as a plain string ("1".."4") via getSettingString/setSettingString.
 */

// Default for the "generationIntervalWeeks" key when no row exists yet —
// weekly, matching the pre-existing (always-due) generation cadence.
export const DEFAULT_GENERATION_INTERVAL_WEEKS = "1";

// Market intelligence config — competitor usernames and hashtags the monthly
// analysis routine (GET /api/analysis/market) tracks. Stored as JSON arrays
// under their own AppSetting keys so they can be updated independently of the
// boolean pause switches above.
export const MARKET_COMPETITORS_KEY = "marketCompetitors";
export const MARKET_HASHTAGS_KEY = "marketHashtags";
export const MAX_MARKET_COMPETITORS = 8;
export const MAX_MARKET_HASHTAGS = 10;

export async function getSettingString(key: string, defaultValue: string): Promise<string> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value ?? defaultValue;
}

export async function setSettingString(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

export async function getSetting(key: string): Promise<boolean> {
  return (await getSettingString(key, "false")) === "true";
}

export async function setSetting(key: string, value: boolean): Promise<void> {
  await setSettingString(key, value ? "true" : "false");
}

// Defensive JSON.parse — a hand-edited or corrupted AppSetting row falls back
// to an empty list instead of throwing, since these are non-critical config.
function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export async function getMarketConfig(): Promise<{ competitors: string[]; hashtags: string[] }> {
  const [competitorsRaw, hashtagsRaw] = await Promise.all([
    getSettingString(MARKET_COMPETITORS_KEY, "[]"),
    getSettingString(MARKET_HASHTAGS_KEY, "[]"),
  ]);
  return {
    competitors: parseStringArray(competitorsRaw),
    hashtags: parseStringArray(hashtagsRaw),
  };
}

export async function setMarketConfig(partial: { competitors?: string[]; hashtags?: string[] }): Promise<void> {
  await Promise.all([
    partial.competitors !== undefined
      ? setSettingString(MARKET_COMPETITORS_KEY, JSON.stringify(partial.competitors))
      : Promise.resolve(),
    partial.hashtags !== undefined
      ? setSettingString(MARKET_HASHTAGS_KEY, JSON.stringify(partial.hashtags))
      : Promise.resolve(),
  ]);
}
