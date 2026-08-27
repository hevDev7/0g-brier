import type {Metadata} from "next";
import {DM_Mono, Manrope} from "next/font/google";
import {AppShell} from "./AppShell";
import "./globals.css";

// next/font self-hosts both faces at build time, so no request ever leaves the
// page for fonts.googleapis.com and there is no layout shift while they load.
const manrope = Manrope({subsets: ["latin"], variable: "--font-manrope", display: "swap"});
const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dm-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {default: "0G-Delphi", template: "%s · 0G-Delphi"},
  description:
    "A read-only instrument panel for the binary prediction markets on 0G Chain. Humans observe; agents execute.",
};

/**
 * Runs before first paint, so the page never flashes the wrong theme and then
 * corrects itself. It reads an explicit choice first and falls back to the
 * operating system's. `suppressHydrationWarning` on <html> is required because
 * this deliberately mutates the class list before React hydrates.
 */
const THEME_SCRIPT = `try{var t=localStorage.getItem("delphi-theme");if(t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches)){document.documentElement.classList.add("dark")}}catch(e){}`;

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className={`${manrope.variable} ${dmMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{__html: THEME_SCRIPT}} />
      </head>
      <body className="min-h-dvh bg-bg text-text">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
