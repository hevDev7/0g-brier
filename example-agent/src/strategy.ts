/**
 * THE SEAM. This is the file you replace.
 *
 * Everything else in this project is plumbing that already works: it resolves a
 * network without guessing, reads the book, sizes an order against both the
 * bankroll and the depth, checks that the edge survives the order's own market
 * impact, and signs. None of it has an opinion about the world. This file is
 * where the opinion goes, and it is deliberately the only file that has to
 * change.
 *
 * The contract is one function:
 *
 *     (market, ctx) => Promise<Belief | null>
 *
 * `null` means NO OPINION, and the loop honours it exactly: it moves on without
 * trading, without warning, and without counting it as a failure. Abstaining is
 * a correct answer here rather than a missing one. A forecaster that returns a
 * number for every market it is shown is not forecasting; it is filling in a
 * form. Most markets, most of the time, should get `null` — and the default
 * implementation at the bottom of this file returns nothing else.
 *
 * The seam takes no model with it. There is no 0G Compute import here, no LLM
 * SDK, no HTTP client. Whatever forms your belief — a hosted model, a TEE-
 * attested one on 0G Compute, a scraper, a spreadsheet, a person — lives behind
 * this signature and the rest of the project never learns which.
 *
 * WHAT THE LOOP DOES WITH WHAT YOU RETURN, so that you can predict it:
 *
 *   `impliedProbabilityWad` is compared against `market.impliedProbabilityWad`
 *   and NEVER against `market.marginalPriceWad`. Those are two different
 *   numbers — Brier is DPM Pennock, where `Σpᵢ² = WAD`, so the probability is
 *   the SQUARE of the marginal price. At ordinary skew they differ by about
 *   five percentage points, which is larger than most real edges. Return a
 *   probability. If your model gives you a price, square it first.
 */
import type {MarketView, Outcome, SpecSource} from "@0g-brier/agent-kit";

/**
 * The document a market's `specRoot` commits to, as a strategy needs it.
 *
 * The chain holds a hash; the text lives on 0G Storage and is verified against
 * that hash on the way in. Only the fields the chain cannot answer are here:
 * `category`, `tier` and `tradingEnd` are in the document too, but the on-chain
 * values are the ones that bind, so read those off `MarketView`. A document
 * that disagrees with its own market must not be able to change what the market
 * is by saying so.
 */
export interface MarketSpec {
  version: number;
  /** What the market actually asks. The thing your model reasons about. */
  question: string;
  /** How it settles. Read it: a question and its rules often disagree in spirit. */
  rules: string;
  /**
   * Where the resolvers are supposed to look.
   *
   * The same shape `gatherEvidence` in `@0g-brier/agent-kit` takes, so a
   * strategy that wants to read the sources for itself can pass these straight
   * to it rather than re-deriving them.
   */
  sources: readonly SpecSource[];
  settlementPrompt: string | null;
}

/** What the agent thinks, as opposed to what the market thinks. */
export interface Belief {
  /**
   * The agent's OWN probability that the outcome resolves YES, wad-scaled
   * (`1e18` = 100%). Always about YES, whichever side turns out to be the cheap
   * one: a belief of 70% YES is equally a belief of 30% NO, and the loop reads
   * both sides of it.
   */
  impliedProbabilityWad: bigint;
  /**
   * Why. Printed in the report and worth writing properly.
   *
   * A position whose reasoning was never recorded cannot be reviewed after it
   * loses, and "the model said so" is not a review.
   */
  rationale: string;
}

/**
 * What a rule gets to see. Small on purpose — every field earns its place:
 *
 * - `spec` is the question itself. Without it a model has nothing to reason
 *   about, and `null` is a genuine answer rather than a failure: on anvil there
 *   is no 0G Storage network at all, and elsewhere a market's document may be
 *   absent or may fail verification. Treat `null` as "I was not told what this
 *   market asks" — which is a good reason to abstain.
 *
 * - `position` is what the agent already holds on each side, index 0 = NO,
 *   1 = YES, in wad shares. A rule that already holds a side should be asking
 *   "would I open this position at today's price?", not "am I up?". It is
 *   `null` in a dry run, because a read-only client has no wallet and reporting
 *   a stranger's zero as your own position would be a lie with a number on it.
 *
 * - `spendableTokens` is what the run may commit, in the market's OWN collateral
 *   units — 6 decimals for the mock USDC on Galileo, 18 for W0G on mainnet.
 *   A rule may reasonably decline a market its budget cannot move.
 *
 * - `spendableSource` says whether that number was measured on chain or stated
 *   in configuration for a dry run, so nothing downstream reads a hypothetical
 *   as a fact.
 *
 * - `now` is unix seconds, injected rather than read from the clock, so that a
 *   rule about time left is testable and so that every market in one pass is
 *   judged against the same instant.
 *
 * - `dryRun` is here because forming a belief usually costs money. A dry run
 *   that still pays for inference on every market is a surprise, and the seam
 *   is the only place that knows what forming the belief costs.
 */
export interface StrategyContext {
  spec: MarketSpec | null;
  position: readonly [bigint, bigint] | null;
  spendableTokens: bigint;
  spendableSource: "wallet" | "config";
  now: number;
  dryRun: boolean;
}

