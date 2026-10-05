import type { Metadata } from "next";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import { MobileNav } from "@/components/nav-links";
import { THEME_SCRIPT } from "@/components/theme-toggle";
import "./globals.css";

const interTight = Inter_Tight({ variable: "--font-inter-tight", subsets: ["latin"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "HRDF Explorer", template: "%s · HRDF Explorer" },
  description: "Browse Swiss HRDF timetable data: stations, DIDOK numbers, journeys, Zugnummern, bitfields and every raw record.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${interTight.variable} ${jetbrains.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-8 pb-16 sm:px-6">{children}</main>
        <footer className="border-t">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-muted-foreground sm:px-6">
            <span>Data: HRDF 5.40 from opentransportdata.swiss · parsed locally into SQLite</span>
            <span className="font-mono">HRDF Explorer</span>
          </div>
        </footer>
        <MobileNav />
      </body>
    </html>
  );
}
