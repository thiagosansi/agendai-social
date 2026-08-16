"use client";

import { useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { useRouter } from "next/navigation";
import { FormatBadge, StatusBadge } from "@/components/Badges";
import { publishCountdown } from "@/lib/format";

export interface PieceCardData {
  id: string;
  pillar: string;
  segment: string;
  format: string;
  caption: string;
  imagePrompt: string;
  imageUrl: string | null;
  publishAt: string;
  status: string;
}

interface ClaimCheckViolation {
  id: string;
  label: string;
  substitute: string;
  snippet: string;
}

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 8 * 1024 * 1024;

export function PieceCard({ piece }: { piece: PieceCardData }) {
  const router = useRouter();

  const [captionValue, setCaptionValue] = useState(piece.caption);
  // Tracks the last caption we've synced from props, so we can reset the
  // editable textarea when a fresh piece arrives from the server (e.g.
  // after router.refresh()) without doing it in an effect — this is React's
  // documented "adjusting state when a prop changes" pattern, computed
  // during render instead of causing an extra post-commit render.
  const [syncedCaption, setSyncedCaption] = useState(piece.caption);
  if (piece.caption !== syncedCaption) {
    setSyncedCaption(piece.caption);
    setCaptionValue(piece.caption);
  }
  const [savingCaption, setSavingCaption] = useState(false);
  const [captionError, setCaptionError] = useState<string | null>(null);
  const [captionViolations, setCaptionViolations] = useState<ClaimCheckViolation[]>([]);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);

  const captionDirty = captionValue.trim() !== piece.caption && captionValue.trim().length > 0;

  async function saveCaption() {
    setSavingCaption(true);
    setCaptionError(null);
    setCaptionViolations([]);
    try {
      const res = await fetch(`/api/pieces/${piece.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caption: captionValue.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setCaptionError(body.error ?? "Não foi possível salvar a legenda.");
        setCaptionViolations(body.violations ?? []);
        return;
      }
      router.refresh();
    } catch {
      setCaptionError("Falha de rede ao salvar a legenda.");
    } finally {
      setSavingCaption(false);
    }
  }

  async function uploadFile(file: File) {
    setUploadError(null);

    if (!ALLOWED_TYPES.has(file.type)) {
      setUploadError("Formato não suportado. Envie JPEG, PNG ou WebP.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setUploadError("Arquivo maior que 8MB.");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/pieces/${piece.id}/image`, {
        method: "POST",
        body: formData,
      });
      const body = await res.json();
      if (!res.ok) {
        setUploadError(body.error ?? "Falha ao enviar a imagem.");
        return;
      }
      router.refresh();
    } catch {
      setUploadError("Falha de rede ao enviar a imagem.");
    } finally {
      setUploading(false);
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void uploadFile(file);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void uploadFile(file);
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(piece.imagePrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setUploadError("Não foi possível copiar automaticamente — selecione e copie o texto acima.");
    }
  }

  async function setStatus(status: "approved" | "draft") {
    setApproving(true);
    setApproveError(null);
    try {
      const res = await fetch(`/api/pieces/${piece.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await res.json();
      if (!res.ok) {
        setApproveError(body.error ?? "Não foi possível atualizar o status.");
        return;
      }
      router.refresh();
    } catch {
      setApproveError("Falha de rede ao atualizar o status.");
    } finally {
      setApproving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <FormatBadge format={piece.format} />
        <StatusBadge status={piece.status} />
        <span className="text-xs text-zinc-500">
          {piece.pillar} · {piece.segment}
        </span>
      </div>

      {piece.imageUrl ? (
        <div className="relative aspect-square w-full overflow-hidden rounded-md bg-zinc-100">
          {/* eslint-disable-next-line @next/next/no-img-element -- image can come from same-origin /uploads or an arbitrary Vercel Blob host in prod */}
          <img src={piece.imageUrl} alt="" className="h-full w-full object-cover" />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="rounded-md border border-dashed border-zinc-300 p-3 text-sm text-zinc-600">
            <p className="whitespace-pre-wrap">{piece.imagePrompt}</p>
            <button
              type="button"
              onClick={copyPrompt}
              className="mt-2 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white"
            >
              {copied ? "Copiado!" : "Copiar prompt"}
            </button>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className={`flex items-center justify-center rounded-md border-2 border-dashed p-4 text-sm ${
              dragActive ? "border-zinc-900 bg-zinc-50" : "border-zinc-300"
            }`}
          >
            <label className="flex w-full cursor-pointer flex-col items-center gap-1 text-center">
              <span className="font-medium text-zinc-700">
                {uploading ? "Enviando..." : "Selecionar imagem"}
              </span>
              <span className="text-xs text-zinc-400">
                ou arraste um arquivo aqui (JPEG, PNG ou WebP, até 8MB)
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleFileChange}
                disabled={uploading}
              />
            </label>
          </div>

          {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor={`caption-${piece.id}`} className="text-xs font-medium text-zinc-500">
          Legenda
        </label>
        <textarea
          id={`caption-${piece.id}`}
          value={captionValue}
          onChange={(e) => setCaptionValue(e.target.value)}
          rows={4}
          className="w-full resize-none rounded-md border border-zinc-300 p-2 text-sm text-zinc-900"
        />
        {captionDirty && (
          <button
            type="button"
            onClick={saveCaption}
            disabled={savingCaption}
            className="self-start rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {savingCaption ? "Salvando..." : "Salvar legenda"}
          </button>
        )}
        {captionError && (
          <div className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-700">
            <p className="font-medium">{captionError}</p>
            {captionViolations.length > 0 && (
              <ul className="mt-1 list-inside list-disc">
                {captionViolations.map((v) => (
                  <li key={v.id}>
                    <span className="font-medium">{v.label}</span> em &ldquo;{v.snippet}&rdquo; — sugestão: {v.substitute}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3">
        {piece.status === "approved" ? (
          <>
            <span className="text-sm text-zinc-600">{publishCountdown(piece.publishAt)}</span>
            <button
              type="button"
              onClick={() => setStatus("draft")}
              disabled={approving}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 disabled:opacity-50"
            >
              {approving ? "Aguarde..." : "Desaprovar"}
            </button>
          </>
        ) : (
          <>
            <span className="text-xs text-zinc-400">
              {piece.imageUrl ? "Pronto para aprovar" : "Envie uma imagem para aprovar"}
            </span>
            <button
              type="button"
              onClick={() => setStatus("approved")}
              disabled={!piece.imageUrl || approving}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {approving ? "Aprovando..." : "Aprovar"}
            </button>
          </>
        )}
      </div>
      {approveError && <p className="text-sm text-red-600">{approveError}</p>}
    </div>
  );
}
