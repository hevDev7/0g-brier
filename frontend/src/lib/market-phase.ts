import type {MarketStatus} from "@/lib/data/types";

/**
 * Where a market is in its life, from a reader's point of view rather than the
 * contract's.
 *
 * The registry page listed all seven statuses together, so a deployment whose
 * markets had all finished showed a full table in which nothing could be done —
 * on Galileo, seven rows of which zero were tradable. Status is the wrong axis
 * for that first cut: `Settled` and `Failed` are equally over, `Closed` and
 * `Disputed` are equally unfinished, and `Open` means two different things
 * depending on the clock.
 *
 * THREE phases, not two. An "active / history" split has nowhere to put a market
 * that has stopped trading and has not been resolved — and that is precisely the
 * state where money is locked and somebody still owes the market an answer.
 * Filing it under history hides pending work; leaving it under live promises a
 * trade that reverts. It gets its own phase because it is its own situation.
 */
export type Phase = "live" | "pending" | "resolved";

/**
 * The one boundary `tradingState` and `phaseOf` must agree on.
 *
 * `Open` says only that `close()` has not been called, and nothing obliges
 * anyone to call it promptly. A market past `tradingEnd` still reading `Open` is
 * not tradable — `sell` reverts with `TradingEnded` — so both the badge and the
 * phase have to treat the clock, not the enum, as what settles it. Two copies of
 * this comparison would eventually disagree, and the disagreement would show as
 * a market badged "Awaiting close" while the Live filter is what selected it.
 *
 * `now === null` before the browser reports a clock. Nothing is guessed: the
 * market keeps the chain's own answer and sharpens once the clock arrives.
 */
export function tradingHasEnded(
  market: {status: MarketStatus; tradingEnd: number},
  now: number | null,
): boolean {
  return market.status === "Open" && now !== null && now >= market.tradingEnd;
}

export function phaseOf(
  market: {status: MarketStatus; tradingEnd: number},
  now: number | null,
): Phase {
  switch (market.status) {
    case "Settled":
    case "Failed":
    case "Voided":
      return "resolved";
    case "Closed":
    case "Proposed":
    case "Disputed":
      return "pending";
    case "Open":
      return tradingHasEnded(market, now) ? "pending" : "live";
  }
}

export interface PhaseInfo {
  key: Phase;
  label: string;
  /** Shown under the filter row: what this phase IS, in one line. */
  blurb: string;
  /** Shown in place of the table when the phase holds nothing. */
  empty: string;
}

/**
 * Ordered as a market moves through them, so the control reads as time rather
 * than as an alphabetical list. The default is `live` because that is the only
 * phase in which a reader can still do anything.
 *
 * The control that selects a phase carries each phase's COUNT. There is no "all"
 * option to fall back to — an entry meaning "everything" would have to map to
 * the empty string, which reads back as `live`, so it would promise the whole
 * registry and deliver a third of it. Without that fallback the counts have to
 * be visible from the control itself, or an empty Live view is indistinguishable
 * from a page that failed to load.
 */
export const PHASES: readonly PhaseInfo[] = [
  {
    key: "live",
    label: "Live",
    blurb: "Trading is open. An agent can buy or sell through the SDK until the window closes.",
    empty:
      "No market is open for trading right now. Switch the phase filter to Awaiting settlement or Resolved to see the ones that have stopped.",
  },
  {
    key: "pending",
    label: "Awaiting settlement",
    blurb:
      "Trading has ended and the outcome is not decided. Positions cannot be sold or redeemed, and the collateral stays locked until a resolver settles the market or the deadline passes and it fails.",
    empty: "Nothing is waiting on a resolver.",
  },
  {
    key: "resolved",
    label: "Resolved",
    blurb:
      "Finished. A settled market pays its winning side; a failed or voided one refunds both sides at their own price. Nothing here can be traded, only redeemed or liquidated.",
    empty: "No market has been resolved on this deployment yet.",
  },
];

export function phaseInfo(phase: Phase): PhaseInfo {
  // Non-null by construction: PHASES covers the union, and the return type says
  // so rather than leaving a caller to handle an absence that cannot occur.
  return PHASES.find((p) => p.key === phase)!;
}

export function isPhase(value: string): value is Phase {
  return PHASES.some((p) => p.key === value);
}
