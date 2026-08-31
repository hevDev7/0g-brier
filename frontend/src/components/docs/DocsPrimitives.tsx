import type {ComponentType, ReactNode} from "react";
import {AlertTriangle, ExternalLink, Info, Lightbulb, Terminal} from "lucide-react";

/**
 * The pieces the documentation is built from.
 *
 * Nothing here caps its own width. Every block fills the column, so the body
 * reaches the same right edge as the header — which is what the rest of the app
 * does and what the docs alone did not. The cost is a long measure on a wide
 * window: prose was held at roughly ninety characters a line and now runs to
 * about a hundred and fifty, where the eye has further to travel to find the
 * start of the next line. That was the trade, made deliberately.
 *
 * Kept apart from the pages so each page reads as prose and structure rather
 * than as markup, and so the two shapes that carry the teaching — a worked
 * number and a correction of an expectation — are defined once and cannot drift
 * apart.
 *
 * There was a `Section` here, which wrapped a heading around content while the
 * documentation was one long page. Splitting it into routes gave that job to
 * `DocPage`, and a design system that keeps the older of two ways to do the same
 * thing invites somebody to reach for it.
 */

export function P({children}: {children: ReactNode}) {
  return <p className="text-[15px] leading-relaxed text-text-muted">{children}</p>;
}

export function H3({children}: {children: ReactNode}) {
  return <h3 className="mt-2 text-[16px] font-bold tracking-tight text-text">{children}</h3>;
}

/**
 * An outbound link.
 *
 * The documentation carried none of these until the packages were published,
 * because until then everything it named lived in the reader's own checkout.
 * A published package is somewhere else, and naming one without a way to reach
 * it leaves the reader retyping what the page has just told them.
 *
 * Always a new tab. These are asides from a page somebody is working through,
 * and navigating away from a setup they are halfway through loses their place.
 */
export function A({href, children}: {href: string; children: ReactNode}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-baseline gap-1 text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
    >
      {children}
      <ExternalLink size={11} aria-hidden className="shrink-0 self-center" />
    </a>
  );
}

/** Inline code, for a number or an identifier inside a sentence. */
export function C({children}: {children: ReactNode}) {
  return (
    <code className="rounded bg-bg-sunken px-1.5 py-0.5 font-mono text-[13.5px] text-text">{children}</code>
  );
}

const NOTE_KINDS = {
  info: {icon: Info, border: "border-accent", text: "text-accent"},
  warn: {icon: AlertTriangle, border: "border-warn", text: "text-warn"},
  tip: {icon: Lightbulb, border: "border-pos", text: "text-pos"},
} as const;

export function Note({
  kind = "info",
  title,
  children,
}: {
  kind?: keyof typeof NOTE_KINDS;
  title: string;
  children: ReactNode;
}) {
  const {icon: Icon, border, text} = NOTE_KINDS[kind];
  return (
    <aside className={`rounded-r border-l-2 bg-bg-sunken px-4 py-3 ${border}`}>
      <p className={`mb-1 flex items-center gap-2 text-[14px] font-bold ${text}`}>
        <Icon size={14} aria-hidden />
        {title}
      </p>
      <div className="text-[14px] leading-relaxed text-text-muted">{children}</div>
    </aside>
  );
}

/**
 * The correction shape: what a newcomer expects, against what is true here.
 *
 * Every mechanic on this venue that differs from an ordinary prediction market
 * is a chance to lose money by assuming, so each one is stated as the assumption
 * first. Naming the wrong belief is what makes it correctable; a table of
 * correct facts alone leaves the reader's wrong one intact beside it.
 */
