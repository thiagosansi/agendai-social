import Link from "next/link";

export type AlertLevel = "amber" | "red" | "info";

export interface DashboardAlert {
  level: AlertLevel;
  message: string;
  href?: string;
  linkLabel?: string;
}

const LEVEL_CLASSES: Record<AlertLevel, string> = {
  amber: "border-amber-300 bg-amber-50 text-amber-900",
  red: "border-red-300 bg-red-50 text-red-900",
  info: "border-zinc-200 bg-zinc-50 text-zinc-700",
};

// Server-computed alert banner shown at the top of the dashboard — renders
// nothing when the list is empty (callers should conditionally render this
// component's section entirely, but the guard here is defensive too).
export function AlertList({ alerts }: { alerts: DashboardAlert[] }) {
  if (alerts.length === 0) return null;

  return (
    <ul className="flex flex-col gap-2">
      {alerts.map((alert, idx) => (
        <li
          key={idx}
          className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm ${LEVEL_CLASSES[alert.level]}`}
        >
          <span>{alert.message}</span>
          {alert.href && (
            <Link href={alert.href} className="shrink-0 text-xs font-medium underline">
              {alert.linkLabel ?? "Ver"}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
