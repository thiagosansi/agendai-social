"use client";

import { useEffect, useState } from "react";

/**
 * Opt-in control for Web Push notifications, one row per device.
 *
 * The whole chain has to line up before a notification can arrive: the browser
 * must support the Push API, the deploy must have VAPID keys, the user must
 * grant permission, and — on iOS — the app must have been installed to the home
 * screen first. Each of those is reported separately below, because a silent
 * failure here is invisible until the day something actually needs approving.
 */

// Converts the URL-safe base64 VAPID public key into the byte array
// PushManager.subscribe expects. Standard boilerplate — the Push API takes no
// other representation of the key.
// The ArrayBuffer is allocated explicitly so the result is typed
// Uint8Array<ArrayBuffer> rather than the default Uint8Array<ArrayBufferLike>,
// which is not assignable to the BufferSource that applicationServerKey wants
// (ArrayBufferLike also covers SharedArrayBuffer).
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

type Support = "checking" | "unsupported" | "supported";

interface ServerState {
  configured: boolean;
  publicKey: string | null;
  deviceCount: number;
}

export function NotificationControls() {
  const [support, setSupport] = useState<Support>("checking");
  const [server, setServer] = useState<ServerState | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Feature detection, service worker registration and the current
  // subscription all live outside React, so they're read once on mount. Every
  // setState below runs in an async continuation, never synchronously in the
  // effect body.
  useEffect(() => {
    let cancelled = false;

    async function detect() {
      const supported =
        "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

      if (!supported) {
        if (!cancelled) setSupport("unsupported");
        return;
      }

      // iOS only exposes the Push API to a PWA launched from the home screen.
      // Safari-in-a-tab reports support but silently never delivers, so the
      // install step is surfaced as its own instruction.
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const isStandalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        ("standalone" in navigator && Boolean(navigator.standalone));

      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        const existing = await registration.pushManager.getSubscription();

        const res = await fetch("/api/push/subscribe");
        const state: ServerState = await res.json();

        if (cancelled) return;
        setServer(state);
        setSubscribed(Boolean(existing));
        setPermission(Notification.permission);
        setNeedsInstall(isIOS && !isStandalone);
        setSupport("supported");
      } catch {
        if (!cancelled) {
          setSupport("unsupported");
          setError("Não foi possível registrar o service worker neste navegador.");
        }
      }
    }

    void detect();
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    if (!server?.publicKey) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const granted = await Notification.requestPermission();
      setPermission(granted);
      if (granted !== "granted") {
        setError("Permissão negada. Autorize as notificações nas configurações do navegador.");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      // userVisibleOnly is mandatory in Chrome: every push must result in a
      // visible notification, which is exactly what this app does.
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(server.publicKey),
      });

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      const body = await res.json();
      if (!res.ok) {
        // Roll the browser-side subscription back so the UI can't show
        // "enabled" for a device the server has no record of.
        await subscription.unsubscribe();
        setError(body.error ?? "Não foi possível registrar este dispositivo.");
        return;
      }

      setSubscribed(true);
      setServer((current) => (current ? { ...current, deviceCount: body.deviceCount } : current));
      setNotice("Dispositivo registrado.");
    } catch {
      setError("Falha ao ativar as notificações neste dispositivo.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // Server first: if the browser drops the subscription but the DELETE
        // never lands, the row is left undeliverable until it's pruned on the
        // next send.
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }

      setSubscribed(false);
      setNotice("Notificações desativadas neste dispositivo.");
    } catch {
      setError("Falha ao desativar as notificações.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Não foi possível enviar a notificação de teste.");
        return;
      }
      setNotice(`Enviada para ${body.sent} dispositivo(s).`);
    } catch {
      setError("Falha de rede ao enviar a notificação de teste.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="font-medium text-zinc-900">Notificações</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Avisa neste aparelho quando houver peças aguardando aprovação ou quando uma publicação
        falhar.
      </p>

      <div className="mt-3 flex flex-col gap-3">
        {support === "checking" && <p className="text-sm text-zinc-500">Verificando suporte...</p>}

        {support === "unsupported" && (
          <p className="text-sm text-zinc-600">
            Este navegador não suporta notificações push. Use o Chrome no Android ou instale o app
            na tela de início do iPhone (iOS 16.4+).
          </p>
        )}

        {support === "supported" && server && !server.configured && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            As chaves VAPID não estão configuradas neste deploy. Gere um par com{" "}
            <code className="font-mono text-xs">npx web-push generate-vapid-keys</code> e defina{" "}
            <code className="font-mono text-xs">VAPID_PUBLIC_KEY</code>,{" "}
            <code className="font-mono text-xs">VAPID_PRIVATE_KEY</code> e{" "}
            <code className="font-mono text-xs">VAPID_SUBJECT</code>.
          </div>
        )}

        {support === "supported" && needsInstall && (
          <div className="rounded-md border border-zinc-300 bg-zinc-50 p-3 text-sm text-zinc-700">
            No iPhone, as notificações só funcionam com o app instalado: toque em Compartilhar e
            depois em &ldquo;Adicionar à Tela de Início&rdquo;. Abra o app por lá e volte aqui para
            ativar.
          </div>
        )}

        {support === "supported" && permission === "denied" && (
          <p className="text-sm text-red-600">
            As notificações estão bloqueadas para este site. Libere nas configurações do navegador
            e recarregue a página.
          </p>
        )}

        {support === "supported" && server?.configured && (
          <>
            <div className="flex items-center justify-between gap-3 rounded-md bg-zinc-50 p-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-zinc-800">
                  {subscribed ? "Ativas neste aparelho" : "Desativadas neste aparelho"}
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {server.deviceCount} aparelho(s) registrado(s) no total.
                </p>
              </div>
              <button
                type="button"
                onClick={subscribed ? disable : enable}
                disabled={busy || permission === "denied"}
                className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50 ${
                  subscribed
                    ? "border border-zinc-300 text-zinc-700"
                    : "bg-zinc-900 text-white"
                }`}
              >
                {busy ? "Aguarde..." : subscribed ? "Desativar" : "Ativar"}
              </button>
            </div>

            {subscribed && (
              <button
                type="button"
                onClick={sendTest}
                disabled={busy}
                className="self-start rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 disabled:opacity-50"
              >
                Enviar notificação de teste
              </button>
            )}
          </>
        )}

        {notice && <p className="text-sm text-green-700">{notice}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </section>
  );
}
