import "server-only";
import { inflateRawSync } from "node:zlib";
import { db } from "@/lib/db";
import { bitfieldAtStop, cache, categoryIn, lineInfo, runsOn, texts, type Lang } from "./lookups";
import { parseFplanLine, type RouteStop } from "./fplan";
import { decodeLine } from "./decoders";

export interface StationRow {
  id: number;
  name: string;
  long_name: string | null;
  abbr: string | null;
  synonyms: string | null;
  lon: number | null;
  lat: number | null;
  alt: number | null;
  e: number | null;
  n: number | null;
  prio: number | null;
  kminfo: number | null;
  sloid: string | null;
  country: string | null;
  stop_events: number;
}

export interface JourneyRow {
  id: number;
  nr: number;
  admin: string;
  variant: string | null;
  takt_n: number | null;
  takt_min: number | null;
  category: string | null;
  line: string | null;
  line_ref: number | null;
  dir: string | null;
  dir_code: string | null;
  from_stop: number | null;
  to_stop: number | null;
  dep: number | null;
  arr: number | null;
  n_stops: number;
  bitfield: number | null;
  jy: number | null;
  tail: string | null;
}

const JOURNEY_COLS = "j.id, j.nr, j.admin, j.variant, j.takt_n, j.takt_min, j.category, j.line, j.line_ref, j.dir, j.dir_code, j.from_stop, j.to_stop, j.dep, j.arr, j.n_stops, j.bitfield, j.jy, j.tail";

const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function overview() {
  const d = db();
  const c = cache();
  const count = (sql: string) => (d.prepare(sql).get() as { n: number }).n;
  return {
    period: c.period,
    header: c.header,
    meta: Object.fromEntries((d.prepare("SELECT key, value FROM meta").all() as { key: string; value: string }[]).map((r) => [r.key, r.value])),
    stations: count("SELECT COUNT(*) n FROM stations"),
    journeys: count("SELECT COUNT(*) n FROM journeys"),
    stopEvents: count("SELECT COUNT(*) n FROM stops"),
    bitfields: c.bitfields.size,
    operators: c.operators.length,
    lines: c.lines.size,
    categories: c.categories.size,
    files: d.prepare("SELECT name, size, lines, stored FROM files ORDER BY name").all() as { name: string; size: number; lines: number; stored: string }[],
  };
}

export function stationNames(ids: number[]): Map<number, string> {
  const uniq = [...new Set(ids.filter((x) => x !== null && x !== undefined))];
  const out = new Map<number, string>();
  if (!uniq.length) return out;
  for (let i = 0; i < uniq.length; i += 500) {
    const chunk = uniq.slice(i, i + 500);
    const s = db().prepare(`SELECT id, name FROM stations WHERE id IN (${chunk.map(() => "?").join(",")})`);
    for (const r of s.all(...chunk) as { id: number; name: string }[]) out.set(r.id, r.name);
  }
  return out;
}

export function searchStations(q: string, limit = 50): StationRow[] {
  const d = db();
  const s = q.trim();
  if (!s) {
    return d.prepare("SELECT * FROM stations ORDER BY stop_events DESC LIMIT ?").all(limit) as StationRow[];
  }
  if (/^\d+$/.test(s)) {
    const exact = d.prepare("SELECT * FROM stations WHERE id = ?").all(Number(s)) as StationRow[];
    const like = d.prepare("SELECT * FROM stations WHERE CAST(id AS TEXT) LIKE ? AND id != ? ORDER BY stop_events DESC LIMIT ?").all(`%${s}%`, Number(s), limit) as StationRow[];
    return [...exact, ...like].slice(0, limit);
  }
  if (/^ch:1:sloid:/i.test(s)) {
    return d.prepare("SELECT * FROM stations WHERE sloid LIKE ? LIMIT ?").all(`${s}%`, limit) as StationRow[];
  }
  const n = normalize(s);
  return d
    .prepare(
      `SELECT * FROM stations WHERE name_norm LIKE ?
       ORDER BY (name_norm = ?) DESC, (name_norm LIKE ?) DESC, stop_events DESC LIMIT ?`,
    )
    .all(`%${n}%`, n, `${n}%`, limit) as StationRow[];
}

