/**
 * Streams an HRDF 5.40 zip into a SQLite database for the explorer.
 *
 *   npm run data:build                       # data/hrdf.zip → data/hrdf.sqlite
 *   npm run data:build -- path/to.zip out.sqlite
 */
import Database from "better-sqlite3";
import yauzl from "yauzl";
import readline from "node:readline";
import { createHash } from "node:crypto";
import { existsSync, renameSync, rmSync, statSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import path from "node:path";
import type { Readable } from "node:stream";
import { parseFplanLine, parseHrdfTime } from "../src/lib/hrdf/fplan";
import { bitfieldDays, parseHrdfDate } from "../src/lib/hrdf/calendar";
import { baseName, decodeLine, isSectionHeader, lineKey } from "../src/lib/hrdf/decoders";
import { emitProgress } from "../src/lib/import-progress";

const zipPath = path.resolve(process.argv[2] ?? process.env.HRDF_ZIP ?? "data/hrdf.zip");
const dbPath = path.resolve(process.argv[3] ?? process.env.HRDF_DB ?? "data/hrdf.sqlite");

const SCHEMA = `
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE files(name TEXT PRIMARY KEY, size INTEGER, lines INTEGER, stored TEXT);
CREATE TABLE lines(file TEXT NOT NULL, n INTEGER NOT NULL, section TEXT, key TEXT, text TEXT NOT NULL, PRIMARY KEY(file, n)) WITHOUT ROWID;
CREATE TABLE refs(kind TEXT NOT NULL, ref TEXT NOT NULL, file TEXT NOT NULL, n INTEGER NOT NULL);
CREATE TABLE bitfields(id INTEGER PRIMARY KEY, hex TEXT NOT NULL, days INTEGER NOT NULL);
CREATE TABLE stations(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_norm TEXT NOT NULL, long_name TEXT, abbr TEXT, synonyms TEXT,
  lon REAL, lat REAL, alt REAL, e REAL, n REAL, prio INTEGER, kminfo INTEGER, sloid TEXT, country TEXT,
  stop_events INTEGER DEFAULT 0
);
CREATE TABLE journeys(
  id INTEGER PRIMARY KEY, nr INTEGER NOT NULL, admin TEXT NOT NULL, variant TEXT, takt_n INTEGER, takt_min INTEGER,
  category TEXT, line TEXT, line_ref INTEGER, dir TEXT, dir_code TEXT,
  from_stop INTEGER, to_stop INTEGER, dep INTEGER, arr INTEGER, n_stops INTEGER,
  bitfield INTEGER, jy INTEGER, tail TEXT, raw BLOB
);
CREATE TABLE stops(journey INTEGER NOT NULL, seq INTEGER NOT NULL, stop INTEGER NOT NULL, arr INTEGER, dep INTEGER, flags INTEGER NOT NULL, PRIMARY KEY(journey, seq)) WITHOUT ROWID;
CREATE TABLE jlines(journey INTEGER NOT NULL, idx INTEGER NOT NULL, type TEXT NOT NULL, code TEXT, from_stop INTEGER, to_stop INTEGER, bitfield INTEGER, ref TEXT, text TEXT NOT NULL, PRIMARY KEY(journey, idx)) WITHOUT ROWID;
CREATE TABLE gleis(stop INTEGER NOT NULL, nr INTEGER NOT NULL, admin TEXT NOT NULL, ref TEXT NOT NULL, time INTEGER, bitfield INTEGER);
CREATE TABLE gleis_def(file TEXT NOT NULL, n INTEGER NOT NULL, stop INTEGER NOT NULL, ref TEXT NOT NULL, kind TEXT NOT NULL, value TEXT);
`;

const INDEXES = `
CREATE INDEX lines_key ON lines(key, file);
CREATE INDEX refs_kind_ref ON refs(kind, ref);
CREATE INDEX stations_name ON stations(name_norm);
CREATE INDEX journeys_nr ON journeys(nr, admin);
CREATE INDEX journeys_admin ON journeys(admin);
CREATE INDEX journeys_bitfield ON journeys(bitfield);
CREATE INDEX journeys_cat_line ON journeys(category, line);
CREATE INDEX journeys_line_ref ON journeys(line_ref);
CREATE INDEX journeys_takt ON journeys(takt_n) WHERE takt_n > 0;
CREATE INDEX stops_stop_dep ON stops(stop, dep);
CREATE INDEX stops_stop_arr ON stops(stop, arr);
CREATE INDEX jlines_type_code ON jlines(type, code);
CREATE INDEX jlines_bitfield ON jlines(bitfield) WHERE bitfield IS NOT NULL;
CREATE INDEX jlines_ref ON jlines(type, ref) WHERE ref IS NOT NULL;
CREATE INDEX gleis_journey ON gleis(nr, admin);
CREATE INDEX gleis_stop ON gleis(stop);
CREATE INDEX gleis_def_stop ON gleis_def(stop, ref);
`;

const normalize = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

interface StationAcc {
  name?: string;
  long?: string;
  abbr?: string;
  syn: string[];
  lon?: number;
  lat?: number;
  alt?: number;
  e?: number;
  n?: number;
  prio?: number;
  km?: number;
  sloid?: string;
  country?: string;
}

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((res, rej) =>
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zf) => (err || !zf ? rej(err) : res(zf))),
  );
}

