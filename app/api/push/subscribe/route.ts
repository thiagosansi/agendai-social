import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSameOrigin } from "@/lib/auth";
import { requireOwner } from "@/lib/session";
import { getVapidPublicKey, isPushConfigured } from "@/lib/push";
import { pushSubscriptionSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/push/subscribe
// Handshake for the Config page: reports whether the deploy has VAPID keys and
// hands back the public one. Serving the key from here instead of baking it in
// as NEXT_PUBLIC_* means rotating the key pair only needs an env change and a
// redeploy of the server, not a rebuild of the client bundle.
//
// The public key is public by definition — it ships to every subscribing
// browser — so this is intentionally readable without a bearer token. The page
// that calls it already sits behind APP_PASSWORD basic auth (middleware.ts).
export async function GET() {
  return Response.json({
    configured: isPushConfigured(),
    publicKey: getVapidPublicKey(),
    deviceCount: await prisma.pushSubscription.count(),
  });
}

// POST /api/push/subscribe
// Registers (or refreshes) one device's push subscription.
//
// Same-origin (see lib/auth.ts requireSameOrigin) plus owner-only
// (lib/session.ts requireOwner) — this route was previously reachable by
// any same-origin caller, including a logged-in viewer.
export async function POST(req: NextRequest) {
  const authError = requireSameOrigin(req);
  if (authError) return authError;

  const ownerError = await requireOwner(req);
  if (ownerError) return ownerError;

  if (!isPushConfigured()) {
    return Response.json(
      { error: "push notifications are not configured on this deploy" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = pushSubscriptionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { endpoint, keys } = parsed.data;

  // Upsert on endpoint: browsers hand back the same endpoint when a device
  // re-subscribes, so this refreshes the encryption keys in place instead of
  // leaving a stale duplicate row that can never be delivered to.
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: {
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: req.headers.get("user-agent"),
    },
    update: {
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: req.headers.get("user-agent"),
    },
  });

  return Response.json({ ok: true, deviceCount: await prisma.pushSubscription.count() });
}
