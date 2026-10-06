import "server-only";
import { db } from "@/lib/db";
import { bitfieldDays, parseHrdfDate, type Period } from "./calendar";
import { quotedValues } from "./decoders";
import { parseFplanLine, resolveRange, veBitfieldAtStop, type RouteStop } from "./fplan";

export interface LineInfo {
  id: number;
  name?: string;
  longName?: string;
  description?: string;
  slnid?: string;
  fg?: string;
  bg?: string;
  /** LINIE type H: id of the main line this partial line belongs to. */
  mainLine?: number;
}

export interface AttrDef {
  code: string;
  /** 0 = section; 1 = boarding, 2 = alighting, 4 = intermediate (summable). */
  relevance: number;
  priority: number;
  sort: number;
  /** Code to output on a partial section (`--` = suppress). */
  partialOut: string | null;
  /** Code to output when the attribute covers the whole journey. */
  fullOut: string | null;
}

export interface VeRange {
  from: string;
  to: string;
  fromTime: string;
  toTime: string;
  bitfield: number | null;
}
export interface Operator {
  key: string;
  short?: string;
  abbr?: string;
  name?: string;
  sboid?: string;
  admins: string[];
}
export interface Category {
  code: string;
  productClass: number;
  displayName: string;
  label?: string;
  classLabel?: string;
}

interface Cache {
  period: Period;
  header: string;
  bitfields: Map<number, { hex: string; days: boolean[]; count: number }>;
  lines: Map<number, LineInfo>;
  operatorsByAdmin: Map<string, Operator>;
  operators: Operator[];
  categories: Map<string, Category>;
  attributes: Map<string, string>;
  directions: Map<string, string>;
  catByNo: Map<number, string>;
  /** Journeys with more than one *A VE line (operating days vary per section). */
  multiVe: Map<number, VeRange[]>;
  attrDefs: Map<string, AttrDef>;
}

const g = globalThis as unknown as { __hrdfCache?: Cache };

type Row = { text: string; section: string | null; file: string };

function rows(fileLike: string): Row[] {
  return db().prepare("SELECT file, text, section FROM lines WHERE file LIKE ? ORDER BY file, n").all(fileLike) as Row[];
}

function pickFile(prefix: string, prefer = ["_EN", "_DE", ""]): string | null {
  const files = (db().prepare("SELECT name FROM files WHERE name LIKE ?").all(`${prefix}%`) as { name: string }[]).map((f) => f.name);
  for (const p of prefer) {
    const f = files.find((x) => x === `${prefix}${p}`);
    if (f) return f;
  }
  return files[0] ?? null;
}

