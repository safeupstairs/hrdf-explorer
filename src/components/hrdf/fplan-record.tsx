import type { ParsedFplanLine } from "@/lib/hrdf/fplan";
import type { Field } from "@/lib/hrdf/decoders";
import { DecodedInline } from "./decoded-fields";

const LABELS: Record<string, string> = {
  journeyNumber: "Journey nr",
  administration: "Admin",
  variant: "Variant",
  cycleCount: "Cycle count",
  cycleMinutes: "Cycle min",
  category: "Category",
  fromStop: "From",
  toStop: "To",
  depTime: "Dep",
  arrTime: "Arr",
  attribute: "Attribute",
  bitfield: "Bitfield",
  infoCode: "Info code",
  infotext: "Infotext",
  line: "Line",
  direction: "Direction",
  directionCode: "Dir. code",
  minutes: "Minutes",
  borderPoint: "Border point",
  lastStopBefore: "Last stop before",
  firstStopAfter: "First stop after",
  stop: "Stop",
  name: "Name",
  flag: "Flag",
  content: "Content",
};

/** Turns a parsed FPLAN line into linked fields. */
export function fplanFields(p: ParsedFplanLine, fromName?: string | null, toName?: string | null): Field[] {
  const out: Field[] = [];
  for (const [k, v] of Object.entries(p.fields)) {
    if (!v) continue;
    const label = LABELS[k] ?? k;
    if (k === "fromStop" || k === "toStop" || k === "stop" || k === "lastStopBefore" || k === "firstStopAfter" || k === "borderPoint") {
      const nm = k === "fromStop" ? fromName : k === "toStop" ? toName : null;
      out.push({ label, value: nm ? `${v} ${nm}` : v, link: { kind: "station", id: String(Number(v)) }, mono: true });
    } else if (k === "bitfield") {
      out.push({ label, value: v, link: Number(v) ? { kind: "bitfield", id: String(Number(v)) } : undefined, mono: true });
    } else if (k === "infotext") {
      out.push({ label, value: v, link: { kind: "infotext", id: String(Number(v)) }, mono: true });
    } else if (k === "administration") {
      out.push({ label, value: v, link: { kind: "admin", id: v }, mono: true });
    } else if (k === "category") {
      out.push({ label, value: v, link: { kind: "category", id: v }, mono: true });
    } else if (k === "attribute") {
      out.push({ label, value: v, link: { kind: "attribute", id: v }, mono: true });
    } else if (k === "line" && v.startsWith("#")) {
      out.push({ label, value: v, link: { kind: "line", id: String(Number(v.slice(1))) }, mono: true });
    } else if (k === "directionCode") {
      out.push({ label, value: v, link: { kind: "direction", id: v }, mono: true });
    } else {
      out.push({ label, value: v, mono: true });
    }
  }
  if (p.comment) out.push({ label: "Comment", value: p.comment, mono: true });
  return out;
}

export function FplanRecordFields({ parsed, fromName, toName }: { parsed: ParsedFplanLine; fromName?: string | null; toName?: string | null }) {
  return <DecodedInline fields={fplanFields(parsed, fromName, toName)} />;
}
