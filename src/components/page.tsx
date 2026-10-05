import Link from "next/link";
import { ChevronLeft, ChevronRight, Database } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  children,
  aside,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  children?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b pb-6 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow mb-2">{eyebrow}</div> : null}
        <h1 className="text-[28px] leading-[1.05] font-extrabold tracking-[-0.025em] text-balance sm:text-[38px]">{title}</h1>
        {children ? <div className="mt-3 text-[15px] text-muted-foreground">{children}</div> : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  );
}

export function Section({ title, aside, children, className, id }: { title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("mt-10", className)}>
      <div className="mb-3 flex items-baseline justify-between gap-4 border-b border-foreground pb-2">
        <h2 className="text-[13px] font-bold tracking-[0.08em] uppercase">{title}</h2>
        {aside ? <div className="text-sm text-muted-foreground">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, href, sub }: { label: string; value: React.ReactNode; href?: string; sub?: React.ReactNode }) {
  const inner = (
    <div className="group h-full border-l-[3px] border-foreground/80 bg-card px-4 py-3 transition-colors hover:border-primary">
      <div className="eyebrow">{label}</div>
      <div className="mt-1 text-2xl font-extrabold tracking-tight tabular">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export function EmptyState({ title, children, icon }: { title: string; children?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed bg-paper px-6 py-14 text-center">
      <div className="mb-3 text-muted-foreground">{icon ?? <Database className="size-6" />}</div>
      <div className="text-[15px] font-semibold">{title}</div>
      {children ? <div className="mt-1.5 max-w-md text-sm text-muted-foreground">{children}</div> : null}
    </div>
  );
}

export function Pager({ offset, limit, total, hrefFor, count }: { offset: number; limit: number; total: number | null; count: number; hrefFor: (offset: number) => string }) {
  const hasPrev = offset > 0;
  const hasNext = total !== null ? offset + limit < total : count === limit;
  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-sm text-muted-foreground">
      <span className="font-mono text-xs tabular">
        {count ? `${(offset + 1).toLocaleString()}–${(offset + count).toLocaleString()}` : "0"}
        {total !== null ? ` of ${total.toLocaleString()}` : ""}
      </span>
      <div className="flex gap-1">
        <PagerLink href={hasPrev ? hrefFor(Math.max(0, offset - limit)) : null}>
          <ChevronLeft className="size-4" /> Prev
        </PagerLink>
        <PagerLink href={hasNext ? hrefFor(offset + limit) : null}>
          Next <ChevronRight className="size-4" />
        </PagerLink>
      </div>
    </div>
  );
}

function PagerLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  const cls = "inline-flex h-8 items-center gap-1 rounded-md border bg-card px-2.5 text-[13px] font-medium";
  if (!href) return <span className={cn(cls, "opacity-40")}>{children}</span>;
  return (
    <Link href={href} className={cn(cls, "text-foreground hover:border-foreground")}>
      {children}
    </Link>
  );
}

export function NoData() {
  return (
    <div className="mx-auto max-w-2xl py-16">
      <EmptyState title="No HRDF database found">
        <p>The explorer reads a local SQLite file built from the official HRDF zip. Create it with:</p>
        <pre className="mt-4 rounded-md bg-board p-4 text-left font-mono text-[12.5px] text-board-foreground">
          npm run data:fetch{"\n"}npm run data:build
        </pre>
        <p className="mt-3">Then reload this page.</p>
      </EmptyState>
    </div>
  );
}

export function FilterInput({ name, defaultValue, placeholder, label, className, type = "text" }: { name: string; defaultValue?: string; placeholder?: string; label: string; className?: string; type?: string }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="eyebrow !text-[9.5px]">{label}</span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="h-9 w-full min-w-0 rounded-md border bg-card px-2.5 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
    </label>
  );
}

export function SubmitButton({ children = "Apply" }: { children?: React.ReactNode }) {
  return (
    <button type="submit" className="h-9 shrink-0 self-end rounded-md bg-foreground px-4 text-sm font-semibold text-background transition-colors hover:bg-primary hover:text-primary-foreground">
      {children}
    </button>
  );
}
