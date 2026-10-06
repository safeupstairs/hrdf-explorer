import "server-only";
import Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

export const DB_PATH = path.resolve(process.env.HRDF_DB ?? "data/hrdf.sqlite");
export const ZIP_PATH = path.resolve(process.env.HRDF_ZIP ?? "data/hrdf.zip");
export const DATA_DIR = path.dirname(DB_PATH);

const g = globalThis as unknown as {
  __hrdfDb?: Database.Database | null;
  __hrdfDbMtime?: number;
  __hrdfHasDb?: { mtime: number; ok: boolean };
};

export class NoDataError extends Error {
  constructor() {
    super(`HRDF database not found at ${DB_PATH}`);
  }
}

/** True when the SQLite file exists and has imported HRDF tables (not empty/truncated). */
export function isUsableDbFile(file: string): boolean {
  if (!existsSync(file)) return false;
  try {
    if (statSync(file).size < 100) return false;
    const d = new Database(file, { readonly: true, fileMustExist: true });
    try {
      const row = d.prepare("SELECT 1 AS ok FROM files LIMIT 1").get();
      return !!row;
    } finally {
      d.close();
    }
  } catch {
    return false;
  }
}

export function hasDb(): boolean {
  if (!existsSync(DB_PATH)) {
    g.__hrdfHasDb = undefined;
    return false;
  }
  const mtime = statSync(DB_PATH).mtimeMs;
  if (g.__hrdfHasDb && g.__hrdfHasDb.mtime === mtime) return g.__hrdfHasDb.ok;
  const ok = isUsableDbFile(DB_PATH);
  g.__hrdfHasDb = { mtime, ok };
  return ok;
}

export function resetDb() {
  if (g.__hrdfDb) {
    try {
      g.__hrdfDb.close();
    } catch {
      /* already closed */
    }
    g.__hrdfDb = null;
  }
  g.__hrdfDbMtime = undefined;
  g.__hrdfHasDb = undefined;
}

export function db(): Database.Database {
  const mtime = existsSync(DB_PATH) ? statSync(DB_PATH).mtimeMs : 0;
  if (g.__hrdfDb && g.__hrdfDbMtime === mtime) return g.__hrdfDb;
  if (g.__hrdfDb) {
    try {
      g.__hrdfDb.close();
    } catch {
      /* already closed */
    }
    g.__hrdfDb = null;
  }
  if (!existsSync(DB_PATH)) throw new NoDataError();
  const d = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  d.pragma("cache_size = -200000");
  d.pragma("mmap_size = 3000000000");
  g.__hrdfDb = d;
  g.__hrdfDbMtime = mtime;
  return d;
}
