/**
 * `MarketView` and `Preview` literals, DERIVED from a live `q` rather than typed out.
 *
 * Nothing here is a hand-written wad. Every price, probability, payout and cost
 * comes out of `@0g-brier/protocol` — the same mirror `BrierClient.previewBuy`
 * fills its non-chain fields from — so a test asserting "P is 50% and p is
 * 0.7071×" is asserting a property of the DPM curve rather than a number
 * somebody once observed. CLAUDE.md's third rule is that bounds are derived
 * from `q` in closed form and never guessed; a fixture full of literal wads is
 * that guessed constant wearing a different hat, and it would go quietly stale
 * the first time the pricing changed.
 *
 * `previewOfBuy` mirrors `Market._priceBuy` (contracts/src/core/Market.sol:241)
 * and `BrierClient.previewBuy` together, including the direction each rounds:
 * money in uses `ceilDiv`, and the pool's target is `costUp`.
 */
import {WAD, dpm, quote, toTokensCeil, toWad} from "@0g-brier/protocol";
import type {MarketStatus, MarketView, Outcome, Preview} from "@0g-brier/agent-kit";

/** W0G on 0G mainnet — the collateral the live deployment settles in. */
export const W0G_DECIMALS = 18;
/** The mock USDC on Galileo. Present so that no test can assume 18 by accident. */
export const MUSDC_DECIMALS = 6;

/**
 * A 50/50 book, which is where the two numbers a strategy must not confuse are
 * furthest apart in the direction that matters: P = 50.00% while p = 0.7071×.
 * Read one for the other and a 60% belief changes sides.
 */
export const EVEN_BOOK: readonly [bigint, bigint] = [1000n * WAD, 1000n * WAD];

export interface MarketOverrides {
  status?: MarketStatus;
  winningOutcome?: Outcome | null;
  tradingEnd?: number;
  feeBps?: number;
  collateralDecimals?: number;
  collateralSymbol?: string;
}

/** A market whose whole book is computed from `q`, so the fields cannot disagree. */
export function marketAt(q: readonly [bigint, bigint], overrides: MarketOverrides = {}): MarketView {
  const decimals = overrides.collateralDecimals ?? W0G_DECIMALS;
  return {
    address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    status: overrides.status ?? "Open",
    tier: "VERIFIED",
    category: "crypto",
    q,
    poolWad: dpm.costUp(q),
    marginalPriceWad: [dpm.price(q, 0), dpm.price(q, 1)],
    impliedProbabilityWad: [dpm.probability(q, 0), dpm.probability(q, 1)],
    // Far enough out that a test about time is testing time and not this default.
    tradingEnd: overrides.tradingEnd ?? 4_000_000_000,
    feeBps: overrides.feeBps ?? 100,
    collateral: "0xcccccccccccccccccccccccccccccccccccccccc",
    collateralDecimals: decimals,
    collateralSymbol: overrides.collateralSymbol ?? (decimals === MUSDC_DECIMALS ? "mUSDC" : "W0G"),
    specRoot: "0x1111111111111111111111111111111111111111111111111111111111111111",
    winningOutcome: overrides.winningOutcome ?? null,
  };
}

/**
 * What a budget buys, exactly as `Market.quoteBuySpend` inverts it.
 *
 * The fee denominator is `10_000 + feeBps` rather than `10_000` because the
 * contract charges the fee ON TOP of the pool cost, so inverting it out of a
 * gross budget has to account for the fee itself.
 */
export function sharesForBudget(input: {
  q: readonly [bigint, bigint];
  outcome: Outcome;
  budgetTokens: bigint;
  feeBps: number;
  decimals: number;
}): bigint {
  const bps = BigInt(input.feeBps);
  const fee = (input.budgetTokens * bps) / (10_000n + bps);
  return dpm.sharesForSpend(input.q, input.outcome, toWad(input.budgetTokens - fee, input.decimals));
}

/**
 * The `Preview` the SDK would return for buying `sharesOut`.
 *
 * `tokensIn` is GROSS — the fee is inside it — because that is what
 * `Market.quoteBuy` returns and therefore what an agent signs against. A test
 * that netted the fee back out would be measuring a trade nobody can make.
 */
export function previewOfBuy(input: {
  q: readonly [bigint, bigint];
  outcome: Outcome;
  sharesOut: bigint;
  feeBps: number;
  decimals: number;
}): Preview {
  const {q, outcome, sharesOut, feeBps, decimals} = input;
  const qAfter = quote.qAfterBuy(q, outcome, sharesOut);
  const costTokens = toTokensCeil(dpm.costUp(qAfter) - dpm.costUp(q), decimals);
  const feeTokens = (costTokens * BigInt(feeBps)) / 10_000n;
  const tokensIn = costTokens + feeTokens;
  return {
    tokensIn,
    feeTokens,
    sharesOut,
    avgPriceWad: sharesOut === 0n ? 0n : (toWad(tokensIn, decimals) * WAD) / sharesOut,
    impliedProbabilityBeforeWad: dpm.probability(q, outcome),
    impliedProbabilityAfterWad: dpm.probability(qAfter, outcome),
    payoutPerShareBeforeWad: quote.payoutPerShareWad(q, outcome),
    payoutPerShareAfterWad: quote.payoutPerShareWad(qAfter, outcome),
  };
}

/** The book after the same order, for the price fields a `Preview` does not carry. */
export function bookAfterBuy(input: {
  q: readonly [bigint, bigint];
  outcome: Outcome;
  sharesOut: bigint;
}): {marginalPriceWad: bigint; impliedProbabilityWad: bigint} {
  const qAfter = quote.qAfterBuy(input.q, input.outcome, input.sharesOut);
  return {
    marginalPriceWad: dpm.price(qAfter, input.outcome),
    impliedProbabilityWad: dpm.probability(qAfter, input.outcome),
  };
}

/**
 * A wad probability, from the percentage a person would say out loud.
 *
 * Rounded through 1e-6 in floating point and scaled the rest of the way in
 * bigint, exactly as `beliefFromProbability` does: `50.9 * 1e16` is beyond the
 * 53 bits a double carries, and a fixture that quietly landed a few wei off
 * would make the boundary cases below prove nothing.
 */
export function beliefWad(percent: number): bigint {
  return BigInt(Math.round(percent * 1e6)) * 10n ** 10n;
}
