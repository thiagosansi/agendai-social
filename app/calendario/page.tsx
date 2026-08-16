import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { CalendarGrid, type CalendarPiece } from "@/components/calendario/CalendarGrid";

export const dynamic = "force-dynamic";

const SP_TIME_ZONE = "America/Sao_Paulo";

const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function currentSPYearMonth(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return { year, month };
}

export default async function CalendarioPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const params = await searchParams;
  const { year: currentYear, month: currentMonth } = currentSPYearMonth();

  const parsedYear = Number(params.y);
  const parsedMonth = Number(params.m);
  const year = Number.isInteger(parsedYear) ? parsedYear : currentYear;
  const month =
    Number.isInteger(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12
      ? parsedMonth
      : currentMonth;

  // Query a window a few days wider than the calendar month so pieces near
  // the SP-timezone month boundary aren't dropped by the UTC storage; the
  // client component buckets precisely by spDateKey afterwards.
  const rangeStart = new Date(Date.UTC(year, month - 1, 1) - 3 * 24 * 60 * 60 * 1000);
  const rangeEnd = new Date(Date.UTC(year, month, 1) + 3 * 24 * 60 * 60 * 1000);

  const pieces = await prisma.piece.findMany({
    where: { publishAt: { gte: rangeStart, lt: rangeEnd } },
    orderBy: { publishAt: "asc" },
  });

  const items: CalendarPiece[] = pieces.map((piece) => ({
    id: piece.id,
    format: piece.format,
    status: piece.status,
    caption: piece.caption,
    publishAt: piece.publishAt.toISOString(),
  }));

  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-4 sm:py-6">
      <div className="flex items-center justify-between">
        <Link
          href={`/calendario?y=${prev.y}&m=${prev.m}`}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700"
        >
          ← Anterior
        </Link>
        <h1 className="text-lg font-semibold text-zinc-900">
          {MONTH_NAMES[month - 1]} {year}
        </h1>
        <Link
          href={`/calendario?y=${next.y}&m=${next.m}`}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700"
        >
          Próximo →
        </Link>
      </div>

      <CalendarGrid year={year} month={month} pieces={items} />
    </div>
  );
}
