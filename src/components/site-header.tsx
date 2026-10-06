import Link from "next/link";
import { Search } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { NavLinks } from "@/components/nav-links";
import { LangSelect } from "@/components/lang-select";
import { getLang } from "@/lib/lang";

export function Brand() {
  return (
    <Link href="/" className="group flex items-center gap-2.5">
      <span className="relative flex size-7 items-center justify-center rounded-[4px] bg-primary text-primary-foreground">
        <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
          <path d="M5 4h3v6.5h8V4h3v16h-3v-6.5H8V20H5z" fill="currentColor" />
        </svg>
      </span>
      <span className="leading-none">
        <span className="block text-[15px] font-extrabold tracking-tight">HRDF Explorer</span>
        <span className="eyebrow !text-[9px]">Swiss timetable data</span>
      </span>
    </Link>
  );
}

export async function SiteHeader() {
  const lang = await getLang();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-4 sm:px-6">
        <Brand />
        <NavLinks />
        <form action="/search" className="ml-auto flex min-w-0 flex-1 items-center sm:max-w-xs">
          <label className="relative w-full">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              name="q"
              placeholder="Station, DIDOK, Zugnummer…"
              className="h-8 w-full rounded-md border bg-card pr-2 pl-8 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>
        </form>
        <LangSelect lang={lang} />
        <ThemeToggle />
      </div>
      <div className="h-[3px] bg-primary" />
    </header>
  );
}
