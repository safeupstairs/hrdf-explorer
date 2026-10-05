import Link from "next/link";
import { ArrowRight, Repeat } from "lucide-react";
import type { BoardEntry } from "@/lib/hrdf/queries";
import { categoryFor, lineInfo, operatorFor } from "@/lib/hrdf/lookups";
import { minutesToTime } from "@/lib/hrdf/calendar";
import { CategoryBadge } from "./category-badge";

/** SBB-style station board. */
export function Board({ entries, mode, dateIso }: { entries: BoardEntry[]; mode: "dep" | "arr"; dateIso: string }) {
  return (
    <div className="overflow-hidden rounded-md bg-board text-board-foreground shadow-[0_1px_0_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(20,30,80,0.45)]">
      <div className="hidden grid-cols-[72px_120px_minmax(0,1fr)_110px_minmax(0,160px)_56px] gap-3 border-b border-board-line px-4 py-2 font-mono text-[10px] tracking-[0.14em] text-board-muted uppercase md:grid">
        <span>{mode === "dep" ? "Departure" : "Arrival"}</span>
        <span>Service</span>
        <span>{mode === "dep" ? "Destination" : "From"}</span>
        <span>Zugnummer</span>
        <span>Operator</span>
        <span className="text-right">Track</span>
      </div>
      <ul className="divide-y divide-board-line">
        {entries.map((e, i) => {
          const j = e.journey;
          const cat = categoryFor(j.category);
          const li = lineInfo(j.line_ref);
          const op = operatorFor(j.admin);
          const href = `/journeys/${j.id}?date=${dateIso}${e.cycle ? `&cycle=${e.cycle}` : ""}`;
          return (
            <li key={`${j.id}-${e.cycle}-${e.serviceDayShift}-${i}`}>
              <Link
                href={href}
                className="group grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 transition-colors hover:bg-white/[0.06] md:grid-cols-[72px_120px_minmax(0,1fr)_110px_minmax(0,160px)_56px]"
              >
                <span className="row-span-2 text-[19px] font-bold text-board-accent tabular md:row-span-1 md:text-[21px]">
                  {minutesToTime(e.time)}
                  {e.time >= 1440 ? <sup className="ml-0.5 text-[10px] text-board-muted">+1</sup> : null}
                </span>
                <span className="flex items-center gap-1.5 md:order-none">
                  <CategoryBadge category={j.category} line={j.line} productClass={cat?.productClass} lineBg={li?.bg} lineFg={li?.fg} size="sm" />
                  {e.cycle ? (
                    <span title={`Cycle repetition ${e.cycle} of ${j.takt_n} (every ${j.takt_min} min)`}>
                      <Repeat className="size-3 text-board-muted" />
                    </span>
                  ) : null}
                </span>
                <span className="col-start-2 row-start-2 flex min-w-0 items-center gap-1.5 text-[15px] font-semibold md:col-start-auto md:row-start-auto md:text-[16px]">
                  <ArrowRight className="hidden size-3.5 shrink-0 text-board-muted md:block" />
                  <span className="truncate">{mode === "dep" ? e.terminus : e.origin}</span>
                </span>
                <span className="col-start-3 row-start-1 text-right font-mono text-[12.5px] text-board-muted md:col-start-auto md:row-start-auto md:text-left">
                  {j.nr}
                </span>
                <span className="hidden truncate text-[12.5px] text-board-muted md:block" title={op?.name}>
                  {op?.abbr ?? op?.short ?? j.admin}
                  <span className="ml-1.5 font-mono text-[10.5px] opacity-60">{j.admin}</span>
                </span>
                <span className="col-start-3 row-start-2 text-right text-[15px] font-bold md:col-start-auto md:row-start-auto">{e.track ?? <span className="text-board-muted/50">–</span>}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
