import {dpm, toTokensFloor} from "@brier/protocol";
import type {MarketStatus, MarketSummary, Outcome, Position} from "@/lib/data/types";

const WAD = 10n ** 18n;

export interface BookRow {
  market: MarketSummary;
  outcome: Outcome;
  shares: bigint;
  /** null when the current mode cannot know what was paid (COST_BASIS). */
  entryPriceWad: bigint | null;
  currentPriceWad: bigint;
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
      const currentValueWad = (position.shares * currentPriceWad) / WAD;
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
export function holdingStatus(status: MarketStatus): string {
  switch (status) {
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
