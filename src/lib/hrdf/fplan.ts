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
  bitfield: number | null;
  ref: string | null;
  fields: Record<string, string>;
  comment: string | null;
}

const col = (l: string, from: number, to: number) => l.slice(from - 1, to).trim();

export function numOrNull(s: string): number | null {
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
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
    bitfield: null,
    ref: null,
    fields: {},
    comment,
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
      return { ...base, code: f.category, fromStop: numOrNull(f.fromStop), toStop: numOrNull(f.toStop), fields: f };
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
        fromStop: numOrNull(f.fromStop),
        toStop: numOrNull(f.toStop),
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
        fromStop: numOrNull(f.fromStop),
        toStop: numOrNull(f.toStop),
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
        fromStop: numOrNull(f.fromStop),
        toStop: numOrNull(f.toStop),
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
        fromStop: numOrNull(f.fromStop),
        toStop: numOrNull(f.toStop),
        fields: f,
      };
    }
    case "*CI":
    case "*CO": {
      const f = {
        minutes: col(l, 5, 8),
        fromStop: col(l, 10, 16),
        toStop: col(l, 18, 24),
      };
      return { ...base, code: type.slice(1), fromStop: numOrNull(f.fromStop), toStop: numOrNull(f.toStop), fields: f };
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
        journeyNumber: col(l, 44, 48),
        administration: col(l, 50, 55),
        flag: col(l, 57, 57),
      };
      return { ...base, fromStop: numOrNull(f.stop), fields: f };
    }
    default:
      return { ...base, code: l.split(/\s+/)[0] ?? null, fields: { content: l } };
  }
}