export function getStation(id: number): StationRow | null {
  return (db().prepare("SELECT * FROM stations WHERE id = ?").get(id) as StationRow | undefined) ?? null;
}

export function stationMentions(id: number) {
  const d = db();
  const files = d
    .prepare("SELECT file, COUNT(*) AS n, MIN(n) AS first FROM refs WHERE kind = 'station' AND ref = ? GROUP BY file ORDER BY file")
    .all(String(id)) as { file: string; n: number; first: number }[];
  const sample = d.prepare(
    "SELECT l.file, l.n, l.section, l.text FROM refs r JOIN lines l ON l.file = r.file AND l.n = r.n WHERE r.kind = 'station' AND r.ref = ? AND r.file = ? ORDER BY l.n LIMIT 12",
  );
  return files.map((f) => ({ ...f, lines: sample.all(String(id), f.file) as { file: string; n: number; section: string | null; text: string }[] }));
}

export function metaGroups(id: number) {
  const parsed = parseMetabhf();
  const groups = parsed.groups.filter((g) => g.meta === id || g.members.includes(id));
  const transfers = parsed.transfers.filter((t) => t.from === id || t.to === id);
  return { groups, transfers };
}

interface MetabhfCache {
  groups: { meta: number; members: number[] }[];
  transfers: { from: number; to: number; minutes: number; attributes: string[] }[];
}

function parseMetabhf(): MetabhfCache {
  const g = globalThis as unknown as { __hrdfMetabhf?: MetabhfCache };
  if (g.__hrdfMetabhf) return g.__hrdfMetabhf;
  const rows = db().prepare("SELECT n, text FROM lines WHERE file = 'METABHF' ORDER BY n").all() as { n: number; text: string }[];
  const groups: MetabhfCache["groups"] = [];
  const transfers: MetabhfCache["transfers"] = [];
  let current: MetabhfCache["transfers"][number] | null = null;
  for (const r of rows) {
    if (r.text.startsWith("*A")) {
      const code = r.text.slice(3).trim();
      if (current && code) current.attributes.push(code);
      continue;
    }
    const colon = r.text.indexOf(":");
    if (colon > 0 && colon <= 8) {
      current = null;
      groups.push({ meta: Number(r.text.slice(0, colon)), members: r.text.slice(colon + 1).trim().split(/\s+/).map(Number) });
    } else if (/^\d{7} \d{7}/.test(r.text)) {
      current = {
        from: Number(r.text.slice(0, 7)),
        to: Number(r.text.slice(8, 15)),
        minutes: Number(r.text.slice(16, 19)),
        attributes: [],
      };
      transfers.push(current);
    } else {
      current = null;
    }
  }
  g.__hrdfMetabhf = { groups, transfers };
  return g.__hrdfMetabhf;
}

export function trackDefs(stop: number) {
  return db().prepare("SELECT file, ref, kind, value FROM gleis_def WHERE stop = ? ORDER BY ref, file").all(stop) as { file: string; ref: string; kind: string; value: string }[];
}

export interface TrackInfo {
  ref: string;
  label: string | null;
  title: string | null;
}

/** Track name (G + optional T + A); GLEISE `G ''` has no name, so fall back to the quay SLOID. */
function trackLabel(stop: number, ref: string): { label: string | null; title: string | null } {
  const rows = db().prepare("SELECT kind, value FROM gleis_def WHERE stop = ? AND ref = ? AND kind IN ('G', 'A', 'T', 'g')").all(stop, ref) as { kind: string; value: string }[];
  const val = (k: string) => rows.find((r) => r.kind === k)?.value.replace(/^'|'$/g, "") ?? "";
  const name = `${val("G")}${val("T")}${val("A")}`;
  if (name) return { label: name, title: null };
  const sloid = val("g").split(/\s+/).pop();
  if (!sloid) return { label: null, title: null };
  const quay = sloid.split(":").slice(-2).join(":");
  return { label: `no track name (quay ${quay})`, title: sloid };
}

