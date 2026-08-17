"use client";

import { useState, type FormEvent } from "react";

// Only accept internal, single-slash paths as a redirect target — this
// blocks "//evil.com" (protocol-relative) and backslash tricks some
// browsers still normalize into a scheme-relative URL, so `next` can never
// send the user off-site.
function sanitizeNext(next: string | null): string {
  if (!next) return "/";
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//")) return "/";
  if (next.includes("\\")) return "/";
  return next;
}

export function LoginForm({ next }: { next: string | null }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: username.trim().toLowerCase(), password }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Não foi possível entrar.");
        setSubmitting(false);
        return;
      }

      window.location.assign(sanitizeNext(next));
    } catch {
      setError("Falha de rede ao tentar entrar.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="username" className="text-sm font-medium text-zinc-800">
          Usuário
        </label>
        <input
          id="username"
          type="text"
          autoFocus
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={submitting}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 disabled:opacity-50"
        />
        <p className="text-xs text-zinc-500">Dono: usuário admin + senha do app.</p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-medium text-zinc-800">
          Senha
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 disabled:opacity-50"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting || username.trim().length === 0 || password.length === 0}
        className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Entrar
      </button>
    </form>
  );
}
