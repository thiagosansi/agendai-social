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
