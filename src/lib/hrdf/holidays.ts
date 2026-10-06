import "server-only";
import { db } from "@/lib/db";

const g = globalThis as unknown as { __hrdfHolidays?: Set<string> };

/** FEIERTAG dates as ISO strings. */
export function holidays(): Set<string> {
  if (g.__hrdfHolidays) return g.__hrdfHolidays;
  const out = new Set<string>();
  for (const r of db().prepare("SELECT text FROM lines WHERE file = 'FEIERTAG'").all() as { text: string }[]) {
    const m = r.text.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
    if (m) out.add(`${m[3]}-${m[2]}-${m[1]}`);
  }
  g.__hrdfHolidays = out;
  return out;
}
