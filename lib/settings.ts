import { prisma } from "@/lib/prisma";

/**
 * Generic key/value settings store backed by AppSetting. Values are stored
 * as the string "true"/"false" — an absent row means "false", so every
 * known key (see app/api/settings/route.ts) defaults to unpaused without a
 * seed migration.
 */

export async function getSetting(key: string): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value === "true";
}

export async function setSetting(key: string, value: boolean): Promise<void> {
  const stringValue = value ? "true" : "false";
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: stringValue },
    update: { value: stringValue },
  });
}
