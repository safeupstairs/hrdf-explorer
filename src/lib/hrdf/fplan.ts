/**
 * Fixed-width parsing for HRDF 5.40 FPLAN lines. Column positions are
 * character based (the files are UTF-8, umlauts count as one column).
 */

export type FplanLineType =
  | "*Z"
  | "*G"
  | "*A"
  | "*I"
  | "*L"
  | "*R"
  | "*CI"
  | "*CO"
  | "*GR"
  | "*SH"
  | "*T"
  | "stop"
  | "other";

export interface ParsedFplanLine {
  type: FplanLineType;
  code: string | null;
  fromStop: number | null;
  toStop: number | null;
  fromIndex: number | null;
  toIndex: number | null;
  bitfield: number | null;
  ref: string | null;
  fields: Record<string, string>;
  comment: string | null;
}

export interface RouteStop {
  stop: number;
  arr: number | null;
  dep: number | null;
}

const col = (l: string, from: number, to: number) => l.slice(from - 1, to).trim();

export function numOrNull(s: string): number | null {
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Stop field: empty, a 7-digit stop number, or `#n` 0-based route index (H §7.1.1). */
export function parseStopField(s: string): { stop: number | null; index: number | null } {
  if (!s) return { stop: null, index: null };
  if (s.startsWith("#")) {
    const index = Number(s.slice(1));
    return { stop: null, index: Number.isFinite(index) ? index : null };
  }
  return { stop: numOrNull(s), index: null };
}

/** HRDF time "HHHMM" (optionally prefixed with "-") → minutes after midnight of the operating day. */
export function parseHrdfTime(raw: string): { minutes: number | null; negative: boolean } {
  const s = raw.trim();
  if (!s) return { minutes: null, negative: false };
  const negative = s.startsWith("-");
  const digits = negative ? s.slice(1) : s;
  if (!/^\d{3,5}$/.test(digits)) return { minutes: null, negative };
  const h = Number(digits.slice(0, -2));
  const m = Number(digits.slice(-2));
  return { minutes: h * 60 + m, negative };
}

export function splitComment(line: string): { body: string; comment: string | null } {
  const i = line.indexOf("%");
  if (i < 0) return { body: line.trimEnd(), comment: null };
  const comment = line.slice(i + 1).trim();
  return { body: line.slice(0, i).trimEnd(), comment: comment || null };
}

export function fplanLineType(line: string): FplanLineType {
  if (line.startsWith("*")) {
    const t = line.slice(0, 3).trimEnd();
    if (t === "*CI" || t === "*CO" || t === "*GR" || t === "*SH") return t;
    const t2 = line.slice(0, 2);
    if (["*Z", "*G", "*A", "*I", "*L", "*R", "*T"].includes(t2)) return t2 as FplanLineType;
    return "other";
  }
  if (/^\d{7} /.test(line)) return "stop";
  return "other";
}

export function parseFplanLine(line: string): ParsedFplanLine {
  const { body: l, comment } = splitComment(line);
  const type = fplanLineType(line);
  const base: ParsedFplanLine = {
    type,
    code: null,
    fromStop: null,
    toStop: null,
    fromIndex: null,
    toIndex: null,
    bitfield: null,
    ref: null,
    fields: {},
    comment,
  };
  const range = (from: string, to: string) => {
    const a = parseStopField(from);
    const b = parseStopField(to);
    return { fromStop: a.stop, toStop: b.stop, fromIndex: a.index, toIndex: b.index };
  };
  switch (type) {
    case "*Z": {
      const f = {
        journeyNumber: col(l, 4, 9),
        administration: col(l, 11, 16),
        variant: col(l, 20, 22),
        cycleCount: col(l, 24, 26),
        cycleMinutes: col(l, 28, 30),
      };
      return { ...base, code: f.administration, ref: f.journeyNumber, fields: f };
    }
    case "*G": {
      const f = {
        category: col(l, 4, 6),
        fromStop: col(l, 8, 14),
        toStop: col(l, 16, 22),
        depTime: col(l, 24, 29),
        arrTime: col(l, 31, 36),
      };
      return { ...base, code: f.category, ...range(f.fromStop, f.toStop), fields: f };
    }
    case "*A": {
      const f = {
        attribute: col(l, 4, 5),
        fromStop: col(l, 7, 13),
        toStop: col(l, 15, 21),
        bitfield: col(l, 23, 28),
        depTime: col(l, 30, 35),
        arrTime: col(l, 37, 42),
      };
      return {
        ...base,
        code: f.attribute,
        ...range(f.fromStop, f.toStop),
        bitfield: numOrNull(f.bitfield),
        fields: f,
      };
    }
    case "*I": {
      const f = {
        infoCode: col(l, 4, 5),
        fromStop: col(l, 7, 13),
        toStop: col(l, 15, 21),
        bitfield: col(l, 23, 28),
        infotext: col(l, 30, 38),
        depTime: col(l, 40, 45),
        arrTime: col(l, 47, 52),
      };
      return {
        ...base,
        code: f.infoCode,
        ...range(f.fromStop, f.toStop),
        bitfield: numOrNull(f.bitfield),
        ref: f.infotext || null,
        fields: f,
      };
    }
    case "*L": {
      const f = {
        line: col(l, 4, 11),
        fromStop: col(l, 13, 19),
        toStop: col(l, 21, 27),
        depTime: col(l, 29, 34),
        arrTime: col(l, 36, 41),
      };
      return {
        ...base,
        code: f.line.startsWith("#") ? "#" : "literal",
        ref: f.line,
        ...range(f.fromStop, f.toStop),
        fields: f,
      };
    }
    case "*R": {
      const f = {
        direction: col(l, 4, 4),
        directionCode: col(l, 6, 12),
        fromStop: col(l, 14, 20),
        toStop: col(l, 22, 28),
        depTime: col(l, 30, 35),
        arrTime: col(l, 37, 42),
      };
      return {
        ...base,
        code: f.direction,
        ref: f.directionCode || null,
        ...range(f.fromStop, f.toStop),
        fields: f,
      };
    }
    case "*CI":
    case "*CO": {
      const f = {
        minutes: col(l, 5, 8),
        fromStop: col(l, 10, 16),
        toStop: col(l, 18, 24),
        depTime: col(l, 26, 31),
        arrTime: col(l, 33, 38),
        role: type === "*CO" ? "Line buffer (not shown to passengers)" : "Check-in time",
      };
      return { ...base, code: type.slice(1), ...range(f.fromStop, f.toStop), fields: f };
    }
    case "*GR": {
      const f = {
        borderPoint: col(l, 5, 11),
        lastStopBefore: col(l, 13, 19),
        firstStopAfter: col(l, 21, 27),
        depLastStop: col(l, 29, 34),
        arrFirstStop: col(l, 36, 41),
      };
      return { ...base, code: "GR", fromStop: numOrNull(f.lastStopBefore), toStop: numOrNull(f.firstStopAfter), fields: f };
    }
    case "*SH": {
      const f = { stop: col(l, 5, 11), bitfield: col(l, 13, 18), depTime: col(l, 20, 25) };
      return { ...base, code: "SH", fromStop: numOrNull(f.stop), bitfield: numOrNull(f.bitfield), fields: f };
    }
    case "stop": {
      const arr = col(l, 30, 35);
      const dep = col(l, 37, 42);
      const f = {
        stop: col(l, 1, 7),
        name: col(l, 9, 29),
        arrTime: arr,
        depTime: dep,
        journeyNumber: col(l, 44, 49),
        administration: col(l, 51, 56),
        flag: col(l, 58, 58),
      };
      return { ...base, fromStop: numOrNull(f.stop), fields: f };
    }
    default:
      return { ...base, code: l.split(/\s+/)[0] ?? null, fields: { content: l } };
  }
}

/** Format a raw FPLAN time/occurrence field (`00706`, `-01933`, `#2`) for display. */
export function formatHrdfTimeField(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  if (s.startsWith("#")) return `occurrence ${s.slice(1)}`;
  const { minutes, negative } = parseHrdfTime(s);
  if (minutes === null) return s;
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const day = Math.floor(minutes / 1440);
  return `${negative ? "−" : ""}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}${day ? ` +${day}` : ""}`;
}

function resolveEnd(stops: RouteStop[], field: string, timeField: string, end: "from" | "to"): number {
  if (!stops.length) return -1;
  if (!field) return end === "from" ? 0 : stops.length - 1;
  if (field.startsWith("#")) {
    const idx = Number(field.slice(1));
    if (!Number.isFinite(idx)) return -1;
    return Math.max(0, Math.min(idx, stops.length - 1));
  }
  const stop = Number(field);
  if (!Number.isFinite(stop)) return -1;
  const candidates: number[] = [];
  for (let i = 0; i < stops.length; i++) if (stops[i].stop === stop) candidates.push(i);
  if (!candidates.length) return -1;
  if (timeField.startsWith("#")) {
    const occ = Number(timeField.slice(1));
    return candidates[occ] ?? -1;
  }
  if (timeField) {
    const t = parseHrdfTime(timeField).minutes;
    if (t !== null) {
      const match = candidates.find((i) => (end === "from" ? stops[i].dep : stops[i].arr) === t);
      if (match !== undefined) return match;
    }
  }
  return end === "from" ? candidates[0] : candidates[candidates.length - 1];
}

/**
 * H §7.1.1 range: empty = first/last stop, `#n` = 0-based route index,
 * from-stop searched from the front, to-stop from the back, times / `#n`
 * occurrence columns disambiguate loops.
 */
export function resolveRange(
  stops: RouteStop[],
  fromField: string,
  toField: string,
  fromTime = "",
  toTime = "",
): { fromIndex: number; toIndex: number } {
  return {
    fromIndex: resolveEnd(stops, fromField, fromTime, "from"),
    toIndex: resolveEnd(stops, toField, toTime, "to"),
  };
}

/**
 * Operating-day bitfield at a stop for multi-section *A VE. Both VE ranges
 * include the boundary stop; a departure belongs to the section that starts
 * there, an arrival to the section that ends there (H §7.1.3).
 */
export function veBitfieldAtStop(
  ves: { fromIndex: number; toIndex: number; bitfield: number | null }[],
  stopIndex: number,
  mode: "dep" | "arr",
  fallback: number | null,
): number | null {
  const preferred = mode === "dep" ? ves.find((v) => v.fromIndex === stopIndex) : ves.find((v) => v.toIndex === stopIndex);
  if (preferred) return preferred.bitfield;
  const cover = ves.find((v) => stopIndex >= v.fromIndex && stopIndex <= v.toIndex);
  return cover ? cover.bitfield : fallback;
}
