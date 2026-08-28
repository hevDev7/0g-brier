"use client";

import {useState} from "react";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {ChevronDown, List} from "lucide-react";
import {DOCS} from "./nav";

/**
 * The persistent navigation.
 *
 * One element, not a desktop copy and a mobile copy: two would put the same
 * links in the accessibility tree twice and make every `getByRole("link")` in a
 * test ambiguous. Below `lg` it collapses behind a summary; above, it is simply
 * always open and the toggle is hidden.
 */
export function DocsSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:sticky lg:top-24 lg:self-start">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="docs-nav"
        className="mb-4 flex w-full items-center justify-between rounded border border-border px-3 py-2 text-[13px] font-medium text-text lg:hidden"
      >
        <span className="flex items-center gap-2">
          <List size={14} aria-hidden />
          Documentation
        </span>
        <ChevronDown size={14} aria-hidden className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>

      <nav
        id="docs-nav"
        aria-label="Documentation"
        className={`${open ? "block" : "hidden"} lg:block lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto lg:pr-2`}
      >
        {DOCS.map((group) => (
          <div key={group.title} className="mb-6 last:mb-0">
            <p className="eyebrow mb-2 text-text-faint">{group.title}</p>
            <ul className="flex flex-col gap-0.5 border-l border-border">
              {group.pages.map((page) => {
                const href = page.slug === "" ? "/docs" : `/docs/${page.slug}`;
                const active = pathname === href;
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      title={page.blurb}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setOpen(false)}
                      // The active marker is a border on the item rather than a
                      // background: the sidebar sits on the page background, and
                      // a filled row would read as a panel floating in a list.
                      className={`-ml-px block border-l-2 py-1.5 pl-3 text-[13px] leading-snug transition-colors ${
                        active
                          ? "border-accent font-medium text-accent"
                          : "border-transparent text-text-muted hover:border-border-strong hover:text-text"
                      }`}
                    >
                      {page.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}
