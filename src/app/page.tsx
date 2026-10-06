import Link from "next/link";
import { connection } from "next/server";
import { ArrowRight } from "lucide-react";
import { hasDb } from "@/lib/db";
import { overview, searchStations } from "@/lib/hrdf/queries";
import { formatDate } from "@/lib/hrdf/calendar";
import { describeFile } from "@/lib/hrdf/decoders";
import { NoData, Section, Stat } from "@/components/page";

const EXAMPLES = [
  { label: "Zürich HB departures", href: "/stations/8503000" },
  { label: "Bern (8507000)", href: "/stations/8507000" },
  { label: "IC 1 journeys (SBB)", href: "/journeys?category=IC&line=1" },
  { label: "Zugnummer 2577", href: "/journeys?nr=2577" },
  { label: "Bitfield 3933", href: "/bitfields/3933" },
  { label: "*A VE lines", href: "/files/FPLAN?type=*A&code=VE" },
];

export default async function Home() {
  await connection();
  if (!hasDb()) return <NoData />;
  const o = overview();
  const [name, created, version, source] = o.header.split("$");
  const top = searchStations("", 12);
  return (
    <div>
      <div className="grid gap-8 border-b pb-10 lg:grid-cols-[1.25fr_1fr] lg:items-end">
        <div>
          <div className="eyebrow mb-3">
            {source} · HRDF {version} · exported {created}
          </div>
          <h1 className="text-[44px] leading-[0.95] font-extrabold tracking-[-0.04em] sm:text-[68px]">
            {name}
            <span className="text-primary">.</span>
          </h1>
          <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
            Every Swiss public-transport journey, stop and operating day from the official HRDF export — searchable, decoded and cross-linked, down to the original fixed-width line.
          </p>
          <form action="/search" className="mt-6 flex max-w-xl gap-2">
            <input
              name="q"
              autoFocus
              placeholder="Try “Luzern”, “8505000”, “IC 2577” or “ch:1:sloid:7000”"
              className="h-12 min-w-0 flex-1 rounded-md border-2 border-foreground bg-card px-4 text-[15px] outline-none placeholder:text-muted-foreground/60 focus:border-primary"
            />
            <button className="h-12 rounded-md bg-primary px-5 font-bold text-primary-foreground hover:bg-primary/90">Search</button>
          </form>
          <div className="mt-4 flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <Link key={e.href} href={e.href} className="rounded-full border bg-card px-3 py-1 text-[12.5px] font-medium transition-colors hover:border-foreground">
                {e.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="rounded-md bg-board p-5 text-board-foreground">
          <div className="flex items-center justify-between text-board-muted">
            <span className="font-mono text-[10.5px] tracking-[0.14em] uppercase">Timetable period</span>
            <span className="font-mono text-[10.5px]">ECKDATEN</span>
          </div>
          <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div>
              <div className="text-[11px] text-board-muted">First day</div>
              <div className="text-xl font-bold tabular">{formatDate(o.period.start)}</div>
            </div>
            <div className="h-px w-10 bg-board-accent" />
            <div className="text-right">
              <div className="text-[11px] text-board-muted">Last day</div>
              <div className="text-xl font-bold tabular">{formatDate(o.period.end)}</div>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded bg-board-line">
            {[
              ["Days", o.period.days],
              ["Bitfields", o.bitfields],
              ["Files", o.files.length],
            ].map(([l, v]) => (
              <div key={l} className="bg-board px-3 py-2">
                <div className="text-[10.5px] text-board-muted uppercase">{l}</div>
                <div className="text-lg font-bold text-board-accent tabular">{Number(v).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Stops" value={o.stations.toLocaleString()} href="/stations" sub="BAHNHOF" />
        <Stat label="Journeys" value={o.journeys.toLocaleString()} href="/journeys" sub="FPLAN *Z" />
        <Stat label="Stop times" value={o.stopEvents.toLocaleString()} href="/files/FPLAN" sub="FPLAN stop lines" />
        <Stat label="Operators" value={o.operators.toLocaleString()} href="/files/BETRIEB_DE" sub="BETRIEB" />
        <Stat label="Lines" value={o.lines.toLocaleString()} href="/files/LINIE" sub="LINIE" />
        <Stat label="Categories" value={o.categories.toLocaleString()} href="/files/ZUGART" sub="ZUGART" />
      </div>

      <div className="grid gap-x-10 lg:grid-cols-[1fr_1.3fr]">
        <Section title="Busiest stops" aside={<Link href="/stations" className="link-u">All stations</Link>}>
          <ol className="divide-y">
            {top.map((s, i) => (
              <li key={s.id}>
                <Link href={`/stations/${s.id}`} className="group flex items-center gap-3 py-2">
                  <span className="w-5 font-mono text-xs text-muted-foreground tabular">{i + 1}</span>
                  <span className="flex-1 font-semibold group-hover:text-primary">{s.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{String(s.id).padStart(7, "0")}</span>
                  <span className="w-20 text-right font-mono text-xs tabular">{s.stop_events.toLocaleString()}</span>
                </Link>
              </li>
            ))}
          </ol>
        </Section>
        <Section title="Files in this export" aside={<Link href="/files" className="link-u">Browse all</Link>}>
          <div className="grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2">
            {o.files.map((f) => (
              <Link key={f.name} href={`/files/${f.name}`} className="group flex items-start justify-between gap-3 bg-card px-3 py-2 hover:bg-paper">
                <span className="min-w-0">
                  <span className="block font-mono text-[13px] font-semibold group-hover:text-primary">{f.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{describeFile(f.name)}</span>
                </span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular">{f.lines.toLocaleString()}</span>
              </Link>
            ))}
          </div>
        </Section>
      </div>
      <div className="mt-10 flex items-center gap-2 text-sm text-muted-foreground">
        <ArrowRight className="size-4" /> Database built {new Date(o.meta.built_at).toLocaleString("en-GB")} from {o.meta.source_zip} in {o.meta.build_seconds}s.
      </div>
    </div>
  );
}
