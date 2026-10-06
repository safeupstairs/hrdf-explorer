import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import { DATA_DIR, DB_PATH, hasDb, resetDb, ZIP_PATH } from "./db";
import { resetLookups } from "./hrdf/lookups";
import { mapScriptProgress, parseProgressLine } from "./import-progress";
import type { ImportSource, ImportState, ImportStatus } from "./import-status";

export type { ImportSource, ImportState, ImportStatus };

export class ImportBusyError extends Error {
  constructor() {
    super("An import is already running.");
    this.name = "ImportBusyError";
  }
}

const STATUS_PATH = path.join(DATA_DIR, "import-status.json");
const TSX = path.join(process.cwd(), "node_modules/tsx/dist/cli.mjs");

const g = globalThis as unknown as {
  __hrdfImport?: { child: ChildProcess | null; status: ImportStatus; stderr: string; live: boolean };
};

function isBusy(state: ImportState) {
  return state === "uploading" || state === "downloading" || state === "building";
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function idleStatus(): ImportStatus {
  const ready = hasDb();
  return {
    state: "idle",
    source: null,
    filename: null,
    pct: 0,
    message: ready ? "HRDF database is ready." : "No HRDF database yet.",
    error: null,
    startedAt: null,
    finishedAt: null,
    bytes: null,
    totalBytes: null,
    dbBytes: ready && existsSync(DB_PATH) ? statSync(DB_PATH).size : null,
    zipReady: existsSync(ZIP_PATH),
    ready,
    pid: null,
  };
}

function readStatusFile(): ImportStatus | null {
  try {
    if (!existsSync(STATUS_PATH)) return null;
    return JSON.parse(readFileSync(STATUS_PATH, "utf8")) as ImportStatus;
  } catch {
    return null;
  }
}

function persist(status: ImportStatus) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STATUS_PATH, JSON.stringify(status));
}

function ensureLoaded() {
  if (g.__hrdfImport) return;
  g.__hrdfImport = { child: null, status: readStatusFile() ?? idleStatus(), stderr: "", live: false };
}

function snapshot(): ImportStatus {
  const s = g.__hrdfImport!.status;
  return {
    ...s,
    ready: hasDb(),
    zipReady: existsSync(ZIP_PATH),
    dbBytes: hasDb() && existsSync(DB_PATH) ? statSync(DB_PATH).size : s.dbBytes,
  };
}

function patch(partial: Partial<ImportStatus>): ImportStatus {
  ensureLoaded();
  g.__hrdfImport!.status = { ...g.__hrdfImport!.status, ...partial };
  persist(g.__hrdfImport!.status);
  return snapshot();
}

export function getImportStatus(): ImportStatus {
  ensureLoaded();
  const s = g.__hrdfImport!.status;
  if (isBusy(s.state) && !g.__hrdfImport!.child && !g.__hrdfImport!.live) {
    if (s.pid && isAlive(s.pid)) return snapshot();
    if (hasDb()) return finishSuccess("Importer finished after the app lost the process handle.");
    return finishError("Import interrupted. The process exited before the database was ready.");
  }
  return snapshot();
}

function assertNotBusy() {
  const s = getImportStatus();
  if (isBusy(s.state) && (g.__hrdfImport!.child || g.__hrdfImport!.live || (s.pid && isAlive(s.pid)))) {
    throw new ImportBusyError();
  }
}

function finishSuccess(message?: string): ImportStatus {
  g.__hrdfImport!.live = false;
  resetDb();
  resetLookups();
  const dbBytes = existsSync(DB_PATH) ? statSync(DB_PATH).size : null;
  const started = g.__hrdfImport!.status.startedAt;
  const elapsed = started ? Math.round((Date.now() - Date.parse(started)) / 1000) : null;
  const size = dbBytes != null ? `${(dbBytes / 1e9).toFixed(2)} GB` : "SQLite";
  return patch({
    state: "success",
    pct: 100,
    message: message ?? `Imported ${size}${elapsed != null ? ` in ${elapsed}s` : ""}.`,
    error: null,
    finishedAt: new Date().toISOString(),
    dbBytes,
    ready: true,
    zipReady: existsSync(ZIP_PATH),
    pid: null,
  });
}

function finishError(error: string): ImportStatus {
  g.__hrdfImport!.live = false;
  return patch({
    state: "error",
    error,
    message: error,
    finishedAt: new Date().toISOString(),
    pid: null,
    zipReady: existsSync(ZIP_PATH),
    ready: hasDb(),
  });
}

export function sanitizeZipName(name: string): string {
  const base = path.basename(name.replace(/\\/g, "/"));
  if (!base || base === "." || base === "..") throw new Error("Invalid file name.");
  if (!/\.zip$/i.test(base)) throw new Error("Choose an HRDF .zip file.");
  return base;
}

function assertReadableZip(file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (err, zf) => {
      if (err || !zf) {
        reject(new Error("That file is not a readable zip. Export an HRDF 5.40 zip from opentransportdata.swiss."));
        return;
      }
      zf.close();
      resolve();
    });
  });
}

function runScript(scriptRel: string, args: string[]): ChildProcess {
  return spawn(process.execPath, [TSX, scriptRel, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function attach(child: ChildProcess, script: "fetch" | "build") {
  g.__hrdfImport!.child = child;
  g.__hrdfImport!.stderr = "";
  patch({ pid: child.pid ?? null });
  let buf = "";
  const onChunk = (chunk: Buffer) => {
    buf += chunk.toString("utf8");
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      const p = parseProgressLine(line.replace(/\r/g, ""));
      if (!p) continue;
      patch({
        state: script === "fetch" ? "downloading" : "building",
        pct: mapScriptProgress(script, p.pct),
        message: p.message,
        bytes: p.bytes ?? g.__hrdfImport!.status.bytes,
        totalBytes: p.totalBytes ?? g.__hrdfImport!.status.totalBytes,
      });
    }
  };
  child.stdout?.on("data", onChunk);
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    g.__hrdfImport!.stderr = (g.__hrdfImport!.stderr + text).slice(-4000);
    onChunk(chunk);
  });
}

