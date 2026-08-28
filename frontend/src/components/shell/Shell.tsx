"use client";

import {useState} from "react";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {BookOpen, FileText, LineChart, Menu, Radio, Trophy, X} from "lucide-react";
import {ModeIndicator} from "./ModeIndicator";
import {ThemeToggle} from "./ThemeToggle";

const NAV = [
  {href: "/", label: "Markets", icon: LineChart},
  {href: "/leaderboard", label: "Leaderboard", icon: Trophy},
  {href: "/portfolio", label: "Portfolio", icon: BookOpen},
  {href: "/docs", label: "Docs", icon: FileText},
] as const;

/** `/market/[address]` belongs to Markets, so the section stays lit while inspecting one. */
function isActive(pathname: string, href: string): boolean {
  return href === "/"
    ? pathname === "/" || pathname.startsWith("/market")
    : pathname.startsWith(href);
}

export function Shell({children}: {children: React.ReactNode}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-[13px] focus:text-accent-fg"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-border bg-bg/95 backdrop-blur">
        {/*
          Three tracks from md up, with the outer two at `1fr` each: equal side
          columns are what actually centres the nav, rather than merely placing
          it after the brand. `minmax(0,…)` so a long brand or a wide indicator
          shrinks its own track instead of shoving the middle one off centre.
          Below md the row is still flex, because there the nav is not in it at
          all — it drops out of the header as a panel.
        */}
        <div className="relative mx-auto flex h-16 w-full max-w-[1440px] items-center gap-4 px-4 md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-6 md:px-8">
          <Link href="/" data-testid="link-brand" className="flex shrink-0 items-center gap-3">
            <span className="grid size-8 place-items-center rounded-md bg-accent text-accent-fg">
              <Radio size={16} strokeWidth={2.5} aria-hidden />
            </span>
            <span>
              <span className="block text-[14px] leading-tight font-extrabold tracking-tight text-text">
                BRIER
              </span>
              <span className="eyebrow text-text-faint">on 0G Chain</span>
            </span>
          </Link>

          {/*
            ONE nav element, not a desktop copy and a mobile copy. Two would put
            the same links in the accessibility tree twice and make every
            `getByTestId("nav-…")` ambiguous. Below md it is a panel that drops
            out of the header; from md it is a row inside it.
          */}
          <nav
            id="primary-nav"
            aria-label="Primary"
            className={`${
              navOpen ? "flex" : "hidden"
            } absolute inset-x-0 top-16 flex-col gap-1 border-b border-border bg-bg-raised p-3 md:static md:flex md:flex-row md:justify-self-center md:border-0 md:bg-transparent md:p-0`}
          >
            {NAV.map(({href, label, icon: Icon}) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setNavOpen(false)}
                  aria-current={active ? "page" : undefined}
                  data-testid={`nav-${label.toLowerCase()}`}
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-[13px] font-semibold transition-colors ${
                    active
                      ? "bg-accent/10 text-accent"
                      : "text-text-muted hover:bg-bg-sunken hover:text-text"
                  }`}
                >
                  <Icon size={16} strokeWidth={1.8} aria-hidden />
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-3 md:ml-0 md:justify-self-end">
            {/*
              From lg up only. `mock source · fixture data` is wide enough that
              at md it either wraps the chip to two lines inside a 64px bar or
              pushes the controls into the centred nav. The footer carries it
              below lg, so exactly one indicator is in the accessibility tree at
              every width — never none, because a reader looking at fixture
              figures has to be told they are fixtures.
            */}
            <span className="hidden lg:block">
              <ModeIndicator />
            </span>
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setNavOpen((v) => !v)}
              aria-expanded={navOpen}
              aria-controls="primary-nav"
              aria-label={navOpen ? "Close navigation" : "Open navigation"}
              data-testid="nav-toggle"
              className="grid size-8 place-items-center rounded-md border border-border text-text-muted md:hidden"
            >
              {navOpen ? <X size={17} aria-hidden /> : <Menu size={17} aria-hidden />}
            </button>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-7 md:px-8 md:py-9">
        {children}
      </main>

      {/*
        This statement moved down here when the sidebar that held it was
        replaced by a top navigation. It is not decoration and could not simply
        go with the sidebar: this product's defining constraint is that the
        browser has no write path to the chain at all, and saying so is the
        honest way to explain why no page here has an action button. A footer is
        where a standing claim of that kind belongs.
      */}
      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-4 md:px-8">
          <span className="eyebrow flex items-center gap-1.5 text-text-faint">
            <Radio size={12} aria-hidden />
            Read-only node
          </span>
          <span className="text-[12px] leading-relaxed text-text-muted">
            Humans observe here. Every trade is executed by an agent through the SDK, never from
            this page.
          </span>
          <span className="ml-auto lg:hidden">
            <ModeIndicator />
          </span>
        </div>
      </footer>
    </div>
  );
}