function listEntries(zf: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((res, rej) => {
    const out: yauzl.Entry[] = [];
    zf.on("entry", (e: yauzl.Entry) => {
      if (!e.fileName.endsWith("/")) out.push(e);
      zf.readEntry();
    });
    zf.on("end", () => res(out));
    zf.on("error", rej);
    zf.readEntry();
  });
}

function entryStream(zf: yauzl.ZipFile, e: yauzl.Entry): Promise<Readable> {
  return new Promise((res, rej) => zf.openReadStream(e, (err, s) => (err || !s ? rej(err) : res(s))));
}

async function* readLines(zf: yauzl.ZipFile, e: yauzl.Entry, onBytes?: (n: number) => void): AsyncGenerator<string> {
  const stream = await entryStream(zf, e);
  if (onBytes) {
    let seen = 0;
    stream.on("data", (chunk: Buffer) => {
      seen += chunk.length;
      onBytes(seen);
    });
  }
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) yield line.replace(/^\uFEFF/, "");
}

function log(msg: string) {
  process.stdout.write(`${new Date().toISOString().slice(11, 19)}  ${msg}\n`);
}

/** Order: small reference files first (FPLAN needs LINIE / stations), then FPLAN, then GLEISE. */
function rank(name: string): number {
  if (name === "FPLAN") return 2;
  if (/^GLEISE?(_|$)/.test(name)) return name.endsWith("LV95") ? 4 : 3;
  return 1;
}