/** Track ref for a journey at a stop on a given day. Prefer an exact-time GLEISE row over an untimed one. */
export function trackFor(stop: number, nr: number, admin: string, time: number | null, day: number): TrackInfo | null {
  const rows = db()
    .prepare("SELECT ref, time, bitfield FROM gleis WHERE nr = ? AND admin = ? AND stop = ?")
    .all(nr, admin, stop) as { ref: string; time: number | null; bitfield: number | null }[];
  const ok = (r: { bitfield: number | null }) => runsOn(r.bitfield, day);
  const timed =
    time !== null
      ? rows.find((r) => r.time !== null && (r.time === time || r.time === time % 1440) && ok(r))
      : undefined;
  const hit = timed ?? rows.find((r) => r.time === null && ok(r)) ?? null;
  if (!hit) return null;
  const { label, title } = trackLabel(stop, hit.ref);
  return { ref: hit.ref, label, title };
}

export interface BoardEntry {
  journey: JourneyRow;
  time: number;
  /** Day the journey's operating bitfield refers to (relative to queried date: 0 or −1). */
  serviceDayShift: number;
  cycle: number;
  seq: number;
  flags: number;
  terminus: string;
  origin: string;
  track: string | null;
  trackTitle: string | null;
}

export function board(stop: number, day: number, from: number, to: number, mode: "dep" | "arr", limit = 120): BoardEntry[] {
  const d = db();
  const col = mode === "dep" ? "dep" : "arr";
  const negFlag = mode === "dep" ? 2 : 1;
  const base = d.prepare(
    `SELECT ${JOURNEY_COLS}, s.seq, s.${col} AS t, s.flags FROM stops s JOIN journeys j ON j.id = s.journey
     WHERE s.stop = ? AND s.${col} BETWEEN ? AND ? ORDER BY s.${col}`,
  );
  const cyc = d.prepare(
    `SELECT ${JOURNEY_COLS}, s.seq, s.${col} AS t, s.flags FROM journeys j JOIN stops s ON s.journey = j.id AND s.stop = ?
     WHERE j.takt_n > 0 AND s.${col} <= ? AND s.${col} + j.takt_n * j.takt_min >= ?`,
  );
  type R = JourneyRow & { seq: number; t: number; flags: number };
  const out: Omit<BoardEntry, "terminus" | "origin" | "track" | "trackTitle">[] = [];
  const c = cache();
  const stopSeqCache = new Map<number, RouteStop[]>();
  const effectiveBitfield = (r: R) => {
    if (!c.multiVe.has(r.id)) return r.bitfield;
    let seq = stopSeqCache.get(r.id);
    if (!seq) {
      seq = d.prepare("SELECT stop, arr, dep FROM stops WHERE journey = ? ORDER BY seq").all(r.id) as RouteStop[];
      stopSeqCache.set(r.id, seq);
    }
    return bitfieldAtStop(r.id, r.seq - 1, seq, r.bitfield, mode);
  };
  for (const shift of [0, -1]) {
    const a = from - shift * 1440;
    const b = to - shift * 1440;
    const serviceDay = day + shift;
    for (const r of base.all(stop, a, b) as R[]) {
      if (r.flags & negFlag) continue;
      if (!runsOn(effectiveBitfield(r), serviceDay)) continue;
      out.push({ journey: r, time: r.t + shift * 1440, serviceDayShift: shift, cycle: 0, seq: r.seq, flags: r.flags });
    }
    for (const r of cyc.all(stop, b, a) as R[]) {
      if (r.flags & negFlag) continue;
      if (!runsOn(effectiveBitfield(r), serviceDay)) continue;
      for (let k = 1; k <= (r.takt_n ?? 0); k++) {
        const t = r.t + k * (r.takt_min ?? 0);
        if (t >= a && t <= b) out.push({ journey: r, time: t + shift * 1440, serviceDayShift: shift, cycle: k, seq: r.seq, flags: r.flags });
      }
    }
  }
  out.sort((x, y) => x.time - y.time || x.journey.nr - y.journey.nr);
  const slice = out.slice(0, limit);
  const names = stationNames(slice.flatMap((e) => [e.journey.to_stop ?? 0, e.journey.from_stop ?? 0]));
  return slice.map((e) => {
    const tr = trackFor(stop, e.journey.nr, e.journey.admin, e.time - e.serviceDayShift * 1440, day + e.serviceDayShift);
    return {
      ...e,
      terminus: names.get(e.journey.to_stop ?? 0) ?? String(e.journey.to_stop),
      origin: names.get(e.journey.from_stop ?? 0) ?? String(e.journey.from_stop),
      track: tr?.label ?? null,
      trackTitle: tr?.title ?? null,
    };
  });
}

