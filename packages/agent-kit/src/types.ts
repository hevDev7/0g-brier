export type Outcome = 0 | 1;

export type MarketStatus = "Open" | "Closed" | "Proposed" | "Disputed" | "Settled" | "Failed" | "Voided";

export type Tier = "FAST" | "VERIFIED" | "DETERMINISTIC";

/**
 * A market as an agent sees it.
 *
 * There is deliberately no field called `price`. Delphi is LMSR, where the
 * marginal price IS the implied probability; 0G-Delphi is DPM Pennock, where
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

export interface Fill {
  hash: `0x${string}`;
  /** Read back from the chain after the receipt, never assumed from the quote. */
  sharesAfter: bigint;
  tokensDelta: bigint;
  impliedProbabilityAfterWad: readonly [bigint, bigint];
}
