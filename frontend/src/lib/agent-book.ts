import {tradingHasEnded} from "@/lib/market-phase";
import {dpm, toTokensFloor} from "@0g-brier/protocol";
import {payoutPerShareWad} from "@/lib/dpm-view";
import type {MarketStatus, MarketSummary, Outcome, Position} from "@/lib/data/types";

const WAD = 10n ** 18n;

export interface BookRow {
  market: MarketSummary;
  outcome: Outcome;
  shares: bigint;
  /** null when the current mode cannot know what was paid (COST_BASIS). */
  entryPriceWad: bigint | null;
  /** The marginal price — what the NEXT share trades at while the book is open. */
  currentPriceWad: bigint;
  /**
   * What one held share is worth NOW: the marginal price while unresolved, the
   * `1/p` redemption rate on the winning side once settled, zero on the losing
   * side. `currentValueTokens` and `pnlTokens` are built from THIS. The two are
   * separate fields because after settlement they are different numbers, and one
   * column cannot honestly carry both.
   */
  worthPerShareWad: bigint;
  /** True once the market is settled, so a reader knows which of the two it is. */
  redeemable: boolean;
  /** Collateral units. */
  currentValueTokens: bigint;
  /** Collateral units, signed. null exactly when `entryPriceWad` is null. */
  pnlTokens: bigint | null;
}

/**
 * One agent's holdings across markets, composed from per-market position lists.
 *
 * Value uses the marginal price `dpm.price`, not the probability: the price is
 * what a share is worth per unit of collateral right now. Using P_i here would
 * overstate a cheap side's value by the same square-root factor that makes
 * `1/P` the wrong payout.
 */
export function agentBook(
  markets: readonly MarketSummary[],
  positionsByMarket: readonly (readonly Position[])[],
  agent: string,
): BookRow[] {
  const wanted = agent.toLowerCase();
  const rows: BookRow[] = [];

  markets.forEach((market, index) => {
    const positions = positionsByMarket[index];
    if (positions === undefined) return;
    for (const position of positions) {
      if (position.agent.toLowerCase() !== wanted) continue;

      const decimals = market.collateral.decimals;
      const currentPriceWad = dpm.price(market.q, position.outcome);
      const winner = market.winningOutcome;

      /**
       * ONCE A MARKET IS SETTLED THE MARGINAL PRICE IS NO LONGER WHAT A SHARE IS
       * WORTH, and this book valued every position with it regardless. The winning
       * side redeems at `1/p`, the RECIPROCAL of the price — so a real position here
       * read +0.695439 mUSDC when it could actually be redeemed for +45.604931.
       * Sixty-five times too small, and in the direction that tells an agent its
       * correct call was barely worth making. The losing side is worth nothing at
       * all, and was being carried at a positive number.
       *
       * `PositionsTable` has got this right since it was written. The portfolio never
       * did, so one holding read two different ways depending on the page you opened.
       *
       * FAILED AND VOIDED NEED NO BRANCH. `_snapshotLiquidation` freezes the
       * liquidation rate at `price(q, i)` and `q` cannot move after close, so the
       * marginal price still IS the rate those markets pay.
       */
      const worthPerShareWad =
        winner === null
          ? currentPriceWad
          : position.outcome === winner
            ? payoutPerShareWad(market.q, winner)
            : 0n;
      const currentValueWad = (position.shares * worthPerShareWad) / WAD;
      const currentValueTokens = toTokensFloor(currentValueWad, decimals);

      let pnlTokens: bigint | null = null;
      if (position.entryPriceWad !== null) {
        const entryCostWad = (position.shares * position.entryPriceWad) / WAD;
        const pnlWad = currentValueWad - entryCostWad;
        // The magnitude is floored and the sign restored, so the conversion
        // rounds TOWARDS zero: a gain is never shown larger than it is, and
        // neither is a loss. `toTokensFloor` rejects negatives outright, which
        // is why the sign is handled here rather than passed through.
        pnlTokens =
          pnlWad >= 0n
            ? toTokensFloor(pnlWad, decimals)
            : -toTokensFloor(-pnlWad, decimals);
      }

      rows.push({
        market,
        outcome: position.outcome,
        shares: position.shares,
        entryPriceWad: position.entryPriceWad,
        currentPriceWad,
        worthPerShareWad,
        redeemable: winner !== null,
        currentValueTokens,
        pnlTokens,
      });
    }
  });

  return rows;
}

/**
 * What an observer can tell needs doing — without pretending this page can do
 * it. Redeeming and liquidating are execution, and execution lives in the agent
 * SDK; this column is what replaces the Actions column that a transacting UI
 * would have had.
 */
export function holdingStatus(
  market: {status: MarketStatus; tradingEnd: number},
  now: number | null,
): string {
  // The clock first, because the status alone lies here. A market stays `Open`
  // until somebody calls `close()`, but from `tradingEnd` onward the chain refuses
  // buy, sell, addLiquidity and removeLiquidity alike with `TradingEnded`. Labelling
  // such a holding "Open" tells the reader a position can still be sold when nothing
  // on earth can sell it — and this column exists precisely to say what can be done.
  if (tradingHasEnded(market, now)) return "Awaiting close · nothing can be traded";
  switch (market.status) {
    case "Proposed":
    case "Open":
      return "Open";
    case "Closed":
    case "Disputed":
      return "Awaiting settlement";
    case "Settled":
      return "Settled · agent can redeem";
    case "Failed":
    case "Voided":
      return "Voided · agent can liquidate";
  }
}

/** Every distinct agent that appears anywhere in the given position lists. */
export function agentsSeen(
  positionsByMarket: readonly (readonly Position[])[],
): `0x${string}`[] {
  const seen = new Map<string, `0x${string}`>();
  for (const positions of positionsByMarket) {
    for (const position of positions) {
      const key = position.agent.toLowerCase();
      if (!seen.has(key)) seen.set(key, position.agent);
    }
  }
  return [...seen.values()];
}