export interface JourneyFilter {
  nr?: string;
  admin?: string;
  category?: string;
  line?: string;
  bitfield?: string;
  stop?: string;
  lineRef?: string;
  dir?: string;
}

export function searchJourneys(f: JourneyFilter, limit = 100, offset = 0): { rows: (JourneyRow & { fromName: string; toName: string })[]; total: number } {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.nr && /^\d+$/.test(f.nr)) {
    where.push("j.nr = ?");
    args.push(Number(f.nr));
  }
  if (f.admin) {
    where.push("j.admin = ?");
    args.push(f.admin.padStart(6, "0"));
  }
  if (f.category) {
    where.push("j.category = ?");
    args.push(f.category.toUpperCase());
  }
  if (f.line) {
    where.push("j.line = ?");
    args.push(f.line);
  }
  if (f.lineRef && /^\d+$/.test(f.lineRef)) {
    where.push("j.line_ref = ?");
    args.push(Number(f.lineRef));
  }
  if (f.dir) {
    where.push("j.dir_code = ?");
    args.push(f.dir);
  }
  if (f.bitfield && /^\d+$/.test(f.bitfield)) {
    const b = Number(f.bitfield);
    if (b === 0) where.push("j.bitfield IS NULL");
    else {
      where.push("(j.bitfield = ? OR j.id IN (SELECT journey FROM jlines WHERE bitfield = ?))");
      args.push(b, b);
    }
  }
  if (f.stop && /^\d+$/.test(f.stop)) {
    where.push("j.id IN (SELECT journey FROM stops WHERE stop = ?)");
    args.push(Number(f.stop));
  }
  if (!where.length) return { rows: [], total: 0 };
  const w = `WHERE ${where.join(" AND ")}`;
  const d = db();
  const total = (d.prepare(`SELECT COUNT(*) n FROM journeys j ${w}`).get(...args) as { n: number }).n;
  const rows = d.prepare(`SELECT ${JOURNEY_COLS} FROM journeys j ${w} ORDER BY j.dep, j.nr LIMIT ? OFFSET ?`).all(...args, limit, offset) as JourneyRow[];
  const names = stationNames(rows.flatMap((r) => [r.from_stop ?? 0, r.to_stop ?? 0]));
  return {
    total,
    rows: rows.map((r) => ({ ...r, fromName: names.get(r.from_stop ?? 0) ?? "", toName: names.get(r.to_stop ?? 0) ?? "" })),
  };
}

export function infotext(id: number, lang: string = "EN"): string | null {
  const d = db();
  for (const f of [`INFOTEXT_${lang}`, "INFOTEXT_DE", "INFOTEXT"]) {
    const r = d.prepare("SELECT text FROM lines WHERE key = ? AND file = ?").get(String(id), f) as { text: string } | undefined;
    if (r) return r.text.slice(10).trim();
  }
  return null;
}

export function infotextAll(id: number) {
  return db().prepare("SELECT file, text FROM lines WHERE key = ? AND file LIKE 'INFOTEXT%' ORDER BY file").all(String(id)) as { file: string; text: string }[];
}

