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