function startBuildProcess() {
  if (!existsSync(ZIP_PATH)) {
    finishError("No HRDF zip on disk. Upload a file or fetch the newest build.");
    return;
  }
  patch({
    state: "building",
    message: "Starting importer…",
    pct: Math.max(g.__hrdfImport!.status.pct, 12),
    error: null,
  });
  const child = runScript("scripts/build-db.ts", [ZIP_PATH, DB_PATH]);
  attach(child, "build");
  child.on("close", (code) => {
    g.__hrdfImport!.child = null;
    if (code === 0) {
      finishSuccess();
      return;
    }
    const err = g.__hrdfImport!.stderr.trim() || `Importer exited with code ${code}.`;
    finishError(err.split("\n").filter(Boolean).slice(-4).join("\n"));
  });
}

function startFetchProcess() {
  mkdirSync(DATA_DIR, { recursive: true });
  patch({
    state: "downloading",
    source: "fetch",
    filename: "newest opentransportdata.swiss build",
    pct: 0,
    message: "Fetching the newest HRDF zip…",
    error: null,
    startedAt: g.__hrdfImport!.status.startedAt ?? new Date().toISOString(),
    finishedAt: null,
    bytes: 0,
    totalBytes: null,
    ready: hasDb(),
  });
  const child = runScript("scripts/fetch-hrdf.ts", []);
  attach(child, "fetch");
  child.on("close", (code) => {
    g.__hrdfImport!.child = null;
    if (code === 0) {
      patch({ zipReady: true, message: "Download complete. Starting import…" });
      startBuildProcess();
      return;
    }
    const err = g.__hrdfImport!.stderr.trim() || `Download failed (exit ${code}).`;
    finishError(err.split("\n").filter(Boolean).slice(-4).join("\n"));
  });
}

export function startFetch(): ImportStatus {
  assertNotBusy();
  ensureLoaded();
  g.__hrdfImport!.live = true;
  g.__hrdfImport!.status = {
    ...idleStatus(),
    state: "downloading",
    source: "fetch",
    startedAt: new Date().toISOString(),
    message: "Fetching the newest HRDF zip…",
    ready: hasDb(),
  };
  persist(g.__hrdfImport!.status);
  startFetchProcess();
  return snapshot();
}

export function startBuild(): ImportStatus {
  assertNotBusy();
  if (!existsSync(ZIP_PATH)) throw new Error("No HRDF zip on disk. Upload a file or fetch the newest build.");
  ensureLoaded();
  g.__hrdfImport!.live = true;
  g.__hrdfImport!.status = {
    ...idleStatus(),
    state: "building",
    source: g.__hrdfImport!.status.source ?? "upload",
    filename: g.__hrdfImport!.status.filename ?? path.basename(ZIP_PATH),
    startedAt: new Date().toISOString(),
    message: "Starting importer…",
    pct: 12,
    zipReady: true,
    ready: hasDb(),
  };
  persist(g.__hrdfImport!.status);
  startBuildProcess();
  return snapshot();
}

export async function saveUpload(
  request: Request,
  filename: string,
  opts: { offset?: number; final?: boolean; totalBytes?: number } = {},
): Promise<ImportStatus> {
  const offset = opts.offset ?? 0;
  const final = opts.final ?? true;
  const name = sanitizeZipName(filename);
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${ZIP_PATH}.part`;
  const total = opts.totalBytes || Number(request.headers.get("content-length") ?? 0) || 0;

  if (offset === 0) {
    assertNotBusy();
    ensureLoaded();
    g.__hrdfImport!.live = true;
    g.__hrdfImport!.status = {
      ...idleStatus(),
      state: "uploading",
      source: "upload",
      filename: name,
      pct: 0,
      message: `Uploading ${name}…`,
      startedAt: new Date().toISOString(),
      bytes: 0,
      totalBytes: total || null,
      ready: hasDb(),
    };
    persist(g.__hrdfImport!.status);
  } else if (getImportStatus().state !== "uploading") {
    throw new Error("No upload in progress.");
  }

  if (!request.body) throw new Error("Missing file body.");
  try {
    const nodeStream = Readable.fromWeb(request.body as import("node:stream/web").ReadableStream);
    let done = offset;
    let last = 0;
    nodeStream.on("data", (chunk: Buffer) => {
      done += chunk.length;
      if (Date.now() - last > 200) {
        last = Date.now();
        const whole = g.__hrdfImport!.status.totalBytes || total;
        patch({
          pct: whole ? (done / whole) * 12 : 1,
          bytes: done,
          totalBytes: whole || done,
          message: `Uploading ${name} (${(done / 1e6).toFixed(1)} MB)…`,
        });
      }
    });
    await pipeline(nodeStream, createWriteStream(tmp, { flags: offset === 0 ? "w" : "r+", start: offset }));
    const size = statSync(tmp).size;
    const whole = g.__hrdfImport!.status.totalBytes || total || size;
    patch({ pct: whole ? (size / whole) * 12 : 1, bytes: size, totalBytes: whole });
    if (!final) return snapshot();
    renameSync(tmp, ZIP_PATH);
    await assertReadableZip(ZIP_PATH);
    patch({ zipReady: true, pct: 12, bytes: size, message: "Upload complete. Starting import…" });
    startBuildProcess();
    return snapshot();
  } catch (err) {
    if (final || offset === 0) {
      try {
        unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    finishError(message);
    throw err;
  }
}
