"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/utils";

const LANGS = ["DE", "FR", "IT", "EN"] as const;

/** Picks which language variant of INFOTEXT / BETRIEB / ATTRIBUT / ZUGART texts is shown. */
export function LangSelect({ lang }: { lang: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className={cn("hidden overflow-hidden rounded-md border bg-card sm:flex", pending && "opacity-60")} title="Text language (INFOTEXT, BETRIEB, ATTRIBUT, ZUGART)">
      {LANGS.map((l) => (
        <button
          key={l}
          onClick={() => {
            document.cookie = `hrdf-lang=${l}; path=/; max-age=31536000; samesite=lax`;
            start(() => router.refresh());
          }}
          className={cn("px-1.5 py-1 font-mono text-[10.5px] font-semibold", l === lang ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
