import Link from "next/link";
import { addDays, toIsoDate, type Period } from "@/lib/hrdf/calendar";
import { cn } from "@/lib/utils";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Month-by-month operating-day grid. Each cell is one day of the timetable
 * period; filled red = runs. Weeks start on Monday.
 */
export function OperatingCalendar({
  days,
  period,
  highlight,
  holidays,
  hrefForDate,
}: {
  days: boolean[];
  period: Period;
  highlight?: string | null;
  holidays?: Set<string>;
  hrefForDate?: (iso: string) => string;
}) {
  const months: { key: string; label: string; cells: ({ iso: string; i: number; dom: number; dow: number } | null)[] }[] = [];
  for (let i = 0; i < period.days; i++) {
    const d = addDays(period.start, i);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    let m = months[months.length - 1];
    if (!m || m.key !== key) {
      m = { key, label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, cells: [] };
      const lead = (d.getUTCDay() + 6) % 7;
      for (let k = 0; k < lead; k++) m.cells.push(null);
      months.push(m);
    }
    m.cells.push({ iso: toIsoDate(d), i, dom: d.getUTCDate(), dow: d.getUTCDay() });
  }
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {months.map((m) => {
        const run = m.cells.filter((c) => c && days[c.i]).length;
        const total = m.cells.filter(Boolean).length;
        return (
          <div key={m.key}>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[12px] font-semibold">{m.label}</span>
              <span className="font-mono text-[10px] text-muted-foreground tabular">
                {run}/{total}
              </span>
            </div>
            <div className="grid grid-cols-7 gap-[3px]">
              {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                <span key={i} className="text-center font-mono text-[8.5px] text-muted-foreground/70">
                  {d}
                </span>
              ))}
              {m.cells.map((c, idx) => {
                if (!c) return <span key={idx} />;
                const on = days[c.i];
                const isHl = highlight === c.iso;
                const isHoliday = holidays?.has(c.iso);
                const cell = (
                  <span
                    title={`${c.iso}${isHoliday ? " (public holiday)" : ""} — ${on ? "runs" : "does not run"}`}
                    className={cn(
                      "flex aspect-square items-center justify-center rounded-[2px] font-mono text-[9px] tabular transition-transform hover:scale-110",
                      on ? "bg-run text-white" : "bg-muted text-muted-foreground/60",
                      isHoliday && "ring-1 ring-board-accent ring-inset",
                      isHl && "outline-2 outline-offset-1 outline-foreground",
                    )}
                  >
                    {c.dom}
                  </span>
                );
                return hrefForDate ? (
                  <Link key={idx} href={hrefForDate(c.iso)} scroll={false}>
                    {cell}
                  </Link>
                ) : (
                  <span key={idx}>{cell}</span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
