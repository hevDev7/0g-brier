/**
 * RULE 1: the probability is `pᵢ²`, and a belief is measured against IT.
 *
 * `DPMMath.price` returns the marginal price `pᵢ = qᵢ/C(q)`; the implied
 * probability is its square, because `Σpᵢ² = WAD`. On an LMSR venue those are
 * one number, so an agent ported across the boundary reads either for the other
 * and keeps running — it just bleeds. The SDK names them apart (`MarketView`
 * has deliberately no field called `price`) so that the mistake has to be typed
 * out on purpose. This file is where that would be caught.
 *
 * The case below is chosen because it is the worst one: on a 50/50 book the
 * probability is 50.00% and the marginal price is 0.7071×, and a belief of 60%
 * lands BETWEEN them. Against the probability it is ten points of edge on YES.
 * Against the price it is not an edge at all, and the loop that read the price
 * would decline a market it had correctly judged to be mispriced.
 */
import {describe, expect, it} from "vitest";
import {WAD} from "@0g-brier/protocol";
import type {Preview} from "@0g-brier/agent-kit";
import {survivesItsOwnImpact} from "../src/agent.js";
import {pct, times} from "../src/config.js";
import {
  EVEN_BOOK,
  W0G_DECIMALS,
  beliefWad,
  bookAfterBuy,
  marketAt,
  previewOfBuy,
  sharesForBudget,
} from "./fixtures.js";
import {fileNamed, loadSrc, occurrences, statementAround} from "./source.js";

const book = marketAt(EVEN_BOOK);
/** "I think this resolves YES about 60 times in 100." */
const BELIEF = beliefWad(60);
/** 100 W0G, which is a real order rather than dust: it moves P by 6.3 points. */
const BUDGET = 100n * WAD;

const sharesOut = sharesForBudget({
  q: EVEN_BOOK,
  outcome: 1,
  budgetTokens: BUDGET,
  feeBps: book.feeBps,
  decimals: W0G_DECIMALS,
});
const preview = previewOfBuy({
  q: EVEN_BOOK,
  outcome: 1,
  sharesOut,
  feeBps: book.feeBps,
  decimals: W0G_DECIMALS,
});
const after = bookAfterBuy({q: EVEN_BOOK, outcome: 1, sharesOut});

describe("rule 1 — the two numbers, and why reading one for the other changes the trade", () => {
  it("one 50/50 book quotes 50.00% and 0.7071×, and the second is the square root of the first", () => {
    expect(pct(book.impliedProbabilityWad[1])).toBe("50.00%");
    expect(times(book.marginalPriceWad[1])).toBe("0.7071×");
    // The probabilities sum to WAD; the prices sum to 1.4142×. That is the
    // whole difference, and it is why only the first can be read as a percentage.
    // `± 2` is the one constant tolerance CLAUDE.md allows, because the algebra
    // makes this residue constant rather than a function of q.
    const summedProbability = book.impliedProbabilityWad[0] + book.impliedProbabilityWad[1];
    expect(summedProbability >= WAD - 2n && summedProbability <= WAD + 2n).toBe(true);
    expect(book.marginalPriceWad[0] + book.marginalPriceWad[1]).toBeGreaterThan(WAD);
  });

  it("a 60% belief is ten points of edge on YES against the probability", () => {
    const side = BELIEF > book.impliedProbabilityWad[1] ? 1 : 0;
    const edgeBps = ((BELIEF - book.impliedProbabilityWad[1]) * 10_000n) / WAD;
    expect(side).toBe(1);
    expect(edgeBps).toBe(1000n);
  });

  it("the SAME belief read against the marginal price picks the other side and then finds no edge at all", () => {
    // This is the mutation, written out: `market.impliedProbabilityWad` replaced
    // by `market.marginalPriceWad` in the two lines of `consider` that choose a
    // side and measure the edge.
    const side = BELIEF > book.marginalPriceWad[1] ? 1 : 0;
    expect(side).toBe(0);

    // Having picked NO, it compares its own 40% against a NO *price* of 0.7071
    // and declines. Every side looks expensive when the yardstick sums to 1.41,
    // so a mispriced book reads as a fair one and the agent simply stops trading.
    const beliefOnThatSide = WAD - BELIEF;
    expect(beliefOnThatSide).toBeLessThan(book.marginalPriceWad[0]);
  });
});

