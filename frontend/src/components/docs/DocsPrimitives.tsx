import type {ComponentType, ReactNode} from "react";
import {AlertTriangle, Info, Lightbulb} from "lucide-react";

/**
 * The pieces the documentation is built from.
 *
 * Kept apart from the page so the page reads as prose and structure rather than
 * as markup, and so the two shapes that carry the teaching — a worked number and
 * a correction of an expectation — are defined once and cannot drift apart.
 */

/** A section with an id, so the contents list can link into it. */
export function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    // scroll-mt so an anchored heading does not land under the sticky header.
    <section id={id} className="scroll-mt-24 border-t border-border pt-10">
      <p className="eyebrow mb-2 text-accent">{eyebrow}</p>
      <h2 className="text-[20px] leading-tight font-extrabold tracking-[-0.02em] text-text md:text-[24px]">{title}</h2>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function P({children}: {children: ReactNode}) {
  return <p className="max-w-2xl text-[14px] leading-relaxed text-text-muted">{children}</p>;
}

export function H3({children}: {children: ReactNode}) {
  return <h3 className="mt-2 text-[15px] font-bold tracking-tight text-text">{children}</h3>;
}

/** Inline code, for a number or an identifier inside a sentence. */
export function C({children}: {children: ReactNode}) {
  return (
    <code className="rounded bg-bg-sunken px-1.5 py-0.5 font-mono text-[12.5px] text-text">{children}</code>
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
    <aside className={`max-w-2xl rounded-r border-l-2 bg-bg-sunken px-4 py-3 ${border}`}>
      <p className={`mb-1 flex items-center gap-2 text-[13px] font-bold ${text}`}>
        <Icon size={14} aria-hidden />
        {title}
      </p>
      <div className="text-[13px] leading-relaxed text-text-muted">{children}</div>
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
    <div className="max-w-2xl overflow-hidden rounded border border-border">
      <div className="grid grid-cols-1 sm:grid-cols-2">
        <div className="border-b border-border p-4 sm:border-r sm:border-b-0">
          <p className="eyebrow mb-2 text-text-faint">You might expect</p>
          <div className="text-[13px] leading-relaxed text-text-muted line-through decoration-neg/60">{expect}</div>
        </div>
        <div className="p-4">
          <p className="eyebrow mb-2 text-pos">Here it is</p>
          <div className="text-[13px] leading-relaxed text-text">{actual}</div>
        </div>
      </div>
      <div className="border-t border-border bg-bg-sunken px-4 py-3 text-[12.5px] leading-relaxed text-text-muted">
        {why}
      </div>
    </div>
  );
}

/** A worked calculation. Numbers first, in mono, so they can be checked. */
export function Worked({title, rows, note}: {title: string; rows: [string, string][]; note?: ReactNode}) {
  return (
    <div className="max-w-2xl rounded border border-border">
      <p className="border-b border-border px-4 py-2.5 text-[13px] font-bold text-text">{title}</p>
      <dl className="divide-y divide-border">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
            <dt className="text-[13px] text-text-muted">{k}</dt>
            <dd className="font-mono text-[13px] font-medium tabular-nums text-text">{v}</dd>
          </div>
        ))}
      </dl>
      {note && (
        <p className="border-t border-border bg-bg-sunken px-4 py-3 text-[12.5px] leading-relaxed text-text-muted">
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
    <div className="flex max-w-2xl gap-4">
      <span
        aria-hidden
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border-strong font-mono text-[12px] font-bold text-text"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-bold text-text">{title}</p>
        <div className="mt-1.5 flex flex-col gap-2 text-[13px] leading-relaxed text-text-muted">{children}</div>
      </div>
    </div>
  );
}

/** A shell command, or a small block of one. */
export function Cmd({children}: {children: string}) {
  return (
    <pre className="max-w-2xl overflow-x-auto rounded border border-border bg-bg-sunken p-3 font-mono text-[12.5px] leading-relaxed text-text">
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
        <p className="font-mono text-[13px] font-bold text-text">{state}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-text-muted">
          <span className="text-pos">Can:</span> {can}
        </p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-text-muted">
          <span className="text-neg">Cannot:</span> {cannot}
        </p>
      </div>
    </div>
  );
}
