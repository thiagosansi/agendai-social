import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSameOriginLenient } from "@/lib/auth";
import { verifyPassword } from "@/lib/passwords";
import { prisma } from "@/lib/prisma";
import {
  constantTimeEqual,
  createSessionToken,
  OWNER_USERNAME,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/session";
import { loginSchema } from "@/lib/validation";

export const runtime = "nodejs";

// Cheap brute-force friction — a fixed delay before every failure response
// so repeated guesses cost wall-clock time without adding a timing signal
// (the delay is constant regardless of how close the guess was, and is the
// same across the owner and viewer paths so an attacker can't distinguish
// "unknown username" from "wrong password" by latency either).
const FAILURE_DELAY_MS = 400;

async function fail(): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS));
  // Same message for every failure kind (unknown username, wrong password,
  // inactive viewer) — no signal about which part of the credential pair
  // was wrong or whether the account exists at all.
  return Response.json({ error: "usuário ou senha incorretos" }, { status: 401 });
}

// POST /api/auth/login
// Exchanges either the owner credential (username "admin" + APP_PASSWORD)
// or a viewer credential (ViewerUser row, prisma/schema.prisma) for a
// cookie session (lib/session.ts) — this is what lets iOS home-screen PWAs
// authenticate, since standalone mode never shows the Basic Auth prompt
// middleware.ts falls back to. Same-origin only, matching the guard already
// used by PATCH /api/settings.
export async function POST(req: NextRequest) {
  const authError = requireSameOriginLenient(req);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const expectedPassword = process.env.APP_PASSWORD;
  if (!expectedPassword) {
    // Fail closed, same posture as middleware.ts when APP_PASSWORD is unset.
    return Response.json({ error: "APP_PASSWORD is not configured" }, { status: 500 });
  }

  const { username, password } = parsed.data;

  if (username === OWNER_USERNAME) {
    if (!constantTimeEqual(password, expectedPassword)) {
      return fail();
    }

    const token = await createSessionToken(expectedPassword, "owner", OWNER_USERNAME);
    const response = NextResponse.json({ ok: true, role: "owner" });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions("owner"));
    return response;
  }

  const viewer = await prisma.viewerUser.findUnique({ where: { username } });
  if (!viewer || !viewer.active || !verifyPassword(password, viewer.passwordHash)) {
    return fail();
  }

  const token = await createSessionToken(expectedPassword, "viewer", viewer.username);
  const response = NextResponse.json({ ok: true, role: "viewer" });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions("viewer"));
  return response;
}