export function cache(): Cache {
  if (g.__hrdfCache) return g.__hrdfCache;
  const d = db();
  const meta = Object.fromEntries((d.prepare("SELECT key, value FROM meta").all() as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  const start = parseHrdfDate(meta.start);
  const end = parseHrdfDate(meta.end);
  const period: Period = { start, end, days: Math.round((end.getTime() - start.getTime()) / 86400000) + 1 };

  const bitfields = new Map<number, { hex: string; days: boolean[]; count: number }>();
  for (const r of d.prepare("SELECT id, hex FROM bitfields").all() as { id: number; hex: string }[]) {
    const days = bitfieldDays(r.hex, period.days);
    bitfields.set(r.id, { hex: r.hex, days, count: days.filter(Boolean).length });
  }

  const lines = new Map<number, LineInfo>();
  for (const r of rows("LINIE")) {
    const id = Number(r.text.slice(0, 7));
    const type = r.text.charAt(8);
    const rest = r.text.slice(10).trim();
    const l = lines.get(id) ?? { id };
    const val = rest.replace(/^T\s+/, "");
    if (type === "K") l.slnid = rest;
    else if (type === "N") l.name = val;
    else if (type === "L") l.longName = val;
    else if (type === "D") l.description = val;
    else if (type === "F" || type === "B") {
      const [r0, g0, b0] = rest.split(/\s+/).map(Number);
      const css = `rgb(${r0} ${g0} ${b0})`;
      if (type === "F") l.fg = css;
      else l.bg = css;
    } else if (type === "H") {
      l.mainLine = Number(val || rest);
    }
    lines.set(id, l);
  }
  for (const l of lines.values()) {
    if (l.mainLine == null) continue;
    const main = lines.get(l.mainLine);
    if (!main) continue;
    l.name ??= main.name;
    l.longName ??= main.longName;
    l.description ??= main.description;
    l.slnid ??= main.slnid;
    l.fg ??= main.fg;
    l.bg ??= main.bg;
  }

  const operators = new Map<string, Operator>();
  const betrieb = pickFile("BETRIEB");
  if (betrieb) {
    for (const r of rows(betrieb)) {
      const key = r.text.slice(0, 5).trim();
      const rest = r.text.slice(6).trim();
      const op = operators.get(key) ?? { key, admins: [] };
      const v = quotedValues(rest);
      if (v.K !== undefined) Object.assign(op, { short: v.K, abbr: v.L, name: v.V });
      else if (rest.startsWith("N ")) op.sboid = rest.slice(1).trim().replace(/["']/g, "");
      else if (rest.startsWith(":")) op.admins.push(...rest.slice(1).trim().split(/\s+/));
      operators.set(key, op);
    }
  }
  const operatorsByAdmin = new Map<string, Operator>();
  for (const op of operators.values()) for (const a of op.admins) if (!operatorsByAdmin.has(a)) operatorsByAdmin.set(a, op);

  const categories = new Map<string, Category>();
  const classLabels = new Map<number, string>();
  const catLabels = new Map<number, string>();
  let catOrder = 0;
  const catByNo = new Map<number, string>();
  for (const r of rows("ZUGART")) {
    if (r.text.startsWith("*")) continue;
    if (!r.section) {
      const code = r.text.slice(0, 3).trim();
      const no = Number(r.text.slice(30, 34).replace("#", "")) || ++catOrder;
      categories.set(code, { code, productClass: Number(r.text.slice(4, 6)), displayName: r.text.slice(12, 20).trim() || code });
      catByNo.set(no, code);
      continue;
    }
    if (!/Englisch|eng/i.test(r.section)) continue;
    const m = r.text.match(/^(class|category)(\d+)\s+(.*)$/);
    if (m && m[1] === "class") classLabels.set(Number(m[2]), m[3]);
    if (m && m[1] === "category") catLabels.set(Number(m[2]), m[3]);
  }
  for (const [no, code] of catByNo) {
    const c = categories.get(code);
    if (c) c.label = catLabels.get(no);
  }
  for (const c of categories.values()) c.classLabel = classLabels.get(c.productClass);

  const attributes = new Map<string, string>();
  for (const r of rows("ATTRIBUT%")) {
    if (!r.section || !/eng/i.test(r.section)) continue;
    attributes.set(r.text.slice(0, 3).trim(), r.text.slice(4).trim());
  }
  if (!attributes.size) {
    for (const r of rows("ATTRIBUT%")) if (r.section && /deu/i.test(r.section)) attributes.set(r.text.slice(0, 3).trim(), r.text.slice(4).trim());
  }

  const directions = new Map<string, string>();
  for (const r of rows("RICHTUNG")) directions.set(r.text.slice(0, 7).trim(), r.text.slice(8).trim());

  g.__hrdfCache = {
    period,
    header: meta.header ?? "",
    bitfields,
    lines,
    operatorsByAdmin,
    operators: [...operators.values()],
    categories,
    attributes,
    directions,
    catByNo,
    multiVe: loadMultiVe(),
    attrDefs: loadAttrDefs(),
  };
  return g.__hrdfCache;
}

/** Whether a journey with this bitfield (null = daily) runs on day index i. */
export function runsOn(bitfield: number | null, i: number): boolean {
  const c = cache();
  if (i < 0 || i >= c.period.days) return false;
  if (bitfield === null || bitfield === 0) return true;
  const b = c.bitfields.get(bitfield);
  return b ? b.days[i] : false;
}

export function lineInfo(ref: number | null): LineInfo | null {
  if (ref === null) return null;
  return cache().lines.get(ref) ?? null;
}

export function operatorFor(admin: string): Operator | null {
  return cache().operatorsByAdmin.get(admin) ?? null;
}

export function categoryFor(code: string | null): Category | null {
  if (!code) return null;
  return cache().categories.get(code) ?? null;
}

function loadMultiVe() {
  const m = new Map<number, VeRange[]>();
  const rows = db()
    .prepare(
      `SELECT journey, bitfield, text FROM jlines WHERE type = '*A' AND code = 'VE' AND journey IN
         (SELECT journey FROM jlines WHERE type = '*A' AND code = 'VE' GROUP BY journey HAVING COUNT(*) > 1) ORDER BY journey, idx`,
    )
    .all() as { journey: number; bitfield: number | null; text: string }[];
  for (const r of rows) {
    const p = parseFplanLine(r.text);
    const ve: VeRange = {
      from: p.fields.fromStop ?? "",
      to: p.fields.toStop ?? "",
      fromTime: p.fields.depTime ?? "",
      toTime: p.fields.arrTime ?? "",
      bitfield: r.bitfield || null,
    };
    m.set(r.journey, [...(m.get(r.journey) ?? []), ve]);
  }
  return m;
}

function loadAttrDefs() {
  const defs = new Map<string, AttrDef>();
  for (const r of rows("ATTRIBUT%")) {
    if (r.section) continue;
    if (r.text.startsWith("#")) {
      const code = r.text.slice(2, 4).trim();
      const partial = r.text.slice(5, 7).trim();
      const full = r.text.slice(8, 10).trim();
      const d = defs.get(code) ?? { code, relevance: 0, priority: 999, sort: 99, partialOut: null, fullOut: null };
      d.partialOut = partial || null;
      d.fullOut = full || null;
      defs.set(code, d);
      continue;
    }
    if (r.text.startsWith("<") || !r.text.trim()) continue;
    const code = r.text.slice(0, 2).trim();
    if (!code) continue;
    const d = defs.get(code) ?? { code, relevance: 0, priority: 999, sort: 99, partialOut: null, fullOut: null };
    d.relevance = Number(r.text.slice(3, 4)) || 0;
    d.priority = Number(r.text.slice(5, 8)) || 0;
    d.sort = Number(r.text.slice(9, 11)) || 0;
    defs.set(code, d);
  }
  return defs;
}

/**
 * Resolves the operating-day bitfield that applies at a given stop for
 * journeys whose *A VE differs per section. A departure from a boundary stop
 * uses the section that starts there; an arrival uses the one that ends there.
 */
export function bitfieldAtStop(
  journey: number,
  stopIndex: number,
  stops: RouteStop[],
  fallback: number | null,
  mode: "dep" | "arr",
): number | null {
  const ves = cache().multiVe.get(journey);
  if (!ves) return fallback;
  const resolved = ves.map((v) => {
    const { fromIndex, toIndex } = resolveRange(stops, v.from, v.to, v.fromTime, v.toTime);
    return { fromIndex, toIndex, bitfield: v.bitfield };
  });
  return veBitfieldAtStop(resolved, stopIndex, mode, fallback);
}

function stopInAttrRange(i: number, a: number, b: number, relevance: number): boolean {
  if (i < a || i > b || a < 0 || b < 0) return false;
  if (relevance === 0 || a === b) return true;
  if (i === a) return (relevance & 1) !== 0;
  if (i === b) return (relevance & 2) !== 0;
  return (relevance & 4) !== 0;
}

/** Service attributes that apply at a stop on a given operating day (H §5.5.1). */
export function attributesForStop(
  lines: { code: string | null; bitfield: number | null; fields: Record<string, string> }[],
  stops: RouteStop[],
  stopIndex: number,
  day: number,
  labels: Map<string, string>,
): { code: string; text: string }[] {
  const defs = cache().attrDefs;
  const last = stops.length - 1;
  const seen = new Map<string, { code: string; text: string; priority: number; sort: number }>();
  for (const a of lines) {
    if (!a.code || a.code === "VE") continue;
    if (!runsOn(a.bitfield, day)) continue;
    const { fromIndex, toIndex } = resolveRange(stops, a.fields.fromStop ?? "", a.fields.toStop ?? "", a.fields.depTime ?? "", a.fields.arrTime ?? "");
    const def = defs.get(a.code);
    const rel = def?.relevance ?? 0;
    if (!stopInAttrRange(stopIndex, fromIndex, toIndex, rel)) continue;
    const full = fromIndex === 0 && toIndex === last;
    const mapped = def ? (full ? def.fullOut : def.partialOut) : null;
    if (mapped === "--") continue;
    const code = (mapped && mapped !== a.code ? mapped : a.code).trim();
    const entry = {
      code,
      text: labels.get(code) ?? labels.get(a.code) ?? code,
      priority: def?.priority ?? 999,
      sort: def?.sort ?? 99,
    };
    const prev = seen.get(code);
    if (!prev || entry.priority < prev.priority || (entry.priority === prev.priority && entry.sort < prev.sort)) seen.set(code, entry);
  }
  return [...seen.values()].sort((a, b) => a.priority - b.priority || a.sort - b.sort || a.code.localeCompare(b.code));
}

export type Lang = "DE" | "FR" | "IT" | "EN";
export const LANGS: Lang[] = ["DE", "FR", "IT", "EN"];
const ATTR_SECTION: Record<Lang, RegExp> = { DE: /^deu$/i, FR: /^fra$/i, IT: /^ita$/i, EN: /^eng$/i };
const ZUG_SECTION: Record<Lang, RegExp> = { DE: /^Deutsch$/i, FR: /^Franz/i, IT: /^Italien/i, EN: /^Englisch$/i };

interface Texts {
  attributes: Map<string, string>;
  catLabels: Map<string, string>;
  classLabels: Map<number, string>;
  operatorsByAdmin: Map<string, Operator>;
}

/** Language-dependent texts from ATTRIBUT, ZUGART and BETRIEB_xx. */
export function texts(lang: Lang): Texts {
  const store = globalThis as unknown as { __hrdfTexts?: Partial<Record<Lang, Texts>> };
  store.__hrdfTexts ??= {};
  const hit = store.__hrdfTexts[lang];
  if (hit) return hit;
  const c = cache();
  const attributes = new Map<string, string>();
  for (const r of rows("ATTRIBUT%")) if (r.section && ATTR_SECTION[lang].test(r.section)) attributes.set(r.text.slice(0, 3).trim(), r.text.slice(4).trim());
  const catLabels = new Map<string, string>();
  const classLabels = new Map<number, string>();
  for (const r of rows("ZUGART")) {
    if (!r.section || !ZUG_SECTION[lang].test(r.section)) continue;
    const m = r.text.match(/^(class|category)(\d+)\s+(.*)$/);
    if (m && m[1] === "class") classLabels.set(Number(m[2]), m[3]);
    if (m && m[1] === "category") {
      const code = c.catByNo.get(Number(m[2]));
      if (code) catLabels.set(code, m[3]);
    }
  }
  const operatorsByAdmin = new Map<string, Operator>();
  const file = pickFile("BETRIEB", [`_${lang}`, "_DE", ""]);
  if (file) {
    const ops = new Map<string, Operator>();
    for (const r of rows(file)) {
      const key = r.text.slice(0, 5).trim();
      const rest = r.text.slice(6).trim();
      const op = ops.get(key) ?? { key, admins: [] };
      const v = quotedValues(rest);
      if (v.K !== undefined) Object.assign(op, { short: v.K, abbr: v.L, name: v.V });
      else if (rest.startsWith("N ")) op.sboid = rest.slice(1).trim().replace(/["']/g, "");
      else if (rest.startsWith(":")) op.admins.push(...rest.slice(1).trim().split(/\s+/));
      ops.set(key, op);
    }
    for (const op of ops.values()) for (const a of op.admins) if (!operatorsByAdmin.has(a)) operatorsByAdmin.set(a, op);
  }
  const t = {
    attributes: attributes.size ? attributes : c.attributes,
    catLabels,
    classLabels,
    operatorsByAdmin: operatorsByAdmin.size ? operatorsByAdmin : c.operatorsByAdmin,
  };
  store.__hrdfTexts[lang] = t;
  return t;
}

export function categoryIn(code: string | null, lang: Lang): Category | null {
  const base = categoryFor(code);
  if (!base) return null;
  const t = texts(lang);
  return { ...base, label: t.catLabels.get(base.code) ?? base.label, classLabel: t.classLabels.get(base.productClass) ?? base.classLabel };
}
