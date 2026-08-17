/*
 * Service worker for Agendaí Social Studio.
 *
 * Its only job is Web Push — it deliberately does not cache anything. The
 * approval queue must always reflect live server state (a piece approved on
 * one device must not look pending on another), so offline caching would do
 * more harm than good here.
 *
 * Served from /sw.js so its scope is the whole origin. middleware.ts excludes
 * this path from basic auth: the browser fetches the worker script without the
 * page's Authorization header, so a gated /sw.js would 401 and registration
 * would fail.
 *
 * Registered by components/config/NotificationControls.tsx.
 */

// Take over immediately instead of waiting for every tab to close, so a
// deployed fix to this file reaches the device on the next visit.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Payload shape is defined by PushPayload in lib/push.ts.
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Agendaí Social", body: event.data.text() };
  }

  const title = payload.title || "Agendaí Social";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      // Same tag replaces the previous notification instead of stacking, so a
      // week of unread approval reminders shows as one current entry.
      tag: payload.tag || "agendai",
      renotify: Boolean(payload.tag),
      data: { url: payload.url || "/fila" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(event.notification.data?.url || "/fila", self.location.origin);

  // Prefer focusing an already-open window over opening a second one: on iOS
  // the installed PWA is a single window, and openWindow() there would either
  // be a no-op or replace the founder's place in the queue.
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (new URL(client.url).origin !== targetUrl.origin) continue;
          if ("navigate" in client) {
            return client.navigate(targetUrl.href).then((navigated) => navigated?.focus());
          }
          return client.focus();
        }
        return self.clients.openWindow(targetUrl.href);
      }),
  );
});
