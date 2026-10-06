import { redirect } from "next/navigation";
import { hasDb } from "@/lib/db";
import { searchStations } from "@/lib/hrdf/queries";
import { NoData } from "@/components/page";

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  if (!hasDb()) return <NoData />;
  const q = String((await searchParams).q ?? "").trim();
  if (!q) redirect("/stations");
  // "IC 2577", "2577", "#2577" → journeys; 7-digit numbers / names → stations.
  const m = q.match(/^([A-Za-z]{1,3})\s*#?(\d{1,6})$/);
  if (m) redirect(`/journeys?category=${m[1].toUpperCase()}&nr=${m[2]}`);
  const m2 = q.match(/^(?:#|nr\s*|zug\s*)(\d{1,6})$/i);
  if (m2) redirect(`/journeys?nr=${m2[1]}`);
  if (/^\d{1,6}$/.test(q)) redirect(`/journeys?nr=${q}`);
  if (/^\d{7}$/.test(q)) redirect(`/stations/${Number(q)}`);
  const hits = searchStations(q, 2);
  if (hits.length === 1) redirect(`/stations/${hits[0].id}`);
  redirect(`/stations?q=${encodeURIComponent(q)}`);
}
