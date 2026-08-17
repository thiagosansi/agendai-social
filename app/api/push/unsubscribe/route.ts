import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSameOrigin } from "@/lib/auth";
import { pushUnsubscribeSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/push/unsubscribe
// Drops one device's subscription, called when the founder turns notifications
// off on the Config page. Deliberately idempotent — deleteMany on an endpoint
// that's already gone is a no-op, so a retry (or a device that unsubscribed in
// the browser first) still reports success.
export async function POST(req: NextRequest) {
  const authError = requireSameOrigin(req);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = pushUnsubscribeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  await prisma.pushSubscription.deleteMany({ where: { endpoint: parsed.data.endpoint } });

  return Response.json({ ok: true, deviceCount: await prisma.pushSubscription.count() });
}
