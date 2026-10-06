import Link from "next/link";
import type { Metadata } from "next";
import { TrainFront } from "lucide-react";
import { hasDb } from "@/lib/db";
import { searchJourneys, getStation } from "@/lib/hrdf/queries";
import { cache, categoryFor, lineInfo, operatorFor, runsOn } from "@/lib/hrdf/lookups";
import { dayIndex, formatDate, fromIsoDate, minutesToTime, toIsoDate } from "@/lib/hrdf/calendar";
import { qs } from "@/lib/links";
import { CategoryBadge } from "@/components/hrdf/category-badge";
import { EmptyState, FilterInput, NoData, PageHeader, Pager, SubmitButton } from "@/components/page";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Journeys" };

const LIMIT = 100;

export default async function JourneysPage({ searchParams }: PageProps<"/journeys">) {
  if (!hasDb()) return <NoData />;
  const sp = await searchParams;
  const get = (k: string) => String(sp[k] ?? "").trim();
  const f = { nr: get("nr"), admin: get("admin"), category: get("category"), line: get("line"), stop: get("stop"), bitfield: get("bitfield"), lineRef: get("lineRef"), dir: get("dir") };
  const date = fromIsoDate(get("date"));
  const offset = Math.max(0, Number(get("offset")) || 0);
  const { period } = cache();
  const day = date ? dayIndex(period.start, date) : null;
  const active = Object.values(f).some(Boolean);
  const res = active ? searchJourneys(f, LIMIT, offset) : { rows: [], total: 0 };
  const stopName = f.stop ? getStation(Number(f.stop))?.name : null;
  const base = { ...f, date: get("date") };

  return (
    <div>
      <PageHeader eyebrow="FPLAN *Z · *G · *L · *A VE" title="Journeys">
        Find journeys by Zugnummer (journey number), administration, category, line, stop or bitfield. Add a date to see whether each journey runs that day.
      </PageHeader>
      <form className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-[repeat(7,minmax(0,1fr))_auto]">
        <FilterInput name="nr" label="Zugnummer" defaultValue={f.nr} placeholder="2577" />
        <FilterInput name="admin" label="Admin" defaultValue={f.admin} placeholder="000011" />
        <FilterInput name="category" label="Category" defaultValue={f.category} placeholder="IC, S, B…" />
        <FilterInput name="line" label="Line" defaultValue={f.line} placeholder="1, R56…" />
        <FilterInput name="stop" label="Stop number" defaultValue={f.stop} placeholder="8507000" />
        <FilterInput name="bitfield" label="Bitfield" defaultValue={f.bitfield} placeholder="3933" />
        <FilterInput name="date" type="date" label="Runs on" defaultValue={get("date")} />
        <SubmitButton>Find</SubmitButton>
        {f.lineRef ? <input type="hidden" name="lineRef" value={f.lineRef} /> : null}
        {f.dir ? <input type="hidden" name="dir" value={f.dir} /> : null}
      </form>
      {(stopName || f.lineRef || f.dir) && (
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {stopName ? <span className="rounded-full border bg-card px-3 py-1">Stops at <Link className="link-u font-semibold" href={`/stations/${f.stop}`}>{stopName}</Link></span> : null}
          {f.lineRef ? <span className="rounded-full border bg-card px-3 py-1">LINIE #{f.lineRef}</span> : null}
          {f.dir ? <span className="rounded-full border bg-card px-3 py-1">Direction {f.dir}</span> : null}
        </div>
      )}
      <div className="mt-6">
        {!active ? (
          <EmptyState title="Enter at least one filter" icon={<TrainFront className="size-6" />}>
            For example Zugnummer <Link className="link-u" href="/journeys?nr=2577">2577</Link>, category <Link className="link-u" href="/journeys?category=ICE">ICE</Link>, or line <Link className="link-u" href="/journeys?category=S&line=12">S 12</Link>.
          </EmptyState>
        ) : res.rows.length === 0 ? (
          <EmptyState title="No journeys match these filters" icon={<TrainFront className="size-6" />}>
            Admin numbers are 6 digits (SBB = 000011). Category codes are case-insensitive, line names must match exactly.
          </EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border bg-card">
              <table className="w-full text-sm">
                <thead className="border-b bg-paper text-left">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-mono [&>th]:text-[10.5px] [&>th]:font-medium [&>th]:tracking-wider [&>th]:text-muted-foreground [&>th]:uppercase">
                    <th>Service</th>
                    <th>Nr</th>
                    <th className="hidden md:table-cell">Admin</th>
                    <th>Route</th>
                    <th className="text-right">Dep</th>
                    <th className="hidden text-right sm:table-cell">Arr</th>
                    <th className="hidden text-right lg:table-cell">Stops</th>
                    <th className="hidden md:table-cell">Bitfield</th>
                    {date ? <th>{toIsoDate(date)}</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {res.rows.map((r) => {
                    const cat = categoryFor(r.category);
                    const li = lineInfo(r.line_ref);
                    const op = operatorFor(r.admin);
                    const runs = day !== null ? runsOn(r.bitfield, day) : null;
                    return (
                      <tr key={r.id} className={cn("hover:bg-paper [&>td]:px-3 [&>td]:py-2", runs === false && "opacity-50")}>
                        <td>
                          <Link href={`/journeys/${r.id}${date ? `?date=${toIsoDate(date)}` : ""}`}>
                            <CategoryBadge category={r.category} line={r.line} productClass={cat?.productClass} lineBg={li?.bg} lineFg={li?.fg} size="sm" />
                          </Link>
                        </td>
                        <td className="font-mono font-semibold">
                          <Link className="link-u" href={`/journeys/${r.id}${date ? `?date=${toIsoDate(date)}` : ""}`}>
                            {r.nr}
                          </Link>
                          {r.takt_n ? <span className="ml-1 text-[10px] text-muted-foreground">×{r.takt_n + 1}</span> : null}
                        </td>
                        <td className="hidden font-mono text-xs md:table-cell">
                          <Link className="link-u" href={`/ref/admin/${r.admin}`}>{r.admin}</Link> <span className="text-muted-foreground">{op?.abbr}</span>
                        </td>
                        <td className="max-w-[340px] truncate">
                          {r.fromName} <span className="text-primary">→</span> {r.toName}
                        </td>
                        <td className="text-right font-mono tabular">{minutesToTime(r.dep)}</td>
                        <td className="hidden text-right font-mono tabular sm:table-cell">{minutesToTime(r.arr)}</td>
                        <td className="hidden text-right font-mono text-xs lg:table-cell">{r.n_stops}</td>
                        <td className="hidden font-mono text-xs md:table-cell">
                          {r.bitfield ? <Link className="link-u" href={`/bitfields/${r.bitfield}`}>{r.bitfield}</Link> : "daily"}
                        </td>
                        {date ? <td className={cn("font-mono text-xs font-semibold", runs ? "text-run" : "text-muted-foreground")}>{runs ? "runs" : "—"}</td> : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager offset={offset} limit={LIMIT} total={res.total} count={res.rows.length} hrefFor={(o) => `/journeys${qs({ ...base, offset: o || undefined })}`} />
            {date ? <p className="mt-2 text-xs text-muted-foreground">Faded rows do not run on {formatDate(date)}.</p> : null}
          </>
        )}
      </div>
    </div>
  );
}
