"use client";

import { useState } from "react";
import { WEEKDAY_LABELS_PT_BR } from "@/lib/generation-schedule";

interface CadenceSettings {
  generationIntervalWeeks: number;
  piecesPerRound: number;
  postingWeekdays: number[];
  postingTime: string;
}

type CadenceField = keyof CadenceSettings;

const FREQUENCY_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "Semanal" },
  { value: 2, label: "Quinzenal" },
  { value: 3, label: "A cada 3 semanas" },
  { value: 4, label: "Mensal (4 semanas)" },
];

const PIECES_PER_ROUND_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "1 peça" },
  { value: 2, label: "2 peças" },
  { value: 3, label: "3 peças" },
  { value: 4, label: "4 peças" },
];

const POSTING_TIME_RE = /^\d{2}:\d{2}$/;

export function CadenceControls({ initialSettings }: { initialSettings: CadenceSettings }) {
  const [settings, setSettings] = useState<CadenceSettings>(initialSettings);
  const [pendingKey, setPendingKey] = useState<CadenceField | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Shared optimistic-PATCH helper — mirrors PauseControls' toggle/
  // updateFrequency pattern, generalized to any single cadence field so each
  // control below is a thin wrapper instead of a copy of the fetch logic.
  async function patchField<K extends CadenceField>(
    field: K,
    value: CadenceSettings[K],
    errorMessage: string,
  ) {
    const previous = settings;

    setSettings({ ...settings, [field]: value });
    setPendingKey(field);
    setError(null);

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      const body = await res.json();
      if (!res.ok) {
        setSettings(previous);
        setError(body.error ?? errorMessage);
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

  function toggleWeekday(day: number) {
    const isSelected = settings.postingWeekdays.includes(day);
    if (isSelected && settings.postingWeekdays.length === 1) return; // last day can't be unchecked

    const next = isSelected
      ? settings.postingWeekdays.filter((d) => d !== day)
      : [...settings.postingWeekdays, day].sort((a, b) => a - b);

    patchField("postingWeekdays", next, "Não foi possível salvar os dias de postagem.");
  }

  function handleTimeChange(value: string) {
    setSettings((current) => ({ ...current, postingTime: value }));
    // Safari can emit "" mid-edit — only PATCH once the value is a full HH:MM.
    if (POSTING_TIME_RE.test(value)) {
      patchField("postingTime", value, "Não foi possível salvar o horário.");
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="font-medium text-zinc-900">Cadência de postagem</h2>

      <div className="mt-3 flex flex-col gap-1 rounded-md bg-zinc-50 p-3">
        <label htmlFor="generation-interval-weeks" className="text-sm font-medium text-zinc-800">
          Frequência de geração
        </label>
        <select
          id="generation-interval-weeks"
          value={settings.generationIntervalWeeks}
          disabled={pendingKey === "generationIntervalWeeks"}
          onChange={(e) =>
            patchField(
              "generationIntervalWeeks",
              Number(e.target.value),
              "Não foi possível salvar a frequência.",
            )
          }
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-800 disabled:opacity-50"
        >
          {FREQUENCY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-zinc-500">
          A rotina acorda toda semana e decide, com base nisso, se a rodada está no prazo.
        </p>
      </div>

      <div className="mt-3 flex flex-col gap-1 rounded-md bg-zinc-50 p-3">
        <label htmlFor="pieces-per-round" className="text-sm font-medium text-zinc-800">
          Peças por rodada
        </label>
        <select
          id="pieces-per-round"
          value={settings.piecesPerRound}
          disabled={pendingKey === "piecesPerRound"}
          onChange={(e) =>
            patchField(
              "piecesPerRound",
              Number(e.target.value),
              "Não foi possível salvar as peças por rodada.",
            )
          }
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-800 disabled:opacity-50"
        >
          {PIECES_PER_ROUND_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-zinc-500">
          O playbook alterna carrossel+stories / reels+estático; com mais de 2 peças a rotina completa
          o par da outra semana.
        </p>
      </div>

      <div className="mt-3 flex flex-col gap-2 rounded-md bg-zinc-50 p-3">
        <span className="text-sm font-medium text-zinc-800">Dias de postagem</span>
        <div className="flex flex-wrap gap-2">
          {WEEKDAY_LABELS_PT_BR.map((label, day) => {
            const selected = settings.postingWeekdays.includes(day);
            const isLastSelected = selected && settings.postingWeekdays.length === 1;
            return (
              <button
                key={day}
                type="button"
                role="checkbox"
                aria-checked={selected}
                aria-label={label}
                disabled={pendingKey === "postingWeekdays" || isLastSelected}
                onClick={() => toggleWeekday(day)}
                className={`h-9 min-w-[2.75rem] rounded-md text-sm font-medium capitalize transition-colors disabled:opacity-50 ${
                  selected
                    ? "bg-zinc-900 text-white"
                    : "border border-zinc-300 bg-white text-zinc-700"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-zinc-500">Mantenha pelo menos um dia de postagem.</p>
      </div>

      <div className="mt-3 flex flex-col gap-1 rounded-md bg-zinc-50 p-3">
        <label htmlFor="posting-time" className="text-sm font-medium text-zinc-800">
          Horário de postagem
        </label>
        <input
          id="posting-time"
          type="time"
          step={900}
          value={settings.postingTime}
          disabled={pendingKey === "postingTime"}
          onChange={(e) => handleTimeChange(e.target.value)}
          className="w-fit rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-800 disabled:opacity-50"
        />
        <p className="text-xs text-zinc-500">Horário de Brasília (America/Sao_Paulo).</p>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <p className="mt-3 text-xs text-zinc-500">
        A cadência vale a partir da próxima rodada da rotina de geração — a rotina segue acordando
        toda semana e lê estes valores em GET /api/report/latest. Se a rotina cloud ainda estiver com
        o prompt antigo, atualize-o conforme docs/rotina-geracao.md.
      </p>
    </section>
  );
}
