import "server-only";
import { db } from "@/lib/db";
import { bitfieldDays, parseHrdfDate, type Period } from "./calendar";

interface LineInfo {
  id: number;
  name?: string;
  longName?: string;
  description?: string;
  slnid?: string;
  fg?: string;
  bg?: string;
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
    }
    lines.set(id, l);
  }

  const operators = new Map<string, Operator>();
  const betrieb = pickFile("BETRIEB");
  if (betrieb) {
    for (const r of rows(betrieb)) {
      const key = r.text.slice(0, 5).trim();
      const rest = r.text.slice(6).trim();
      const op = operators.get(key) ?? { key, admins: [] };
      const m = rest.match(/K "([^"]*)"\s*L "([^"]*)"\s*V "([^"]*)"/);
      if (m) Object.assign(op, { short: m[1], abbr: m[2], name: m[3] });
      else if (rest.startsWith("N")) op.sboid = rest.slice(1).trim().replace(/"/g, "");
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
