#!/usr/bin/env node
// Test coverage for lib/generation-schedule.ts's pure scheduling helpers
// (computeGenerationDue, computeNextPublishSlots). Plain node:test — no
// vitest/jest dependency in this project. Node >=23.6 strips TypeScript
// types natively; on 22.12-22.17 (see package.json's engines) run with
// --experimental-strip-types (see the "test:schedule" package.json script).
//
// Usage: pnpm test:schedule

import test from "node:test";
import assert from "node:assert/strict";
import {
  computeGenerationDue,
  computeNextPublishSlots,
  MIN_APPROVAL_LEAD_MS,
} from "../lib/generation-schedule.ts";

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

test("computeGenerationDue: no prior piece is always due", () => {
  assert.equal(computeGenerationDue(null, 1), true);
});

test("computeGenerationDue: within interval is not due", () => {
  const lastPieceCreatedAt = new Date(Date.now() - 2 * ONE_HOUR_MS);
  assert.equal(computeGenerationDue(lastPieceCreatedAt, 1), false);
});

test("computeGenerationDue: past interval is due", () => {
  const lastPieceCreatedAt = new Date(Date.now() - 2 * ONE_WEEK_MS);
  assert.equal(computeGenerationDue(lastPieceCreatedAt, 1), true);
});

test("computeGenerationDue: 12h grace lets a slightly-late routine still count as on-time", () => {
  // Due threshold is (interval - grace) = 1 week - 12h. Elapsed = interval
  // minus 1 full day (24h > 12h grace) is still short of that threshold ->
  // not due yet.
  const lastPieceCreatedAt = new Date(Date.now() - (ONE_WEEK_MS - 24 * ONE_HOUR_MS));
  assert.equal(computeGenerationDue(lastPieceCreatedAt, 1), false);

  // Elapsed = interval - 6h (inside the 12h grace window, past the reduced
  // threshold) -> already due, even though the full week hasn't elapsed —
  // this is the "routine ran a bit late last time" case from the doc comment.
  const lastPieceCreatedAtDue = new Date(Date.now() - (ONE_WEEK_MS - 6 * ONE_HOUR_MS));
  assert.equal(computeGenerationDue(lastPieceCreatedAtDue, 1), true);
});

test("computeNextPublishSlots: default [2,4] 11:00 from Monday 2026-08-17 08:00 BRT", () => {
  const now = new Date("2026-08-17T11:00:00.000Z"); // Monday 08:00 BRT
  const slots = computeNextPublishSlots(now, [2, 4], "11:00", 2);
  assert.equal(slots.length, 2);
  assert.equal(slots[0].toISOString(), "2026-08-18T14:00:00.000Z"); // Tue 11:00 BRT
  assert.equal(slots[1].toISOString(), "2026-08-20T14:00:00.000Z"); // Thu 11:00 BRT
  assert.ok(slots[0].getTime() < slots[1].getTime());
});

test("computeNextPublishSlots: lead time skips a same-day slot", () => {
  const now = new Date("2026-08-17T11:00:00.000Z"); // Monday 08:00 BRT
  const slots = computeNextPublishSlots(now, [1], "11:00", 1);
  assert.equal(slots.length, 1);
  // Monday's own 11:00 BRT slot (14:00Z) is only 3h away — less than
  // MIN_APPROVAL_LEAD_MS (24h) — so the next Monday is used instead.
  assert.equal(slots[0].toISOString(), "2026-08-24T14:00:00.000Z");
  assert.ok(slots[0].getTime() - now.getTime() >= MIN_APPROVAL_LEAD_MS);
});

test("computeNextPublishSlots: wraps across weeks when count > weekdays.length", () => {
  const now = new Date("2026-08-17T11:00:00.000Z"); // Monday 08:00 BRT
  const slots = computeNextPublishSlots(now, [2], "11:00", 4);
  assert.equal(slots.length, 4);
  const expected = [
    "2026-08-18T14:00:00.000Z",
    "2026-08-25T14:00:00.000Z",
    "2026-09-01T14:00:00.000Z",
    "2026-09-08T14:00:00.000Z",
  ];
  assert.deepEqual(
    slots.map((slot) => slot.toISOString()),
    expected,
  );
  for (let i = 1; i < slots.length; i += 1) {
    assert.ok(slots[i].getTime() > slots[i - 1].getTime());
  }
});

