"use client";

import { useState } from "react";

export function LogoutButton() {
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      // Full navigation (not router.push) so every client-side cache/state
      // tied to the now-cleared session is dropped, not just the URL.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional full reload on logout, see comment above
      window.location.assign("/login");
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={pending}
      className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
    >
      Sair
    </button>
  );
}
