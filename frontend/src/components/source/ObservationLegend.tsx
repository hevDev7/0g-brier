import {Panel, PanelHeader} from "@/components/primitives/Panel";

/**
 * The four states every figure on this site can be in, named once so a reader
 * does not have to infer the difference from context.
 *
 * It exists because the distinction it draws is the product's central claim: a
 * dash, a zero, a spinner and an explanation are four different assertions, and
 * a UI that renders them all the same way is lying about three of them. The
 * legend is the promise; `Query<T>` is what keeps it.
 *
 * There is no retry control here on purpose. This is a legend, not a panel that
 * failed — a button offering to reload something that is not broken teaches the
 * reader the wrong thing about the state next to it.
 */
const STATES = [
  {
    key: "LOADING",
    dot: "bg-accent",
    body: "The shape of the answer appears before the answer does, at the size it will take.",
    sample: <span className="block h-1.5 w-20 animate-pulse rounded-full bg-border" />,
  },
  {
    key: "EMPTY",
    dot: "border border-text-faint",
    body: "The source answered, and there is nothing to show. A real fact, stated in words.",
    sample: <span className="block text-[11px] text-text-muted">No positions yet.</span>,
  },
  {
    key: "UNAVAILABLE",
    dot: "bg-warn",
    body: "This mode cannot know. Never a zero, which would be a claim — and never a bare dash.",
    sample: (
      <span className="inline-flex rounded border border-dashed border-border-strong px-1.5 py-0.5 text-[10px] text-text-muted">
        Trade history not available
      </span>
    ),
  },
  {
    key: "ERROR",
    dot: "bg-neg",
    body: "The request failed. Shown plainly, with the reason, rather than as an absence.",
    sample: <span className="block text-[11px] text-neg">Could not load the trade tape.</span>,
  },
] as const;

export function ObservationLegend() {
  return (
    <Panel testId="observation-legend" className="overflow-hidden">
      <PanelHeader eyebrow="Trust conventions" title="How this page labels what it does not know" />
      <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x lg:grid-cols-4 lg:divide-y-0">
        {STATES.map(({key, dot, body, sample}) => (
          <div key={key} className="flex min-h-[112px] flex-col gap-2 p-4 md:p-5">
            <p className="flex items-center gap-2">
              <span className={`size-2 shrink-0 rounded-full ${dot}`} aria-hidden />
              <span className="font-mono text-[10px] font-medium tracking-[0.1em] text-text">
                {key}
              </span>
            </p>
            <div className="min-h-[18px]">{sample}</div>
            <p className="text-[11px] leading-relaxed text-text-muted">{body}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}
