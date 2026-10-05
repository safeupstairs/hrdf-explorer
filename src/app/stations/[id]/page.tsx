import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ExternalLink, TrainFront } from "lucide-react";
import { hasDb } from "@/lib/db";
import { board, getStation, metaGroups, stationExtras, stationMentions, stationNames, trackDefs } from "@/lib/hrdf/queries";
import { getLang } from "@/lib/lang";
import { cache } from "@/lib/hrdf/lookups";
import { addDays, dayIndex, defaultDate, formatDate, fromIsoDate, minutesToTime, parseTimeInput, toIsoDate } from "@/lib/hrdf/calendar";
import { decodeLine } from "@/lib/hrdf/decoders";
import { qs } from "@/lib/links";
import { Board } from "@/components/hrdf/board";
import { DecodedInline } from "@/components/hrdf/decoded-fields";
import { EmptyState, NoData, PageHeader, Section } from "@/components/page";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: PageProps<"/stations/[id]">): Promise<Metadata> {
  if (!hasDb()) return {};
  const s = getStation(Number((await params).id));
  return { title: s ? `${s.name} (${String(s.id).padStart(7, "0")})` : "Station" };
}

const pad7 = (n: number) => String(n).padStart(7, "0");

export default async function StationPage({ params, searchParams }: PageProps<"/stations/[id]">) {
  if (!hasDb()) return <NoData />;
  const id = Number((await params).id);
  const sp = await searchParams;
  const s = Number.isFinite(id) ? getStation(id) : null;
  if (!s) notFound();
  const { period } = cache();
  const date = fromIsoDate(String(sp.date ?? "")) ?? defaultDate(period);
  const iso = toIsoDate(date);
  const day = dayIndex(period.start, date);
  const mode = sp.mode === "arr" ? "arr" : "dep";
  const from = parseTimeInput(String(sp.time ?? ""), 7 * 60);
  const hours = Math.min(Math.max(Number(sp.hours ?? 2) || 2, 1), 24);
  const to = from + hours * 60 - 1;
  const inPeriod = day >= 0 && day < period.days;
  const entries = inPeriod ? board(id, day, from, to, mode, 150) : [];
  const mentions = stationMentions(id);
  const extras = stationExtras(id, await getLang());
  const meta = metaGroups(id);
  const defs = trackDefs(id);
  const tracks = new Map<string, { label?: string; sloid?: string; coords?: string[] }>();
  for (const d of defs) {
    const t = tracks.get(d.ref) ?? { coords: [] };
    if (d.kind === "G") t.label = d.value.replace(/^'|'$/g, "");
    if (d.kind === "g") t.sloid = d.value.split(/\s+/).pop();
    if (d.kind === "k") t.coords!.push(`${d.file.replace("GLEISE_", "")}: ${d.value}`);
    tracks.set(d.ref, t);
  }
  const groupNames = stationNames([...meta.groups.flatMap((g) => [g.meta, ...g.members]), ...meta.transfers.flatMap((t) => [t.from, t.to])]);
  const link = (o: Record<string, string | number | undefined>) => `/stations/${id}${qs({ date: iso, time: minutesToTime(from), mode, hours, ...o })}`;

  return (
    <div>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            <span className="rounded-sm bg-foreground px-1.5 py-0.5 font-mono text-background">{pad7(s.id)}</span>
            <span>DIDOK / BPUIC stop number</span>
            {s.country ? <span>· {s.country}</span> : null}
          </span>
        }
        title={s.name}
        aside={
          <Link href={`/journeys?stop=${s.id}`} className="inline-flex h-9 items-center gap-2 rounded-md border-2 border-foreground px-3 text-sm font-semibold hover:border-primary hover:text-primary">
            <TrainFront className="size-4" /> All {s.stop_events.toLocaleString()} journey stops
          </Link>
        }
      >
        <dl className="mt-1 grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Long name", s.long_name],
            ["Abbreviation", s.abbr],
            ["SLOID", s.sloid],
            ["WGS84", s.lat !== null ? `${s.lat}, ${s.lon}` : null],
            ["LV95", s.e !== null ? `${s.e} / ${s.n}` : null],
            ["Altitude", s.alt !== null ? `${s.alt} m` : null],
            ...extras.infos.map((i) => [i.code === "KT" ? "Canton (BHFART I KT)" : `Info ${i.code}`, i.text ?? i.nr]),
            ["UIC country / DiDok", `${String(s.id).padStart(7, "0").slice(0, 2)} / ${String(s.id).padStart(7, "0").slice(2)}`],
            ["Transfer prio (BFPRIOS)", s.prio],
            ["KMINFO", s.kminfo === 30000 ? "30000 (transfer point)" : s.kminfo === 0 ? "0 (no transfers)" : s.kminfo],
          ]
            .filter(([, v]) => v !== null && v !== undefined)
            .map(([k, v]) => (
              <div key={String(k)}>
                <dt className="eyebrow !text-[9.5px]">{k}</dt>
                <dd className="font-mono text-[12.5px] text-foreground">{String(v)}</dd>
              </div>
            ))}
        </dl>
        {s.synonyms ? <div className="mt-3 text-sm">Synonyms: <span className="text-foreground">{s.synonyms}</span></div> : null}
        {s.lat !== null ? (
          <a className="link-u mt-3 inline-flex items-center gap-1 text-sm" href={`https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lon}#map=17/${s.lat}/${s.lon}`} target="_blank" rel="noreferrer">
            Open in OpenStreetMap <ExternalLink className="size-3" />
          </a>
        ) : null}
      </PageHeader>

      <Section title={mode === "dep" ? "Departures" : "Arrivals"} aside={<span className="font-mono text-xs">{formatDate(date)}</span>}>
        <form className="mb-4 flex flex-wrap items-end gap-2">
          <div className="flex overflow-hidden rounded-md border bg-card">
            {(["dep", "arr"] as const).map((m) => (
              <Link key={m} href={link({ mode: m })} className={cn("px-3 py-2 text-sm font-semibold", mode === m ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
                {m === "dep" ? "Departures" : "Arrivals"}
              </Link>
            ))}
          </div>
          <input type="hidden" name="mode" value={mode} />
          <label className="flex flex-col gap-1">
            <span className="eyebrow !text-[9.5px]">Date</span>
            <input type="date" name="date" defaultValue={iso} min={toIsoDate(period.start)} max={toIsoDate(period.end)} className="h-9 rounded-md border bg-card px-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="eyebrow !text-[9.5px]">From</span>
            <input type="time" name="time" defaultValue={minutesToTime(from)} className="h-9 rounded-md border bg-card px-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="eyebrow !text-[9.5px]">Window</span>
            <select name="hours" defaultValue={String(hours)} className="h-9 rounded-md border bg-card px-2 text-sm">
              {[1, 2, 3, 6, 12, 24].map((h) => (
                <option key={h} value={h}>
                  {h} h
                </option>
              ))}
            </select>
          </label>
          <button className="h-9 rounded-md bg-foreground px-4 text-sm font-semibold text-background hover:bg-primary">Show</button>
          <div className="ml-auto flex gap-1">
            <Link href={link({ date: toIsoDate(addDays(date, -1)) })} className="rounded-md border bg-card px-2.5 py-2 text-xs font-medium hover:border-foreground">
              ← Day
            </Link>
            <Link href={link({ time: minutesToTime(Math.max(0, from - hours * 60)) })} className="rounded-md border bg-card px-2.5 py-2 text-xs font-medium hover:border-foreground">
              Earlier
            </Link>
            <Link href={link({ time: minutesToTime(Math.min(from + hours * 60, 23 * 60 + 59)) })} className="rounded-md border bg-card px-2.5 py-2 text-xs font-medium hover:border-foreground">
              Later
            </Link>
            <Link href={link({ date: toIsoDate(addDays(date, 1)) })} className="rounded-md border bg-card px-2.5 py-2 text-xs font-medium hover:border-foreground">
              Day →
            </Link>
          </div>
        </form>
        {!inPeriod ? (
          <EmptyState title="Date outside the timetable period">
            This export covers {formatDate(period.start)} – {formatDate(period.end)}.
          </EmptyState>
        ) : entries.length === 0 ? (
          <EmptyState title={`No ${mode === "dep" ? "departures" : "arrivals"} in this window`}>
            Nothing stops here between {minutesToTime(from)} and {minutesToTime(to)} on {formatDate(date)}. Try a wider window or another day
            {s.stop_events === 0 ? " — this stop has no FPLAN stop lines at all (it may be a meta-station or a border/tunnel point)." : "."}
          </EmptyState>
        ) : (
          <>
            <Board entries={entries} mode={mode} dateIso={iso} />
            <p className="mt-2 text-xs text-muted-foreground">
              {entries.length} {mode === "dep" ? "departures" : "arrivals"} resolved via each journey&apos;s *A VE bitfield for {formatDate(date)}. Journeys starting the previous day (times ≥ 24:00) are included. Stops with negative HRDF times (no {mode === "dep" ? "boarding" : "alighting"}) are hidden.
            </p>
          </>
        )}
      </Section>

      <div className="grid gap-x-10 lg:grid-cols-2">
        {extras.quays.length ? (
          <Section title={`Quays (${extras.quays.length})`} aside="BHFART G a">
            <div className="flex flex-wrap gap-1.5">
              {extras.quays.map((q) => (
                <span key={q} className="rounded-sm border bg-card px-1.5 py-0.5 font-mono text-[11px]">{q}</span>
              ))}
            </div>
          </Section>
        ) : null}
        {tracks.size ? (
          <Section title="Tracks / platforms" aside="GLEISE">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[...tracks.entries()].map(([ref, t]) => (
                <div key={ref} className="rounded-md border bg-card p-2.5">
                  <div className="flex items-baseline justify-between">
                    <span className={cn("font-bold", t.label ? "text-lg" : "text-sm text-muted-foreground")}>{t.label || "unnamed"}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{ref}</span>
                  </div>
                  {t.sloid ? <div className="truncate font-mono text-[10.5px] text-muted-foreground">{t.sloid}</div> : null}
                </div>
              ))}
            </div>
          </Section>
        ) : null}
        {meta.groups.length || meta.transfers.length ? (
          <Section title="Meta-stations & walking transfers" aside="METABHF">
            <ul className="space-y-2 text-sm">
              {meta.groups.map((g, i) => (
                <li key={`g${i}`}>
                  <span className="eyebrow mr-2">Group</span>
                  <Link className="link-u font-semibold" href={`/stations/${g.meta}`}>
                    {groupNames.get(g.meta) ?? pad7(g.meta)}
                  </Link>{" "}
                  →{" "}
                  {g.members.map((m, k) => (
                    <span key={m}>
                      {k ? ", " : ""}
                      <Link className={cn("link-u", m === id && "font-bold")} href={`/stations/${m}`}>
                        {groupNames.get(m) ?? pad7(m)}
                      </Link>
                    </span>
                  ))}
                </li>
              ))}
              {meta.transfers.slice(0, 30).map((t, i) => (
                <li key={`t${i}`} className="flex flex-wrap items-center gap-2">
                  <span className="eyebrow">Walk</span>
                  <Link className="link-u" href={`/stations/${t.from}`}>{groupNames.get(t.from) ?? pad7(t.from)}</Link>→
                  <Link className="link-u" href={`/stations/${t.to}`}>{groupNames.get(t.to) ?? pad7(t.to)}</Link>
                  <span className="font-mono text-xs">{t.minutes} min</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>

      <Section title="Mentioned in files" aside={`${mentions.reduce((a, m) => a + m.n, 0).toLocaleString()} records`}>
        {mentions.length === 0 ? (
          <EmptyState title="No references in other files" />
        ) : (
          <div className="space-y-4">
            {mentions.map((m) => (
              <div key={m.file} className="rounded-md border bg-card">
                <div className="flex items-center justify-between border-b bg-paper px-3 py-2">
                  <Link href={`/files/${m.file}?station=${id}`} className="font-mono text-[13px] font-semibold hover:text-primary">
                    {m.file}
                  </Link>
                  <span className="font-mono text-xs text-muted-foreground">{m.n.toLocaleString()} lines</span>
                </div>
                <ul className="divide-y">
                  {m.lines.map((l) => (
                    <li key={l.n} className="grid gap-1 px-3 py-2 md:grid-cols-[60px_minmax(0,1fr)]">
                      <Link href={`/files/${m.file}?line=${l.n}`} className="font-mono text-[11px] text-muted-foreground hover:text-primary">
                        #{l.n}
                      </Link>
                      <div className="min-w-0">
                        <DecodedInline fields={decodeLine(m.file, l.text, l.section).fields} />
                        <div className="raw mt-1 overflow-x-auto text-muted-foreground">{l.text}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
