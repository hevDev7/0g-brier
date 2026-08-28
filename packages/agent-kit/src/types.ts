export type Outcome = 0 | 1;

export type MarketStatus = "Open" | "Closed" | "Proposed" | "Disputed" | "Settled" | "Failed" | "Voided";

export type Tier = "FAST" | "VERIFIED" | "DETERMINISTIC";

/**
 * A market as an agent sees it.
 *
 * There is deliberately no field called `price`. Gensyn's Delphi competition
 * runs on LMSR, where the
 * marginal price IS the implied probability; Brier is DPM Pennock, where
 * `Σpᵢ² = WAD` and the probability is the SQUARE of the price. An agent ported
 * across that boundary reads one for the other, mis-sizes every position, and
 * keeps working — it just bleeds. The two are named apart here so the mistake
 * has to be typed out on purpose.
 */
export interface MarketView {
  address: `0x${string}`;
  status: MarketStatus;
  tier: Tier;
  category: string;
  /** Share supply per outcome, wad. Index 0 = NO, 1 = YES. */
  q: readonly [bigint, bigint];
  poolWad: bigint;
  /** `qᵢ/C(q)`, wad. NOT a probability. */
  marginalPriceWad: readonly [bigint, bigint];
  /** `pᵢ²`, wad. The two sum to WAD. This is what a Kelly fraction takes. */
  impliedProbabilityWad: readonly [bigint, bigint];
  tradingEnd: number;
  feeBps: number;
  collateral: `0x${string}`;
  collateralDecimals: number;
  collateralSymbol: string;
  specRoot: `0x${string}`;
  /** `null` until a resolution lands. Outcome 0 is a winner, not an absence. */
  winningOutcome: Outcome | null;
}

/**
 * What a trade would cost, and what it would do to the position's value.
 *
 * `payoutBefore/After` is the field an LMSR agent has no concept of. Under LMSR
 * a winning share pays exactly 1, fixed at purchase. Under DPM it pays `1/pᵢ`
 * and FLOATS: buying moves `p` up, so the prize shrinks as the agent takes it.
 * A Kelly fraction computed at the pre-trade payout overstates the edge on every
 * order.
 */
export interface Preview {
  /** What the CHAIN says, and therefore what gets signed. */
  tokensIn: bigint;
  feeTokens: bigint;
  sharesOut: bigint;
  /** Average cost per share in collateral units, wad-scaled. */
  avgPriceWad: bigint;
  impliedProbabilityBeforeWad: bigint;
  impliedProbabilityAfterWad: bigint;
  payoutPerShareBeforeWad: bigint;
  payoutPerShareAfterWad: bigint;
}

/**
 * What an exit actually returned.
 *
 * `tokensReceived` is measured, not quoted: the collateral balance before and
 * after. `redeem` pays for the tradable position AND for any seed shares on the
 * winning side, and a caller that assumed the first would understate what it
 * got — the creator of a market is usually its largest winner.
 */
export interface Claim {
  hash: `0x${string}`;
  tokensReceived: bigint;
  /**
   * Shares the claim burned — TRADABLE PLUS SEED.
   *
   * The seed half is easy to miss: it is held by the Market rather than by
   * OutcomeShares, so `getPosition` does not see it, while `redeem` pays for it
   * regardless. Dividing proceeds by the tradable balance alone printed an
   * "implied rate" of 21.01× for a market whose rate was 1.3689×.
   */
  sharesBefore: bigint;
}

export interface Fill {
  hash: `0x${string}`;
  /** Read back from the chain after the receipt, never assumed from the quote. */
  sharesAfter: bigint;
  tokensDelta: bigint;
  impliedProbabilityAfterWad: readonly [bigint, bigint];
}
