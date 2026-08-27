"use client";

import {useState} from "react";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {BookOpen, ChevronRight, LineChart, Menu, Radio, X} from "lucide-react";
import {ModeIndicator} from "./ModeIndicator";
import {ThemeToggle} from "./ThemeToggle";

const NAV = [
  {href: "/", label: "Markets", icon: LineChart},
  {href: "/portfolio", label: "Portfolio", icon: BookOpen},
] as const;

/** `/market/[address]` belongs to Markets, so the section stays lit while inspecting one. */
function isActive(pathname: string, href: string): boolean {
  return href === "/"
    ? pathname === "/" || pathname.startsWith("/market")
    : pathname.startsWith(href);
}

function sectionLabel(pathname: string): string {
  if (pathname.startsWith("/portfolio")) return "Observed book";
  if (pathname.startsWith("/market/")) return "Market inspector";
  return "Market overview";
}

export function Shell({children}: {children: React.ReactNode}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-bg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-[13px] focus:text-accent-fg"
      >
        Skip to content
      </a>

      {/*
        `invisible` while closed, not merely translated off-screen: a sidebar
        pushed out with a transform is still in the tab order, so a keyboard user
        would tab into an invisible menu. `visibility` removes it from that order
        and still animates. The `md:` pair re-shows it on desktop, where it is
        permanent — which is why this is CSS rather than `inert`: `inert` cannot
        be made conditional on a media query, and applying it unconditionally
        would kill the desktop navigation.
      */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[236px] flex-col border-r border-border bg-bg-raised transition-transform md:visible md:translate-x-0 ${
          navOpen ? "visible translate-x-0" : "invisible -translate-x-full"
        }`}
      >
        <div className="flex h-[68px] items-center justify-between border-b border-border px-5">
          <Link href="/" data-testid="link-brand" className="flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-md bg-accent text-accent-fg">
              <Radio size={16} strokeWidth={2.5} aria-hidden />
            </span>
            <span>
              <span className="block text-[14px] font-extrabold tracking-tight text-text">
                0G DELPHI
              </span>
              <span className="eyebrow text-text-faint">instrument panel</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation"
            className="text-text-muted md:hidden"
          >
            <X size={17} aria-hidden />
          </button>
        </div>

        <div className="px-3 py-5">
          <p className="eyebrow px-3 pb-2 text-text-faint">Observe</p>
          <nav aria-label="Primary" className="flex flex-col gap-1">
            {NAV.map(({href, label, icon: Icon}) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setNavOpen(false)}
                  aria-current={active ? "page" : undefined}
                  data-testid={`nav-${label.toLowerCase()}`}
                  className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-[13px] font-semibold transition-colors ${
                    active
                      ? "bg-accent/10 text-accent"
                      : "text-text-muted hover:bg-bg-sunken hover:text-text"
                  }`}
                >
                  <Icon size={16} strokeWidth={1.8} aria-hidden />
                  {label}
                  {/* A marker for the section you are in. `aria-current` above
                      already says it to a screen reader, so this is decoration
                      for that one item only and is hidden from the tree. */}
                  {active && (
                    <span aria-hidden className="ml-auto size-1.5 rounded-full bg-accent" />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/*
          Not a slogan. This product's defining constraint is that the browser
          has no write path to the chain at all — every buy, sell, redeem and
          liquidate runs through `@0g-delphi/agent-kit`. Saying so in the chrome
          is the honest way to explain why no page here has an action button.
        */}
        <div className="mt-auto border-t border-border p-4">
          <div className="rounded-md bg-bg-sunken p-3">
            <p className="eyebrow mb-1.5 text-text-faint">Read-only node</p>
            <p className="text-[11px] leading-relaxed text-text-muted">
              Humans observe here. Every trade is executed by an agent through the SDK, never
              from this page.
            </p>
          </div>
        </div>
      </aside>

      {navOpen && (
        <button
          type="button"
          onClick={() => setNavOpen(false)}
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-text/20 md:hidden"
        />
      )}

      <div className="md:pl-[236px]">
        <header className="sticky top-0 z-20 flex h-[68px] items-center gap-3 border-b border-border bg-bg/95 px-4 backdrop-blur md:px-8">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            className="grid size-8 shrink-0 place-items-center rounded-md border border-border md:hidden"
          >
            <Menu size={17} aria-hidden />
          </button>
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[12px] text-text-muted">
            <span className="font-mono text-text">0G</span>
            <ChevronRight size={13} aria-hidden />
            <span>{sectionLabel(pathname)}</span>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden sm:block">
              <ModeIndicator />
            </span>
            <ThemeToggle />
          </div>
        </header>

        <main id="main" className="mx-auto max-w-[1440px] px-4 py-7 md:px-8 md:py-9">
          {children}
        </main>
      </div>
    </div>
  );
}
