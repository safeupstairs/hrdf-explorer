import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { FileSearch } from "lucide-react";
import { hasDb } from "@/lib/db";
import {
  browseFplan,
  browseGleisDefs,
  browseGleise,
  browseLines,
  browseStopLines,
  fileInfo,
  fplanTypeStats,
  lineOffset,
  stationNames,
} from "@/lib/hrdf/queries";
import { decodeLine, describeFile, hasDecoder, type Field } from "@/lib/hrdf/decoders";
import { parseFplanLine } from "@/lib/hrdf/fplan";
import { minutesToTime } from "@/lib/hrdf/calendar";
import { qs } from "@/lib/links";
import { FieldValue } from "@/components/hrdf/decoded-fields";
import { fplanFields } from "@/components/hrdf/fplan-record";
import { EmptyState, FilterInput, NoData, PageHeader, Pager, SubmitButton } from "@/components/page";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: PageProps<"/files/[name]">): Promise<Metadata> {
  return { title: (await params).name };
}

const LIMIT = 100;

type Row = { n: number | string; href?: string; fields: Field[]; raw?: string; kind?: string };

/** Renders rows as a real table when every row has the same field labels, otherwise as a list. */
function RecordTable({ rows }: { rows: Row[] }) {
  const sig = (r: Row) => r.fields.map((f) => f.label).join("|");
  const uniform = rows.length > 0 && rows.every((r) => sig(r) === sig(rows[0]));
  if (uniform) {
    return (
      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-paper text-left">
            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-mono [&>th]:text-[10px] [&>th]:font-medium [&>th]:tracking-wider [&>th]:whitespace-nowrap [&>th]:text-muted-foreground [&>th]:uppercase">
              <th>#</th>
              {rows[0].fields.map((f) => (
                <th key={f.label}>{f.label}</th>
              ))}
              <th className="hidden xl:table-cell">Raw</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.n} className="align-top hover:bg-paper [&>td]:px-3 [&>td]:py-1.5">
                <td className="font-mono text-[11px] text-muted-foreground">{r.href ? <Link href={r.href} className="hover:text-primary">{r.n}</Link> : r.n}</td>
                {r.fields.map((f, i) => (
                  <td key={i} className="max-w-[420px] whitespace-nowrap">
                    <span className="block truncate"><FieldValue f={f} /></span>
                  </td>
                ))}
                <td className="raw hidden text-[11px] text-muted-foreground xl:table-cell">{r.raw}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="divide-y rounded-md border bg-card">
      {rows.map((r) => (
        <div key={r.n} className="grid gap-1 px-3 py-2 md:grid-cols-[70px_minmax(0,1fr)]">
          <span className="font-mono text-[11px] text-muted-foreground">{r.href ? <Link href={r.href} className="hover:text-primary">{r.n}</Link> : r.n}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {r.fields.map((f, i) => (
                <span key={i} className="inline-flex items-baseline gap-1.5 text-sm">
                  <span className="eyebrow !text-[9.5px]">{f.label}</span>
                  <FieldValue f={f} />
                </span>
              ))}
            </div>
            {r.raw ? <div className="raw mt-1 overflow-x-auto text-muted-foreground">{r.raw}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function FilePage({ params, searchParams }: PageProps<"/files/[name]">) {
  if (!hasDb()) return <NoData />;
  const name = decodeURIComponent((await params).name);
  const sp = await searchParams;
  const get = (k: string) => String(sp[k] ?? "").trim();
  const info = fileInfo(name);
  if (!info) notFound();
  const q = get("q");
  let offset = Math.max(0, Number(get("offset")) || 0);

  const header = (
    <PageHeader
      eyebrow={
        <span className="flex flex-wrap gap-x-3">
          <Link href="/files" className="link-u">All files</Link>
          <span>{info.lines.toLocaleString()} lines</span>
          <span>{(info.size / 1e6).toFixed(1)} MB</span>
          {!hasDecoder(name) && info.stored === "lines" ? <span className="text-primary">generic decoder</span> : null}
        </span>
      }
      title={<span className="font-mono">{name}</span>}
    >
      {describeFile(name)}
    </PageHeader>
  );

  if (info.stored === "fplan") {
    const stats = fplanTypeStats();
    const type = get("type");
    const code = get("code");
    const bitfield = Number(get("bitfield")) || undefined;
    const stop = Number(get("stop")) || undefined;
    const isStops = type === "stop";
    const grouped = new Map<string, { code: string | null; n: number }[]>();
    for (const s of stats) grouped.set(s.type, [...(grouped.get(s.type) ?? []), { code: s.code, n: s.n }]);
    const lines = isStops ? [] : type || bitfield || stop ? browseFplan(type, code || null, q, offset, LIMIT, bitfield, stop) : [];
    const stopLines = isStops ? browseStopLines(stop ?? null, offset, LIMIT) : [];
    const names = stationNames(lines.flatMap((l) => [l.from_stop ?? 0, l.to_stop ?? 0]));
    const base = { type, code, q, bitfield, stop };
    const facet = (t: string, c?: string | null) => `/files/FPLAN${qs({ type: t, code: c ?? undefined, bitfield, stop })}`;
    return (
      <div>
        {header}
        <div className="mt-6 grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <div className="rounded-md border bg-card">
              <div className="border-b px-3 py-2 eyebrow">Line types</div>
              <div className="max-h-[60vh] overflow-y-auto py-1">
                <Link href={facet("stop")} className={cn("flex justify-between px-3 py-1 text-sm hover:bg-paper", isStops && "bg-foreground text-background hover:bg-foreground")}>
                  <span className="font-mono font-semibold">stop lines</span>
                  <span className="font-mono text-xs opacity-70">stops table</span>
                </Link>
                {[...grouped.entries()].map(([t, codes]) => (
                  <div key={t} className="mt-1">
                    <Link href={facet(t)} className={cn("flex justify-between px-3 py-1 text-sm hover:bg-paper", type === t && !code && "bg-foreground text-background hover:bg-foreground")}>
                      <span className="font-mono font-bold">{t}</span>
                      <span className="font-mono text-xs opacity-70">{codes.reduce((a, c) => a + c.n, 0).toLocaleString()}</span>
                    </Link>
                    {codes.length > 1 && (t === "*A" || t === "*I" || t === "*R" || t === "*L" || t === "*CI" || t === "*CO")
                      ? codes.slice(0, 40).map((c) => (
                          <Link key={`${t}${c.code}`} href={facet(t, c.code ?? "")} className={cn("flex justify-between py-0.5 pr-3 pl-7 text-[13px] hover:bg-paper", type === t && code === c.code && "bg-foreground text-background hover:bg-foreground")}>
                            <span className="font-mono">{c.code || "∅"}</span>
                            <span className="font-mono text-[11px] opacity-70">{c.n.toLocaleString()}</span>
                          </Link>
                        ))
                      : null}
                  </div>
                ))}
              </div>
            </div>
          </aside>
          <div className="min-w-0">
            <form className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
              <input type="hidden" name="type" value={type} />
              <input type="hidden" name="code" value={code} />
              <FilterInput name="q" label="Text contains" defaultValue={q} placeholder="raw substring, e.g. 8507000" />
              <FilterInput name="bitfield" label="Bitfield" defaultValue={bitfield ? String(bitfield) : ""} />
              <FilterInput name="stop" label="From/to stop" defaultValue={stop ? String(stop) : ""} />
              <SubmitButton>Filter</SubmitButton>
            </form>
            {!type && !bitfield && !stop ? (
              <EmptyState title="Pick a line type" icon={<FileSearch className="size-6" />}>
                FPLAN holds one block per journey: a *Z header followed by *G (category), *A (attributes, incl. VE = operating days), *I (info texts), *L (line), *R (direction), *CI/*CO (check-in/out) and stop lines. Choose a type on the left to browse all lines of that kind across every journey.
              </EmptyState>
            ) : isStops ? (
              <>
                <RecordTable
                  rows={stopLines.map((s) => ({
                    n: `${s.journey}:${s.seq}`,
                    href: `/journeys/${s.journey}`,
                    fields: [
                      { label: "Journey", value: String(s.journey), link: undefined, mono: true },
                      { label: "Seq", value: String(s.seq), mono: true },
                      { label: "Stop", value: `${String(s.stop).padStart(7, "0")} ${s.name}`, link: { kind: "station", id: String(s.stop) }, mono: true },
                      { label: "Arr", value: `${s.flags & 1 ? "−" : ""}${minutesToTime(s.arr)}`, mono: true },
                      { label: "Dep", value: `${s.flags & 2 ? "−" : ""}${minutesToTime(s.dep)}`, mono: true },
                    ],
                  }))}
                />
                <Pager offset={offset} limit={LIMIT} total={null} count={stopLines.length} hrefFor={(o) => `/files/FPLAN${qs({ ...base, offset: o || undefined })}`} />
              </>
            ) : lines.length === 0 ? (
              <EmptyState title="No FPLAN lines match" />
            ) : (
              <>
                <RecordTable
                  rows={lines.map((l) => ({
                    n: `${l.journey}.${l.idx}`,
                    href: `/journeys/${l.journey}?tab=records`,
                    fields: fplanFields(parseFplanLine(l.text), names.get(l.from_stop ?? -1), names.get(l.to_stop ?? -1)),
                    raw: l.text,
                  }))}
                />
                <Pager offset={offset} limit={LIMIT} total={null} count={lines.length} hrefFor={(o) => `/files/FPLAN${qs({ ...base, offset: o || undefined })}`} />
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (info.stored === "gleise") {
    const view = get("view") === "defs" ? "defs" : "assign";
    const stop = get("stop");
    const nr = get("nr");
    const isSource = name === "GLEISE_WGS" || name === "GLEISE" || name === "GLEIS";
    const assigns = view === "assign" ? browseGleise(stop, nr, offset, LIMIT) : [];
    const defs = view === "defs" ? browseGleisDefs(name, stop, offset, LIMIT) : [];
    const names = stationNames([...assigns.map((a) => a.stop), ...defs.map((d) => d.stop)]);
    const base = { view, stop, nr };
    return (
      <div>
        {header}
        <div className="mt-6 flex flex-wrap items-end gap-3">
          <div className="flex overflow-hidden rounded-md border bg-card">
            {(["assign", "defs"] as const).map((v) => (
              <Link key={v} href={`/files/${name}${qs({ view: v, stop })}`} className={cn("px-3 py-2 text-sm font-semibold", view === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
                {v === "assign" ? "Journey → track assignments" : "Track definitions (#refs)"}
              </Link>
            ))}
          </div>
          <form className="flex flex-1 flex-wrap items-end gap-2">
            <input type="hidden" name="view" value={view} />
            <FilterInput name="stop" label="Stop number" defaultValue={stop} placeholder="8507000" className="w-36" />
            {view === "assign" ? <FilterInput name="nr" label="Journey nr" defaultValue={nr} placeholder="2577" className="w-32" /> : null}
            <SubmitButton>Filter</SubmitButton>
          </form>
        </div>
        {view === "assign" && !isSource ? (
          <p className="mt-3 rounded-md border bg-card p-3 text-sm">
            Assignment lines are identical in GLEISE_WGS and GLEISE_LV95 (verified by hash during import), so they are stored once and shown here from GLEISE_WGS. Only the coordinate (k) lines differ.
          </p>
        ) : null}
        <div className="mt-4">
          {view === "assign" ? (
            assigns.length === 0 ? (
              <EmptyState title="No assignments match" />
            ) : (
              <>
                <RecordTable
                  rows={assigns.map((a) => ({
                    n: a.n,
                    fields: [
                      { label: "Stop", value: `${String(a.stop).padStart(7, "0")} ${names.get(a.stop) ?? ""}`, link: { kind: "station", id: String(a.stop) }, mono: true },
                      { label: "Journey nr", value: String(a.nr), link: { kind: "journey", id: String(a.nr), extra: a.admin }, mono: true },
                      { label: "Admin", value: a.admin, link: { kind: "admin", id: a.admin }, mono: true },
                      { label: "Track ref", value: a.ref, mono: true },
                      { label: "Time", value: a.time !== null ? minutesToTime(a.time) : "—", mono: true },
                      { label: "Bitfield", value: a.bitfield ? String(a.bitfield) : "—", link: a.bitfield ? { kind: "bitfield", id: String(a.bitfield) } : undefined, mono: true },
                    ],
                  }))}
                />
                <Pager offset={offset} limit={LIMIT} total={null} count={assigns.length} hrefFor={(o) => `/files/${name}${qs({ ...base, offset: o || undefined })}`} />
              </>
            )
          ) : defs.length === 0 ? (
            <EmptyState title="No track definitions match" />
          ) : (
            <>
              <RecordTable
                rows={defs.map((d) => ({
                  n: d.n,
                  fields: decodeLine("GLEISE", `${String(d.stop).padStart(7, "0")} ${d.ref} ${d.kind} ${d.value}`).fields.map((f) =>
                    f.label === "Stop" ? { ...f, value: `${f.value} ${names.get(d.stop) ?? ""}` } : f,
                  ),
                  raw: `${String(d.stop).padStart(7, "0")} ${d.ref} ${d.kind} ${d.value}`,
                }))}
              />
              <Pager offset={offset} limit={LIMIT} total={null} count={defs.length} hrefFor={(o) => `/files/${name}${qs({ ...base, offset: o || undefined })}`} />
            </>
          )}
        </div>
      </div>
    );
  }

  const key = get("key") || undefined;
  const station = get("station");
  const bitfield = get("bitfield");
  const lineN = Number(get("line")) || 0;
  if (lineN && !get("offset")) offset = Math.floor(lineOffset(name, lineN) / LIMIT) * LIMIT;
  const ref = station ? { kind: "station", id: String(Number(station)) } : bitfield ? { kind: "bitfield", id: String(Number(bitfield)) } : undefined;
  const { rows, total } = browseLines(name, q, offset, LIMIT, key, ref);
  const base = { q, key, station, bitfield };
  return (
    <div>
      {header}
      <form className="mt-6 flex flex-wrap items-end gap-2">
        <FilterInput name="q" label="Text contains" defaultValue={q} placeholder="any substring of the raw line" className="min-w-[220px] flex-1" />
        <FilterInput name="key" label="Key (first column)" defaultValue={key ?? ""} placeholder="e.g. 8507000" className="w-40" />
        <FilterInput name="station" label="Mentions stop" defaultValue={station} placeholder="8507000" className="w-36" />
        <FilterInput name="line" label="Jump to line" defaultValue={lineN ? String(lineN) : ""} className="w-28" />
        <SubmitButton>Filter</SubmitButton>
      </form>
      <div className="mt-4">
        {rows.length === 0 ? (
          <EmptyState title="No lines match" icon={<FileSearch className="size-6" />}>
            The search is a plain substring match on the raw line (case-sensitive for non-ASCII).
          </EmptyState>
        ) : (
          <>
            <RecordTable
              rows={rows.map((r) => {
                const d = decodeLine(name, r.text, r.section);
                return { n: r.n, fields: d.fields, raw: r.text, kind: d.kind, href: `/files/${name}${qs({ line: r.n })}` };
              })}
            />
            <Pager offset={offset} limit={LIMIT} total={total} count={rows.length} hrefFor={(o) => `/files/${name}${qs({ ...base, offset: o || undefined })}`} />
          </>
        )}
      </div>
    </div>
  );
}
