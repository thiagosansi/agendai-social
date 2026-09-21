const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DUE_GRACE_MS = 12 * 60 * 60 * 1000; // lets a routine that runs a bit late each week still count as on-time

// Whether a new content round is due, given the most recent Piece (any
// status — a draft still counts as "a round already ran") and the
// configured interval. No pieces yet → always due. The grace window means a
// weekly Monday-08:00 routine is still "due" even if the previous round was
// created Monday 08:30 the week before.
export function computeGenerationDue(lastPieceCreatedAt: Date | null, intervalWeeks: number): boolean {
  if (!lastPieceCreatedAt) return true;
  const dueAfterMs = intervalWeeks * ONE_WEEK_MS - DUE_GRACE_MS;
  return Date.now() - lastPieceCreatedAt.getTime() >= dueAfterMs;
}

// Fixed America/Sao_Paulo UTC offset, in minutes: local = UTC + offset (i.e.
// UTC = local + 3h). Brazil abolished daylight saving time in 2019, so this
// is a constant rather than a real timezone calculation — isolated here so
// a future DST reversal is a one-line change instead of a rewrite of the
// slot math below.
export const SAO_PAULO_UTC_OFFSET_MINUTES = -180;

// Minimum gap, in ms, a computed publish slot must sit ahead of "now". Gives
// the owner time to review and approve a draft piece before its scheduled
// slot. The cloud generation routine (docs/rotina-geracao.md) wakes Monday
// 08:00 BRT, so without this a same-day 11:00 BRT slot would already be
// unusable (only 3h of approval window) — 24h guarantees at least one full
// day, pushing that case to the following occurrence of the weekday.
export const MIN_APPROVAL_LEAD_MS = 24 * 60 * 60 * 1000;

// pt-BR abbreviations for JS `Date#getDay()` weekdays (0 = Sunday ... 6 =
// Saturday). Pure data, lives here (not in a UI file) so scripts and future
// UI code can both import it without pulling in React.
export const WEEKDAY_LABELS_PT_BR = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

const POSTING_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DEFAULT_HOUR = 11;
const DEFAULT_MINUTE = 0;

// Parses "HH:MM" into { hour, minute }; malformed input falls back to the
// default 11:00 rather than throwing, since this runs against
// AppSetting-sourced strings that may have been hand-edited.
function parsePostingTime(time: string): { hour: number; minute: number } {
  const match = POSTING_TIME_RE.exec(time);
  if (!match) return { hour: DEFAULT_HOUR, minute: DEFAULT_MINUTE };
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

// Computes the next `count` publish slots (ascending), each landing on one
// of `weekdays` (São Paulo local weekday, JS `Date#getDay()` convention) at
// `time` (HH:MM, São Paulo local), at least MIN_APPROVAL_LEAD_MS after
// `now`. Advances week by week once every weekday in a given week has been
// used, so `count > weekdays.length` wraps into following weeks.
//
// Implemented with pure UTC arithmetic (no Intl/timezone APIs): `now` is
// shifted by the fixed BRT offset so reading its UTC-getters yields São
// Paulo calendar fields, then each candidate day's local HH:MM is converted
// back to a real UTC instant by shifting the other way. This keeps the file
// dependency-free.
export function computeNextPublishSlots(
  now: Date,
  weekdays: number[],
  time: string,
  count: number,
  minLeadMs: number = MIN_APPROVAL_LEAD_MS,
): Date[] {
  if (count <= 0) return [];

  const validWeekdays = Array.from(
    new Set(weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)),
  );
  if (validWeekdays.length === 0) return [];

  const { hour, minute } = parsePostingTime(time);
  const minInstantMs = now.getTime() + minLeadMs;

  // Shift now's instant by the offset so its UTC-getters read as São Paulo
  // local calendar fields.
  const localNow = new Date(now.getTime() + SAO_PAULO_UTC_OFFSET_MINUTES * 60_000);
  const startYear = localNow.getUTCFullYear();
  const startMonth = localNow.getUTCMonth();
  const startDate = localNow.getUTCDate();

  const slots: Date[] = [];
  // Bound the scan: worst case is one match per week (single configured
  // weekday), so count weeks plus one is always enough headroom.
  const maxDayOffset = (count + 1) * 7;

  for (let dayOffset = 0; slots.length < count && dayOffset <= maxDayOffset; dayOffset += 1) {
    const candidateDay = new Date(Date.UTC(startYear, startMonth, startDate + dayOffset));
    if (!validWeekdays.includes(candidateDay.getUTCDay())) continue;

    // Build the candidate slot as if the local HH:MM were UTC, then shift
    // back to the real UTC instant (local = UTC + offset ⇒ UTC = local - offset).
    const localAsUtcMs = Date.UTC(startYear, startMonth, startDate + dayOffset, hour, minute, 0, 0);
    const slotUtcMs = localAsUtcMs - SAO_PAULO_UTC_OFFSET_MINUTES * 60_000;
    if (slotUtcMs >= minInstantMs) {
      slots.push(new Date(slotUtcMs));
    }
  }

  return slots;
}

// Finds the earliest cadence slot not already occupied by another piece's
// publishAt, for PATCH /api/pieces/[id]'s approve-time reschedule (a piece
// that sat past its slot moves here instead of staying stuck in draft).
//
// Called with `minLeadMs: 0` — deliberately bypassing the MIN_APPROVAL_LEAD_MS
// invariant documented above. That lead exists to give the owner a review
// window before a slot arrives; on this path the owner has *already*
// reviewed and is approving right now, so there is nothing left to protect
// by pushing the slot further out. Requesting `occupied.length + 1` slots
// keeps the scan bounded by computeNextPublishSlots's own `maxDayOffset`
// logic (which sizes its search window off the requested count) while still
// guaranteeing at least one candidate survives after occupied slots are
// filtered out.
export function pickNextFreeSlot(now: Date, weekdays: number[], time: string, occupied: Date[]): Date | null {
  const occupiedMs = new Set(occupied.map((date) => date.getTime()));
  const candidates = computeNextPublishSlots(now, weekdays, time, occupied.length + 1, 0);
  const free = candidates.find((slot) => !occupiedMs.has(slot.getTime()));
  return free ?? null;
}
