import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// HTTP Basic Auth gate for the approval web UI pages (fila/calendario/
// publicados/config). Any username is accepted — only the password (from
// APP_PASSWORD) is checked, per README.md ("single-owner tool, no
// multi-user auth yet"). API routes have their own bearer-token auth (see
// lib/auth.ts) and must stay reachable without this gate — the daily
// publish cron and the AI generation routine call them directly, with no
// browser and no Basic Auth header. The matcher below excludes /api, /_next,
// /uploads (local dev image storage, served as static files), favicon.ico,
// manifest.webmanifest, icon.png, apple-icon.png, /icons/ directory
// (needed for PWA/mobile app icons to load without auth), and sw.js — the
// browser fetches the service worker script without the page's Authorization
// header, so gating it would 401 and push registration would never succeed.
const REALM = "Agendaí Social Studio";

export function middleware(req: NextRequest) {
  const expectedPassword = process.env.APP_PASSWORD;

  if (!expectedPassword) {
    // Fail closed: an unconfigured password must not silently open the UI.
    return new NextResponse("APP_PASSWORD is not configured.", { status: 500 });
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
    "/((?!api|_next|uploads|favicon.ico|manifest.webmanifest|icon.png|apple-icon.png|icons/|sw.js).*)",
  ],
};
