/**
 * Decoders for every non-FPLAN HRDF 5.40 file. Each decoder turns one raw
 * line (plus the section header it lives under, for files that are split into
 * `<text>` / `<deu>` / `% heading` blocks) into labelled fields with optional
 * cross-links. Unknown files fall back to a whitespace tokenizer.
 */

export type LinkKind =
  | "station"
  | "bitfield"
  | "admin"
  | "infotext"
  | "category"
  | "line"
  | "attribute"
  | "direction"
  | "journey"
  | "trackref";

export interface Link {
  kind: LinkKind;
  id: string;
  /** Extra discriminator, e.g. administration for a journey number. */
  extra?: string;
}

export interface Field {
  label: string;
  value: string;
  link?: Link;
  mono?: boolean;
  color?: string;
}

export interface Decoded {
  kind: string;
  fields: Field[];
}

const c = (l: string, from: number, to?: number) => l.slice(from - 1, to).trim();

const st = (label: string, v: string): Field =>
  v && /^\d{1,7}$/.test(v) ? { label, value: v.padStart(7, "0"), link: { kind: "station", id: String(Number(v)) }, mono: true } : { label, value: v, mono: true };
const bf = (label: string, v: string): Field =>
  v && /^\d+$/.test(v) && Number(v) !== 0
    ? { label, value: v, link: { kind: "bitfield", id: String(Number(v)) }, mono: true }
    : { label, value: v ? `${v} (daily)` : "—", mono: true };
const adm = (label: string, v: string): Field =>
  v && /^\d+$/.test(v) ? { label, value: v, link: { kind: "admin", id: v.padStart(6, "0") }, mono: true } : { label, value: v || "—", mono: true };
const info = (label: string, v: string): Field =>
  v && /^\d+$/.test(v) ? { label, value: v, link: { kind: "infotext", id: String(Number(v)) }, mono: true } : { label, value: v || "—", mono: true };
const txt = (label: string, value: string, mono = false): Field => ({ label, value: value || "—", mono });
const time = (label: string, v: string): Field => {
  const s = v.trim();
  if (!s) return { label, value: "—", mono: true };
  const neg = s.startsWith("-");
  const d = neg ? s.slice(1) : s;
  const h = Number(d.slice(0, -2));
  const m = d.slice(-2);
  return { label, value: `${neg ? "−" : ""}${String(h).padStart(2, "0")}:${m}`, mono: true };
};
const journey = (label: string, nr: string, admin: string): Field => ({
  label,
  value: nr,
  link: { kind: "journey", id: String(Number(nr)), extra: admin.padStart(6, "0") },
  mono: true,
});

function comment(line: string): { body: string; note: string } {
  const i = line.indexOf("%");
  if (i < 0) return { body: line, note: "" };
  return { body: line.slice(0, i), note: line.slice(i + 1).trim() };
}

const LANG_SECTION = /^<(deu|fra|ita|eng|Deutsch|Englisch|Franzoesisch|Französisch|Italienisch|text)>$/i;

export function isSectionHeader(file: string, line: string): boolean {
  if (LANG_SECTION.test(line.trim())) return true;
  if (/^%/.test(line) && ["BHFART", "ZEITVS"].includes(baseName(file))) return true;
  return false;
}

export function baseName(file: string): string {
  return file.replace(/_(DE|EN|FR|IT|WGS|LV95)$/, "");
}

export function fileLanguage(file: string): string | null {
  const m = file.match(/_(DE|EN|FR|IT)$/);
  return m ? m[1] : null;
}

type DecoderFn = (line: string, section: string | null) => Decoded;

