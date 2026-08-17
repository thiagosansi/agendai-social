import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireSameOriginLenient } from "@/lib/auth";
import { constantTimeEqual, createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const runtime = "nodejs";

const loginSchema = z.object({
  password: z.string().min(1, "password is required"),
});

// POST /api/auth/login
// Exchanges APP_PASSWORD for a cookie session (lib/session.ts) — this is
// what lets iOS home-screen PWAs authenticate, since standalone mode never
// shows the Basic Auth prompt middleware.ts falls back to. Same-origin only,
// matching the guard already used by PATCH /api/settings.
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

  if (!constantTimeEqual(parsed.data.password, expectedPassword)) {
    // Cheap brute-force friction — a fixed delay before the 401 so repeated
    // guesses cost wall-clock time without adding any timing signal (the
    // delay is constant regardless of how close the guess was).
    await new Promise((resolve) => setTimeout(resolve, 400));
    return Response.json({ error: "senha incorreta" }, { status: 401 });
  }

  const token = await createSessionToken(expectedPassword);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
}
