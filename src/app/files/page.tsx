import Link from "next/link";
import type { Metadata } from "next";
import { hasDb } from "@/lib/db";
import { overview } from "@/lib/hrdf/queries";
import { baseName, describeFile, fileLanguage, hasDecoder } from "@/lib/hrdf/decoders";
import { NoData, PageHeader } from "@/components/page";

export const metadata: Metadata = { title: "Files" };

const GROUPS: { title: string; files: string[] }[] = [
  { title: "Timetable core", files: ["ECKDATEN", "FPLAN", "BITFELD", "BITFIELD", "FEIERTAG", "ZEITVS"] },
  { title: "Stops", files: ["BAHNHOF", "BFKOORD", "BFPRIOS", "KMINFO", "BHFART", "METABHF", "GLEISE", "GLEIS"] },
  { title: "Transfers & through-services", files: ["UMSTEIGB", "UMSTEIGV", "UMSTEIGL", "UMSTEIGZ", "DURCHBI"] },
  { title: "Reference data", files: ["ZUGART", "LINIE", "BETRIEB", "ATTRIBUT", "RICHTUNG", "INFOTEXT"] },
];

export default async function FilesPage() {
  if (!hasDb()) return <NoData />;
  const o = overview();
  const known = new Set(GROUPS.flatMap((g) => g.files));
  const groups = [...GROUPS.map((g) => ({ ...g, rows: o.files.filter((f) => g.files.includes(baseName(f.name))) })), { title: "Other / unrecognised", files: [], rows: o.files.filter((f) => !known.has(baseName(f.name))) }].filter((g) => g.rows.length);
  return (
    <div>
      <PageHeader eyebrow={`${o.files.length} files · ${(o.files.reduce((a, f) => a + f.size, 0) / 1e9).toFixed(2)} GB uncompressed`} title="Every file in the export">
        Each file opens a searchable, paginated record view with decoded fields and links to stations, journeys and bitfields. Files without a dedicated decoder get a generic tokenised view.
      </PageHeader>
      {groups.map((g) => (
        <section key={g.title} className="mt-8">
          <h2 className="mb-3 border-b border-foreground pb-2 text-[13px] font-bold tracking-[0.08em] uppercase">{g.title}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.rows.map((f) => (
              <Link key={f.name} href={`/files/${f.name}`} className="group rounded-md border bg-card p-4 transition-colors hover:border-foreground">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-mono text-[15px] font-bold group-hover:text-primary">{f.name}</span>
                  <span className="flex gap-1">
                    {fileLanguage(f.name) ? <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px]">{fileLanguage(f.name)}</span> : null}
                    {!hasDecoder(f.name) ? <span className="rounded-sm bg-board-accent px-1.5 py-0.5 font-mono text-[10px] text-black">generic</span> : null}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{describeFile(f.name)}</p>
                <div className="mt-3 flex gap-4 font-mono text-[11px] text-muted-foreground tabular">
                  <span>{f.lines.toLocaleString()} lines</span>
                  <span>{f.size >= 1e6 ? `${(f.size / 1e6).toFixed(1)} MB` : `${(f.size / 1e3).toFixed(1)} kB`}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
