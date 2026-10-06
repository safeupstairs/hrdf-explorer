import assert from "node:assert/strict";
import { test } from "node:test";
import { mapScriptProgress, parseProgressLine, PROGRESS_PREFIX } from "./import-progress";

test("parseProgressLine reads a prefixed JSON payload", () => {
  const line = `${PROGRESS_PREFIX} ${JSON.stringify({ phase: "building", pct: 41.2, message: "Reading FPLAN…", bytes: 10, totalBytes: 20 })}`;
  assert.deepEqual(parseProgressLine(line), {
    phase: "building",
    pct: 41.2,
    message: "Reading FPLAN…",
    bytes: 10,
    totalBytes: 20,
  });
});

test("parseProgressLine ignores ordinary log lines", () => {
  assert.equal(parseProgressLine("14:02:11  FPLAN: 12 lines"), null);
  assert.equal(parseProgressLine(""), null);
  assert.equal(parseProgressLine(`${PROGRESS_PREFIX} not-json`), null);
});

test("mapScriptProgress reserves 12% for download then scales the importer", () => {
  assert.equal(mapScriptProgress("fetch", 0), 0);
  assert.equal(mapScriptProgress("fetch", 100), 12);
  assert.equal(mapScriptProgress("build", 0), 12);
  assert.equal(mapScriptProgress("build", 100), 100);
  assert.equal(mapScriptProgress("build", 50), 56);
});
