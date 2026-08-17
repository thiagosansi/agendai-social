import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSameOriginLenient } from "@/lib/auth";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const runtime = "nodejs";

// Both POST and GET clear the same cookie the same way — the role passed to
// sessionCookieOptions only affects maxAge, which is overridden to 0 here
// regardless, so "viewer" vs "owner" makes no difference for a clear.
function clearedCookie() {
  return { ...sessionCookieOptions("viewer"), maxAge: 0 };
}

// POST /api/auth/logout
// Clears the session cookie set by POST /api/auth/login. Same-origin only,
// matching the guard used by the login route and PATCH /api/settings.
export async function POST(req: NextRequest) {
  const authError = requireSameOriginLenient(req);
  if (authError) return authError;

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", clearedCookie());
  return response;
}

// GET /api/auth/logout?next=/login
// A navigable (non-fetch) variant used by app/layout.tsx to force out a
// viewer session whose ViewerUser row has been deactivated/deleted since
// the cookie was issued. A server component can't set cookies itself, so
// the layout redirects here instead: this clears the cookie and then
// redirects on to `next` (defaulting to /login), which now sees no cookie
// at all — no redirect loop. No same-origin check: this is a plain
// navigation (the browser follows the redirect from app/layout.tsx), not a
// fetch, so Sec-Fetch-Site/Origin aren't meaningfully checkable here, and
// the only effect is clearing the caller's own cookie.
//
// `next` must be a same-origin, single-segment-root path: it must start
// with exactly one "/" (not "//", which browsers/URL parsers treat as a
// protocol-relative host) and must not contain a backslash — some URL
// parsers normalize a leading "/\" into "//", turning
// `new URL("/\\evil.com", base)` into an off-origin redirect even though
// the raw string looks like it starts with a single slash.
export async function GET(req: NextRequest) {
  const nextParam = req.nextUrl.searchParams.get("next");
  const isSafeNext =
    !!nextParam &&
    nextParam.startsWith("/") &&
    !nextParam.startsWith("//") &&
    !nextParam.includes("\\");
  const next = isSafeNext ? nextParam : "/login";

  const response = NextResponse.redirect(new URL(next, req.url), 302);
  response.cookies.set(SESSION_COOKIE, "", clearedCookie());
  return response;
}
