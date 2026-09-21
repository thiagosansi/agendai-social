// Presentation helpers shared by the approval web UI. All piece timestamps
// are stored in UTC (Prisma `DateTime`) and rendered in the founder's local
// timezone (America/Sao_Paulo) since that's the only audience for this tool.

import { SAO_PAULO_UTC_OFFSET_MINUTES } from "@/lib/generation-schedule";

const SP_TIME_ZONE = "America/Sao_Paulo";

function toDate(value: Date | string): Date {
  return typeof value === "string" ? new Date(value) : value;
}

export function formatDateTimeSP(value: Date | string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: SP_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(toDate(value));
}

export function formatDateSP(value: Date | string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: SP_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(toDate(value));
}

/** "YYYY-MM-DD" calendar-day key of `value` in America/Sao_Paulo, for bucketing. */
export function spDateKey(value: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(toDate(value));
}

const DATETIME_LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Converts `value` to the "YYYY-MM-DDTHH:mm" string a `<input
 * type="datetime-local">` expects, representing the instant in São Paulo
 * local time. Pure UTC arithmetic (no Intl/timezone APIs, no dependency on
 * the browser's own timezone — the person opening this UI may not be in
 * São Paulo): shifts the instant by the fixed BRT offset
 * (SAO_PAULO_UTC_OFFSET_MINUTES, lib/generation-schedule.ts) so reading its
 * UTC-getters yields São Paulo calendar fields. Mirrors the shift
 * computeNextPublishSlots uses for the reverse direction.
 */
export function toSaoPauloDateTimeLocal(value: Date | string): string {
  const localInstant = new Date(toDate(value).getTime() + SAO_PAULO_UTC_OFFSET_MINUTES * 60_000);
  const year = localInstant.getUTCFullYear();
  const month = pad2(localInstant.getUTCMonth() + 1);
  const day = pad2(localInstant.getUTCDate());
  const hour = pad2(localInstant.getUTCHours());
  const minute = pad2(localInstant.getUTCMinutes());
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

/**
 * Parses a "YYYY-MM-DDTHH:mm[:ss]" string (as produced by a
 * datetime-local input) as São Paulo local wall-clock time, returning the
 * corresponding UTC Date — or null for empty/malformed input. Inverse of
 * toSaoPauloDateTimeLocal: reads the digits as if they were UTC fields
 * (Date.UTC), then shifts back by the fixed BRT offset to get the real
 * instant. Deliberately NOT `new Date("YYYY-MM-DDTHH:mm")`, which parses
 * against the *browser's* local timezone.
 */
export function fromSaoPauloDateTimeLocal(value: string): Date | null {
  const match = DATETIME_LOCAL_RE.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const pseudoUtcMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    second ? Number(second) : 0,
  );
  if (Number.isNaN(pseudoUtcMs)) return null;
  const realInstantMs = pseudoUtcMs - SAO_PAULO_UTC_OFFSET_MINUTES * 60_000;
  return new Date(realInstantMs);
}

export const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  approved: "Aprovado",
  published: "Publicado",
  failed: "Falhou",
};

export const FORMAT_LABELS: Record<string, string> = {
  carrossel: "Carrossel",
  reels: "Reels",
  estatico: "Estático",
  stories: "Stories",
};

/**
 * Human countdown/date for an approved piece's `publishAt`. Once the
 * schedule has already passed (and the piece is still sitting as approved),
 * there's no fixed next run to point to — the daily publish cron just picks
 * it up whenever it next executes.
 */
export function publishCountdown(publishAt: Date | string, now: Date = new Date()): string {
  const target = toDate(publishAt);
  const diffMs = target.getTime() - now.getTime();

  if (diffMs <= 0) {
    return "Publica na próxima execução do cron";
  }

  const diffMinutes = Math.round(diffMs / 60_000);
  if (diffMinutes < 60) {
    return `Publica em ${diffMinutes} min`;
  }

  const diffHours = Math.round(diffMs / 3_600_000);
  if (diffHours < 24) {
    return `Publica em ${diffHours}h`;
  }

  const diffDays = Math.round(diffMs / 86_400_000);
  if (diffDays === 1) {
    return "Publica amanhã";
  }
  if (diffDays < 7) {
    return `Publica em ${diffDays} dias`;
  }

  return `Publica em ${formatDateTimeSP(target)}`;
}
