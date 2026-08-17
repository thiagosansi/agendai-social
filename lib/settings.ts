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

// Posting cadence config — how many pieces the generation routine writes per
// round, and which weekday/time slots the routine (docs/rotina-geracao.md)
// distributes `publishAt` across, so the owner can tune pace without editing
// the routine prompt. Stored as three independent AppSetting keys (like the
// market config above) so the Config page can update one at a time.
export const PIECES_PER_ROUND_KEY = "piecesPerRound";
export const POSTING_WEEKDAYS_KEY = "postingWeekdays";
export const POSTING_TIME_KEY = "postingTime";

export const DEFAULT_PIECES_PER_ROUND = "2";
// JS `Date#getDay()` convention: 0 = Sunday, 1 = Monday, ..., 6 = Saturday.
// Default [2, 4] = Tuesday and Thursday, matching the pre-existing hardcoded
// cadence in docs/rotina-geracao.md. Any code reading this key (including
// the cloud generation routine) must use the same 0-6/Sunday-first mapping.
export const DEFAULT_POSTING_WEEKDAYS = "[2,4]";
// HH:MM, 24h, America/Sao_Paulo local time (see
// lib/generation-schedule.ts's SAO_PAULO_UTC_OFFSET_MINUTES for the
// fixed UTC-3 conversion).
export const DEFAULT_POSTING_TIME = "11:00";

export const MAX_PIECES_PER_ROUND = 4;

export interface CadenceConfig {
  piecesPerRound: number;
  postingWeekdays: number[];
  postingTime: string;
}

// Defensive integer parse for piecesPerRound — out-of-range or non-integer
// values (e.g. a hand-edited row) fall back to the default rather than
// propagating a bad value into the generation routine's piece count.
function parsePiecesPerRound(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PIECES_PER_ROUND) {
    return Number(DEFAULT_PIECES_PER_ROUND);
  }
  return parsed;
}

// Defensive JSON.parse for postingWeekdays — invalid JSON, a non-array, an
// empty array, or any out-of-range/non-integer entry falls back to the
// default rather than producing an empty or malformed schedule. Valid
// weekdays are deduped and sorted ascending.
function parsePostingWeekdays(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return JSON.parse(DEFAULT_POSTING_WEEKDAYS);
    const valid = parsed.every(
      (item): item is number => typeof item === "number" && Number.isInteger(item) && item >= 0 && item <= 6,
    );
    if (!valid) return JSON.parse(DEFAULT_POSTING_WEEKDAYS);
    return Array.from(new Set(parsed as number[])).sort((a, b) => a - b);
  } catch {
    return JSON.parse(DEFAULT_POSTING_WEEKDAYS);
  }
}

const POSTING_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Defensive format check for postingTime — anything not matching strict
// HH:MM (00:00-23:59) falls back to the default.
function parsePostingTime(raw: string): string {
  return POSTING_TIME_RE.test(raw) ? raw : DEFAULT_POSTING_TIME;
}

export async function getCadenceConfig(): Promise<CadenceConfig> {
  const [piecesPerRoundRaw, postingWeekdaysRaw, postingTimeRaw] = await Promise.all([
    getSettingString(PIECES_PER_ROUND_KEY, DEFAULT_PIECES_PER_ROUND),
    getSettingString(POSTING_WEEKDAYS_KEY, DEFAULT_POSTING_WEEKDAYS),
    getSettingString(POSTING_TIME_KEY, DEFAULT_POSTING_TIME),
  ]);
  return {
    piecesPerRound: parsePiecesPerRound(piecesPerRoundRaw),
    postingWeekdays: parsePostingWeekdays(postingWeekdaysRaw),
    postingTime: parsePostingTime(postingTimeRaw),
  };
}

export async function setCadenceConfig(partial: Partial<CadenceConfig>): Promise<void> {
  await Promise.all([
    partial.piecesPerRound !== undefined
      ? setSettingString(PIECES_PER_ROUND_KEY, String(partial.piecesPerRound))
      : Promise.resolve(),
    partial.postingWeekdays !== undefined
      ? setSettingString(POSTING_WEEKDAYS_KEY, JSON.stringify(partial.postingWeekdays))
      : Promise.resolve(),
    partial.postingTime !== undefined
      ? setSettingString(POSTING_TIME_KEY, partial.postingTime)
      : Promise.resolve(),
  ]);
}