export function getJourney(id: number, lang: Lang = "EN") {
  const d = db();
  const j = d.prepare(`SELECT ${JOURNEY_COLS}, j.raw FROM journeys j WHERE j.id = ?`).get(id) as (JourneyRow & { raw: Buffer }) | undefined;
  if (!j) return null;
  const raw = inflateRawSync(j.raw).toString("utf8");
  const stops = d.prepare("SELECT seq, stop, arr, dep, flags FROM stops WHERE journey = ? ORDER BY seq").all(id) as { seq: number; stop: number; arr: number | null; dep: number | null; flags: number }[];
  const jl = d.prepare("SELECT idx, type, code, from_stop, to_stop, bitfield, ref, text FROM jlines WHERE journey = ? ORDER BY idx").all(id) as {
    idx: number; type: string; code: string | null; from_stop: number | null; to_stop: number | null; bitfield: number | null; ref: string | null; text: string;
  }[];
  const names = stationNames([...stops.map((s) => s.stop), ...jl.flatMap((l) => [l.from_stop ?? 0, l.to_stop ?? 0])]);
  const stations = d.prepare(`SELECT id, lon, lat FROM stations WHERE id IN (${stops.map(() => "?").join(",") || "NULL"})`).all(...stops.map((s) => s.stop)) as { id: number; lon: number | null; lat: number | null }[];
  const coords = new Map(stations.map((s) => [s.id, s]));
  const c = cache();
  const t = texts(lang);
  const records = jl.map((l) => {
    const p = parseFplanLine(l.text);
    let resolved: string | null = null;
    if (l.type === "*I" && l.ref) resolved = infotext(Number(l.ref), lang);
    if (l.type === "*A" && l.code) resolved = t.attributes.get(l.code) ?? null;
    if (l.type === "*R" && l.ref) resolved = c.directions.get(l.ref) ?? null;
    if (l.type === "*L" && l.ref?.startsWith("#")) {
      const li = lineInfo(Number(l.ref.slice(1)));
      resolved = li ? [li.name, li.longName, li.description].filter(Boolean).join(" · ") : null;
    }
    if (l.type === "*G" && l.code) {
      const cat = categoryIn(l.code, lang);
      resolved = cat ? [cat.label, cat.classLabel].filter(Boolean).join(" · ") : null;
    }
    return { ...l, parsed: p, resolved, fromName: names.get(l.from_stop ?? -1) ?? null, toName: names.get(l.to_stop ?? -1) ?? null };
  });
  const variants = d
    .prepare(`SELECT ${JOURNEY_COLS} FROM journeys j WHERE j.nr = ? AND j.admin = ? ORDER BY j.dep LIMIT 60`)
    .all(j.nr, j.admin) as JourneyRow[];
  const tracks = d.prepare("SELECT stop, ref, time, bitfield FROM gleis WHERE nr = ? AND admin = ?").all(j.nr, j.admin) as { stop: number; ref: string; time: number | null; bitfield: number | null }[];
  const trackLabels = new Map<string, { label: string | null; title: string | null }>();
  for (const t of tracks) {
    const k = `${t.stop}|${t.ref}`;
    if (!trackLabels.has(k)) trackLabels.set(k, trackLabel(t.stop, t.ref));
  }
  const through = d
    .prepare("SELECT n, text FROM lines WHERE file = 'DURCHBI' AND (substr(text,1,13) = ? OR substr(text,23,13) = ?)")
    .all(`${String(j.nr).padStart(6, "0")} ${j.admin}`, `${String(j.nr).padStart(6, "0")} ${j.admin}`) as { n: number; text: string }[];
  const transfers = d
    .prepare("SELECT n, text FROM lines WHERE file = 'UMSTEIGZ' AND (substr(text,9,13) = ? OR substr(text,23,13) = ?)")
    .all(`${String(j.nr).padStart(6, "0")} ${j.admin}`, `${String(j.nr).padStart(6, "0")} ${j.admin}`) as { n: number; text: string }[];
  return {
    journey: j as JourneyRow,
    raw,
    stops: stops.map((s) => ({ ...s, name: names.get(s.stop) ?? String(s.stop), lon: coords.get(s.stop)?.lon ?? null, lat: coords.get(s.stop)?.lat ?? null })),
    records,
    variants,
    tracks: tracks.map((t) => {
      const info = trackLabels.get(`${t.stop}|${t.ref}`);
      return { ...t, label: info?.label ?? null, title: info?.title ?? null };
    }),
    operator: t.operatorsByAdmin.get(j.admin) ?? null,
    category: categoryIn(j.category, lang),
    lineInfo: lineInfo(j.line_ref),
    sjyid: j.jy !== null ? infotext(j.jy, "DE") : null,
    direction: j.dir_code ? c.directions.get(j.dir_code) ?? null : null,
    through: through.map((t) => ({ ...t, decoded: decodeLine("DURCHBI", t.text) })),
    transfers: transfers.map((t) => ({ ...t, decoded: decodeLine("UMSTEIGZ", t.text) })),
  };
}