describe("rule 1 — the exported verdict accepts the probability and refuses the price", () => {
  it("survivesItsOwnImpact takes the trade: 108.49 W0G expected against a cost of 100", () => {
    const verdict = survivesItsOwnImpact(preview, BELIEF, W0G_DECIMALS, 0n);
    if (!verdict.ok) throw new Error(`expected the trade to survive, got: ${verdict.why}`);
    // sharesOut × payoutPerShareAfterWad × 0.60, against a gross tokensIn of 100.
    expect(verdict.expectedWad).toBe(108_494_743_860_525_678_690n);
    expect(verdict.survivingBps).toBe(849n);
  });

  it("every price-shaped field of that same preview sits ABOVE the belief", () => {
    // So a comparison against any of them aborts a trade the probability calls
    // good by 8.49%. `avgPriceWad` is the tempting one — "the average price I
    // paid" reads like a probability and is not one.
    expect(preview.impliedProbabilityAfterWad).toBeLessThan(BELIEF);
    expect(preview.avgPriceWad).toBeGreaterThan(BELIEF);
    expect(after.marginalPriceWad).toBeGreaterThan(BELIEF);
    expect(after.impliedProbabilityWad).toBeLessThan(BELIEF);
  });

  it("feeding the marginal price into the probability field turns that trade into an abort", () => {
    const misread: Preview = {
      ...preview,
      impliedProbabilityBeforeWad: book.marginalPriceWad[1],
      impliedProbabilityAfterWad: after.marginalPriceWad,
    };
    const verdict = survivesItsOwnImpact(misread, BELIEF, W0G_DECIMALS, 0n);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.why).toContain("past our own");
  });
});

/**
 * The half of rule 1 that no type can carry.
 *
 * `impliedProbabilityWad` and `marginalPriceWad` are both `readonly [bigint,
 * bigint]` on `MarketView`, so the compiler is content either way. The rule
 * lives at the call site, and this is the shape
 * `packages/agent-kit/test/network-boundary.test.ts` uses for exactly that.
 */
describe("rule 1, at the call site — agent.ts reads a marginal price only to print it", () => {
  const files = loadSrc();
  const agent = fileNamed(files, "agent.ts");

  it("scans the source it means to scan", () => {
    // A scanner that finds nothing passes everything below it for free.
    expect(files.map((f) => f.name)).toEqual(["agent.ts", "config.ts", "redeem.ts", "strategy.ts"]);
    for (const file of files) {
      expect(file.code, `src/${file.name} has no code left after comment blanking`).toContain("export");
      expect(file.code.trim().length, `src/${file.name} was blanked away`).toBeGreaterThan(200);
    }
  });

  it("every marginalPriceWad in agent.ts is inside a console.log", () => {
    const hits = occurrences(agent.code, /marginalPriceWad/g);
    expect(hits.length, "agent.ts stopped mentioning the marginal price at all").toBeGreaterThan(0);
    for (const hit of hits) {
      expect(
        hit.statement.includes("console.log("),
        `agent.ts:${hit.line} uses the marginal price outside a console.log — a decision, ` +
          `not a display: ${hit.statement}`,
      ).toBe(true);
    }
  });

  it("the side, the edge and the Kelly denominator all come from impliedProbabilityWad", () => {
    for (const anchor of ["const outcome", "const bookP", "const kellyWad"]) {
      const at = agent.code.indexOf(anchor);
      expect(at, `agent.ts no longer declares ${anchor}`).toBeGreaterThan(-1);
      const statement = statementAround(agent.code, at);
      expect(statement, `agent.ts: ${anchor} reads the marginal price`).not.toContain("marginalPriceWad");
    }
    // The two that read the book directly must name the probability field.
    expect(statementAround(agent.code, agent.code.indexOf("const outcome"))).toContain("impliedProbabilityWad");
    expect(statementAround(agent.code, agent.code.indexOf("const bookP"))).toContain("impliedProbabilityWad");
  });

  it("pct() is never handed a price and times() is never handed a probability", () => {
    // CLAUDE.md: anything wearing a percent sign comes from `dpm.probability`.
    // A marginal price printed as a percentage is wrong by about five points,
    // and the reader has no way to tell.
    for (const file of files) {
      for (const hit of occurrences(file.code, /\bpct\(([^)]*)\)/g)) {
        expect(
          hit.groups[0] ?? "",
          `src/${file.name}:${hit.line} prints a price as a percentage`,
        ).not.toMatch(/marginalPrice|avgPrice|payoutPerShare/);
      }
      for (const hit of occurrences(file.code, /\btimes\(([^)]*)\)/g)) {
        expect(
          hit.groups[0] ?? "",
          `src/${file.name}:${hit.line} prints a probability as a multiple`,
        ).not.toMatch(/impliedProbability/);
      }
    }
  });
});
