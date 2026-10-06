import Link from "next/link";
import type { Metadata } from "next";
import { hasDb } from "@/lib/db";
import { cache } from "@/lib/hrdf/lookups";
import { bitfieldUsage } from "@/lib/hrdf/queries";
import { dayIndex, formatDate, fromIsoDate, toIsoDate } from "@/lib/hrdf/calendar";
import { qs } from "@/lib/links";
import { EmptyState, FilterInput, NoData, PageHeader, Pager, SubmitButton } from "@/components/page";

export const metadata: Metadata = { title: "Bitfields" };
const LIMIT = 60;

/** Tiny 364-day strip; one 1px column per day. */
function Strip({ days }: { days: boolean[] }) {
  return (
    <svg viewBox={`0 0 ${days.length} 10`} preserveAspectRatio="none" className="h-4 w-full rounded-[2px] bg-muted">
      {days.map((on, i) => (on ? <rect key={i} x={i} y={0} width={1} height={10} className="fill-run" /> : null))}
    </svg>
  );
}

export default async function BitfieldsPage({ searchParams }: PageProps<"/bitfields">) {
  if (!hasDb()) return <NoData />;
  const sp = await searchParams;
  const q = String(sp.q ?? "").trim();
  const dateStr = String(sp.date ?? "").trim();
  const sort = String(sp.sort ?? "usage");
  const offset = Math.max(0, Number(sp.offset) || 0);
  const c = cache();
  const usage = bitfieldUsage();
  const date = fromIsoDate(dateStr);
  const di = date ? dayIndex(c.period.start, date) : null;
  let rows = [...c.bitfields.entries()].map(([id, b]) => ({ id, ...b, usage: usage.get(id) ?? 0 }));
  if (q) rows = rows.filter((r) => String(r.id).includes(q.replace(/^0+/, "")) || r.hex.includes(q.toUpperCase()));
  if (di !== null) rows = rows.filter((r) => r.days[di]);
  const minDays = Number(sp.min ?? "") || 0;
  const maxDays = Number(sp.max ?? "") || 0;
  if (minDays) rows = rows.filter((r) => r.count >= minDays);
  if (maxDays) rows = rows.filter((r) => r.count <= maxDays);
  rows.sort((a, b) => (sort === "id" ? a.id - b.id : sort === "days" ? b.count - a.count : b.usage - a.usage));
  const page = rows.slice(offset, offset + LIMIT);

  return (
    <div>
      <PageHeader eyebrow="BITFELD · ECKDATEN" title="Bitfields (operating days)">
        Each bitfield is a hex string; every bit is one day starting {formatDate(c.period.start)} (after 2 padding bits). {usage.get(0)?.toLocaleString() ?? 0} journeys have no VE bitfield and run daily.
      </PageHeader>
      <form className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto_auto]">
        <FilterInput name="q" label="Number or hex" defaultValue={q} placeholder="3933" />
        <FilterInput name="date" type="date" label="Runs on" defaultValue={dateStr} />
        <FilterInput name="min" label="Min. days" defaultValue={sp.min ? String(sp.min) : ""} placeholder="0" />
        <FilterInput name="max" label="Max. days" defaultValue={sp.max ? String(sp.max) : ""} placeholder={String(c.period.days)} />
        <label className="flex flex-col gap-1">
          <span className="eyebrow !text-[9.5px]">Sort</span>
          <select name="sort" defaultValue={sort} className="h-9 rounded-md border bg-card px-2 text-sm">
            <option value="usage">Most journeys</option>
            <option value="days">Most days</option>
            <option value="id">Number</option>
          </select>
        </label>
        <SubmitButton>Filter</SubmitButton>
      </form>
      <div className="mt-6">
        {page.length === 0 ? (
          <EmptyState title="No bitfield matches">Try removing the date or day-count filters.</EmptyState>
        ) : (
          <>
            <div className="divide-y rounded-md border bg-card">
              {page.map((r) => (
                <Link key={r.id} href={`/bitfields/${r.id}${date ? `?date=${toIsoDate(date)}` : ""}`} className="grid grid-cols-[80px_minmax(0,1fr)_70px] items-center gap-3 px-3 py-2 hover:bg-paper sm:grid-cols-[90px_minmax(0,1fr)_90px_90px]">
                  <span className="font-mono text-[13px] font-semibold">{String(r.id).padStart(6, "0")}</span>
                  <Strip days={r.days} />
                  <span className="text-right font-mono text-xs tabular">{r.count} d</span>
                  <span className="hidden text-right font-mono text-xs text-muted-foreground tabular sm:block">{r.usage.toLocaleString()} j</span>
                </Link>
              ))}
            </div>
            <Pager offset={offset} limit={LIMIT} total={rows.length} count={page.length} hrefFor={(o) => `/bitfields${qs({ q, date: dateStr, sort, min: sp.min as string, max: sp.max as string, offset: o || undefined })}`} />
          </>
        )}
      </div>
    </div>
  );
}
