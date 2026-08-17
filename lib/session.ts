import type { NextRequest } from "next/server";

// Cookie-session helpers for the approval web UI, edge-safe (Web Crypto
// only — no Node `crypto`, since middleware.ts runs on the edge runtime).
//
// v2 adds a `role` (owner | approver | viewer) and `username` to the token
// so the same cookie can represent either the single owner (username
// "admin", authenticated against APP_PASSWORD) or a non-owner ViewerUser
// row (prisma/schema.prisma, authenticated against a scrypt hash — see
// lib/passwords.ts). "approver" is a ViewerUser with full piece-editing
// rights (edit caption/prompt, images, approve/disapprove) but no Config,
// no manual round, and no settings/push/users API access — see
// requirePieceEditor below. The token is still not a random, server-stored
// value —
// it is a timestamped HMAC keyed by APP_PASSWORD itself:
// `${exp}.${role}.${username}.${hex(HMAC)}`. That means there is still no
// session store to manage for the owner path: any request presenting a
// token that (a) has not expired and (b) recomputes to the same HMAC is
// trusted. Rotating APP_PASSWORD invalidates every existing session
// immediately (the HMAC key changed, so old tokens stop verifying), and the
// embedded expiry bounds how long a leaked token stays valid even without a
// rotation.
//
// Viewer accountability (has this ViewerUser been deactivated/deleted since
// the cookie was issued?) is NOT encoded in the token — that would require
// re-signing on every admin action. Instead app/layout.tsx re-checks
// `active` against the DB on every request for viewer sessions (Node
// runtime, not middleware) and clears the cookie via GET /api/auth/logout
// if the account is gone/inactive.
//
// v1 tokens (`${exp}.${hex(HMAC)}`, no role/username) fail to parse here
// (wrong part count) and verify as `null` — every v1 session is treated as
// unauthenticated, forcing a fresh login.

export const SESSION_COOKIE = "app_session";

export const OWNER_USERNAME = "admin";

export const OWNER_SESSION_MAX_AGE_SECONDS = 180 * 24 * 60 * 60; // ~180 days
export const VIEWER_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // ~30 days

const SESSION_MESSAGE_PREFIX = "agendai-social-session-v2:";

export type SessionRole = "owner" | "approver" | "viewer";

export interface Session {
  role: SessionRole;
  username: string;
  expiresAt: number;
}

// Same shape as lib/validation.ts's usernameSchema regex, duplicated here
// (rather than imported) so this file stays edge-safe and dependency-free —
// lib/validation.ts pulls in zod, which is fine on Node but adds weight to
// the middleware bundle unnecessarily.
const VIEWER_USERNAME_PATTERN = /^[a-z0-9._]{3,30}$/;

export function maxAgeForRole(role: SessionRole): number {
  return role === "owner" ? OWNER_SESSION_MAX_AGE_SECONDS : VIEWER_SESSION_MAX_AGE_SECONDS;
}