test("computeNextPublishSlots: unsorted/duplicate weekdays behave like the deduped/sorted set", () => {
  const now = new Date("2026-08-17T11:00:00.000Z"); // Monday 08:00 BRT
  const sorted = computeNextPublishSlots(now, [2, 4], "11:00", 2);
  const unsortedWithDupes = computeNextPublishSlots(now, [4, 2, 4, 2], "11:00", 2);
  assert.deepEqual(
    unsortedWithDupes.map((slot) => slot.toISOString()),
    sorted.map((slot) => slot.toISOString()),
  );
});

test("computeNextPublishSlots: 23:30 crosses UTC midnight but keeps the BRT weekday", () => {
  const now = new Date("2026-08-17T11:00:00.000Z"); // Monday 08:00 BRT
  const slots = computeNextPublishSlots(now, [2], "23:30", 1);
  assert.equal(slots.length, 1);
  // Tue 23:30 BRT = Wed 02:30 UTC — UTC date rolls to the next day, but the
  // slot is still anchored to Tuesday in São Paulo local time.
  assert.equal(slots[0].toISOString(), "2026-08-19T02:30:00.000Z");
});

test("computeNextPublishSlots: 00:00 BRT is 03:00 UTC the same date", () => {
  const now = new Date("2026-08-17T11:00:00.000Z"); // Monday 08:00 BRT
  // Wednesday (weekday 3), not Tuesday: the first Tuesday's 00:00 BRT slot
  // (Aug18 03:00Z) falls before minInstant (Tue 08:00 BRT = Aug18 11:00Z),
  // so it would be skipped by the lead-time rule and land on the following
  // Tuesday instead — using Wednesday isolates the offset-conversion check
  // (date is NOT rolled back a day) from the lead-time rule covered above.
  const slots = computeNextPublishSlots(now, [3], "00:00", 1);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].toISOString(), "2026-08-19T03:00:00.000Z");
});

test("computeNextPublishSlots: malformed time falls back to 11:00", () => {
  const now = new Date("2026-08-17T11:00:00.000Z"); // Monday 08:00 BRT
  const malformed = computeNextPublishSlots(now, [2], "9:00", 1);
  const fallback = computeNextPublishSlots(now, [2], "11:00", 1);
  assert.deepEqual(
    malformed.map((slot) => slot.toISOString()),
    fallback.map((slot) => slot.toISOString()),
  );
});

test("computeNextPublishSlots: weekdays [0] (Sunday only)", () => {
  const now = new Date("2026-08-17T11:00:00.000Z"); // Monday 08:00 BRT
  const slots = computeNextPublishSlots(now, [0], "11:00", 1);
  assert.equal(slots.length, 1);
  // Next Sunday after Monday 2026-08-17 is 2026-08-23.
  assert.equal(slots[0].toISOString(), "2026-08-23T14:00:00.000Z");
});

test("computeNextPublishSlots: empty weekdays returns []", () => {
  const now = new Date("2026-08-17T11:00:00.000Z");
  assert.deepEqual(computeNextPublishSlots(now, [], "11:00", 2), []);
});

test("computeNextPublishSlots: count 0 returns []", () => {
  const now = new Date("2026-08-17T11:00:00.000Z");
  assert.deepEqual(computeNextPublishSlots(now, [2, 4], "11:00", 0), []);
});

test("computeNextPublishSlots: now exactly on a slot is included (lead time already satisfied by prior day)", () => {
  // now is exactly at a slot that is already >= a previous candidate + lead
  // time; verify the boundary comparison is inclusive (>=), not exclusive.
  const slotInstant = new Date("2026-08-18T14:00:00.000Z"); // Tue 11:00 BRT
  const now = new Date(slotInstant.getTime() - MIN_APPROVAL_LEAD_MS); // exactly lead-time before the slot
  const slots = computeNextPublishSlots(now, [2], "11:00", 1);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].toISOString(), slotInstant.toISOString());
});
