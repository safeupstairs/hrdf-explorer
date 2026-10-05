import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CalendarCheck2, CalendarX2, Repeat } from "lucide-react";
import { hasDb } from "@/lib/db";
import { getJourney } from "@/lib/hrdf/queries";
import { cache, runsOn } from "@/lib/hrdf/lookups";
import { bitfieldDays, dayIndex, defaultDate, formatDate, fromIsoDate, minutesToTime, toIsoDate } from "@/lib/hrdf/calendar";
import { qs } from "@/lib/links";
import { CategoryBadge } from "@/components/hrdf/category-badge";
import { OperatingCalendar } from "@/components/hrdf/operating-calendar";
import { DecodedInline } from "@/components/hrdf/decoded-fields";
import { FplanRecordFields } from "@/components/hrdf/fplan-record";
import { holidays } from "@/lib/hrdf/holidays";
import { NoData, PageHeader, Section } from "@/components/page";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: PageProps<"/journeys/[id]">): Promise<Metadata> {
  if (!hasDb()) return {};
  const j = getJourney(Number((await params).id));
  return { title: j ? `${j.journey.category ?? ""} ${j.journey.line ?? ""} · Nr ${j.journey.nr}` : "Journey" };
}

const pad7 = (n: number) => String(n).padStart(7, "0");

function T({ min, neg }: { min: number | null; neg: boolean }) {
  if (min === null) return <span className="text-muted-foreground/40">—</span>;
  return (
    <span className={cn("tabular", neg && "text-muted-foreground line-through decoration-primary/70")} title={neg ? "Negative time: no boarding / alighting" : undefined}>
      {minutesToTime(min)}
      {min >= 1440 ? <sup className="ml-0.5 text-[9px] text-muted-foreground">+{Math.floor(min / 1440)}</sup> : null}
    </span>
  );
}

