/** Structured progress lines from fetch/build scripts for the in-app importer. */

export const PROGRESS_PREFIX = "HRDF_PROGRESS";

export type ProgressPayload = {
  phase: string;
  pct: number;
  message: string;
  bytes?: number;
  totalBytes?: number;
};

let lastEmit = 0;

export function emitProgress(p: ProgressPayload, opts?: { force?: boolean }) {
  const now = Date.now();
  if (!opts?.force && p.pct < 100 && now - lastEmit < 250) return;
  lastEmit = now;
  const pct = Math.max(0, Math.min(100, p.pct));
  process.stdout.write(`${PROGRESS_PREFIX} ${JSON.stringify({ ...p, pct })}\n`);
}

export function parseProgressLine(line: string): ProgressPayload | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(PROGRESS_PREFIX)) return null;
  const raw = trimmed.slice(PROGRESS_PREFIX.length).trim();
  try {
    const v = JSON.parse(raw) as ProgressPayload;
    if (typeof v.pct !== "number" || typeof v.message !== "string") return null;
    return v;
  } catch {
    return null;
  }
}

/** Map child-script % onto the overall 0–100 bar (download/upload is the first 12%). */
export function mapScriptProgress(script: "fetch" | "build", pct: number): number {
  const p = Math.max(0, Math.min(100, pct));
  return script === "fetch" ? p * 0.12 : 12 + p * 0.88;
}
