import type { Link } from "@/lib/hrdf/decoders";

export function hrefFor(link: Link): string {
  switch (link.kind) {
    case "station":
      return `/stations/${link.id}`;
    case "bitfield":
      return `/bitfields/${link.id}`;
    case "journey":
      return `/journeys?nr=${link.id}${link.extra ? `&admin=${link.extra}` : ""}`;
    case "trackref":
      return `/files/GLEISE_WGS?view=defs&stop=${link.extra ?? ""}`;
    case "admin":
      return `/ref/admin/${link.id}`;
    default:
      return `/ref/${link.kind}/${encodeURIComponent(link.id)}`;
  }
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const pad7 = (id: number | string) => String(id).padStart(7, "0");
