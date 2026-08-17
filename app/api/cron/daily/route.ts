import type { NextRequest } from "next/server";
import { requireCronSecret } from "@/lib/auth";
import { runPublish, type PublishPayload } from "@/lib/cron-publish";
import { runInsights, type InsightsPayload } from "@/lib/cron-insights";
import {
  notifyPendingApproval,
  notifyPublishFailures,
  notifySafely,
} from "@/lib/notifications";

export const runtime = "nodejs";

interface DailyResponse {
  publish: PublishPayload;
  insights: InsightsPayload | { skipped: string };
}

// GET /api/cron/daily
// Called daily by Vercel Cron (see vercel.json).
// Always runs the publish routine. Runs insights only on Monday (UTC weekday 1).
// Each half is isolated: a failure in one does not prevent the other from running.
export async function GET(req: NextRequest) {
  const authError = requireCronSecret(req);
  if (authError) return authError;

  const publishPayload = await runPublish({ dryRun: false });

  // Notify on anything that now needs a human. Both calls are isolated the
  // same way the two halves of this route are: a push failure must not stop
  // insights from running or turn a successful publish run into a 500.
  const failures = publishPayload.results
    .filter((result) => result.outcome === "failed")
    .map((result) => ({ id: result.id, error: result.error }));

  await notifySafely("publish failures", () => notifyPublishFailures(failures));

  // Daily catch-up for a queue that was generated but never worked through —
  // the generation-time notification only fires once per round, so without
  // this a queue left pending would go quiet after the first reminder.
  await notifySafely("pending approval", notifyPendingApproval);

  // Insights run only on Monday (UTC weekday 1)
  const now = new Date();
  const utcWeekday = now.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const isMonday = utcWeekday === 1;

  let insightsPayload: InsightsPayload | { skipped: string };

  if (isMonday) {
    try {
      insightsPayload = await runInsights();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      insightsPayload = { skipped: `error: ${message}` };
    }
  } else {
    insightsPayload = { skipped: "not Monday (UTC)" };
  }

  const response: DailyResponse = {
    publish: publishPayload,
    insights: insightsPayload,
  };

  return Response.json(response);
}
