import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { hasDb, db } from "@/lib/db";
import { cache, categoryFor, lineInfo } from "@/lib/hrdf/lookups";
import { infotextAll, searchJourneys } from "@/lib/hrdf/queries";
import { decodeLine } from "@/lib/hrdf/decoders";
import { minutesToTime } from "@/lib/hrdf/calendar";
import { CategoryBadge, classColor } from "@/components/hrdf/category-badge";
import { DecodedInline } from "@/components/hrdf/decoded-fields";
import { NoData, PageHeader, Section, Stat } from "@/components/page";

const TITLES: Record<string, string> = {
  admin: "Administration / operator",
  category: "Category (Gattung)",
  line: "Line",
  attribute: "Attribute",
  direction: "Direction",
  infotext: "Info text",
};

export async function generateMetadata({ params }: PageProps<"/ref/[kind]/[id]">): Promise<Metadata> {
  const p = await params;
  return { title: `${TITLES[p.kind] ?? p.kind} ${decodeURIComponent(p.id)}` };
}

function RecordList({ file, rows }: { file: string; rows: { n: number; text: string; section: string | null }[] }) {
  if (!rows.length) return null;
  return (
    <div className="divide-y rounded-md border bg-card">
      {rows.map((r) => (
        <div key={`${file}${r.n}`} className="grid gap-1 px-3 py-2 md:grid-cols-[150px_minmax(0,1fr)]">
          <Link href={`/files/${file}?line=${r.n}`} className="font-mono text-[11px] text-muted-foreground hover:text-primary">
            {file} #{r.n}
          </Link>
          <div className="min-w-0">
            <DecodedInline fields={decodeLine(file, r.text, r.section).fields} />
            <div className="raw mt-1 overflow-x-auto text-muted-foreground">{r.text}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function JourneyList({ filter, label }: { filter: Parameters<typeof searchJourneys>[0]; label: string }) {
  const res = searchJourneys(filter, 20);
  const q = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <Section title={label} aside={<Link className="link-u" href={`/journeys?${q}`}>All {res.total.toLocaleString()}</Link>}>
      {res.rows.length ? (
        <div className="divide-y rounded-md border bg-card">
          {res.rows.map((r) => (
            <Link key={r.id} href={`/journeys/${r.id}`} className="grid grid-cols-[56px_120px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-sm hover:bg-paper">
              <span className="font-mono tabular">{minutesToTime(r.dep)}</span>
              <CategoryBadge category={r.category} line={r.line} productClass={categoryFor(r.category)?.productClass} lineBg={lineInfo(r.line_ref)?.bg} lineFg={lineInfo(r.line_ref)?.fg} size="sm" />
              <span className="truncate">
                {r.fromName} → {r.toName}
              </span>
              <span className="font-mono text-xs text-muted-foreground">{r.nr}</span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No journeys.</p>
      )}
    </Section>
  );
}

export default async function RefPage({ params }: PageProps<"/ref/[kind]/[id]">) {
  if (!hasDb()) return <NoData />;
  const p = await params;
  const kind = p.kind;
  const id = decodeURIComponent(p.id);
  if (!TITLES[kind]) notFound();
  const d = db();
  const c = cache();
  const fileRows = (fileLike: string, key: string) => d.prepare("SELECT file, n, text, section FROM lines WHERE file LIKE ? AND key = ? ORDER BY file, n").all(fileLike, key) as { file: string; n: number; text: string; section: string | null }[];
  const byFile = (rows: { file: string; n: number; text: string; section: string | null }[]) => {
    const m = new Map<string, typeof rows>();
    for (const r of rows) m.set(r.file, [...(m.get(r.file) ?? []), r]);
    return [...m.entries()];
  };
  const jlineCount = (type: string, col: "code" | "ref", v: string) => (d.prepare(`SELECT COUNT(*) n FROM jlines WHERE type = ? AND ${col} = ?`).get(type, v) as { n: number }).n;

  if (kind === "admin") {
    const admin = id.padStart(6, "0");
    const op = c.operatorsByAdmin.get(admin);
    const rows = op ? fileRows("BETRIEB%", String(Number(op.key))) : [];
    const cats = d.prepare("SELECT category, COUNT(*) n FROM journeys WHERE admin = ? GROUP BY category ORDER BY n DESC").all(admin) as { category: string; n: number }[];
    return (
      <div>
        <PageHeader eyebrow={`${TITLES.admin} · BETRIEB`} title={op?.name ?? `Administration ${admin}`}>
          <span className="font-mono">{admin}</span>
          {op ? <span> · {op.abbr} · operator key {op.key} · {op.sboid}</span> : <span> · not listed in BETRIEB</span>}
          {op && op.admins.length > 1 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              Also:{" "}
              {op.admins.filter((a) => a !== admin).map((a) => (
                <Link key={a} href={`/ref/admin/${a}`} className="link-u font-mono text-xs">
                  {a}
                </Link>
              ))}
            </div>
          ) : null}
        </PageHeader>
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-6">
          {cats.slice(0, 12).map((x) => (
            <Stat key={x.category} label={`${x.category} · ${categoryFor(x.category)?.label ?? ""}`} value={x.n.toLocaleString()} href={`/journeys?admin=${admin}&category=${x.category}`} />
          ))}
        </div>
        {byFile(rows).map(([f, r]) => (
          <Section key={f} title={f}>
            <RecordList file={f} rows={r} />
          </Section>
        ))}
        <JourneyList filter={{ admin }} label="Journeys" />
      </div>
    );
  }

  if (kind === "category") {
    const cat = categoryFor(id);
    const rows = fileRows("ZUGART", id);
    const col = classColor(cat?.productClass);
    return (
      <div>
        <PageHeader eyebrow={`${TITLES.category} · ZUGART`} title={<span className="flex items-center gap-3"><CategoryBadge category={id} productClass={cat?.productClass} size="lg" /> {cat?.label ?? id}</span>}>
          Product class {cat?.productClass ?? "?"}: {cat?.classLabel ?? col.label} · display name “{cat?.displayName}”
        </PageHeader>
        <Section title="ZUGART records">
          <RecordList file="ZUGART" rows={rows} />
        </Section>
        <JourneyList filter={{ category: id }} label="Journeys" />
      </div>
    );
  }

  if (kind === "line") {
    const li = lineInfo(Number(id));
    const rows = fileRows("LINIE", String(Number(id)));
    return (
      <div>
        <PageHeader eyebrow={`${TITLES.line} · LINIE #${id.padStart(7, "0")}`} title={<span className="flex items-center gap-3">{li?.bg ? <span className="rounded px-3 py-1" style={{ background: li.bg, color: li.fg ?? "#fff" }}>{li.name}</span> : li?.name ?? id}{li?.description ? <span className="text-muted-foreground">{li.description}</span> : null}</span>}>
          {li?.slnid}
        </PageHeader>
        <Section title="LINIE records">
          <RecordList file="LINIE" rows={rows} />
        </Section>
        <JourneyList filter={{ lineRef: String(Number(id)) }} label="Journeys referencing this line (*L #ref)" />
      </div>
    );
  }

  if (kind === "attribute") {
    const rows = fileRows("ATTRIBUT%", id);
    const n = jlineCount("*A", "code", id);
    return (
      <div>
        <PageHeader eyebrow={`${TITLES.attribute} · ATTRIBUT`} title={<span><span className="font-mono">{id}</span> · {c.attributes.get(id) ?? "Unknown attribute"}</span>}>
          Used in <Link className="link-u" href={`/files/FPLAN?type=*A&code=${encodeURIComponent(id)}`}>{n.toLocaleString()} FPLAN *A lines</Link>
        </PageHeader>
        {byFile(rows).map(([f, r]) => (
          <Section key={f} title={f}>
            <RecordList file={f} rows={r} />
          </Section>
        ))}
      </div>
    );
  }

  if (kind === "direction") {
    const rows = fileRows("RICHTUNG", id);
    return (
      <div>
        <PageHeader eyebrow={`${TITLES.direction} · RICHTUNG`} title={c.directions.get(id) ?? id}>
          <span className="font-mono">{id}</span>
        </PageHeader>
        <Section title="RICHTUNG records">
          <RecordList file="RICHTUNG" rows={rows} />
        </Section>
        <JourneyList filter={{ dir: id }} label="Journeys with this direction (*R)" />
      </div>
    );
  }

  // infotext
  const nr = String(Number(id));
  const texts = infotextAll(Number(id));
  const padded = id.padStart(9, "0");
  const usage = d.prepare("SELECT code, COUNT(*) n FROM jlines WHERE type = '*I' AND ref = ? GROUP BY code").all(padded) as { code: string; n: number }[];
  const sample = d.prepare("SELECT journey FROM jlines WHERE type = '*I' AND ref = ? LIMIT 20").all(padded) as { journey: number }[];
  const other = d.prepare("SELECT l.file, l.n, l.text, l.section FROM refs r JOIN lines l ON l.file = r.file AND l.n = r.n WHERE r.kind = 'infotext' AND r.ref = ? AND r.file NOT LIKE 'INFOTEXT%' LIMIT 50").all(nr) as { file: string; n: number; text: string; section: string | null }[];
  return (
    <div>
      <PageHeader eyebrow={`${TITLES.infotext} · INFOTEXT`} title={texts[0]?.text.slice(10).trim() || `Info text ${id}`}>
        <span className="font-mono">{padded}</span>
        {usage.length ? (
          <span>
            {" "}· used by{" "}
            {usage.map((u) => (
              <Link key={u.code} className="link-u" href={`/files/FPLAN?type=*I&code=${u.code}&q=${padded}`}>
                {u.n.toLocaleString()} *I {u.code}
              </Link>
            ))}
          </span>
        ) : null}
      </PageHeader>
      <Section title="All languages">
        <div className="divide-y rounded-md border bg-card">
          {texts.map((t) => (
            <div key={t.file} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 px-3 py-2 text-sm">
              <Link href={`/files/${t.file}?key=${nr}`} className="font-mono text-xs text-muted-foreground hover:text-primary">
                {t.file}
              </Link>
              <span className="break-words">{t.text.slice(10).trim()}</span>
            </div>
          ))}
        </div>
      </Section>
      {byFile(other).map(([f, r]) => (
        <Section key={f} title={`Referenced in ${f}`}>
          <RecordList file={f} rows={r} />
        </Section>
      ))}
      {sample.length ? (
        <Section title="Journeys referencing it">
          <div className="flex flex-wrap gap-2">
            {sample.map((s) => (
              <Link key={s.journey} href={`/journeys/${s.journey}?tab=records`} className="rounded border bg-card px-2 py-1 font-mono text-xs hover:border-foreground">
                #{s.journey}
              </Link>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
