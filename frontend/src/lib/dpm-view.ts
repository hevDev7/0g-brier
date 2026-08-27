import {dpm, quote} from "@0g-delphi/protocol";
import type {Outcome} from "@/lib/data/types";

type Q = readonly [bigint, bigint];

/**
 * Display-side derivations of market state. Every value here comes from the
 * TypeScript mirror already pinned to DPMMath.sol by the 512-vector
 * differential test — so the numbers on screen come from the same source as the
 * numbers on chain, not from a reimplementation.
 *
 * This file computes NOTHING of its own; it only names the derivations the
 * screen uses. The formulas live in `@0g-delphi/protocol`, in a single copy,
 * which `@0g-delphi/agent-kit` uses too — two copies of the payout formula is
 * the easiest way to make the screen and the agent disagree about the same
 * number.
 */

/** Implied probability P_i = p_i^2. This is the only source for any value labelled %. */
export function probabilityWad(q: Q, outcome: Outcome): bigint {
  return dpm.probability(q, outcome);
}

/**
 * Payout per winning share = 1/p_i, in wad.
 *
 * NOT 1/P_i. Both produce numbers that look plausible, and using the wrong one
 * overstates the payout by around 30% at ordinary skew — exactly the direction
 * that hurts anyone who trusts it. This spec's own first draft made that
 * mistake; the test that guards it lives in
 * packages/protocol/test/quote.test.ts, on the formula's side.
 */
export function payoutPerShareWad(q: Q, outcome: Outcome): bigint {
  return quote.payoutPerShareWad(q, outcome);
}
