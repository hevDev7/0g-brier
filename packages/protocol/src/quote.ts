import { WAD } from './units';
import { price, probability, sharesForSpend, type Outcome, type Q } from './dpm';

/**
 * Quote engine: what a budget gets, and what it does to the market. Pure —
 * no React, no RPC, no state — so the same implementation serves the human
 * UI and `@brier/agent-kit`.
 *
 * This is a REFERENCE implementation, not the authority: before sending a
 * transaction, the caller calls `quoteBuySpend`/`quoteBuy` on-chain, and that
 * number is what gets signed. This module mirrors `Market.quoteBuySpend` —
 * the same fee inversion, the same `DPMMath.sharesForSpend` via the mirror
 * in `dpm.ts` — with one deliberate difference: here everything is wad,
 * whereas the contract inverts the fee in token units and then scales it up
 * to wad. Decimal conversion happens only at the token boundary, never in
 * the middle of a calculation.
 */
export interface QuotePreview {
  /** Outcome shares received, wad. */
  sharesOut: bigint;
  /** Portion of the budget that actually enters the pool, wad. */
  poolInWad: bigint;
  /** Portion of the budget that becomes the fee, wad. */
  feeWad: bigint;
  /** Gross budget: always `poolInWad + feeWad`. */
  totalWad: bigint;
  /** Average price paid per share, wad. Always above the initial marginal price. */
  avgPriceWad: bigint;
  probBeforeWad: bigint;
  probAfterWad: bigint;
  payoutBeforeWad: bigint;
  payoutAfterWad: bigint;
}

const MAX_FEE_BPS = 10_000;

/**
 * Payout per winning share = 1/p_i, in wad.
 *
 * NOT 1/P_i. Both produce numbers that look plausible, and using the wrong
 * one overstates the payout by around 30% at typical skew — exactly the
 * direction that hurts anyone who trusts it. This project's own first spec
 * draft made that mistake.
 */
export function payoutPerShareWad(q: Q, outcome: Outcome): bigint {
  const p = price(q, outcome);
  if (p === 0n) return 0n;
  return (WAD * WAD) / p;
}

/** State of q after `shares` shares of `outcome` are minted. */
export function qAfterBuy(q: Q, outcome: Outcome, shares: bigint): Q {
  return outcome === 0 ? [q[0] + shares, q[1]] : [q[0], q[1] + shares];
}

/**
 * The fee contained WITHIN the gross budget `grossWad`.
 *
 * The denominator is `10_000 + feeBps`, not `10_000`, and that is not a
 * detail: the contract charges the fee ON TOP OF the pool cost
 * (`fee = costTokens * feeBps / 10_000`, see `Market._priceBuy`), so
 * inverting it from the gross budget must use a denominator that already
 * accounts for the fee itself. Using `10_000` leaves part of the budget
 * idle — the quote promises fewer shares than that budget actually buys.
 */
export function feeFromGross(grossWad: bigint, feeBps: number): bigint {
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > MAX_FEE_BPS) {
    throw new RangeError(`unsupported feeBps: ${feeBps} (must be an integer 0..${MAX_FEE_BPS})`);
  }
  if (grossWad <= 0n) return 0n;
  const bps = BigInt(feeBps);
  return (grossWad * bps) / (10_000n + bps);
}

/** Preview when nothing is bought: current market state, flat transition. */
function still(q: Q, outcome: Outcome): QuotePreview {
  const prob = probability(q, outcome);
  const payout = payoutPerShareWad(q, outcome);
  return {
    sharesOut: 0n,
    poolInWad: 0n,
    feeWad: 0n,
    totalWad: 0n,
    avgPriceWad: 0n,
    probBeforeWad: prob,
    probAfterWad: prob,
    payoutBeforeWad: payout,
    payoutAfterWad: payout,
  };
}

/**
 * Preview of buying `spendWad` (GROSS budget, fee already included).
 *
 * Zero spend and a market that rejects the purchase (e.g. `q` at the MAX_Q
 * limit, which makes `sharesForSpend` throw) produce an empty preview — with
 * the CURRENT probability and payout still populated, not zero. A preview is
 * a read, not a transaction: it must not crash the screen or agent process
 * that calls it, and must not make the market read as worthless just
 * because nothing was spent.
 */
export function quoteBuy(input: {
  q: Q;
  outcome: Outcome;
  spendWad: bigint;
  feeBps: number;
}): QuotePreview {
  const { q, outcome, spendWad, feeBps } = input;
  const feeWad = feeFromGross(spendWad, feeBps);
  const poolInWad = spendWad - feeWad;
  if (poolInWad <= 0n) return still(q, outcome);

  let sharesOut: bigint;
  try {
    sharesOut = sharesForSpend(q, outcome, poolInWad);
  } catch {
    return still(q, outcome);
  }
  const after = qAfterBuy(q, outcome, sharesOut);
  return {
    sharesOut,
    poolInWad,
    feeWad,
    totalWad: spendWad,
    avgPriceWad: sharesOut === 0n ? 0n : (poolInWad * WAD) / sharesOut,
    probBeforeWad: probability(q, outcome),
    probAfterWad: probability(after, outcome),
    payoutBeforeWad: payoutPerShareWad(q, outcome),
    payoutAfterWad: payoutPerShareWad(after, outcome),
  };
}
