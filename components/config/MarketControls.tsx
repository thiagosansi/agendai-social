"use client";

import { useState } from "react";

interface MarketSettings {
  marketCompetitors: string[];
  marketHashtags: string[];
}

type FieldKey = keyof MarketSettings;

const FIELDS: { key: FieldKey; label: string; placeholder: string }[] = [
  {
    key: "marketCompetitors",
    label: "Concorrentes (@usernames, até 8)",
    placeholder: "@concorrente_um, concorrente_dois",
  },
  {
    key: "marketHashtags",
    label: "Hashtags (até 10)",
    placeholder: "#estetica, #skincare",
  },
];

// Splits a free-form textarea into individual tokens — accepts commas,
// newlines or plain spaces as separators so users can paste lists copied
// from anywhere. Empty tokens (double separators, trailing newline) are
// dropped; server-side normalization (lib/validation.ts) strips @/# and
// lowercases.
function splitTokens(raw: string): string[] {
  return raw
    .split(/[\n,\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

export function MarketControls({
  initialCompetitors,
  initialHashtags,
}: {
  initialCompetitors: string[];
  initialHashtags: string[];
}) {
  const [settings, setSettings] = useState<MarketSettings>({
    marketCompetitors: initialCompetitors,
    marketHashtags: initialHashtags,
  });
  const [drafts, setDrafts] = useState<Record<FieldKey, string>>({
    marketCompetitors: initialCompetitors.join(", "),
    marketHashtags: initialHashtags.join(", "),
  });
  const [pendingKey, setPendingKey] = useState<FieldKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(key: FieldKey) {
    const tokens = splitTokens(drafts[key]);
    setPendingKey(key);
    setError(null);

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [key]: tokens }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Não foi possível salvar a alteração.");
        return;
      }
      setSettings((current) => ({ ...current, [key]: body[key] }));
      setDrafts((current) => ({ ...current, [key]: body[key].join(", ") }));
    } catch {
      setError("Falha de rede ao salvar a alteração.");
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="font-medium text-zinc-900">Inteligência de mercado</h2>
      <p className="mt-0.5 text-xs text-zinc-500">
        Usados pela análise mensal (GET /api/analysis/market). Contas precisam ser Business/Creator
        públicas. Limite Meta: 30 hashtags únicas por 7 dias.
      </p>

      <div className="mt-3 flex flex-col gap-3">
        {FIELDS.map(({ key, label, placeholder }) => {
          const pending = pendingKey === key;
          return (
            <div key={key} className="flex flex-col gap-1 rounded-md bg-zinc-50 p-3">
              <label htmlFor={key} className="text-sm font-medium text-zinc-800">
                {label}
              </label>
              <textarea
                id={key}
                rows={2}
                value={drafts[key]}
                placeholder={placeholder}
                disabled={pending}
                onChange={(e) => setDrafts((current) => ({ ...current, [key]: e.target.value }))}
                className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-800 disabled:opacity-50"
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-zinc-500">
                  Atual: {settings[key].length > 0 ? settings[key].join(", ") : "nenhum configurado"}
                </p>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => save(key)}
                  className="shrink-0 rounded-md bg-zinc-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  {pending ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
