// ISO-8601 week helpers, always computed in UTC so the anti-repetition rule
// in docs/02-playbook-conteudo.md §2 ("mesma combinação pilar+segmento não
// repete em 6 semanas ISO") is consistent regardless of server timezone.

/** Returns the UTC-midnight Monday that starts the ISO week containing `date`. */
export function isoWeekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const isoDay = d.getUTCDay() || 7; // Sunday (0) -> 7, so Monday is day 1
  d.setUTCDate(d.getUTCDate() - isoDay + 1);
  return d;
}

/** Returns the [start, end) UTC range of the ISO week containing `date`. */
export function isoWeekRange(date: Date): { start: Date; end: Date } {
  const start = isoWeekStart(date);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 7);
  return { start, end };
}

/** Human-readable ISO week key, e.g. "2026-W33". Useful for logs/notes. */
export function isoWeekKey(date: Date): string {
  const start = isoWeekStart(date);
  // Thursday of this ISO week determines the ISO week-numbering year.
  const thursday = new Date(start);
  thursday.setUTCDate(start.getUTCDate() + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * Parses the `since` query param used by GET /api/pieces for the
 * anti-repetition lookback, e.g. "6w" (6 weeks back from now) or an ISO
 * date string. Returns null if `raw` is missing or unparsable.
 */
export function parseSince(raw: string | null, now: Date = new Date()): Date | null {
  if (!raw) return null;

  const weeksMatch = /^(\d+)w$/i.exec(raw.trim());
  if (weeksMatch) {
    const weeks = Number(weeksMatch[1]);
    const cutoff = new Date(now);
    cutoff.setUTCDate(cutoff.getUTCDate() - weeks * 7);
    return cutoff;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