async function hmacKey(password: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function signPayload(
  password: string,
  expiresAtEpochSeconds: number,
  role: SessionRole,
  username: string,
): Promise<string> {
  const key = await hmacKey(password);
  const message = `${SESSION_MESSAGE_PREFIX}${expiresAtEpochSeconds}:${role}:${username}`;
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toHex(signature);
}

// Produces a v2 session token: `${exp}.${role}.${username}.${hex(HMAC-SHA256(
// key = password, message = "agendai-social-session-v2:" + exp + ":" + role +
// ":" + username))}`, with exp = now + maxAge for the given role. The owner
// path is always authenticated against APP_PASSWORD (the `password` param);
// the viewer path is authenticated against the ViewerUser's own scrypt hash
// beforehand (see app/api/auth/login/route.ts) but the token itself is still
// signed with APP_PASSWORD as the HMAC key, same as the owner path — that's
// what lets rotating APP_PASSWORD invalidate every outstanding session,
// owner and viewer alike, without touching the ViewerUser table.
export async function createSessionToken(
  password: string,
  role: SessionRole,
  username: string,
): Promise<string> {
  const expiresAtEpochSeconds = Math.floor(Date.now() / 1000) + maxAgeForRole(role);
  const signature = await signPayload(password, expiresAtEpochSeconds, role, username);
  return `${expiresAtEpochSeconds}.${role}.${username}.${signature}`;
}

// Constant-time string comparison — compares lengths first (a length
// mismatch already leaks no useful timing information) then XORs every
// character so a mismatch anywhere doesn't short-circuit the loop early.
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// Parses the `${exp}.${role}.${username}.${signature}` token (exactly 4
// dot-separated parts — a v1 token has 2 and is rejected outright), rejects
// it if the expiry isn't a valid integer or is already in the past, if the
// role isn't a known SessionRole, or if the username fails the same shape
// check enforced at signup/login time, then recomputes the HMAC for that
// exact payload and compares it against the supplied signature in constant
// time.
export async function verifySessionToken(
  token: string | undefined,
  password: string,
): Promise<Session | null> {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 4) return null;

  const [expiresAtRaw, roleRaw, username, signature] = parts;

  if (!/^\d+$/.test(expiresAtRaw)) return null;
  const expiresAtEpochSeconds = Number(expiresAtRaw);
  if (!Number.isSafeInteger(expiresAtEpochSeconds)) return null;
  if (expiresAtEpochSeconds < Math.floor(Date.now() / 1000)) return null;

  if (roleRaw !== "owner" && roleRaw !== "approver" && roleRaw !== "viewer") return null;
  const role: SessionRole = roleRaw;

  const usernameIsValid =
    username === OWNER_USERNAME || VIEWER_USERNAME_PATTERN.test(username);
  if (!usernameIsValid) return null;

  const expected = await signPayload(password, expiresAtEpochSeconds, role, username);
  if (!constantTimeEqual(signature, expected)) return null;

  return { role, username, expiresAt: expiresAtEpochSeconds };
}

export interface SessionCookieOptions {
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
}

// Shared cookie attributes for both setting and clearing the session
// cookie. `secure` is gated on NODE_ENV so local dev over http still works.
export function sessionCookieOptions(role: SessionRole): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeForRole(role),
  };
}

// Reads and verifies the session cookie off a NextRequest — the
// middleware-safe entry point (edge runtime, no next/headers). Server
// components needing the session should use getSession() in
// lib/session-server.ts instead, which reads from next/headers' cookies().
export async function getSessionFromRequest(req: NextRequest): Promise<Session | null> {
  const expectedPassword = process.env.APP_PASSWORD;
  if (!expectedPassword) return null;

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return verifySessionToken(token, expectedPassword);
}

// Generic role-gated route guard for API routes (Node runtime). Returns a
// Response to short-circuit the caller when access must be denied, or null
// when the request's session role is in `allowed` and the caller should
// proceed:
//   - no/invalid session         -> 401 { error: "unauthorized" }
//   - session role not allowed   -> 403 { error: "sem permissão" }
//   - session role allowed       -> null (proceed)
export async function requireRole(
  req: NextRequest,
  allowed: SessionRole[],
): Promise<Response | null> {
  const session = await getSessionFromRequest(req);

  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!allowed.includes(session.role)) {
    return Response.json({ error: "sem permissão" }, { status: 403 });
  }

  return null;
}

// Owner-only route guard — Config, settings, push and user-management
// routes. Delegates to requireRole; kept as its own export since it's the
// far more common case and reads better at call sites than
// `requireRole(req, ["owner"])`.
export async function requireOwner(req: NextRequest): Promise<Response | null> {
  return requireRole(req, ["owner"]);
}

// Piece-editing route guard — owner or approver. Covers PATCH
// /api/pieces/[id] and the image upload/delete/reorder routes: full piece
// workflow (caption/prompt, images, approve/disapprove), but not Config,
// manual round, or settings/push/users, which stay requireOwner.
export async function requirePieceEditor(req: NextRequest): Promise<Response | null> {
  return requireRole(req, ["owner", "approver"]);
}
