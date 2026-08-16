// Presentation helpers shared by the approval web UI. All piece timestamps
// are stored in UTC (Prisma `DateTime`) and rendered in the founder's local
// timezone (America/Sao_Paulo) since that's the only audience for this tool.

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
