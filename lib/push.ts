import webpush from "web-push";
import { prisma } from "@/lib/prisma";

/**
 * Web Push transport. Everything domain-specific (what we notify about and
 * when) lives in lib/notifications.ts — this file only knows how to get an
 * encrypted payload to the founder's devices and how to keep the subscription
 * table clean.
 *
 * Requires three env vars, all set on the deploy:
 *   VAPID_PUBLIC_KEY   — handed to the browser by GET /api/push/subscribe
 *   VAPID_PRIVATE_KEY  — signs the push request; never leaves the server
 *   VAPID_SUBJECT      — mailto:/https: contact string required by the spec
 *
 * Generate the key pair once with `npx web-push generate-vapid-keys`. When any
 * of them is missing, push is simply disabled: `isPushConfigured()` is false,
 * `sendPushToAll` is a no-op, and the Config page says so. Nothing throws, so
 * an unconfigured deploy still publishes and approves normally.
 */

// Notification payload delivered to public/sw.js, which turns it into the OS
// notification. `url` is the in-app destination opened on tap.
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  /**
   * Collapse key: a newer notification with the same tag replaces the older
   * one on the device instead of stacking. Keeps a week of daily reminders
   * from piling up in the notification shade.
   */
  tag: string;
}

const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT;

export function isPushConfigured(): boolean {
  return Boolean(publicKey && privateKey && subject);
}

export function getVapidPublicKey(): string | null {
  return isPushConfigured() ? (publicKey ?? null) : null;
}

let vapidConfigured = false;

// setVapidDetails() validates the keys and throws on malformed input, so it's
// called lazily on the first send rather than at import time — a bad key must
// fail the notification, not the whole route bundle that imported this file.
function ensureVapidDetails(): void {
  if (vapidConfigured) return;
  webpush.setVapidDetails(subject!, publicKey!, privateKey!);
  vapidConfigured = true;
}

export interface SendResult {
  sent: number;
  failed: number;
  pruned: number;
  skipped?: "not-configured" | "no-subscriptions";
}

/**
 * Fans a notification out to every registered device.
 *
 * Never throws: this runs inside the publish cron and the generation endpoint,
 * where a dead push service must not fail the request that triggered it. All
 * outcomes come back in the result, and failures are logged.
 *
 * A 404/410 from the push service means the subscription is permanently gone
 * (app uninstalled, browser data cleared), so the row is deleted — otherwise
 * the table accumulates endpoints that can never be delivered to.
 */
export async function sendPushToAll(payload: PushPayload): Promise<SendResult> {
  if (!isPushConfigured()) {
    return { sent: 0, failed: 0, pruned: 0, skipped: "not-configured" };
  }

  const subscriptions = await prisma.pushSubscription.findMany();
  if (subscriptions.length === 0) {
    return { sent: 0, failed: 0, pruned: 0, skipped: "no-subscriptions" };
  }

  ensureVapidDetails();
  const body = JSON.stringify(payload);

  const outcomes = await Promise.all(
    subscriptions.map(async (sub): Promise<"sent" | "failed" | "gone"> => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
        );
        return "sent";
      } catch (error) {
        const statusCode =
          error instanceof webpush.WebPushError ? error.statusCode : undefined;

        if (statusCode === 404 || statusCode === 410) return "gone";

        console.error(
          `[push] delivery failed for ${sub.endpoint.slice(0, 48)}...`,
          statusCode ?? error,
        );
        return "failed";
      }
    }),
  );

  const goneEndpoints = subscriptions
    .filter((_, i) => outcomes[i] === "gone")
    .map((sub) => sub.endpoint);

  if (goneEndpoints.length > 0) {
    await prisma.pushSubscription.deleteMany({
      where: { endpoint: { in: goneEndpoints } },
    });
  }

  return {
    sent: outcomes.filter((o) => o === "sent").length,
    failed: outcomes.filter((o) => o === "failed").length,
    pruned: goneEndpoints.length,
  };
}