export type Strategy = (market: MarketView, ctx: StrategyContext) => Promise<Belief | null>;

/**
 * A float probability into the wad integer the loop expects.
 *
 * Rounded to 1e-6 and zero below that on purpose. A probability out of a model
 * carries at most a few significant digits; letting IEEE-754 residue fill the
 * bottom of a wad would dress noise up as precision the number does not have.
 *
 * It throws rather than clamping. There is no safe substitute for a belief that
 * did not parse: a value defaulted to 0.5 is NOT neutral on a DPM book, it is a
 * position against whatever the market currently says, and it will be sized and
 * signed like any other.
 */
export function beliefFromProbability(probability: number, rationale: string): Belief {
  if (!Number.isFinite(probability)) {
    throw new Error("belief is not a number — refusing to substitute one");
  }
  if (probability < 0 || probability > 1) {
    throw new Error(`belief ${probability} is not a probability (expected 0…1)`);
  }
  if (rationale.trim() === "") {
    throw new Error("belief has no rationale — a position nobody can review later");
  }
  return {impliedProbabilityWad: BigInt(Math.round(probability * 1e6)) * 10n ** 12n, rationale};
}

/**
 * The shipped strategy. IT NEVER TRADES, AND THAT IS THE POINT.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS FUNCTION HAS NO FORECAST IN IT AND WILL NOT PRETEND OTHERWISE.     ║
 * ║                                                                          ║
 * ║  Run this project unmodified and it will connect, read every open        ║
 * ║  market, print the book, and buy nothing. There is no threshold here     ║
 * ║  that fires on a stale price, no momentum rule, no "0.5 plus a nudge".   ║
 * ║  A placeholder that traded would be worse than useless: it would look    ║
 * ║  like a working agent, it would take real positions on a signal nobody   ║
 * ║  designed, and the first thing anyone learned from this project would    ║
 * ║  be a bug.                                                               ║
 * ║                                                                          ║
 * ║  Everything below the preconditions is yours to write.                   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * What it does do is the part that is the same whatever your model is: the
 * checks that make a market unfit to have an opinion about at all. Those are
 * real, they are load-bearing, and you should keep them.
 */
export const strategy: Strategy = async (market, ctx) => {
  // No question, no opinion. The chain holds a hash of the market's document;
  // if the document behind it could not be read or did not verify, this run
  // does not know what the market asks. Trading on the ticker alone is trading
  // on a guess about the question, before any guess about the answer.
  if (ctx.spec === null) return null;

  // A market that declares no sources has told the resolution committee nothing
  // to look at, which makes it markedly more likely to reach its settlement
  // deadline unresolved and be FAILED. A failed market pays every side out at
  // its own price rather than paying a winner at 1/p — a different bet from the
  // one a forecast is about. Decline it, or handle it deliberately.
  if (ctx.spec.sources.length === 0) return null;

  // Open is not the same as tradable. `close()` only becomes callable once
  // `tradingEnd` has passed and somebody still has to send it, so a market sits
  // in Open past its own window until a keeper acts — one sat four hours that
  // way in this project while every buy against it reverted (see the note at
  // the top of scripts/keeper-tick.sh). The status says Open; the clock is the
  // thing that decides.
  if (market.tradingEnd - ctx.now <= 0) return null;

  // Nothing to trade with. Worth checking here rather than letting the sizer
  // return zero later, because forming the belief is the expensive step and
  // there is no point paying for one that cannot be acted on.
  if (ctx.spendableTokens <= 0n) return null;

  // ─────────────────────────────────────────────────────────────────────────
  // YOUR MODEL GOES HERE, and this `return null` is the line you delete.
  //
  // Everything a forecast needs is in hand: `ctx.spec.question` and
  // `ctx.spec.rules` say what is being asked and how it settles,
  // `ctx.spec.sources` says where the resolvers will look, `market.tradingEnd`
  // says how long there is, and `ctx.position` says what you already hold.
  //
  // A minimal replacement looks like this — the whole body, not a fragment:
  //
  //     const answer = await myModel(ctx.spec.question, ctx.spec.rules);
  //     if (answer === null) return null;          // still a valid answer
  //     return beliefFromProbability(answer.p, answer.why);
  //
  // Three things to hold on to when you write it:
  //
  //   1. Return a PROBABILITY, not a price. The loop compares your number
  //      against `market.impliedProbabilityWad`, and the marginal price is its
  //      square root. Handing over a price understates your belief by up to
  //      about five percentage points and does it silently.
  //
  //   2. Keep `null` reachable. A model that cannot read the sources, times
  //      out, or answers something you cannot parse has given you no belief,
  //      and no belief is not 50%. `beliefFromProbability` throws for the same
  //      reason rather than clamping.
  //
  //   3. Do not compute a payout here, or anywhere. The prize per winning share
  //      is `1/pᵢ` and it FLOATS — your own order moves `p` and shrinks it. The
  //      loop reads `Preview.payoutPerShareAfterWad` from the SDK for exactly
  //      that reason; anything you work out locally is a pre-trade number and
  //      will overstate the trade you are about to make.
  // ─────────────────────────────────────────────────────────────────────────
  return null;
};

/** Re-exported so a replacement strategy has the outcome type without a second import. */
export type {Outcome};
