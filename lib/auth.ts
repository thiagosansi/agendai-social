import type { NextRequest } from "next/server";

/**
 * Bearer-token guard for the AI generation routine (POST /api/pieces only).
 *
 * The approval web UI (GET/PATCH/image upload) is intentionally NOT gated
 * here — it will be protected by basic-auth middleware with APP_PASSWORD in
 * a follow-up task. Gating those routes here too would double-protect them
 * with a token the browser UI doesn't have, so they stay open for now.
 */
export function requireGenerationToken(req: NextRequest): Response | null {
  const expected = process.env.GENERATION_API_TOKEN;
  const header = req.headers.get("authorization");
  const provided = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;

  if (!expected || !provided || provided !== expected) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
}

/**
 * Bearer-token guard for the daily publish cron (GET /api/cron/publish).
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically
 * when the CRON_SECRET env var is set on the project — see README "Publicação".
 */
export function requireCronSecret(req: NextRequest): Response | null {
  const expected = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  const provided = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;

  if (!expected || !provided || provided !== expected) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
}

/**
 * Same-origin guard for the settings PATCH endpoint (app/api/settings/route.ts).
 * The Config page (behind APP_PASSWORD basic auth via middleware.ts) calls this
 * endpoint with a plain same-origin fetch, and modern browsers attach the Fetch
 * Metadata `Sec-Fetch-Site` header automatically — no bearer token needed for
 * this single-user app. Cross-site requests (or tools that omit the header
 * entirely, like curl) are rejected.
 */
export function requireSameOrigin(req: NextRequest): Response | null {
  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite !== "same-origin") {
    return Response.json({ error: "cross-origin request rejected" }, { status: 403 });
  }
  return null;
}
