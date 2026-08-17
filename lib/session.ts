// Cookie-session helpers for the approval web UI, edge-safe (Web Crypto
// only — no Node `crypto`, since middleware.ts runs on the edge runtime).
//
// The session token is not a random, server-stored value — it is a
// timestamped HMAC keyed by APP_PASSWORD itself: `${expiresAt}.${hex(HMAC)}`.
// That means there is no session store to manage: any request presenting a
// token that (a) has not expired and (b) recomputes to the same HMAC is
// trusted. Rotating APP_PASSWORD invalidates every existing session
// immediately (the HMAC key changed, so old tokens stop verifying), and the
// embedded expiry bounds how long a leaked token stays valid even without a
// rotation. This mirrors the single-owner, no-session-store posture already
// used by Basic Auth in middleware.ts.

export const SESSION_COOKIE = "app_session";
export const SESSION_MAX_AGE_SECONDS = 180 * 24 * 60 * 60; // ~180 days

const SESSION_MESSAGE_PREFIX = "agendai-social-session-v1:";

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

async function signExpiry(password: string, expiresAtEpochSeconds: number): Promise<string> {
  const key = await hmacKey(password);
  const message = `${SESSION_MESSAGE_PREFIX}${expiresAtEpochSeconds}`;
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toHex(signature);
}

// Produces the session token for the given password: `${expiresAt}.${hex(
// HMAC-SHA256(key = password, message = "agendai-social-session-v1:" +
// expiresAt))}`, with expiresAt = now + SESSION_MAX_AGE_SECONDS. Embedding
// the expiry in the signed message (rather than trusting an unsigned
// prefix) means it can't be tampered with independently of the signature.
export async function createSessionToken(password: string): Promise<string> {
  const expiresAtEpochSeconds = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const signature = await signExpiry(password, expiresAtEpochSeconds);
  return `${expiresAtEpochSeconds}.${signature}`;
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

// Parses the `${expiresAt}.${signature}` token, rejects it outright if the
// expiry isn't a valid integer or is already in the past, then recomputes
// the HMAC for that exact expiry and compares it against the supplied
// signature in constant time.
export async function verifySessionToken(
  token: string | undefined,
  password: string,
): Promise<boolean> {
  if (!token) return false;

  const separatorIndex = token.indexOf(".");
  if (separatorIndex < 0) return false;

  const expiresAtRaw = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);

  if (!/^\d+$/.test(expiresAtRaw)) return false;
  const expiresAtEpochSeconds = Number(expiresAtRaw);
  if (!Number.isSafeInteger(expiresAtEpochSeconds)) return false;
  if (expiresAtEpochSeconds < Math.floor(Date.now() / 1000)) return false;

  const expected = await signExpiry(password, expiresAtEpochSeconds);
  return constantTimeEqual(signature, expected);
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
export function sessionCookieOptions(): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}
