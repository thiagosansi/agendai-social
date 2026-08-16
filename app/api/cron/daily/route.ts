import type { NextRequest } from "next/server";
import { requireCronSecret } from "@/lib/auth";
import { runPublish, type PublishPayload } from "@/lib/cron-publish";
import { runInsights, type InsightsPayload } from "@/lib/cron-insights";

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
