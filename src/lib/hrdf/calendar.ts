/**
 * Bitfield decoding. HRDF bitfields are hex strings; each hex digit holds 4
 * days, most significant bit first. The first two bits are padding, so bit 2
 * corresponds to the first day in ECKDATEN.
 */

export const BITFIELD_PADDING_BITS = 2;

export function parseHrdfDate(s: string): Date {
  const [d, m, y] = s.split(".").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function fromIsoDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

export function dayIndex(start: Date, date: Date): number {
  return Math.round((date.getTime() - start.getTime()) / 86400000);
}

export function decodeBits(hex: string): number[] {
  const bits: number[] = [];
  for (const ch of hex) {
    const v = parseInt(ch, 16);
    for (let b = 3; b >= 0; b--) bits.push((v >> b) & 1);
  }
  return bits;
}

/** Operating days (true = runs) for each day of the timetable period. */
export function bitfieldDays(hex: string, nDays: number): boolean[] {
  const bits = decodeBits(hex);
  return Array.from({ length: nDays }, (_, i) => bits[i + BITFIELD_PADDING_BITS] === 1);
}

export interface Period {
  start: Date;
  end: Date;
  days: number;
}

export function formatDate(d: Date, opts: Intl.DateTimeFormatOptions = {}): string {
  return d.toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric", ...opts });
}

export function defaultDate(period: Period): Date {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (today >= period.start && today <= period.end) return today;
  // Before/after the period: first Monday of the timetable for a representative weekday.
  let d = period.start;
  while (d.getUTCDay() !== 1) d = addDays(d, 1);
  return d;
}

export function minutesToTime(min: number | null | undefined): string {
  if (min === null || min === undefined) return "";
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function dayOffset(min: number | null | undefined): number {
  if (min === null || min === undefined) return 0;
  return Math.floor(min / 1440);
}

export function parseTimeInput(s: string | undefined, fallback: number): number {
  if (!s) return fallback;
  const m = s.match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return fallback;
  return Math.min(Number(m[1]) * 60 + Number(m[2]), 47 * 60 + 59);
}
