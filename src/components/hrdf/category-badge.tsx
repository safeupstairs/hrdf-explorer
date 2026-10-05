import { cn } from "@/lib/utils";

/** Colours per HRDF product class (ZUGART column 5-6). */
const CLASS_COLORS: Record<number, { bg: string; fg: string; label: string }> = {
  0: { bg: "#eb0000", fg: "#fff", label: "High-speed" },
  1: { bg: "#eb0000", fg: "#fff", label: "Long-distance" },
  2: { bg: "#b5001f", fg: "#fff", label: "InterRegio" },
  3: { bg: "#8a1538", fg: "#fff", label: "RegioExpress" },
  4: { bg: "#0b7ea5", fg: "#fff", label: "Boat" },
  5: { bg: "#2a5fc4", fg: "#fff", label: "Regional / S-Bahn" },
  6: { bg: "#f2b705", fg: "#1a1a1a", label: "Bus" },
  7: { bg: "#7a4fb8", fg: "#fff", label: "Cableway" },
  8: { bg: "#5b6170", fg: "#fff", label: "Car train / extra" },
  9: { bg: "#17924d", fg: "#fff", label: "Tram / Metro" },
  13: { bg: "#6b7280", fg: "#fff", label: "Service" },
};

export function classColor(productClass: number | null | undefined) {
  return CLASS_COLORS[productClass ?? -1] ?? { bg: "#4b5563", fg: "#fff", label: "Other" };
}

export const PRODUCT_CLASSES = CLASS_COLORS;

export function CategoryBadge({
  category,
  line,
  productClass,
  lineBg,
  lineFg,
  size = "md",
  className,
}: {
  category: string | null;
  line?: string | null;
  productClass?: number | null;
  lineBg?: string | null;
  lineFg?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const c = classColor(productClass);
  const cat = category ?? "?";
  const showLine = line && !line.startsWith("#") && line.toUpperCase() !== cat.toUpperCase();
  const lineText = showLine ? (line!.toUpperCase().startsWith(cat.toUpperCase()) ? line!.slice(cat.length) : line) : null;
  const sizes = {
    sm: "h-5 text-[11px] px-1.5 gap-1",
    md: "h-6 text-[12.5px] px-2 gap-1.5",
    lg: "h-9 text-lg px-3 gap-2",
  };
  return (
    <span className={cn("inline-flex shrink-0 items-stretch overflow-hidden rounded-[3px] font-bold tracking-tight leading-none tabular", className)}>
      <span className={cn("inline-flex items-center", sizes[size])} style={{ background: c.bg, color: c.fg }}>
        {cat}
      </span>
      {lineText ? (
        <span
          className={cn("inline-flex items-center border-y border-r", sizes[size])}
          style={
            lineBg
              ? { background: lineBg, color: lineFg ?? "#fff", borderColor: lineBg }
              : { borderColor: c.bg, color: "var(--foreground)", background: "var(--card)" }
          }
        >
          {lineText}
        </span>
      ) : null}
    </span>
  );
}
