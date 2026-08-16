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
