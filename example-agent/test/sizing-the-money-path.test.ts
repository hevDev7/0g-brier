import {describe, expect, it} from "vitest";
import {edgeAgainstBook, impactCapFor, stakeBudget} from "../src/agent.js";
import {EVEN_BOOK, beliefWad, marketAt} from "./fixtures.js";

const WAD = 10n ** 18n;

/**
 * The arithmetic between "the strategy has an opinion" and "an order is signed".
 *
 * This file exists because that stretch was unexported and therefore untested, and
 * five separate mutations of it left the whole suite green: deleting the tightening
 * of the impact cap to the edge, deleting the Kelly denominator, dropping the
 * affordability abort, dropping the sub-basis-point abort, and inverting the
 * slippage bound below the chain's own quote so every live order would revert after
 * paying gas. Each is a plausible edit and each costs money.
 *
 * Every assertion below is on a VALUE, not on the shape of the source.
 */

// A fresh 50/50 book. `marginalPriceWad` reads 0.7071 here and
// `impliedProbabilityWad` reads 0.5 — the gap the first describe block turns on.
const evenMarket = marketAt(EVEN_BOOK);

describe("which side is cheap, measured against the probability", () => {
  it("reads a 60% belief as a 10pp edge on YES", () => {
    const found = edgeAgainstBook(beliefWad(60), evenMarket);
    expect(found.kind).toBe("edge");
    if (found.kind !== "edge") throw new Error("unreachable");
    expect(found.outcome).toBe(1);
    expect(found.bookP).toBe(WAD / 2n);
    expect(found.myP).toBe(600000000000000000n);
    expect(found.edgeBps).toBe(1000n);
  });

  it("RULE 1: the same belief has NO edge against the marginal price, and the wrong side", () => {
    // The whole reason the SDK names the two fields apart. At this book:
    //   impliedProbabilityWad = 0.5      → a 60% belief is 10pp cheap on YES
    //   marginalPriceWad      = 0.7071   → a 60% belief looks 10.7pp EXPENSIVE
    // An agent that reads one for the other does not merely mis-size: it takes the
    // opposite side of its own forecast, and keeps running.
    expect(evenMarket.marginalPriceWad[1]).toBe(707106781186547524n);
    expect(evenMarket.impliedProbabilityWad[1]).toBe(WAD / 2n);

    const asProbability = edgeAgainstBook(beliefWad(60), evenMarket);
    expect(asProbability.kind).toBe("edge");

    // Feed the price in where the probability belongs — the one-character slip.
    const asPrice = edgeAgainstBook(beliefWad(60), {impliedProbabilityWad: evenMarket.marginalPriceWad});
    expect(asPrice.kind).toBe("no-edge");
    expect(asPrice.outcome).toBe(0); // NO, the opposite of the correct trade
  });

  it("takes the NO side when the belief is below the book", () => {
    const found = edgeAgainstBook(beliefWad(40), evenMarket);
    expect(found.kind).toBe("edge");
    if (found.kind !== "edge") throw new Error("unreachable");
    expect(found.outcome).toBe(0);
    expect(found.edgeBps).toBe(1000n);
  });

  it("reports no edge when the belief agrees with the book", () => {
    expect(edgeAgainstBook(WAD / 2n, evenMarket).kind).toBe("no-edge");
  });

  it("calls a sub-basis-point difference dust rather than an edge", () => {
    // 1e13 wad of disagreement is 0.001pp, which rounds to zero basis points.
    // Trading it would pay a fee and gas to express a rounding residue.
    const found = edgeAgainstBook(WAD / 2n + 10n ** 13n, evenMarket);
    expect(found.kind).toBe("dust");
    if (found.kind !== "dust") throw new Error("unreachable");
    expect(found.edgeBps).toBe(0n);
  });
});

describe("how much of the bankroll the edge justifies", () => {
  const spendable = WAD; // one whole collateral token

  it("uses (1 − P), the PROBABILITY, as the Kelly denominator", () => {
    // f* = (0.60 − 0.50) / (1 − 0.50) = 0.20 exactly.
    const {kellyWad} = stakeBudget({
      myP: 600000000000000000n,
      bookP: WAD / 2n,
      spendable,
      bankrollCapBps: 10_000n, // uncapped, so the raw Kelly is visible
    });
    expect(kellyWad).toBe(200000000000000000n);
  });

  it("RULE 1 again: the marginal price in place of the probability asks for a NEGATIVE stake", () => {
    // The ported-LMSR mistake, priced. Substituting 0.7071 for 0.5 puts the book
    // ABOVE the 60% belief, so f* = (0.60 − 0.7071)/(1 − 0.7071) comes out at
    // −0.3657 — the formula asking for a short position in a market that has no
    // such thing, from a budget line that would then size against a negative
    // fraction. In the live path `edgeAgainstBook` refuses first, which is exactly
    // why the two are separate functions: the guard is the thing standing between
    // this arithmetic and a wallet.
    const wrong = stakeBudget({
      myP: 600000000000000000n,
      bookP: evenMarket.marginalPriceWad[1],
      spendable,
      bankrollCapBps: 10_000n,
    });
    expect(wrong.kellyWad).toBe(-365685424949238017n);
    expect(wrong.kellyWad).toBeLessThan(0n);

    // And the guard does hold: the same substitution never reaches stakeBudget.
    expect(edgeAgainstBook(beliefWad(60), {impliedProbabilityWad: evenMarket.marginalPriceWad}).kind).toBe(
      "no-edge",
    );
  });

  it("caps the fraction at the configured bankroll limit and sizes the budget from it", () => {
    const {kellyWad, fractionWad, budgetTokens} = stakeBudget({
      myP: 900000000000000000n, // a 40pp edge: Kelly wants 80% of the bankroll
      bookP: WAD / 2n,
      spendable,
      bankrollCapBps: 2500n, // the shipped default
    });
    expect(kellyWad).toBe(800000000000000000n);
    expect(fractionWad).toBe(250000000000000000n); // capped
    expect(budgetTokens).toBe(WAD / 4n); // 25% of one token
  });

  it("leaves the fraction alone when Kelly is already under the cap", () => {
    const {fractionWad, budgetTokens} = stakeBudget({
      myP: 600000000000000000n,
      bookP: WAD / 2n,
      spendable,
      bankrollCapBps: 2500n,
    });
    expect(fractionWad).toBe(200000000000000000n); // Kelly, not the 25% cap
    expect(budgetTokens).toBe(200000000000000000n);
  });

  it("spends nothing when there is nothing to spend", () => {
    const {budgetTokens} = stakeBudget({
      myP: 600000000000000000n,
      bookP: WAD / 2n,
      spendable: 0n,
      bankrollCapBps: 2500n,
    });
    expect(budgetTokens).toBe(0n);
  });
});

describe("the impact ceiling is derived from the edge, not chosen", () => {
  it("tightens the standing limit down to the distance to the belief", () => {
    // 3pp of edge against a 5pp standing cap: buying the last 2pp would be buying
    // shares the agent's own model calls overpriced.
    expect(impactCapFor(300n, 500n)).toBe(300n);
  });

  it("keeps the standing limit when the edge is wider than it", () => {
    expect(impactCapFor(1000n, 500n)).toBe(500n);
  });

  it("is exactly the smaller of the two at the boundary", () => {
    expect(impactCapFor(500n, 500n)).toBe(500n);
  });
});
