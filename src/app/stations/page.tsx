import Link from "next/link";
import type { Metadata } from "next";
import { MapPin } from "lucide-react";
import { hasDb } from "@/lib/db";
import { searchStations } from "@/lib/hrdf/queries";
import { EmptyState, FilterInput, NoData, PageHeader, SubmitButton } from "@/components/page";

export const metadata: Metadata = { title: "Stations" };

export default async function StationsPage({ searchParams }: PageProps<"/stations">) {
  if (!hasDb()) return <NoData />;
  const q = String((await searchParams).q ?? "");
  const rows = searchStations(q, 150);
  return (
    <div>
      <PageHeader eyebrow="BAHNHOF · BFKOORD · BHFART" title="Stations & stops">
        Search by name, synonym, abbreviation, DIDOK / BPUIC number or SLOID. Results are ranked by number of stop events in FPLAN.
      </PageHeader>
      <form className="mt-6 flex max-w-2xl gap-2">
        <FilterInput name="q" label="Name or number" defaultValue={q} placeholder="e.g. Lausanne, 8501120, ZUE, ch:1:sloid:3000" className="flex-1" />
        <SubmitButton>Search</SubmitButton>
      </form>
      <div className="mt-6">
        {rows.length === 0 ? (
          <EmptyState title={`No stop matches “${q}”`} icon={<MapPin className="size-6" />}>
            Try a shorter name, drop accents, or search the 7-digit number (e.g. 8507000 for Bern).
          </EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b bg-paper text-left">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-mono [&>th]:text-[10.5px] [&>th]:font-medium [&>th]:tracking-wider [&>th]:text-muted-foreground [&>th]:uppercase">
                  <th>Number</th>
                  <th>Name</th>
                  <th className="hidden md:table-cell">Abbr.</th>
                  <th className="hidden lg:table-cell">SLOID</th>
                  <th className="hidden sm:table-cell">Country</th>
                  <th className="hidden md:table-cell">WGS84</th>
                  <th className="text-right">Stop events</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((s) => (
                  <tr key={s.id} className="hover:bg-paper [&>td]:px-3 [&>td]:py-2">
                    <td className="font-mono text-[12.5px]">
                      <Link href={`/stations/${s.id}`} className="link-u">
                        {String(s.id).padStart(7, "0")}
                      </Link>
                    </td>
                    <td>
                      <Link href={`/stations/${s.id}`} className="font-semibold hover:text-primary">
                        {s.name}
                      </Link>
                      {s.long_name && s.long_name !== s.name ? <span className="ml-2 text-xs text-muted-foreground">{s.long_name}</span> : null}
                    </td>
                    <td className="hidden font-mono text-xs md:table-cell">{s.abbr ?? "—"}</td>
                    <td className="hidden font-mono text-xs text-muted-foreground lg:table-cell">{s.sloid ?? "—"}</td>
                    <td className="hidden font-mono text-xs sm:table-cell">{s.country ?? "—"}</td>
                    <td className="hidden font-mono text-xs text-muted-foreground md:table-cell">{s.lat !== null ? `${s.lat?.toFixed(5)}, ${s.lon?.toFixed(5)}` : "—"}</td>
                    <td className="text-right font-mono text-xs tabular">{s.stop_events.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
