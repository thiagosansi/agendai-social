import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSameOriginLenient } from "@/lib/auth";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const runtime = "nodejs";

// POST /api/auth/logout
// Clears the session cookie set by POST /api/auth/login. Same-origin only,
// matching the guard used by the login route and PATCH /api/settings.
export async function POST(req: NextRequest) {
  const authError = requireSameOriginLenient(req);
  if (authError) return authError;

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  return response;
}