export function bitfieldUsage(): Map<number, number> {
  const g = globalThis as unknown as { __hrdfBfUsage?: Map<number, number> };
  if (g.__hrdfBfUsage) return g.__hrdfBfUsage;
  const m = new Map<number, number>();
  for (const r of db().prepare("SELECT bitfield, COUNT(*) n FROM journeys GROUP BY bitfield").all() as { bitfield: number | null; n: number }[]) m.set(r.bitfield ?? 0, r.n);
  g.__hrdfBfUsage = m;
  return m;
}

export function bitfieldLineUsage(id: number) {
  return db().prepare("SELECT type, code, COUNT(*) n FROM jlines WHERE bitfield = ? GROUP BY type, code ORDER BY n DESC").all(id) as { type: string; code: string; n: number }[];
}

export function bitfieldFileRefs(id: number) {
  return db().prepare("SELECT file, COUNT(*) n FROM refs WHERE kind = 'bitfield' AND ref = ? GROUP BY file").all(String(id)) as { file: string; n: number }[];
}

export interface FileRow {
  n: number;
  section: string | null;
  text: string;
}

export function browseLines(
  file: string,
  q: string,
  offset: number,
  limit: number,
  key?: string,
  ref?: { kind: string; id: string },
): { rows: FileRow[]; total: number | null } {
  const d = db();
  const args: (string | number)[] = [file];
  let w = "file = ?";
  if (key) {
    w += " AND key = ?";
    args.push(key);
  }
  if (ref) {
    w += " AND n IN (SELECT n FROM refs WHERE kind = ? AND ref = ? AND file = ?)";
    args.push(ref.kind, ref.id, file);
  }
  if (q) {
    w += " AND text LIKE ?";
    args.push(`%${q}%`);
  }
  const rows = d.prepare(`SELECT n, section, text FROM lines WHERE ${w} ORDER BY n LIMIT ? OFFSET ?`).all(...args, limit, offset) as FileRow[];
  const total = (d.prepare(`SELECT COUNT(*) n FROM lines WHERE ${w}`).get(...args) as { n: number }).n;
  return { rows, total };
}

export function fileInfo(name: string) {
  return (db().prepare("SELECT name, size, lines, stored FROM files WHERE name = ?").get(name) as { name: string; size: number; lines: number; stored: string } | undefined) ?? null;
}

export function fplanTypeStats() {
  const g = globalThis as unknown as { __hrdfFplanStats?: { type: string; code: string | null; n: number }[] };
  if (g.__hrdfFplanStats) return g.__hrdfFplanStats;
  g.__hrdfFplanStats = db().prepare("SELECT type, code, COUNT(*) n FROM jlines GROUP BY type, code ORDER BY type, n DESC").all() as { type: string; code: string | null; n: number }[];
  return g.__hrdfFplanStats;
}

