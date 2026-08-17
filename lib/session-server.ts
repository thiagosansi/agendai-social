import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken, type Session } from "@/lib/session";

// Server-component variant of lib/session.ts's getSessionFromRequest, for
// places that only have next/headers' cookies() and not a NextRequest (e.g.
// app/layout.tsx). Kept out of lib/session.ts on purpose — that file must
// stay edge-safe for middleware.ts, and next/headers is not available on
// the edge runtime.
export async function getSession(): Promise<Session | null> {
  const expectedPassword = process.env.APP_PASSWORD;
  if (!expectedPassword) return null;

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return verifySessionToken(token, expectedPassword);
}
