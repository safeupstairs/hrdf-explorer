"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export const NAV = [
  { href: "/stations", label: "Stations" },
  { href: "/journeys", label: "Journeys" },
  { href: "/bitfields", label: "Bitfields" },
  { href: "/files/FPLAN", label: "FPLAN" },
  { href: "/files", label: "All files" },
];

export function NavLinks() {
  const path = usePathname();
  const active = (href: string) => (href === "/files" ? path === "/files" || (path.startsWith("/files/") && !path.startsWith("/files/FPLAN")) : path.startsWith(href));
  return (
    <nav className="hidden items-center gap-0.5 md:flex">
      {NAV.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          className={cn(
            "relative rounded-md px-2.5 py-1.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:text-foreground",
            active(n.href) && "text-foreground after:absolute after:inset-x-2.5 after:-bottom-[13px] after:h-[3px] after:bg-foreground",
          )}
        >
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

export function MobileNav() {
  const path = usePathname();
  return (
    <nav className="sticky bottom-0 z-40 grid grid-cols-5 border-t bg-background/95 backdrop-blur md:hidden">
      {NAV.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          className={cn("py-2.5 text-center text-[11.5px] font-medium text-muted-foreground", path.startsWith(n.href) && "text-primary")}
        >
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