const decoders: Record<string, DecoderFn> = {
  ECKDATEN(line) {
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(line.trim())) return { kind: "date", fields: [txt("Date", line.trim(), true)] };
    const [name, created, version, source] = line.split("$");
    return {
      kind: "header",
      fields: [txt("Timetable", name), txt("Created", created, true), txt("Version", version, true), txt("Source", source)],
    };
  },

  BITFELD(line) {
    const [id, hex] = line.trim().split(/\s+/);
    return { kind: "bitfield", fields: [bf("Bitfield", id), txt("Hex", `${hex?.slice(0, 24) ?? ""}…`, true), txt("Hex chars", String(hex?.length ?? 0), true)] };
  },

  BAHNHOF(line) {
    const id = c(line, 1, 7);
    const rest = line.slice(12).trim();
    const parts = rest.split("$");
    const names: Record<string, string[]> = {};
    for (let i = 0; i < parts.length - 1; i += 2) {
      const tag = parts[i + 1]?.replace(/[<>]/g, "") ?? "?";
      (names[tag] ??= []).push(parts[i]);
    }
    const labels: Record<string, string> = { "1": "Name", "2": "Long name", "3": "Abbreviation", "4": "Synonym" };
    return {
      kind: "station",
      fields: [st("Stop", id), ...Object.entries(names).map(([k, v]) => txt(labels[k] ?? `Name <${k}>`, v.join(" · ")))],
    };
  },

  BFKOORD(line) {
    const { body, note } = comment(line);
    const [id, x, y, alt] = body.trim().split(/\s+/);
    const isWgs = x?.includes(".") && Math.abs(Number(x)) <= 180;
    return {
      kind: "coordinate",
      fields: [
        st("Stop", id),
        txt(isWgs ? "Longitude" : "E (LV95)", x, true),
        txt(isWgs ? "Latitude" : "N (LV95)", y, true),
        txt("Altitude (m)", alt, true),
        txt("Name", note),
      ],
    };
  },

  BFPRIOS(line) {
    return { kind: "priority", fields: [st("Stop", c(line, 1, 7)), txt("Transfer priority", c(line, 9, 10), true), txt("Name", c(line, 12))] };
  },

  KMINFO(line) {
    const { body, note } = comment(line);
    return { kind: "kminfo", fields: [st("Stop", c(body, 1, 7)), txt("Transfer point value", c(body, 9, 13), true), txt("Name", note)] };
  },

  BHFART(line, section) {
    const { body, note } = comment(line);
    const [id, type, sub, ...rest] = body.trim().split(/\s+/);
    const fields: Field[] = [st("Stop", id)];
    if (type === "G") {
      fields.push(txt("Record", "Global ID (SLOID)"), txt("Level", sub === "A" ? "A – stop area" : sub === "a" ? "a – quay / platform" : sub, true), txt("ID", rest.join(" "), true));
    } else if (type === "L") {
      fields.push(txt("Record", "Country"), txt("Country code", sub, true), txt("Name", note));
    } else if (type === "I") {
      fields.push(txt("Record", "Info text"), txt("Code", sub, true), info("Infotext", rest[0] ?? ""));
    } else if (type === "B") {
      fields.push(txt("Record", "Restriction"), txt("Restriction", sub, true), txt("Name", note));
    } else {
      fields.push(txt("Type", type ?? "", true), txt("Value", [sub, ...rest].join(" "), true), txt("Comment", note));
    }
    if (section) fields.push(txt("Section", section));
    return { kind: `bhfart-${type ?? "?"}`, fields };
  },

  METABHF(line) {
    if (line.startsWith("*A")) return { kind: "transfer-attribute", fields: [txt("Record", "Attribute of previous transfer"), { label: "Attribute", value: c(line, 4), link: { kind: "attribute", id: c(line, 4) }, mono: true }] };
    const colon = line.indexOf(":");
    if (colon > 0 && colon <= 8) {
      const members = line.slice(colon + 1).trim().split(/\s+/).filter(Boolean);
      return { kind: "group", fields: [st("Meta station", line.slice(0, colon)), txt("Record", "Station group"), ...members.map((m, i) => st(`Member ${i + 1}`, m))] };
    }
    return { kind: "transfer", fields: [st("From stop", c(line, 1, 7)), st("To stop", c(line, 9, 15)), txt("Transfer minutes", c(line, 17, 19), true)] };
  },

  UMSTEIGB(line) {
    const id = c(line, 1, 7);
    return {
      kind: "transfer-time",
      fields: [id === "9999999" ? txt("Stop", "9999999 (default for all stops)", true) : st("Stop", id), txt("Minutes (IC/IC)", c(line, 9, 10), true), txt("Minutes (other)", c(line, 12, 13), true), txt("Name", c(line, 15))],
    };
  },

  UMSTEIGV(line) {
    return {
      kind: "transfer-admin",
      fields: [st("Stop", c(line, 1, 7)), adm("Admin 1", c(line, 9, 14)), adm("Admin 2", c(line, 16, 21)), txt("Minutes", c(line, 23, 24), true), txt("Name", c(line, 26))],
    };
  },

  UMSTEIGL(line) {
    const cat = (label: string, v: string): Field => (v && v !== "*" ? { label, value: v, link: { kind: "category", id: v }, mono: true } : txt(label, v || "*", true));
    return {
      kind: "transfer-line",
      fields: [
        st("Stop", c(line, 1, 7)),
        adm("Admin 1", c(line, 9, 14)),
        cat("Category 1", c(line, 16, 18)),
        txt("Line 1", c(line, 20, 27), true),
        txt("Dir 1", c(line, 29, 29), true),
        adm("Admin 2", c(line, 31, 36)),
        cat("Category 2", c(line, 38, 40)),
        txt("Line 2", c(line, 42, 49), true),
        txt("Dir 2", c(line, 51, 51), true),
        txt("Minutes", c(line, 53, 55), true),
        txt("Guaranteed", c(line, 56, 56) === "!" ? "yes" : "no"),
        txt("Name", c(line, 58)),
      ],
    };
  },

  UMSTEIGZ(line) {
    return {
      kind: "transfer-journey",
      fields: [
        st("Stop", c(line, 1, 7)),
        journey("Journey 1", c(line, 9, 14), c(line, 16, 21)),
        adm("Admin 1", c(line, 16, 21)),
        journey("Journey 2", c(line, 23, 28), c(line, 30, 35)),
        adm("Admin 2", c(line, 30, 35)),
        txt("Minutes", c(line, 37, 39), true),
        txt("Guaranteed", c(line, 40, 40) === "!" ? "yes" : "no"),
        bf("Bitfield", c(line, 42, 47)),
        txt("Name", c(line, 49)),
      ],
    };
  },

  DURCHBI(line) {
    const { body, note } = comment(line);
    return {
      kind: "through-service",
      fields: [
        journey("Journey 1", c(body, 1, 6), c(body, 8, 13)),
        adm("Admin 1", c(body, 8, 13)),
        st("Last stop of J1", c(body, 15, 21)),
        journey("Journey 2", c(body, 23, 28), c(body, 30, 35)),
        adm("Admin 2", c(body, 30, 35)),
        bf("Bitfield", c(body, 37, 42)),
        st("First stop of J2", c(body, 44, 50)),
        txt("Attribute", c(body, 52, 53), true),
        txt("Comment", note),
      ],
    };
  },

  LINIE(line) {
    const id = c(line, 1, 7);
    const type = c(line, 9, 9);
    const rest = line.slice(10).trim();
    const lineLink: Field = { label: "Line", value: id, link: { kind: "line", id: String(Number(id)) }, mono: true };
    const labels: Record<string, string> = { K: "Line SLNID", N: "Short name", L: "Line name", R: "Region / route", D: "Description", I: "Info text", F: "Text colour", B: "Background colour", H: "Hex colour" };
    if (type === "F" || type === "B") {
      const [r, g, b] = rest.split(/\s+/).map(Number);
      return { kind: `line-${type}`, fields: [lineLink, txt("Record", labels[type]), { label: "RGB", value: rest, color: `rgb(${r}, ${g}, ${b})`, mono: true }] };
    }
    if (type === "I") {
      const [code, nr] = rest.split(/\s+/);
      return { kind: "line-I", fields: [lineLink, txt("Record", labels.I), txt("Code", code, true), info("Infotext", nr ?? "")] };
    }
    if (["N", "L", "R", "D"].includes(type)) {
      const [, ...v] = rest.split(" ");
      return { kind: `line-${type}`, fields: [lineLink, txt("Record", labels[type]), txt("Value type", rest.split(" ")[0], true), txt("Value", v.join(" "))] };
    }
    return { kind: `line-${type}`, fields: [lineLink, txt("Record", labels[type] ?? type), txt("Value", rest, true)] };
  },

  BETRIEB(line) {
    const key = c(line, 1, 5);
    const rest = line.slice(6).trim();
    if (rest.startsWith(":")) {
      const admins = rest.slice(1).trim().split(/\s+/);
      return { kind: "operator-admins", fields: [txt("Operator", key, true), txt("Record", "Administration numbers"), ...admins.map((a, i) => adm(`Admin ${i + 1}`, a))] };
    }
    if (rest.startsWith("N")) return { kind: "operator-sboid", fields: [txt("Operator", key, true), txt("Record", "Business org. ID (SBOID)"), txt("SBOID", rest.slice(1).trim().replace(/"/g, ""), true)] };
    const m = rest.match(/K "([^"]*)"\s*L "([^"]*)"\s*V "([^"]*)"/);
    if (m) return { kind: "operator-names", fields: [txt("Operator", key, true), txt("Short", m[1], true), txt("Abbreviation", m[2], true), txt("Full name", m[3])] };
    return { kind: "operator", fields: [txt("Operator", key, true), txt("Value", rest)] };
  },

  ZUGART(line, section) {
    if (line.startsWith("*I")) {
      const [, code, nr] = line.trim().split(/\s+/);
      return { kind: "category-infotext", fields: [txt("Record", "Infotext of previous category"), txt("Code", code, true), info("Infotext", nr ?? "")] };
    }
    if (section) {
      const m = line.match(/^(class|option|category)(\d+)\s+(.*)$/);
      if (m) return { kind: `text-${m[1]}`, fields: [txt("Language", section), txt("Kind", m[1]), txt("Number", m[2], true), txt("Text", m[3])] };
      return { kind: "text", fields: [txt("Language", section), txt("Text", line)] };
    }
    const code = c(line, 1, 3);
    return {
      kind: "category",
      fields: [
        { label: "Category", value: code, link: { kind: "category", id: code }, mono: true },
        txt("Product class", c(line, 5, 6), true),
        txt("Tariff group", c(line, 8, 8), true),
        txt("Output control", c(line, 10, 11), true),
        txt("Display name", c(line, 13, 20), true),
        txt("Surcharge", c(line, 22, 22), true),
        txt("Flag", c(line, 24, 24), true),
        txt("Category no.", c(line, 31, 34), true),
      ],
    };
  },

  ATTRIBUT(line, section) {
    if (section) {
      const code = c(line, 1, 3);
      return { kind: "attribute-text", fields: [{ label: "Attribute", value: code, link: { kind: "attribute", id: code }, mono: true }, txt("Language", section), txt("Text", line.slice(4).trim())] };
    }
    const code = c(line, 1, 2);
    return {
      kind: "attribute",
      fields: [
        { label: "Attribute", value: code, link: { kind: "attribute", id: code }, mono: true },
        txt("Stop relevance", c(line, 4, 4), true),
        txt("Priority", c(line, 6, 8), true),
        txt("Detail sort", c(line, 10, 11), true),
      ],
    };
  },

  RICHTUNG(line) {
    const code = c(line, 1, 7);
    return { kind: "direction", fields: [{ label: "Direction", value: code, link: { kind: "direction", id: code }, mono: true }, txt("Text", line.slice(8).trim())] };
  },

  INFOTEXT(line) {
    const id = c(line, 1, 9);
    const text = line.slice(10).trim();
    return { kind: "infotext", fields: [info("Infotext", id), txt("Text", text, /^(ch|CH):/.test(text))] };
  },

  FEIERTAG(line) {
    const date = c(line, 1, 10);
    const names = [...line.slice(11).matchAll(/([^<]+)<(\w+)>/g)].map((m) => txt(m[2].toUpperCase(), m[1].trim()));
    return { kind: "holiday", fields: [txt("Date", date, true), ...names] };
  },

  ZEITVS(line, section) {
    const { body, note } = comment(line);
    const t = body.trim().split(/\s+/).filter(Boolean);
    if (!t.length) return { kind: "comment", fields: [txt("Comment", note || line.trim())] };
    const fields: Field[] = [/^\d{7}$/.test(t[0]) ? st("Stop / region", t[0]) : txt("Key", t[0], true), txt("Offset", t[1] ?? "", true)];
    for (let i = 2, k = 1; i + 4 < t.length + 1 && t[i]; i += 5, k++) {
      fields.push(txt(`Summer ${k} offset`, t[i], true), txt(`From`, `${t[i + 1] ?? ""} ${t[i + 2] ?? ""}`, true), txt(`Until`, `${t[i + 3] ?? ""} ${t[i + 4] ?? ""}`, true));
    }
    if (note) fields.push(txt("Comment", note));
    if (section) fields.push(txt("Section", section));
    return { kind: "timezone", fields };
  },

  GLEISE(line) {
    if (line.charAt(8) === "#") {
      const [id, ref, kind, ...rest] = line.trim().split(/\s+/);
      const kinds: Record<string, string> = { G: "Track label", g: "Track SLOID", k: "Coordinates", A: "Sector" };
      return { kind: `track-${kind}`, fields: [st("Stop", id), { label: "Track ref", value: ref, link: { kind: "trackref", id: ref, extra: String(Number(id)) }, mono: true }, txt("Record", kinds[kind] ?? kind), txt("Value", rest.join(" "), true)] };
    }
    return {
      kind: "track-assignment",
      fields: [st("Stop", c(line, 1, 7)), journey("Journey", c(line, 9, 14), c(line, 16, 21)), adm("Admin", c(line, 16, 21)), txt("Track ref", c(line, 23, 30), true), time("Time", c(line, 32, 35)), bf("Bitfield", c(line, 37, 42))],
    };
  },
};

decoders.BITFIELD = decoders.BITFELD;
decoders.GLEIS = decoders.GLEISE;

export function fallbackDecode(line: string): Decoded {
  const { body, note } = comment(line);
  const tokens = body.trim().split(/\s+/).filter(Boolean);
  const fields = tokens.map((t, i) => (/^\d{7}$/.test(t) && i === 0 ? st(`Token ${i + 1}`, t) : txt(`Token ${i + 1}`, t, true)));
  if (note) fields.push(txt("Comment", note));
  return { kind: "generic", fields };
}

export function hasDecoder(file: string): boolean {
  return baseName(file) in decoders;
}

export function decodeLine(file: string, line: string, section: string | null = null): Decoded {
  const fn = decoders[baseName(file)];
  if (!fn) return fallbackDecode(line);
  try {
    return fn(line, section);
  } catch {
    return fallbackDecode(line);
  }
}

/** Primary lookup key for a raw line (used for keyed lookups across files). */
export function lineKey(file: string, line: string): string {
  const b = baseName(file);
  if (b === "METABHF" && line.startsWith("*A")) return "*A";
  const first = line.trim().split(/[\s:]+/)[0] ?? "";
  if (b === "ZUGART" || b === "ATTRIBUT" || b === "RICHTUNG") return first;
  if (/^\d+$/.test(first)) return String(Number(first));
  return first;
}

export const FILE_DESCRIPTIONS: Record<string, string> = {
  ECKDATEN: "Timetable validity period and dataset version",
  BITFELD: "Operating-day bitfields (hex, one bit per day)",
  BAHNHOF: "Stops: number (DIDOK / BPUIC) and names",
  BFKOORD: "Stop coordinates",
  BFPRIOS: "Transfer priority per stop",
  KMINFO: "Transfer point / node values per stop",
  BHFART: "Stop types, SLOIDs, countries and restrictions",
  METABHF: "Meta-stations (station groups) and walking transfers",
  UMSTEIGB: "Standard transfer times per stop",
  UMSTEIGV: "Transfer times between administrations",
  UMSTEIGL: "Transfer times between lines",
  UMSTEIGZ: "Transfer times between specific journeys",
  DURCHBI: "Through-services (journey continues as another)",
  LINIE: "Line definitions: names, colours, SLNIDs",
  BETRIEB: "Operators and their administration numbers",
  ZUGART: "Transport categories (Gattungen), classes and texts",
  ATTRIBUT: "Service attributes and their texts",
  RICHTUNG: "Direction texts",
  INFOTEXT: "Info texts (incl. SJYID journey IDs)",
  FEIERTAG: "Public holidays",
  ZEITVS: "Time-zone offsets and DST rules",
  GLEISE: "Track / platform assignments and definitions",
  GLEIS: "Track / platform assignments and definitions",
  FPLAN: "Journeys: *Z/*G/*A/*I/*L/*R/*CI/*CO lines and stop times",
  BITFIELD: "Operating-day bitfields (duplicate of BITFELD)",
};

export function describeFile(file: string): string {
  return FILE_DESCRIPTIONS[baseName(file)] ?? FILE_DESCRIPTIONS[file] ?? "Unrecognised file (generic view)";
}
