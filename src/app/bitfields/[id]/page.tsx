import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { hasDb } from "@/lib/db";
import { cache } from "@/lib/hrdf/lookups";
import { bitfieldFileRefs, bitfieldLineUsage, bitfieldUsage, searchJourneys } from "@/lib/hrdf/queries";
import { addDays, dayIndex, decodeBits, formatDate, fromIsoDate, minutesToTime, toIsoDate } from "@/lib/hrdf/calendar";
import { holidays } from "@/lib/hrdf/holidays";
import { OperatingCalendar } from "@/components/hrdf/operating-calendar";
import { NoData, PageHeader, Section, Stat } from "@/components/page";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: PageProps<"/bitfields/[id]">): Promise<Metadata> {
  return { title: `Bitfield ${(await params).id}` };
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function BitfieldPage({ params, searchParams }: PageProps<"/bitfields/[id]">) {
  if (!hasDb()) return <NoData />;
  const id = Number((await params).id);
  const sp = await searchParams;
  const c = cache();
  const b = c.bitfields.get(id);
  if (!b) notFound();
  const date = fromIsoDate(String(sp.date ?? ""));
  const di = date ? dayIndex(c.period.start, date) : null;
  const usage = bitfieldUsage().get(id) ?? 0;
  const lineUsage = bitfieldLineUsage(id);
  const fileRefs = bitfieldFileRefs(id).filter((f) => !f.file.startsWith("BITF"));
  const journeys = searchJourneys({ bitfield: String(id) }, 25);
  const bits = decodeBits(b.hex);
  const weekday = [0, 0, 0, 0, 0, 0, 0];
  const weekdayTotal = [0, 0, 0, 0, 0, 0, 0];
  b.days.forEach((on, i) => {
    const wd = addDays(c.period.start, i).getUTCDay();
    weekdayTotal[wd]++;
    if (on) weekday[wd]++;
  });
  const first = b.days.indexOf(true);
  const last = b.days.lastIndexOf(true);

  return (
    <div>
      <PageHeader eyebrow="BITFELD" title={<span className="font-mono">Bitfield {String(id).padStart(6, "0")}</span>}>
        {b.count} of {c.period.days} days
        {first >= 0 ? ` · first ${formatDate(addDays(c.period.start, first))} · last ${formatDate(addDays(c.period.start, last))}` : " · never runs"}
      </PageHeader>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Operating days" value={b.count} />
        <Stat label="Journeys (*Z VE)" value={usage.toLocaleString()} href={`/journeys?bitfield=${id}`} />
        <Stat label="FPLAN lines" value={lineUsage.reduce((a, l) => a + l.n, 0).toLocaleString()} href={`/files/FPLAN?bitfield=${id}`} sub={lineUsage.map((l) => `${l.type} ${l.code}`).slice(0, 3).join(", ")} />
        <Stat label="Other files" value={fileRefs.reduce((a, f) => a + f.n, 0).toLocaleString()} sub={fileRefs.map((f) => f.file).join(", ") || "—"} />
      </div>

      {date && di !== null ? (
        <div className={cn("mt-6 rounded-md border-l-4 px-4 py-3 text-[15px]", b.days[di] ? "border-run bg-run-soft" : "border-muted-foreground bg-muted")}>
          <b>{b.days[di] ? "Set" : "Not set"}</b> for {formatDate(date, { weekday: "long", month: "long" })} (bit {di + 2})
        </div>
      ) : null}

      <Section title="Calendar" aside="click a day to check it">
        <OperatingCalendar days={b.days} period={c.period} highlight={date ? toIsoDate(date) : null} holidays={holidays()} hrefForDate={(d) => `/bitfields/${id}?date=${d}`} />
      </Section>

      <div className="grid gap-x-10 lg:grid-cols-2">
        <Section title="By weekday">
          <div className="grid grid-cols-7 gap-2">
            {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
              <div key={wd} className="text-center">
                <div className="relative mx-auto h-24 w-full overflow-hidden rounded-sm bg-muted">
                  <div className="absolute inset-x-0 bottom-0 bg-run" style={{ height: `${(weekday[wd] / weekdayTotal[wd]) * 100}%` }} />
                </div>
                <div className="mt-1 text-xs font-semibold">{WD[wd]}</div>
                <div className="font-mono text-[10.5px] text-muted-foreground">
                  {weekday[wd]}/{weekdayTotal[wd]}
                </div>
              </div>
            ))}
          </div>
        </Section>
        <Section title="Raw value">
          <div className="rounded-md bg-board p-4 text-board-foreground">
            <div className="raw break-all whitespace-normal text-board-accent">{b.hex}</div>
            <div className="mt-3 flex flex-wrap gap-[2px]">
              {bits.slice(0, 2 + c.period.days + 2).map((bit, i) => (
                <span
                  key={i}
                  title={i < 2 ? `padding bit ${i}` : i - 2 < c.period.days ? toIsoDate(addDays(c.period.start, i - 2)) : "padding"}
                  className={cn("size-[7px] rounded-[1px]", i < 2 || i - 2 >= c.period.days ? "bg-white/20" : bit ? "bg-board-accent" : "bg-white/10")}
                />
              ))}
            </div>
            <p className="mt-3 text-xs text-board-muted">{b.hex.length} hex chars = {b.hex.length * 4} bits. Grey squares are padding bits outside the period.</p>
          </div>
        </Section>
      </div>

      <Section title="Journeys using this bitfield" aside={<Link className="link-u" href={`/journeys?bitfield=${id}`}>All {journeys.total.toLocaleString()}</Link>}>
        <div className="divide-y rounded-md border bg-card">
          {journeys.rows.map((r) => (
            <Link key={r.id} href={`/journeys/${r.id}`} className="grid grid-cols-[60px_80px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-sm hover:bg-paper">
              <span className="font-mono tabular">{minutesToTime(r.dep)}</span>
              <span className="font-mono font-semibold">
                {r.category} {r.nr}
              </span>
              <span className="truncate">
                {r.fromName} → {r.toName}
              </span>
              <span className="font-mono text-xs text-muted-foreground">{r.admin}</span>
            </Link>
          ))}
        </div>
      </Section>
    </div>
  );
}
