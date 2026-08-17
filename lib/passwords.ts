import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Password hashing for ViewerUser rows (prisma/schema.prisma) — Node-only
// (uses node:crypto's scrypt, not Web Crypto), so this must never be
// imported from middleware.ts or any other edge-runtime module. The owner
// account (username "admin") never goes through this file — it is
// authenticated directly against APP_PASSWORD (see lib/session.ts).
//
// scrypt parameters: N=16384 (2^14), r=8, p=1, keylen=64 — a conservative,
// widely-used cost profile (Node's own scrypt docs example) for a
// single-owner tool where the threat model is "a leaked DB dump", not
// "millions of logins per second".

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

// Format: "scrypt$N$saltHex$hashHex" — the cost parameter is embedded so a
// future bump to N doesn't break verification of hashes stored under the
// old value.
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

// Verifies `password` against a `hashPassword` output. Returns false (never
// throws) for malformed stored values so a corrupted/foreign hash fails
// closed instead of crashing the login route.
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;

  const [, nRaw, saltHex, hashHex] = parts;
  const n = Number(nRaw);
  if (!Number.isInteger(n) || n <= 0) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = scryptSync(password, salt, expected.length, { N: n, r: SCRYPT_R, p: SCRYPT_P });
  } catch {
    return false;
  }

  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
