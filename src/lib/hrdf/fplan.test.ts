import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatHrdfTimeField, parseFplanLine, parseStopField, resolveRange, veBitfieldAtStop, type RouteStop } from "./fplan";

describe("parseStopField", () => {
  it("treats empty as unspecified, not as stop 0", () => {
    assert.deepEqual(parseStopField(""), { stop: null, index: null });
  });
  it("parses #n as a 0-based route index", () => {
    assert.deepEqual(parseStopField("#3"), { stop: null, index: 3 });
    assert.equal(parseFplanLine("*A VE #3     8509251 000090").fromIndex, 3);
    assert.equal(parseFplanLine("*A VE #3     8509251 000090").fromStop, null);
  });
  it("parses a stop number", () => {
    assert.deepEqual(parseStopField("8509251"), { stop: 8509251, index: null });
  });
});

describe("formatHrdfTimeField", () => {
  it("formats HHHMM and occurrence indexes", () => {
    assert.equal(formatHrdfTimeField("00706"), "07:06");
    assert.equal(formatHrdfTimeField("00720"), "07:20");
    assert.equal(formatHrdfTimeField("-01933"), "−19:33");
    assert.equal(formatHrdfTimeField("02525"), "01:25 +1");
    assert.equal(formatHrdfTimeField("#2"), "occurrence 2");
  });
});

describe("route line columns (H §7.1.5)", () => {
  it("reads journey number, admin and X from cols 44–49 / 51–56 / 58", () => {
    const line = "8503000".padEnd(29) + " 00700" + " " + " 00701" + " " + "001109" + " " + "000011" + " " + "X";
    const p = parseFplanLine(line);
    assert.equal(p.fields.journeyNumber, "001109");
    assert.equal(p.fields.administration, "000011");
    assert.equal(p.fields.flag, "X");
  });
});

describe("*CI / *CO", () => {
  it("parses time columns and labels *CO as a line buffer", () => {
    const co = parseFplanLine("*CO 0002 8509000 8509251  00509  00703");
    assert.equal(co.fields.minutes, "0002");
    assert.equal(co.fields.depTime, "00509");
    assert.equal(co.fields.arrTime, "00703");
    assert.match(co.fields.role, /buffer/i);
    const ci = parseFplanLine("*CI 0001 8509000 8509251  00509  00703");
    assert.match(ci.fields.role, /Check-in/i);
  });
});

describe("resolveRange (H §7.1.1)", () => {
  const loop: RouteStop[] = [
    { stop: 8500692, arr: null, dep: 5 * 60 + 15 },
    { stop: 8500693, arr: 5 * 60 + 20, dep: 5 * 60 + 21 },
    { stop: 8500692, arr: 5 * 60 + 33, dep: null },
  ];

  it("uses first occurrence for from and last for to when times are omitted", () => {
    assert.deepEqual(resolveRange(loop, "8500692", "8500692"), { fromIndex: 0, toIndex: 2 });
  });

  it("disambiguates a loop with departure/arrival times", () => {
    assert.deepEqual(resolveRange(loop, "8500692", "8500692", "00515", "00533"), { fromIndex: 0, toIndex: 2 });
  });

  it("resolves #n as a route index and empty as first/last", () => {
    assert.deepEqual(resolveRange(loop, "#1", ""), { fromIndex: 1, toIndex: 2 });
    assert.deepEqual(resolveRange(loop, "", "#1"), { fromIndex: 0, toIndex: 1 });
  });

  it("resolves #n in the time column as the n-th occurrence", () => {
    assert.deepEqual(resolveRange(loop, "8500692", "8500692", "#0", "#1"), { fromIndex: 0, toIndex: 2 });
  });
});

describe("veBitfieldAtStop (M1 section boundary)", () => {
  // IR 38 *Z 001109 000072: VE Chur–Samedan (90) and Samedan–St. Moritz (daily).
  const ves = [
    { fromIndex: 0, toIndex: 10, bitfield: 90 },
    { fromIndex: 10, toIndex: 12, bitfield: null },
  ];

  it("uses the section that starts at the stop for a departure", () => {
    assert.equal(veBitfieldAtStop(ves, 10, "dep", 90), null);
  });

  it("uses the section that ends at the stop for an arrival", () => {
    assert.equal(veBitfieldAtStop(ves, 10, "arr", 90), 90);
  });

  it("uses the covering section for an interior stop", () => {
    assert.equal(veBitfieldAtStop(ves, 11, "dep", 90), null);
    assert.equal(veBitfieldAtStop(ves, 1, "dep", 90), 90);
  });
});
