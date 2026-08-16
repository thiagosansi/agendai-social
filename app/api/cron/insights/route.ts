import type { NextRequest } from "next/server";
import { requireCronSecret } from "@/lib/auth";
import { runInsights } from "@/lib/cron-insights";

export const runtime = "nodejs";

// GET /api/cron/insights
// Thin wrapper around runInsights. Kept for manual runs.
// For every published Piece from the last 8 weeks with an igMediaId,
// fetches Instagram insights and merges them into Piece.metrics.
// Also records one AccountSnapshot (follower count) per run.
export async function GET(req: NextRequest) {
  const authError = requireCronSecret(req);
  if (authError) return authError;

  const result = await runInsights();
  return Response.json(result);
}
