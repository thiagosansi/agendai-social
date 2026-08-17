import type { NextRequest } from "next/server";
import { requireCronSecret } from "@/lib/auth";
import { runPublish } from "@/lib/cron-publish";

export const runtime = "nodejs";

// See app/api/cron/daily/route.ts's maxDuration comment — same budget
// applies to a manual run through this route.
export const maxDuration = 300;

// GET /api/cron/publish[?dry=1]
// Thin wrapper around runPublish. Kept for manual runs and dry-run testing.
// Dry-run (?dry=1 or env PUBLISH_DRY_RUN=1): runs every check (claim-check,
// format support, imageUrl reachability) but never calls the Graph API and
// never mutates the DB — eligible pieces are reported with outcome
// "skipped" (they would be published, but the real Meta call was skipped),
// not "published".
export async function GET(req: NextRequest) {
  const authError = requireCronSecret(req);
  if (authError) return authError;

  const dryRun = req.nextUrl.searchParams.get("dry") === "1" || process.env.PUBLISH_DRY_RUN === "1";

  const result = await runPublish({ dryRun });
  return Response.json(result);
}