async function main() {
  if (!existsSync(zipPath)) {
    console.error(`HRDF zip not found at ${zipPath}. Run "npm run data:fetch" first.`);
    process.exit(1);
  }
  const tmpPath = `${dbPath}.building`;
  rmSync(tmpPath, { force: true });
  const db = new Database(tmpPath);
  db.pragma("journal_mode = OFF");
  db.pragma("synchronous = OFF");
  db.pragma("cache_size = -400000");
  db.pragma("temp_store = MEMORY");
  db.pragma("locking_mode = EXCLUSIVE");
  db.exec(SCHEMA);

  const t0 = Date.now();
  emitProgress({ phase: "building", pct: 1, message: `Opening ${path.basename(zipPath)}` }, { force: true });
  const zf = await openZip(zipPath);
  const entries = (await listEntries(zf)).sort((a, b) => rank(a.fileName) - rank(b.fileName));
  log(`${entries.length} files in ${path.basename(zipPath)}`);
  const totalBytes = entries.reduce((s, e) => s + e.uncompressedSize, 0) || 1;
  let completedBytes = 0;
  const prog = { name: "", extra: "" };
  const onBytes = (n: number) => {
    const pct = 4 + ((completedBytes + n) / totalBytes) * 86;
    const message = prog.extra ? `${prog.name}: ${prog.extra}` : `Reading ${prog.name}…`;
    emitProgress({ phase: "building", pct: Math.min(90, pct), message, bytes: completedBytes + n, totalBytes });
  };

  const insMeta = db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)");
  const insFile = db.prepare("INSERT INTO files VALUES (?, ?, ?, ?)");
  const insLine = db.prepare("INSERT INTO lines VALUES (?, ?, ?, ?, ?)");
  const insRef = db.prepare("INSERT INTO refs VALUES (?, ?, ?, ?)");
  const insBitfield = db.prepare("INSERT OR IGNORE INTO bitfields VALUES (?, ?, ?)");

  insMeta.run("source_zip", path.basename(zipPath));
  insMeta.run("built_at", new Date().toISOString());

  const stations = new Map<number, StationAcc>();
  const station = (id: number) => {
    let s = stations.get(id);
    if (!s) stations.set(id, (s = { syn: [] }));
    return s;
  };
  const lineNames = new Map<number, string>();

  let batch = 0;
  db.exec("BEGIN");
  const tick = () => {
    if (++batch % 200000 === 0) {
      db.exec("COMMIT");
      db.exec("BEGIN");
    }
  };

  for (const e of entries) {
    const name = e.fileName;
    const base = baseName(name);
    const t = Date.now();
    prog.name = name;
    prog.extra = "";
    emitProgress({ phase: "building", pct: 4 + (completedBytes / totalBytes) * 86, message: `Reading ${name}…`, bytes: completedBytes, totalBytes }, { force: true });

    if (name === "FPLAN") {
      const n = await importFplan(db, zf, e, lineNames, tick, onBytes, (extra) => {
        prog.extra = extra;
      });
      insFile.run(name, e.uncompressedSize, n, "fplan");
      log(`FPLAN: ${n.toLocaleString()} lines in ${((Date.now() - t) / 1000).toFixed(0)}s`);
      completedBytes += e.uncompressedSize;
      continue;
    }
    if (base === "GLEISE" || base === "GLEIS") {
      const n = await importGleise(db, zf, e, tick, onBytes);
      insFile.run(name, e.uncompressedSize, n, "gleise");
      log(`${name}: ${n.toLocaleString()} lines in ${((Date.now() - t) / 1000).toFixed(0)}s`);
      completedBytes += e.uncompressedSize;
      continue;
    }

    let n = 0;
    let section: string | null = null;
    const skipRefs = base === "INFOTEXT";
    for await (const raw of readLines(zf, e, onBytes)) {
      // ZEITVS ships with "%" instead of newlines between records.
      const parts = base === "ZEITVS" && !raw.includes("\n") && raw.split("%").length > 3 ? splitZeitvs(raw) : [raw];
      for (const line of parts) {
        if (!line.trim()) continue;
        n++;
        if (isSectionHeader(name, line)) section = line.trim().replace(/^%\s*/, "").replace(/[<>]/g, "");
        insLine.run(name, n, section, lineKey(name, line), line);
        tick();
        if (!skipRefs) {
          const seen = new Set<string>();
          for (const f of decodeLine(name, line, section).fields) {
            if (!f.link) continue;
            const k = `${f.link.kind}:${f.link.id}`;
            if (seen.has(k)) continue;
            seen.add(k);
            insRef.run(f.link.kind, f.link.id, name, n);
          }
        }
        collect(name, base, line, section);
      }
    }
    insFile.run(name, e.uncompressedSize, n, "lines");
    log(`${name}: ${n.toLocaleString()} lines`);
    completedBytes += e.uncompressedSize;
  }

  function collect(name: string, base: string, line: string, section: string | null) {
    switch (base) {
      case "ECKDATEN": {
        if (/^\d{2}\.\d{2}\.\d{4}$/.test(line.trim())) {
          insMeta.run(db.prepare("SELECT 1 FROM meta WHERE key='start'").get() ? "end" : "start", line.trim());
        } else insMeta.run("header", line.trim());
        break;
      }
      case "BITFIELD":
      case "BITFELD": {
        const [id, hex] = line.trim().split(/\s+/);
        if (!hex) break;
        insBitfield.run(Number(id), hex, 0);
        break;
      }
      case "BAHNHOF": {
        const id = Number(line.slice(0, 7));
        const parts = line.slice(12).trim().split("$");
        const s = station(id);
        for (let i = 0; i < parts.length - 1; i += 2) {
          const tag = parts[i + 1];
          if (tag === "<1>") s.name ??= parts[i];
          else if (tag === "<2>") s.long ??= parts[i];
          else if (tag === "<3>") s.abbr ??= parts[i];
          else s.syn.push(parts[i]);
        }
        if (!s.name) s.name = parts[0];
        break;
      }
      case "BFKOORD": {
        const [id, x, y, alt] = line.split("%")[0].trim().split(/\s+/);
        const s = station(Number(id));
        if (name.endsWith("LV95")) {
          s.e = Number(x);
          s.n = Number(y);
        } else {
          s.lon = Number(x);
          s.lat = Number(y);
        }
        s.alt = Number(alt);
        break;
      }
      case "BFPRIOS":
        station(Number(line.slice(0, 7))).prio = Number(line.slice(8, 10));
        break;
      case "KMINFO":
        station(Number(line.slice(0, 7))).km = Number(line.slice(8, 13));
        break;
      case "BHFART": {
        const [id, type, sub, value] = line.split("%")[0].trim().split(/\s+/);
        if (!/^\d+$/.test(id ?? "")) break;
        if (type === "G" && sub === "A") station(Number(id)).sloid ??= value;
        if (type === "L") station(Number(id)).country ??= sub;
        break;
      }
      case "LINIE": {
        const id = Number(line.slice(0, 7));
        const type = line.charAt(8);
        if (type === "N") lineNames.set(id, line.slice(10).trim().replace(/^T\s+/, ""));
        break;
      }
    }
    void section;
  }

  db.exec("COMMIT");

  const startMeta = db.prepare("SELECT value FROM meta WHERE key='start'").get() as { value: string } | undefined;
  const endMeta = db.prepare("SELECT value FROM meta WHERE key='end'").get() as { value: string } | undefined;
  if (startMeta && endMeta) {
    const nDays = Math.round((parseHrdfDate(endMeta.value).getTime() - parseHrdfDate(startMeta.value).getTime()) / 86400000) + 1;
    const upd = db.prepare("UPDATE bitfields SET days = ? WHERE id = ?");
    db.transaction(() => {
      for (const r of db.prepare("SELECT id, hex FROM bitfields").all() as { id: number; hex: string }[]) {
        upd.run(bitfieldDays(r.hex, nDays).filter(Boolean).length, r.id);
      }
    })();
    log(`Bitfield operating-day counts (skipping 2-bit padding) for ${nDays} days`);
    emitProgress({ phase: "building", pct: 91, message: `Bitfield operating-day counts for ${nDays} days` }, { force: true });
  }

  log(`Writing ${stations.size.toLocaleString()} stations`);
  emitProgress({ phase: "building", pct: 93, message: `Writing ${stations.size.toLocaleString()} stations` }, { force: true });
  const insStation = db.prepare(
    "INSERT INTO stations(id,name,name_norm,long_name,abbr,synonyms,lon,lat,alt,e,n,prio,kminfo,sloid,country) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  db.transaction(() => {
    for (const [id, s] of stations) {
      const nm = s.name ?? `#${id}`;
      insStation.run(
        id, nm, normalize([nm, s.long, s.abbr, ...s.syn].filter(Boolean).join(" | ")),
        s.long ?? null, s.abbr ?? null, s.syn.length ? s.syn.join(" | ") : null,
        s.lon ?? null, s.lat ?? null, s.alt ?? null, s.e ?? null, s.n ?? null,
        s.prio ?? null, s.km ?? null, s.sloid ?? null, s.country ?? null,
      );
    }
  })();

  log("Creating indexes");
  emitProgress({ phase: "building", pct: 95, message: "Creating indexes" }, { force: true });
  db.exec(INDEXES);
  log("Counting stop events per station");
  emitProgress({ phase: "building", pct: 97, message: "Counting stop events per station" }, { force: true });
  db.exec("UPDATE stations SET stop_events = (SELECT COUNT(*) FROM stops WHERE stops.stop = stations.id)");
  db.exec("ANALYZE");
  insMeta.run("build_seconds", String(Math.round((Date.now() - t0) / 1000)));
  zf.close();
  db.close();
  renameSync(tmpPath, dbPath);
  const seconds = (Date.now() - t0) / 1000;
  const gb = statSync(dbPath).size / 1e9;
  log(`Done in ${seconds.toFixed(0)}s → ${dbPath} (${gb.toFixed(2)} GB)`);
  emitProgress({ phase: "done", pct: 100, message: `Done in ${seconds.toFixed(0)}s → ${path.basename(dbPath)} (${gb.toFixed(2)} GB)` }, { force: true });
}

