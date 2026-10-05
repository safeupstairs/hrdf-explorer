/**
 * Downloads an HRDF zip from opentransportdata.swiss.
 *
 *   npm run data:fetch                       # 2027 timetable (default)
 *   npm run data:fetch -- <url-or-dataset>   # any HRDF dataset slug or direct URL
 */
import { createWriteStream, mkdirSync, renameSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";

const DEFAULT_DATASET = "timetable-54-2027-hrdf";

function resolveUrl(arg: string | undefined): string {
  const v = arg ?? process.env.HRDF_URL ?? DEFAULT_DATASET;
  if (/^https?:\/\//.test(v)) return v;
  return `https://data.opentransportdata.swiss/en/dataset/${v}/permalink`;
}

async function main() {
  const url = resolveUrl(process.argv[2]);
  const out = path.resolve(process.env.HRDF_ZIP ?? "data/hrdf.zip");
  mkdirSync(path.dirname(out), { recursive: true });
  console.log(`Downloading ${url}`);
  const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": "hrdf-explorer/0.1" } });
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`);
  const total = Number(res.headers.get("content-length") ?? 0);
  const fileName = decodeURIComponent(res.url.match(/filename%3D([^&]+)/)?.[1] ?? res.url.split("?")[0].split("/").pop() ?? "");
  let done = 0;
  let last = 0;
  const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
  body.on("data", (chunk: Buffer) => {
    done += chunk.length;
    if (Date.now() - last > 1000) {
      last = Date.now();
      const pct = total ? ` (${((done / total) * 100).toFixed(1)}%)` : "";
      process.stdout.write(`\r  ${(done / 1e6).toFixed(1)} MB${pct}   `);
    }
  });
  const tmp = `${out}.part`;
  await pipeline(body, createWriteStream(tmp));
  renameSync(tmp, out);
  console.log(`\nSaved ${(done / 1e6).toFixed(1)} MB to ${out}${fileName ? ` (${fileName})` : ""}`);
  console.log("Next: npm run data:build");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
