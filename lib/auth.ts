import type { NextRequest } from "next/server";

// Extracts the bearer token from an Authorization header, or null if the
// header is missing or not a `Bearer <token>` value. Shared by every
// token-guard below so the parsing logic lives in one place.
function bearerFrom(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;
}

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
  const provided = bearerFrom(req);

  if (!expected || !provided || provided !== expected) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
}

/**
 * Bearer-token guard for the analysis report API (POST /api/analysis).
 * Mirrors requireGenerationToken but uses its own token so the analysis
 * routine (which may run on a different cadence/credential than piece
 * generation) can be rotated independently.
 */
export function requireAnalysisToken(req: NextRequest): Response | null {
  const expected = process.env.ANALYSIS_API_TOKEN;
  const provided = bearerFrom(req);

  if (!expected || !provided || provided !== expected) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
}

/**
 * Bearer-token guard for analysis read endpoints (GET /api/analysis/latest)
 * that both the analysis routine and the piece-generation routine need to
 * call — accepts either ANALYSIS_API_TOKEN or GENERATION_API_TOKEN.
 */
export function requireAnalysisOrGenerationToken(req: NextRequest): Response | null {
  const provided = bearerFrom(req);
  const analysisExpected = process.env.ANALYSIS_API_TOKEN;
  const generationExpected = process.env.GENERATION_API_TOKEN;

  const matchesAnalysis = !!analysisExpected && provided === analysisExpected;
  const matchesGeneration = !!generationExpected && provided === generationExpected;

  if (!provided || (!matchesAnalysis && !matchesGeneration)) {
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
  const provided = bearerFrom(req);

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
