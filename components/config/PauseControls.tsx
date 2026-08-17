"use client";

import { useState } from "react";

interface SettingsPayload {
  generationPaused: boolean;
  publishingPaused: boolean;
}

interface ToggleConfig {
  key: "generationPaused" | "publishingPaused";
  label: string;
  description: string;
}

const TOGGLES: ToggleConfig[] = [
  {
    key: "generationPaused",
    label: "Pausar geração de conteúdo",
    description:
      "A rotina semanal consulta este status e aborta sem gerar nada (sem consumo de cota Claude).",
  },
  {
    key: "publishingPaused",
    label: "Pausar publicações",
    description: "O cron diário não publica nada enquanto ativo; peças aprovadas aguardam.",
  },
];

type PendingKey = keyof SettingsPayload | null;

export function PauseControls({ initialSettings }: { initialSettings: SettingsPayload }) {
  const [settings, setSettings] = useState<SettingsPayload>(initialSettings);
  const [pendingKey, setPendingKey] = useState<PendingKey>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(key: ToggleConfig["key"]) {
    const previous = settings;
    const nextValue = !settings[key];

    // Optimistic update — reverted in the catch/error branch below if the
    // PATCH fails, so the switch never silently drifts from server state.
    setSettings({ ...settings, [key]: nextValue });
    setPendingKey(key);
    setError(null);

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [key]: nextValue }),
      });
      const body = await res.json();
      if (!res.ok) {
        setSettings(previous);
        setError(body.error ?? "Não foi possível salvar a alteração.");
        return;
      }
      setSettings((current) => ({ ...current, ...body }));
    } catch {
      setSettings(previous);
      setError("Falha de rede ao salvar a alteração.");
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="font-medium text-zinc-900">Controles</h2>

      <div className="mt-3 flex flex-col gap-3">
        {TOGGLES.map(({ key, label, description }) => {
          const checked = settings[key];
          const pending = pendingKey === key;
          return (
            <div
              key={key}
              className="flex items-start justify-between gap-3 rounded-md bg-zinc-50 p-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-zinc-800">{label}</div>
                <p className="mt-0.5 text-xs text-zinc-500">{description}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={label}
                disabled={pending}
                onClick={() => toggle(key)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                  checked ? "bg-red-600" : "bg-zinc-300"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    checked ? "translate-x-[22px]" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          );
        })}
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
