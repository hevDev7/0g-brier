import type {ReactNode} from "react";
import Link from "next/link";
import {ArrowLeft, ArrowRight} from "lucide-react";
import {neighbours, pageBySlug} from "./nav";

/**
 * One documentation page: its heading, its content, and the way onward.
 *
 * Title and blurb come from the nav tree rather than being written again here,
 * so the sidebar and the page cannot disagree about what a page is called — a
 * small thing that goes wrong immediately and quietly the moment there are two
 * copies.
 */
export function DocPage({slug, children}: {slug: string; children: ReactNode}) {
  const page = pageBySlug(slug);
  if (!page) throw new Error(`DocPage: "${slug}" is not in the documentation tree — add it to nav.ts`);
  const {prev, next} = neighbours(slug);

  return (
    // Fills its column, as every other page in this app fills `main`. The docs
    // were the only route that did not, which read as the page being inset while
    // the header spanned the window — 372px of dead space on the right at
    // 1440px. Width is decided per element below: prose stays narrow because a
    // 1100px measure is unreadable, and tables take what they need.
    <article className="min-w-0">
      <header className="mb-8 border-b border-border pb-6">
        <p className="eyebrow mb-2 text-accent">{page.group}</p>
        <h1 className="text-[24px] leading-tight font-extrabold tracking-[-0.03em] text-balance text-text md:text-[30px]">
          {page.title}
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-text-muted">{page.blurb}</p>
      </header>

      {/* The rail scans inside this. */}
      <div data-doc-content className="flex flex-col gap-4">
        {children}
      </div>

      <nav aria-label="Previous and next page" className="mt-14 grid grid-cols-1 gap-3 border-t border-border pt-6 sm:grid-cols-2">
        {prev ? (
          <Link
            href={prev.href}
            rel="prev"
            className="group flex flex-col gap-1 rounded border border-border p-4 transition-colors hover:border-border-strong"
          >
            <span className="flex items-center gap-1.5 text-[11px] text-text-faint">
              <ArrowLeft size={12} aria-hidden />
              Previous
            </span>
            <span className="text-[13.5px] font-medium text-text group-hover:text-accent">{prev.title}</span>
          </Link>
        ) : (
          // Holds the column so a page with only a next link keeps it on the right.
          <span aria-hidden />
        )}
        {next && (
          <Link
            href={next.href}
            rel="next"
            className="group flex flex-col gap-1 rounded border border-border p-4 text-right transition-colors hover:border-border-strong sm:col-start-2"
          >
            <span className="flex items-center justify-end gap-1.5 text-[11px] text-text-faint">
              Next
              <ArrowRight size={12} aria-hidden />
            </span>
            <span className="text-[13.5px] font-medium text-text group-hover:text-accent">{next.title}</span>
          </Link>
        )}
      </nav>
    </article>
  );
}
