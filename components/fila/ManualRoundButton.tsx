"use client";

import { useState } from "react";

const MANUAL_ROUND_URL = "https://claude.ai/code/routines/trig_017eaYQYsHyf9J2KFNZUpugd";

// Opens the manual-round routine on claude.ai. Before opening, it PATCHes
// forceNextGeneration=true so the routine's generationDue check (see
// app/api/report/latest/route.ts) passes even during an off-week for the
// configured frequency (Config page "Frequência de geração"). The flag is
// one-shot — POST /api/pieces clears it back to false on the next successful
// generation. If the PATCH fails, the tab is not opened so the user isn't
// sent to a routine that will just abort as not-due.
export function ManualRoundButton() {
  const [pending, setPending] = useState(false);
  const [released, setReleased] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    setReleased(false);

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ forceNextGeneration: true }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Não foi possível liberar a rodada.");
        return;
      }
      setReleased(true);
      window.open(MANUAL_ROUND_URL, "_blank", "noreferrer");
    } catch {
      setError("Falha de rede ao liberar a rodada.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="inline-flex shrink-0 items-center gap-1 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Liberando..." : "Gerar rodada agora →"}
      </button>
      {released && !error && (
        <p className="max-w-[200px] text-right text-xs text-zinc-500">
          Rodada liberada — use Executar agora na página que abriu.
        </p>
      )}
      {error && <p className="max-w-[200px] text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}