export default async function JourneyPage({ params, searchParams }: PageProps<"/journeys/[id]">) {
  if (!hasDb()) return <NoData />;
  const id = Number((await params).id);
  const sp = await searchParams;
  const data = Number.isFinite(id) ? getJourney(id) : null;
  if (!data) notFound();
  const { journey: j, stops, records, raw, variants, tracks, operator, category, lineInfo, sjyid, direction } = data;
  const c = cache();
  const { period } = c;
  const date = fromIsoDate(String(sp.date ?? "")) ?? defaultDate(period);
  const iso = toIsoDate(date);
  const day = dayIndex(period.start, date);
  const runs = runsOn(j.bitfield, day);
  const bf = j.bitfield ? c.bitfields.get(j.bitfield) : null;
  const days = bf ? bf.days : bitfieldDays("F".repeat(96), period.days);
  const cycle = Math.min(Math.max(Number(sp.cycle ?? 0) || 0, 0), j.takt_n ?? 0);
  const shift = cycle * (j.takt_min ?? 0);
  const tab = String(sp.tab ?? "stops");
  const link = (o: Record<string, string | number | undefined>) => `/journeys/${id}${qs({ date: iso, cycle: cycle || undefined, tab, ...o })}`;

  const trackAt = (stop: number, time: number | null) => {
    const hit = tracks.find((t) => t.stop === stop && (t.time === null || t.time === time || (time !== null && t.time === time % 1440)) && runsOn(t.bitfield, day));
    return hit ? hit.label ?? hit.ref : null;
  };
  const sectionVe = records.filter((r) => r.type === "*A" && r.code === "VE");

  return (
    <div>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-x-2">
            <span>FPLAN *Z journey #{j.id}</span>
            {j.tail ? <span className="normal-case">· {j.tail}</span> : null}
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            <CategoryBadge category={j.category} line={j.line} productClass={category?.productClass} lineBg={lineInfo?.bg} lineFg={lineInfo?.fg} size="lg" />
            <span>
              {stops[0]?.name} <span className="text-primary">→</span> {stops[stops.length - 1]?.name}
            </span>
          </span>
        }
      >
        <dl className="mt-2 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <dt className="eyebrow !text-[9.5px]">Zugnummer / journey nr</dt>
            <dd className="font-mono text-xl font-bold text-foreground">{j.nr}</dd>
          </div>
          <div>
            <dt className="eyebrow !text-[9.5px]">Administration</dt>
            <dd className="text-foreground">
              <Link href={`/ref/admin/${j.admin}`} className="link-u font-mono text-[13px]">
                {j.admin}
              </Link>
              {operator ? <span className="ml-1.5 text-sm">{operator.abbr ?? operator.short}</span> : null}
            </dd>
          </div>
          <div>
            <dt className="eyebrow !text-[9.5px]">Category</dt>
            <dd className="text-foreground">
              <Link href={`/ref/category/${j.category}`} className="link-u font-mono text-[13px]">
                {j.category}
              </Link>
              {category?.label ? <span className="ml-1.5 text-sm">{category.label}</span> : null}
            </dd>
          </div>
          <div>
            <dt className="eyebrow !text-[9.5px]">Line</dt>
            <dd className="text-foreground">
              {j.line_ref !== null ? (
                <Link href={`/ref/line/${j.line_ref}`} className="link-u text-sm font-semibold">
                  {j.line ?? `#${j.line_ref}`}
                </Link>
              ) : (
                <span className="text-sm font-semibold">{j.line ?? "—"}</span>
              )}
              {lineInfo?.slnid ? <div className="font-mono text-[10.5px]">{lineInfo.slnid}</div> : null}
            </dd>
          </div>
          <div>
            <dt className="eyebrow !text-[9.5px]">Operating days</dt>
            <dd className="text-foreground">
              {j.bitfield ? (
                <Link href={`/bitfields/${j.bitfield}`} className="link-u font-mono text-[13px]">
                  Bitfield {j.bitfield}
                </Link>
              ) : (
                <span className="text-sm">Daily (no VE bitfield)</span>
              )}
              <div className="text-xs">{(bf?.count ?? period.days).toLocaleString()} of {period.days} days</div>
            </dd>
          </div>
          <div>
            <dt className="eyebrow !text-[9.5px]">Direction</dt>
            <dd className="text-sm text-foreground">
              {j.dir === "R" ? "Return (R)" : j.dir === "H" ? "Outbound (H)" : "—"}
              {direction ? (
                <Link href={`/ref/direction/${j.dir_code}`} className="link-u ml-1 block text-xs">
                  {j.dir_code}: {direction}
                </Link>
              ) : null}
            </dd>
          </div>
        </dl>
        {sjyid ? (
          <div className="mt-3 font-mono text-xs">
            SJYID <span className="text-foreground">{sjyid}</span>
          </div>
        ) : null}
        {j.takt_n ? (
          <div className="mt-3 inline-flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm">
            <Repeat className="size-4 text-primary" /> Cycle: runs {j.takt_n + 1}× every {j.takt_min} min (*Z cycle count {j.takt_n}).
            <span className="flex gap-1">
              {Array.from({ length: (j.takt_n ?? 0) + 1 }, (_, k) => (
                <Link key={k} href={link({ cycle: k || undefined })} className={cn("rounded px-1.5 font-mono text-xs", k === cycle ? "bg-foreground text-background" : "hover:bg-muted")}>
                  {minutesToTime((j.dep ?? 0) + k * (j.takt_min ?? 0))}
                </Link>
              ))}
            </span>
          </div>
        ) : null}
      </PageHeader>

      <div className={cn("mt-6 flex flex-wrap items-center gap-3 rounded-md border-l-4 px-4 py-3", runs ? "border-run bg-run-soft" : "border-muted-foreground bg-muted")}>
        {runs ? <CalendarCheck2 className="size-5 text-run" /> : <CalendarX2 className="size-5 text-muted-foreground" />}
        <div className="text-[15px]">
          <span className="font-bold">{runs ? "Runs" : "Does not run"}</span> on {formatDate(date, { weekday: "long", month: "long" })}
          {j.bitfield ? <span className="text-muted-foreground"> · bit {day + 2} of bitfield {j.bitfield}</span> : null}
        </div>
        <form className="ml-auto flex items-center gap-2">
          <input type="hidden" name="tab" value={tab} />
          {cycle ? <input type="hidden" name="cycle" value={cycle} /> : null}
          <input type="date" name="date" defaultValue={iso} min={toIsoDate(period.start)} max={toIsoDate(period.end)} className="h-8 rounded-md border bg-card px-2 text-sm" />
          <button className="h-8 rounded-md bg-foreground px-3 text-sm font-semibold text-background hover:bg-primary">Check date</button>
        </form>
      </div>

      <div className="mt-8 flex gap-1 overflow-x-auto border-b">
        {[
          ["stops", `Stops (${stops.length})`],
          ["days", "Operating days"],
          ["records", `Records (${records.length})`],
          ["raw", "Raw HRDF"],
          ["related", `Related (${variants.length - 1 + data.through.length + data.transfers.length})`],
        ].map(([k, label]) => (
          <Link key={k} href={link({ tab: k })} className={cn("-mb-px border-b-[3px] px-3 py-2 text-sm font-semibold whitespace-nowrap", tab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {label}
          </Link>
        ))}
      </div>

      {tab === "stops" ? (
        <div className="mt-6">
          <ol className="relative">
            {stops.map((s, i) => {
              const first = i === 0;
              const last = i === stops.length - 1;
              const pseudo = s.stop < 1000000;
              const arr = s.arr !== null ? s.arr + shift : null;
              const dep = s.dep !== null ? s.dep + shift : null;
              const track = trackAt(s.stop, s.dep ?? s.arr);
              return (
                <li key={s.seq} className="grid grid-cols-[52px_52px_28px_minmax(0,1fr)_auto] items-center gap-x-2 sm:grid-cols-[64px_64px_36px_minmax(0,1fr)_120px_60px]">
                  <span className="py-2 text-right font-mono text-[13px]"><T min={arr} neg={(s.flags & 1) === 1} /></span>
                  <span className="py-2 text-right font-mono text-[13px] font-semibold"><T min={dep} neg={(s.flags & 2) === 2} /></span>
                  <span className="relative flex h-full items-center justify-center">
                    <span className={cn("absolute w-[3px] bg-foreground", first ? "top-1/2 bottom-0" : last ? "top-0 bottom-1/2" : "inset-y-0")} />
                    <span
                      className={cn(
                        "relative z-10 rounded-full border-[3px] border-foreground bg-background",
                        first || last ? "size-4 bg-foreground" : pseudo ? "size-2 border-2" : "size-3",
                      )}
                    />
                  </span>
                  <span className={cn("min-w-0 py-2", pseudo && "text-muted-foreground")}>
                    <Link href={`/stations/${s.stop}?date=${iso}&time=${minutesToTime(Math.max(0, (dep ?? arr ?? 0) - 5) % 1440)}`} className={cn("hover:text-primary", first || last ? "text-[16px] font-bold" : "font-medium")}>
                      {s.name}
                    </Link>
                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">{pad7(s.stop)}</span>
                    {pseudo ? <span className="ml-2 text-[11px] text-muted-foreground italic">pass-through point</span> : null}
                  </span>
                  <span className="hidden font-mono text-[11px] text-muted-foreground sm:block">
                    {s.flags & 1 ? "no alighting " : ""}
                    {s.flags & 2 ? "no boarding" : ""}
                  </span>
                  <span className="text-right text-sm font-bold">{track ? <span title="Track (GLEISE)">Pl. {track}</span> : null}</span>
                </li>
              );
            })}
          </ol>
          <p className="mt-4 text-xs text-muted-foreground">
            Times are HRDF HHHMM relative to the operating day; values ≥ 24:00 are shown with +1. Struck-through times are negative in HRDF (no boarding / alighting). Tracks are resolved from GLEISE for {formatDate(date)}.
          </p>
        </div>
      ) : null}

      {tab === "days" ? (
        <div className="mt-6">
          {sectionVe.length > 1 ? (
            <p className="mb-4 rounded-md border bg-card p-3 text-sm">
              This journey has {sectionVe.length} *A VE lines restricted to sections; the calendar shows bitfield {j.bitfield ?? "daily"} (the one covering the first stop). See the Records tab for the others.
            </p>
          ) : null}
          <OperatingCalendar days={days} period={period} highlight={iso} holidays={holidays()} hrefForDate={(d) => link({ date: d })} />
          <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-run" /> runs</span>
            <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-muted" /> does not run</span>
            <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm ring-1 ring-board-accent ring-inset" /> public holiday (FEIERTAG)</span>
            <span>Click a day to check it.</span>
          </div>
        </div>
      ) : null}

      {tab === "records" ? (
        <div className="mt-6 divide-y rounded-md border bg-card">
          {records.map((r) => (
            <div key={r.idx} className="grid gap-2 px-4 py-3 md:grid-cols-[120px_minmax(0,1fr)]">
              <div>
                <Link href={`/files/FPLAN?type=${encodeURIComponent(r.type)}${r.code ? `&code=${encodeURIComponent(r.code)}` : ""}`} className="inline-flex items-center gap-1 rounded-sm bg-foreground px-1.5 py-0.5 font-mono text-[12px] font-semibold text-background hover:bg-primary">
                  {r.type} {r.type === "*A" || r.type === "*I" ? r.code : ""}
                </Link>
              </div>
              <div className="min-w-0">
                <FplanRecordFields parsed={r.parsed} fromName={r.fromName} toName={r.toName} />
                {r.resolved ? <div className="mt-1 text-sm font-medium">{r.resolved}</div> : null}
                <div className="raw mt-1.5 overflow-x-auto text-muted-foreground">{r.text}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {tab === "raw" ? (
        <div className="mt-6">
          <div className="overflow-x-auto rounded-md bg-board p-4 text-board-foreground">
            <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-board-muted uppercase">FPLAN · original lines (cols 1–80)</div>
            <pre className="raw">
              <span className="text-board-muted">{"         1         2         3         4         5         6\n123456789012345678901234567890123456789012345678901234567890\n"}</span>
              {raw.split("\n").map((l, i) => (
                <span key={i} className={cn(l.startsWith("*") && "text-board-accent")}>
                  {l}
                  {"\n"}
                </span>
              ))}
            </pre>
          </div>
        </div>
      ) : null}

      {tab === "related" ? (
        <div className="mt-2">
          <Section title={`Same Zugnummer ${j.nr} / admin ${j.admin}`} aside={`${variants.length} journeys`}>
            <div className="divide-y rounded-md border bg-card">
              {variants.map((v) => (
                <Link key={v.id} href={`/journeys/${v.id}?date=${iso}`} className={cn("grid grid-cols-[60px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-sm hover:bg-paper", v.id === j.id && "bg-paper font-semibold")}>
                  <span className="font-mono tabular">{minutesToTime(v.dep)}</span>
                  <span className="truncate">
                    #{v.id} · {v.n_stops} stops · {v.category} {v.line ?? ""}
                  </span>
                  <span className="flex items-center gap-2 font-mono text-xs">
                    {runsOn(v.bitfield, day) ? <span className="text-run">runs {iso}</span> : <span className="text-muted-foreground">not {iso}</span>}
                    <span className="text-muted-foreground">bf {v.bitfield ?? "daily"}</span>
                  </span>
                </Link>
              ))}
            </div>
          </Section>
          {data.through.length ? (
            <Section title="Through-services" aside="DURCHBI">
              <div className="divide-y rounded-md border bg-card">
                {data.through.map((t) => (
                  <div key={t.n} className="px-3 py-2">
                    <DecodedInline fields={t.decoded.fields} />
                  </div>
                ))}
              </div>
            </Section>
          ) : null}
          {data.transfers.length ? (
            <Section title="Guaranteed / timed transfers" aside="UMSTEIGZ">
              <div className="divide-y rounded-md border bg-card">
                {data.transfers.map((t) => (
                  <div key={t.n} className="px-3 py-2">
                    <DecodedInline fields={t.decoded.fields} />
                  </div>
                ))}
              </div>
            </Section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
