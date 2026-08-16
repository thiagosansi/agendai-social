"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FORMAT_LABELS, STATUS_LABELS, formatDateTimeSP, spDateKey } from "@/lib/format";

export interface CalendarPiece {
  id: string;
  format: string;
  status: string;
  caption: string;
  publishAt: string;
}

const WEEKDAY_LABELS = ["D", "S", "T", "Q", "Q", "S", "S"];

const STATUS_DOT_CLASSES: Record<string, string> = {
  draft: "bg-zinc-400",
  approved: "bg-blue-500",
  published: "bg-green-500",
  failed: "bg-red-500",
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function CalendarGrid({
  year,
  month,
  pieces,
}: {
  year: number;
  month: number; // 1-12
  pieces: CalendarPiece[];
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const piecesByDay = useMemo(() => {
    const map = new Map<string, CalendarPiece[]>();
    for (const piece of pieces) {
      const key = spDateKey(piece.publishAt);
      const list = map.get(key) ?? [];
      list.push(piece);
      map.set(key, list);
    }
    return map;
  }, [pieces]);

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();

  const cells: Array<{ day: number; key: string } | null> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ day, key: `${year}-${pad2(month)}-${pad2(day)}` });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const todayKey = spDateKey(new Date());
  const selectedPieces = selectedKey ? (piecesByDay.get(selectedKey) ?? []) : [];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-zinc-500">
        {WEEKDAY_LABELS.map((label, i) => (
          <div key={i}>{label}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, i) => {
          if (!cell) return <div key={`empty-${i}`} />;

          const dayPieces = piecesByDay.get(cell.key) ?? [];
          const isSelected = selectedKey === cell.key;
          const isToday = cell.key === todayKey;

          return (
            <button
              key={cell.key}
              type="button"
              onClick={() => setSelectedKey(isSelected ? null : cell.key)}
              aria-pressed={isSelected}
              className={`flex aspect-square flex-col items-center justify-start gap-1 rounded-md border p-1 text-xs ${
                isSelected
                  ? "border-zinc-900 bg-zinc-100"
                  : isToday
                    ? "border-zinc-400"
                    : "border-zinc-200"
              }`}
            >
              <span className={isToday ? "font-semibold text-zinc-900" : "text-zinc-700"}>
                {cell.day}
              </span>
              <div className="flex flex-wrap justify-center gap-0.5">
                {dayPieces.slice(0, 4).map((p) => (
                  <span
                    key={p.id}
                    className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLASSES[p.status] ?? "bg-zinc-400"}`}
                  />
                ))}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-zinc-500">
        {Object.entries(STATUS_LABELS).map(([status, label]) => (
          <span key={status} className="flex items-center gap-1">
            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLASSES[status]}`} />
            {label}
          </span>
        ))}
      </div>

      {selectedKey && (
        <div className="rounded-lg border border-zinc-200 p-3">
          <h2 className="mb-2 text-sm font-semibold text-zinc-900">
            {selectedKey.split("-").reverse().join("/")}
          </h2>
          {selectedPieces.length === 0 ? (
            <p className="text-sm text-zinc-500">Nenhuma peça neste dia.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {selectedPieces.map((p) => (
                <li key={p.id} className="rounded-md bg-zinc-50 p-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-zinc-900">
                      {FORMAT_LABELS[p.format] ?? p.format}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white ${
                        STATUS_DOT_CLASSES[p.status] ?? "bg-zinc-400"
                      }`}
                    >
                      {STATUS_LABELS[p.status] ?? p.status}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-zinc-600">{p.caption}</p>
                  <p className="mt-1 text-xs text-zinc-400">{formatDateTimeSP(p.publishAt)}</p>
                  {p.status === "draft" || p.status === "approved" ? (
                    <Link href={`/fila#piece-${p.id}`} className="mt-1 inline-block text-xs text-blue-600 underline">
                      Ver na fila
                    </Link>
                  ) : (
                    <Link
                      href={`/publicados#piece-${p.id}`}
                      className="mt-1 inline-block text-xs text-blue-600 underline"
                    >
                      Ver em publicados
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
