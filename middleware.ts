import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

// Auth gate for the approval web UI pages (fila/calendario/publicados/
// config/etc). Two credential paths are accepted, in order:
//   1. Cookie session (lib/session.ts) — set by POST /api/auth/login via the
//      /login page. This is what iOS home-screen (standalone) PWAs use,
//      since standalone mode never renders the Basic Auth prompt path 2
//      relies on.
//   2. HTTP Basic Auth — any username, only the password (APP_PASSWORD) is
//      checked, per README.md ("single-owner tool, no multi-user auth
//      yet"). Kept working so curl/scripts don't need to change.
// If neither credential is present: a request that looks like a browser
// asking for a page (Sec-Fetch-Dest: document, or an Accept header that
// wants HTML) gets redirected to /login instead of a raw 401 — a bare 401
// with no UI to respond to it is a dead end for a page navigation. Anything
// else (curl, scripts, non-document fetches) keeps the original 401 +
// WWW-Authenticate response so existing tooling keeps working.
// API routes have their own bearer-token auth (see lib/auth.ts) and must
// stay reachable without this gate — the daily publish cron and the AI
// generation routine call them directly, with no browser and no session/
// Basic Auth credential. The matcher below excludes /api, /_next, /login
// (the page this gate redirects to — gating it would loop), /uploads
// (local dev image storage, served as static files), favicon.ico,
// manifest.webmanifest, icon.png, apple-icon.png, /icons/ directory
// (needed for PWA/mobile app icons to load without auth), and sw.js — the
// browser fetches the service worker script without the page's Authorization
// header, so gating it would 401 and push registration would never succeed.
const REALM = "Agendaí Social Studio";

export async function middleware(req: NextRequest) {
  const expectedPassword = process.env.APP_PASSWORD;

  if (!expectedPassword) {
    // Fail closed: an unconfigured password must not silently open the UI.
    return new NextResponse("APP_PASSWORD is not configured.", { status: 500 });
  }

  const sessionToken = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(sessionToken, expectedPassword);
  if (session) {
    return NextResponse.next();
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Basic ")) {
    const decoded = atob(authHeader.slice("Basic ".length));
    const separatorIndex = decoded.indexOf(":");
    const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : decoded;
    if (password === expectedPassword) {
      return NextResponse.next();
    }
  }

  const acceptHeader = req.headers.get("accept") ?? "";
  const wantsPage = req.headers.get("sec-fetch-dest") === "document" || acceptHeader.includes("text/html");
  if (wantsPage) {
    const next = `${req.nextUrl.pathname}${req.nextUrl.search}`;
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", next);
    return NextResponse.redirect(loginUrl, 302);
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": `Basic realm="${REALM}"` },
  });
}

// NOTE: the parentheses here must balance. A stray trailing ")" in this
// pattern compiles to a *literal* ")" in the generated route regex, which
// silently narrows the matcher to paths ending in that character — i.e. the
// gate stops running on every real page instead of failing loudly.
export const config = {
  matcher: [
    "/((?!api|_next|login|uploads|favicon.ico|manifest.webmanifest|icon.png|apple-icon.png|icons/|sw.js).*)",
  ],
};
