import type { NextRequest } from "next/server";
import { requireSameOrigin } from "@/lib/auth";
import { requireOwner } from "@/lib/session";
import { isPushConfigured, sendPushToAll } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/push/test
// Sends a notification to every registered device so the founder can confirm
// the whole chain works (permission granted, service worker installed, VAPID
// keys valid) without waiting for a real generation round or a failed publish.
//
// Worth keeping: on iOS the notification only arrives when the app was
// installed to the home screen, and that failure mode is otherwise invisible
// until the day something actually needs approval. Same-origin plus
// owner-only (lib/session.ts requireOwner) — this route was previously
// reachable by any same-origin caller, including a logged-in viewer.
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

  const result = await sendPushToAll({
    title: "Notificações ativas",
    body: "É assim que você será avisado quando houver algo para aprovar.",
    url: "/fila",
    tag: "test",
  });

  if (result.skipped === "no-subscriptions") {
    return Response.json({ error: "nenhum dispositivo registrado" }, { status: 409 });
  }

  return Response.json(result);
}