export function browseFplan(type: string, code: string | null, q: string, offset: number, limit: number, bitfield?: number, stop?: number) {
  const args: (string | number)[] = [];
  let w = "1 = 1";
  if (type) {
    w += " AND type = ?";
    args.push(type);
  }
  if (bitfield) {
    w += " AND bitfield = ?";
    args.push(bitfield);
  }
  if (stop) {
    w += " AND (from_stop = ? OR to_stop = ?)";
    args.push(stop, stop);
  }
  if (code !== null && code !== "") {
    w += " AND code = ?";
    args.push(code);
  }
  if (q) {
    w += " AND text LIKE ?";
    args.push(`%${q}%`);
  }
  return db().prepare(`SELECT journey, idx, type, code, from_stop, to_stop, bitfield, ref, text FROM jlines WHERE ${w} LIMIT ? OFFSET ?`).all(...args, limit, offset) as {
    journey: number; idx: number; type: string; code: string | null; from_stop: number | null; to_stop: number | null; bitfield: number | null; ref: string | null; text: string;
  }[];
}

export function browseGleise(stop: string, nr: string, offset: number, limit: number) {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (/^\d+$/.test(stop)) {
    where.push("stop = ?");
    args.push(Number(stop));
  }
  if (/^\d+$/.test(nr)) {
    where.push("nr = ?");
    args.push(Number(nr));
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return db().prepare(`SELECT rowid AS n, stop, nr, admin, ref, time, bitfield FROM gleis ${w} LIMIT ? OFFSET ?`).all(...args, limit, offset) as {
    n: number; stop: number; nr: number; admin: string; ref: string; time: number | null; bitfield: number | null;
  }[];
}

export function browseGleisDefs(file: string, stop: string, offset: number, limit: number) {
  const args: (string | number)[] = [file];
  let w = "file = ?";
  if (/^\d+$/.test(stop)) {
    w += " AND stop = ?";
    args.push(Number(stop));
  }
  return db().prepare(`SELECT n, stop, ref, kind, value FROM gleis_def WHERE ${w} ORDER BY n LIMIT ? OFFSET ?`).all(...args, limit, offset) as {
    n: number; stop: number; ref: string; kind: string; value: string;
  }[];
}

export function journeyExists(id: number): boolean {
  return !!(db().prepare("SELECT 1 AS ok FROM journeys WHERE id = ?").get(id) as { ok: number } | undefined);
}

export function journeyIdFor(nr: number, admin: string): number | null {
  const r = db().prepare("SELECT id FROM journeys WHERE nr = ? AND admin = ? ORDER BY id LIMIT 1").get(nr, admin) as { id: number } | undefined;
  return r?.id ?? null;
}

export function browseStopLines(stop: number | null, offset: number, limit: number) {
  const d = db();
  const rows = stop
    ? (d.prepare("SELECT journey, seq, stop, arr, dep, flags FROM stops WHERE stop = ? ORDER BY dep LIMIT ? OFFSET ?").all(stop, limit, offset) as StopLine[])
    : (d.prepare("SELECT journey, seq, stop, arr, dep, flags FROM stops LIMIT ? OFFSET ?").all(limit, offset) as StopLine[]);
  const names = stationNames(rows.map((r) => r.stop));
  return rows.map((r) => ({ ...r, name: names.get(r.stop) ?? "" }));
}
export interface StopLine {
  journey: number;
  seq: number;
  stop: number;
  arr: number | null;
  dep: number | null;
  flags: number;
}

export function lineOffset(file: string, n: number): number {
  return (db().prepare("SELECT COUNT(*) c FROM lines WHERE file = ? AND n < ?").get(file, n) as { c: number }).c;
}

export function stationExtras(id: number, lang: Lang = "EN") {
  const rows = db().prepare("SELECT text FROM lines WHERE file = 'BHFART' AND key = ?").all(String(id)) as { text: string }[];
  const quays: string[] = [];
  const infos: { code: string; nr: number; text: string | null }[] = [];
  for (const r of rows) {
    const [, type, sub, value] = r.text.split("%")[0].trim().split(/\s+/);
    if (type === "G" && sub === "a" && value) quays.push(value);
    if (type === "I" && value) infos.push({ code: sub, nr: Number(value), text: infotext(Number(value), lang) });
  }
  return { quays, infos };
}