/**
 * ZEITVS ships as a single physical line: header comments, then records each
 * followed by "% comment" that runs straight into the next record
 * ("…MEZ=GMT+11000000 +0200…"). Re-split into one record (+ comment) per line.
 */
function splitZeitvs(raw: string): string[] {
  // Type 1: stop, offset, DST groups. Type 2: stop, stop to copy rules from.
  const REC = String.raw`\d{7} (?:[+-]\d{4}(?: [+-]\d{4} \d{8} \d{4} \d{8} \d{4})*|\d{7})`;
  const out: string[] = [];
  const first = raw.search(new RegExp(REC));
  const head = first >= 0 ? raw.slice(0, first) : raw;
  for (const h of head.split("%")) if (h.trim()) out.push(`% ${h.trim()}`);
  if (first < 0) return out;
  const re = new RegExp(String.raw`(${REC})\s*(?:%\s*(.*?))?\s*(?=${REC}|$)`, "gs");
  for (const m of raw.slice(first).matchAll(re)) {
    const note = m[2]?.replace(/%\s*$/, "").trim();
    out.push(note ? `${m[1]} % ${note}` : m[1]);
  }
  return out;
}

async function importFplan(
  db: Database.Database,
  zf: yauzl.ZipFile,
  e: yauzl.Entry,
  lineNames: Map<number, string>,
  tick: () => void,
  onBytes?: (n: number) => void,
  onExtra?: (extra: string) => void,
): Promise<number> {
  const insJourney = db.prepare(
    "INSERT INTO journeys VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  const insStop = db.prepare("INSERT INTO stops VALUES (?,?,?,?,?,?)");
  const insJline = db.prepare("INSERT INTO jlines VALUES (?,?,?,?,?,?,?,?,?)");

  let id = 0;
  let n = 0;
  let buf: string[] = [];
  let lastLog = Date.now();

  const flush = () => {
    if (!buf.length) return;
    if (!buf[0].startsWith("*Z")) {
      buf = [];
      return;
    }
    id++;
    let nr = 0, admin = "", variant: string | null = null, taktN: number | null = null, taktMin: number | null = null;
    let category: string | null = null, lineTxt: string | null = null, lineRef: number | null = null;
    let dir: string | null = null, dirCode: string | null = null, jy: number | null = null, tail: string | null = null;
    let bitfield: number | null = null, bitfieldFallback: number | null = null;
    const stops: { stop: number; arr: number | null; dep: number | null; flags: number }[] = [];
    let idx = 0;
    for (const line of buf) {
      const p = parseFplanLine(line);
      if (p.type === "stop") {
        const a = parseHrdfTime(p.fields.arrTime);
        const d = parseHrdfTime(p.fields.depTime);
        const s = { stop: p.fromStop ?? 0, arr: a.minutes, dep: d.minutes, flags: (a.negative ? 1 : 0) | (d.negative ? 2 : 0) };
        stops.push(s);
        insStop.run(id, stops.length, s.stop, s.arr, s.dep, s.flags);
        continue;
      }
      idx++;
      insJline.run(id, idx, p.type, p.code, p.fromStop, p.toStop, p.bitfield, p.ref, line.replace(/\s+%\s*$/, "").trimEnd());
      switch (p.type) {
        case "*Z":
          nr = Number(p.fields.journeyNumber);
          admin = p.fields.administration;
          variant = p.fields.variant || null;
          taktN = p.fields.cycleCount ? Number(p.fields.cycleCount) : null;
          taktMin = p.fields.cycleMinutes ? Number(p.fields.cycleMinutes) : null;
          tail = p.comment;
          break;
        case "*G":
          category ??= p.code;
          break;
        case "*L":
          if (lineTxt === null && p.ref) {
            if (p.ref.startsWith("#")) {
              lineRef = Number(p.ref.slice(1));
              lineTxt = lineNames.get(lineRef) ?? p.ref;
            } else lineTxt = p.ref;
          }
          break;
        case "*R":
          if (dir === null) {
            dir = p.code;
            dirCode = p.ref;
          }
          break;
        case "*A":
          if (p.code === "VE") {
            if (bitfieldFallback === null) bitfieldFallback = p.bitfield ?? 0;
            if (bitfield === null && p.fromStop === null) bitfield = p.bitfield ?? 0;
          }
          break;
        case "*I":
          if (p.code === "JY" && jy === null && p.ref) jy = Number(p.ref);
          break;
      }
    }
    if (bitfield === null && bitfieldFallback !== null) {
      // VE restricted to a section: prefer the one starting at the first stop.
      const firstStop = stops[0]?.stop;
      for (const line of buf) {
        if (!line.startsWith("*A VE")) continue;
        const p = parseFplanLine(line);
        if (p.fromStop === firstStop) {
          bitfield = p.bitfield ?? 0;
          break;
        }
      }
      bitfield ??= bitfieldFallback;
    }
    const first = stops[0];
    const last = stops[stops.length - 1];
    insJourney.run(
      id, nr, admin, variant, taktN, taktMin, category, lineTxt, lineRef, dir, dirCode,
      first?.stop ?? null, last?.stop ?? null, first?.dep ?? null, last?.arr ?? null, stops.length,
      bitfield && bitfield !== 0 ? bitfield : null, jy, tail,
      deflateRawSync(Buffer.from(buf.join("\n"), "utf8")),
    );
    buf = [];
    tick();
  };

  for await (const line of readLines(zf, e, onBytes)) {
    n++;
    if (line.startsWith("*Z")) flush();
    buf.push(line);
    if (n % 1_000_000 === 0 && Date.now() - lastLog > 5000) {
      lastLog = Date.now();
      const extra = `${(n / 1e6).toFixed(0)}M lines, ${id.toLocaleString()} journeys`;
      log(`  FPLAN ${extra}`);
      onExtra?.(extra);
    }
  }
  flush();
  return n;
}

async function importGleise(db: Database.Database, zf: yauzl.ZipFile, e: yauzl.Entry, tick: () => void, onBytes?: (n: number) => void): Promise<number> {
  const name = e.fileName;
  const already = (db.prepare("SELECT value FROM meta WHERE key='gleise_assign_source'").get() as { value: string } | undefined)?.value;
  const loadAssignments = !already;
  const insAssign = db.prepare("INSERT INTO gleis VALUES (?,?,?,?,?,?)");
  const insDef = db.prepare("INSERT INTO gleis_def VALUES (?,?,?,?,?,?)");
  const hash = createHash("sha1");
  let n = 0;
  let assigns = 0;
  for await (const line of readLines(zf, e, onBytes)) {
    n++;
    if (line.charAt(8) === "#") {
      const [stop, ref, kind, ...rest] = line.trim().split(/\s+/);
      insDef.run(name, n, Number(stop), ref, kind, rest.join(" "));
      tick();
      continue;
    }
    assigns++;
    hash.update(line);
    hash.update("\n");
    if (!loadAssignments) continue;
    const t = parseHrdfTime(line.slice(31, 35));
    const bf = line.slice(36, 42).trim();
    insAssign.run(Number(line.slice(0, 7)), Number(line.slice(8, 14)), line.slice(15, 21), line.slice(22, 30).trim(), t.minutes, bf ? Number(bf) : null);
    tick();
  }
  const digest = hash.digest("hex");
  const meta = db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)");
  meta.run(`gleise_hash_${name}`, `${assigns}:${digest}`);
  if (loadAssignments) meta.run("gleise_assign_source", name);
  return n;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
