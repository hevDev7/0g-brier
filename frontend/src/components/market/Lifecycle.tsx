import {Check, Clock} from "lucide-react";
import {Panel, PanelHeader} from "@/components/primitives/Panel";
import {formatCountdown, formatTimestamp} from "@/lib/format";
import {Unavailable} from "@/components/primitives/Unavailable";
import type {DataMode, MarketDetail, MarketStatus} from "@/lib/data/types";

/**
 * Which stage a market has actually reached is read from its STATUS, never from
 * the wall clock. Comparing timestamps against `Date.now()` during render is
 * impure — server and client would disagree — and it would also be wrong: a
 * market past its trading end that has not been closed on chain is still Open,
 * and this panel must say what happened, not what should have.
 */
function reached(status: MarketStatus): {closed: boolean; settled: boolean} {
  switch (status) {
    case "Proposed":
    case "Open":
      return {closed: false, settled: false};
    case "Closed":
    case "Disputed":
      return {closed: true, settled: false};
    case "Settled":
    case "Failed":
    case "Voided":
      return {closed: true, settled: true};
  }
}

export function Lifecycle({market, mode}: {market: MarketDetail; mode: DataMode}) {
  const {closed, settled} = reached(market.status);
  const steps: {label: string; at: number | null; done: boolean}[] = [
    {label: "Created", at: market.createdAt, done: true},
    {label: "Trading closes", at: market.tradingEnd, done: closed},
    {label: "Settlement deadline", at: market.settlementDeadline, done: settled},
  ];

  // Not ornament: this gap is the window in which a settlement can still be
  // proposed and disputed, and therefore how long an agent's funds stay locked.
  // An observer has a right to see it as a duration, not to subtract two dates.
  const disputeWindow = market.settlementDeadline - market.tradingEnd;

  return (
    <Panel testId="lifecycle">
      <PanelHeader eyebrow="Protocol timeline" title="Lifecycle" icon={Clock} />
      <ol className="p-4 md:p-5">
        {steps.map((step, index) => (
          <li key={step.label} className="relative flex gap-3 pb-5 last:pb-0">
            <span
              className={`relative z-10 mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border ${
                step.done
                  ? "border-accent bg-accent text-accent-fg"
                  : "border-border bg-bg-raised text-text-faint"
              }`}
            >
              {step.done ? (
                <Check size={11} aria-hidden />
              ) : (
                <span className="size-1.5 rounded-full bg-text-faint" />
              )}
            </span>
            {index < steps.length - 1 && (
              <span
                aria-hidden
                className="absolute top-5 bottom-0 left-[9px] w-px bg-border"
              />
            )}
            <span>
              <span className="block text-[12px] font-semibold text-text">
                {step.label}
                <span className="sr-only">{step.done ? " — reached" : " — not yet reached"}</span>
              </span>
              <span className="mt-0.5 block font-mono text-[11px] text-text-muted">
                {/* `createdAt` is not in Market's storage — it exists only in the
                    MarketCreated event, so a mode without an indexer genuinely does
                    not have it. The step still renders, because the market WAS
                    created; only its timestamp is unknown. */}
                {step.at === null ? (
                  <Unavailable capability="MARKET_STATE" mode={mode} compact />
                ) : (
                  formatTimestamp(step.at)
                )}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <p className="border-t border-border px-4 py-2.5 text-[11px] leading-relaxed text-text-muted md:px-5">
        Dispute window <span className="font-mono text-text">{formatCountdown(disputeWindow)}</span>{" "}
        — the time between trading closing and the settlement deadline, during which funds stay
        locked.
      </p>
    </Panel>
  );
}
