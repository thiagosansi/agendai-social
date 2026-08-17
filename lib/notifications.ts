import { PieceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendPushToAll, type SendResult } from "@/lib/push";
import { getSettingString, setSettingString } from "@/lib/settings";

/**
 * The domain layer on top of lib/push.ts: which situations are worth waking
 * the founder's phone for, and how often.
 *
 * The app only notifies about states that need a human to act — everything
 * else (a piece publishing successfully, insights being captured) resolves
 * itself and stays silent. Two triggers today:
 *
 *   1. Pieces sitting in `draft`, waiting for images + "Aprovar".
 *   2. Pieces that came back `failed` from the publish cron; those are never
 *      retried automatically and need a manual reset to draft.
 */

// AppSetting key holding the ISO timestamp of the last approval reminder.
const LAST_APPROVAL_NOTIFICATION_KEY = "lastApprovalNotificationAt";

/**
 * Minimum gap between two "waiting for approval" notifications.
 *
 * The generation routine creates pieces one POST /api/pieces at a time, so a
 * single weekly round fires this trigger several times within a minute. The
 * cooldown collapses that burst into one notification; the daily cron reminder
 * shares the same window, so a round generated shortly before the cron doesn't
 * produce a second buzz for the same queue.
 */
const APPROVAL_NOTIFICATION_COOLDOWN_MS = 30 * 60 * 1000;

async function withinApprovalCooldown(now: Date): Promise<boolean> {
  const last = await getSettingString(LAST_APPROVAL_NOTIFICATION_KEY, "");
  if (!last) return false;

  const lastAt = new Date(last);
  if (Number.isNaN(lastAt.getTime())) return false;

  return now.getTime() - lastAt.getTime() < APPROVAL_NOTIFICATION_COOLDOWN_MS;
}

export type NotifyOutcome =
  | (SendResult & { notified: true })
  | { notified: false; reason: "cooldown" | "nothing-pending" };

/**
 * Tells the founder that the queue has pieces waiting on them.
 *
 * Counts at send time rather than trusting the caller, so the message stays
 * accurate whether it was triggered by a freshly generated round or by the
 * daily cron finding a queue that was never worked through. Silent when the
 * queue is empty or when the cooldown above hasn't elapsed.
 */
export async function notifyPendingApproval(): Promise<NotifyOutcome> {
  const pending = await prisma.piece.count({ where: { status: PieceStatus.draft } });
  if (pending === 0) return { notified: false, reason: "nothing-pending" };

  const now = new Date();
  if (await withinApprovalCooldown(now)) return { notified: false, reason: "cooldown" };

  // Stamped before sending: if delivery is slow or partially fails, a
  // concurrent caller must still be suppressed rather than pile on a duplicate.
  await setSettingString(LAST_APPROVAL_NOTIFICATION_KEY, now.toISOString());

  const result = await sendPushToAll({
    title: pending === 1 ? "1 peça aguardando aprovação" : `${pending} peças aguardando aprovação`,
    body:
      pending === 1
        ? "Revise a legenda, envie a imagem e aprove na fila."
        : "Revise as legendas, envie as imagens e aprove na fila.",
    url: "/fila",
    tag: "pending-approval",
  });

  return { ...result, notified: true };
}

/**
 * Tells the founder that the publish cron could not ship one or more approved
 * pieces. Deliberately has no cooldown — a failed publish is a missed post and
 * the cron only runs once a day, so every occurrence is worth a notification.
 */
export async function notifyPublishFailures(
  failures: { id: string; error?: string }[],
): Promise<NotifyOutcome> {
  if (failures.length === 0) return { notified: false, reason: "nothing-pending" };

  const firstError = failures[0]?.error?.trim();

  const result = await sendPushToAll({
    title:
      failures.length === 1
        ? "Falha ao publicar uma peça"
        : `Falha ao publicar ${failures.length} peças`,
    // Failed pieces are never retried automatically (see lib/cron-publish.ts),
    // so the body names the required action rather than just the symptom.
    body: firstError
      ? `${firstError} — reaprove a peça para tentar de novo.`
      : "Abra Publicados e reaprove a peça para tentar de novo.",
    url: "/publicados",
    tag: "publish-failure",
  });

  return { ...result, notified: true };
}

/**
 * Wraps a notification so it can never break the request that triggered it.
 *
 * Callers are the generation endpoint and the daily cron: publishing a piece
 * or accepting a draft must succeed even if the push service is down, so
 * failures are logged and swallowed here rather than handled at each call site.
 */
export async function notifySafely(
  label: string,
  run: () => Promise<NotifyOutcome>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(`[notifications] ${label} failed`, error);
  }
}
