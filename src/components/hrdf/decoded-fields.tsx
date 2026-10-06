import Link from "next/link";
import type { Field } from "@/lib/hrdf/decoders";
import { hrefFor } from "@/lib/links";
import { cn } from "@/lib/utils";

export function FieldValue({ f }: { f: Field }) {
  const content = (
    <>
      {f.color ? <span className="mr-1.5 inline-block size-3 rounded-sm border align-[-1px]" style={{ background: f.color }} /> : null}
      {f.value}
    </>
  );
  const cls = cn(f.mono && "font-mono text-[12.5px]");
  if (f.link) {
    return (
      <Link href={hrefFor(f.link)} className={cn(cls, "link-u")}>
        {content}
      </Link>
    );
  }
  return <span className={cls}>{content}</span>;
}

/** Compact inline list of decoded fields (label: value). */
export function DecodedInline({ fields, className }: { fields: Field[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-x-4 gap-y-1", className)}>
      {fields.map((f, i) => (
        <span key={i} className="inline-flex items-baseline gap-1.5 text-sm">
          <span className="eyebrow !text-[9.5px]">{f.label}</span>
          <FieldValue f={f} />
        </span>
      ))}
    </div>
  );
}