export function Correction({
  expect,
  actual,
  why,
}: {
  expect: ReactNode;
  actual: ReactNode;
  why: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded border border-border">
      <div className="grid grid-cols-1 sm:grid-cols-2">
        <div className="border-b border-border p-4 sm:border-r sm:border-b-0">
          <p className="eyebrow mb-2 text-text-faint">You might expect</p>
          <div className="text-[14px] leading-relaxed text-text-muted line-through decoration-neg/60">{expect}</div>
        </div>
        <div className="p-4">
          <p className="eyebrow mb-2 text-pos">Here it is</p>
          <div className="text-[14px] leading-relaxed text-text">{actual}</div>
        </div>
      </div>
      <div className="border-t border-border bg-bg-sunken px-4 py-3 text-[13.5px] leading-relaxed text-text-muted">
        {why}
      </div>
    </div>
  );
}

/** A worked calculation. Numbers first, in mono, so they can be checked. */
export function Worked({title, rows, note}: {title: string; rows: [string, string][]; note?: ReactNode}) {
  return (
    <div className="rounded border border-border">
      <p className="border-b border-border px-4 py-2.5 text-[14px] font-bold text-text">{title}</p>
      <dl className="divide-y divide-border">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
            <dt className="text-[14px] text-text-muted">{k}</dt>
            <dd className="font-mono text-[14px] font-medium tabular-nums text-text">{v}</dd>
          </div>
        ))}
      </dl>
      {note && (
        <p className="border-t border-border bg-bg-sunken px-4 py-3 text-[13.5px] leading-relaxed text-text-muted">
          {note}
        </p>
      )}
    </div>
  );
}

/** A numbered step in a procedure. */
export function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <span
        aria-hidden
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border-strong font-mono text-[13px] font-bold text-text"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold text-text">{title}</p>
        <div className="mt-1.5 flex flex-col gap-2 text-[14px] leading-relaxed text-text-muted">{children}</div>
      </div>
    </div>
  );
}

/**
 * A command, and the directory it is run from.
 *
 * Separate from `Cmd` because a bare command is what caused the confusion this
 * replaced: a reader met `npm run register` with no way to know whether it
 * belonged to a project they had, and it did not — those scripts lived in an
 * agent the author had written and the reader had never seen. Making the
 * directory a required prop means a command cannot be published without one.
 */
export function Run({cwd, children}: {cwd: string; children: string}) {
  return (
    <div className="overflow-hidden rounded border border-border">
      <p className="flex items-center gap-2 border-b border-border bg-bg-sunken px-3 py-1.5 font-mono text-[12px] text-text-muted">
        <Terminal size={12} aria-hidden className="shrink-0" />
        <span className="truncate">{cwd}</span>
      </p>
      <pre className="overflow-x-auto p-3 font-mono text-[13.5px] leading-relaxed text-text">
        <code>{children}</code>
      </pre>
    </div>
  );
}

/** A shell command, or a small block of one. */
export function Cmd({children}: {children: string}) {
  return (
    <pre className="overflow-x-auto rounded border border-border bg-bg-sunken p-3 font-mono text-[13.5px] leading-relaxed text-text">
      <code>{children}</code>
    </pre>
  );
}

/** One row of the lifecycle, tying a state to what can be done in it. */
export function StateRow({
  state,
  tone,
  can,
  cannot,
  icon: Icon,
}: {
  state: string;
  tone: "open" | "closed" | "settled" | "failed";
  can: string;
  cannot: string;
  icon: ComponentType<{size?: number; className?: string}>;
}) {
  const dot = {open: "bg-pos", closed: "bg-warn", settled: "bg-accent", failed: "bg-neg"}[tone];
  return (
    <div className="flex gap-3 border-b border-border py-3 last:border-b-0">
      <span className="mt-1 flex shrink-0 items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
        <Icon size={14} className="text-text-faint" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="font-mono text-[14px] font-bold text-text">{state}</p>
        <p className="mt-1 text-[14px] leading-relaxed text-text-muted">
          <span className="text-pos">Can:</span> {can}
        </p>
        <p className="mt-0.5 text-[14px] leading-relaxed text-text-muted">
          <span className="text-neg">Cannot:</span> {cannot}
        </p>
      </div>
    </div>
  );
}
