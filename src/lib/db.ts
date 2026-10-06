import "server-only";
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import path from "node:path";

export const DB_PATH = path.resolve(process.env.HRDF_DB ?? "data/hrdf.sqlite");

const g = globalThis as unknown as { __hrdfDb?: Database.Database | null; __hrdfDbMtime?: number };

export class NoDataError extends Error {
  constructor() {
    super(`HRDF database not found at ${DB_PATH}`);
  }
}

export function hasDb(): boolean {
  return existsSync(DB_PATH);
}

export function db(): Database.Database {
  if (g.__hrdfDb) return g.__hrdfDb;
  if (!existsSync(DB_PATH)) throw new NoDataError();
  const d = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  d.pragma("cache_size = -200000");
  d.pragma("mmap_size = 3000000000");
  g.__hrdfDb = d;
  return d;
}
