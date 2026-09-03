/**
 * RULE 3: the prize FLOATS, so the edge is checked AFTER the order.
 *
 * Brier is parimutuel. A winning share pays `1/pᵢ` out of the pool, and the
 * agent's own buy moves `p` up — so the prize is smaller by the time the shares
 * are held than it was when the trade was decided. Every buy is a little
 * self-defeating. An LMSR-trained developer has no concept of this at all:
 * there a winning share pays exactly 1, fixed at purchase, and an edge measured
 * before the order is the edge after it.
 *
 * `survivesItsOwnImpact` is where this project refuses that trade. The two
 * cases below are the two ways an order can fail to survive itself, and the
 * second is the one that only exists on a DPM book:
 *
 *   A. the order walks the book PAST the belief, so its last shares are ones
 *      the agent's own model prices as too expensive;
 *   B. the order stays under the belief, and STILL loses money, because the
 *      payout it will be paid at is the diluted one.
 *
 * Case B is measured twice on purpose — once against `payoutPerShareAfterWad`
 * and once against `payoutPerShareBeforeWad` — because the same order reads as
 * −0.24% one way and +0.44% the other. The second is the number a pre-trade
 * calculation returns, and it is a trade this agent must not make.
 */
import {describe, expect, it} from "vitest";
import {WAD, toWad} from "@0g-brier/protocol";
import type {Preview} from "@0g-brier/agent-kit";
import {survivesItsOwnImpact} from "../src/agent.js";
import {pct, rate, times} from "../src/config.js";
import {
  EVEN_BOOK,
  MUSDC_DECIMALS,
  W0G_DECIMALS,
  beliefWad,
  marketAt,
  previewOfBuy,
  sharesForBudget,
} from "./fixtures.js";

const FEE_BPS = 100;

/** The order a budget produces, quoted the way `consider` quotes it. */
function orderFor(budgetTokens: bigint, decimals: number): Preview {
  const sharesOut = sharesForBudget({
    q: EVEN_BOOK,
    outcome: 1,
    budgetTokens,
    feeBps: FEE_BPS,
    decimals,
  });
  return previewOfBuy({q: EVEN_BOOK, outcome: 1, sharesOut, feeBps: FEE_BPS, decimals});
}

/**
 * The same expected value `survivesItsOwnImpact` computes, but at the PRE-trade
 * payout — the answer this rule exists to reject. Written out here so that a
 * test asserting "and the wrong method would have traded" is showing its work
 * rather than quoting a number from a comment.
 */
function survivingBpsAtPreTradePayout(preview: Preview, belief: bigint, decimals: number): bigint {
  const costWad = toWad(preview.tokensIn, decimals);
  const ifItWinsWad = (preview.sharesOut * preview.payoutPerShareBeforeWad) / WAD;
  const expectedWad = (ifItWinsWad * belief) / WAD;
  return ((expectedWad - costWad) * 10_000n) / costWad;
}

describe("the payout falls as the order is taken", () => {
  it("a buy moves the probability up and the prize down, on every size", () => {
    for (const budget of [1n, 10n, 100n, 300n, 800n]) {
      const preview = orderFor(budget * WAD, W0G_DECIMALS);
      expect(preview.impliedProbabilityAfterWad).toBeGreaterThan(preview.impliedProbabilityBeforeWad);
      expect(preview.payoutPerShareAfterWad).toBeLessThan(preview.payoutPerShareBeforeWad);
    }
  });

  it("100 W0G into a 50/50 book takes P from 50.00% to 56.33% and the prize from 1.4142× to 1.3324×", () => {
    const preview = orderFor(100n * WAD, W0G_DECIMALS);
    expect(pct(preview.impliedProbabilityBeforeWad)).toBe("50.00%");
    expect(pct(preview.impliedProbabilityAfterWad)).toBe("56.33%");
    expect(times(preview.payoutPerShareBeforeWad)).toBe("1.4142×");
    expect(times(preview.payoutPerShareAfterWad)).toBe("1.3324×");
  });
});

describe("case A — the order must not walk the book past the belief", () => {
  const preview = orderFor(300n * WAD, W0G_DECIMALS);
  const belief = beliefWad(55);

  it("aborts, and says the order would end past the agent's own number", () => {
    const verdict = survivesItsOwnImpact(preview, belief, W0G_DECIMALS, 0n);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.why).toContain("past our own");
    // 65.85% is where the book would be left; the belief is 55%. The last
    // shares of the order are ones this belief calls overpriced, so the tail of
    // the order is a bet against its own head.
    expect(pct(preview.impliedProbabilityAfterWad)).toBe("65.85%");
  });

  it("and a pre-trade payout would have called that same order profitable", () => {
    expect(survivingBpsAtPreTradePayout(preview, belief, W0G_DECIMALS)).toBe(76n);
  });
});

describe("case B — an order that stays under the belief and still does not survive", () => {
  const preview = orderFor(10n * WAD, W0G_DECIMALS);
  // 50.9%: above where the order leaves the book (50.69%), so case A does not
  // fire, and below the break-even the DILUTED payout demands (51.02%).
  const belief = beliefWad(50.9);

  it("clears the walk-past guard", () => {
    expect(preview.impliedProbabilityAfterWad).toBeLessThan(belief);
    expect(pct(preview.impliedProbabilityAfterWad)).toBe("50.69%");
  });

  it("is refused, because the payout it will be paid at is the diluted one", () => {
    const verdict = survivesItsOwnImpact(preview, belief, W0G_DECIMALS, 0n);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.why).toContain("does not survive its own impact");
    expect(verdict.why).toContain(rate(-24n));
  });

  it("and the pre-trade payout would have traded it at +0.44%", () => {
    // 68 basis points apart on an order of ten tokens, and the sign is what
    // matters: this is the whole of rule 3 in one comparison.
    expect(survivingBpsAtPreTradePayout(preview, belief, W0G_DECIMALS)).toBe(44n);
  });

  it("reaches the same verdict in a 6-decimal collateral", () => {
    // The mock USDC on Galileo has 6 decimals. `toWad(tokensIn, decimals)` is
    // what keeps the cost and the wad-scaled payout in the same units; drop it
    // and this order reads as nine trillion percent of profit instead of a loss.
    const musdc = orderFor(10_000_000n, MUSDC_DECIMALS);
    expect(musdc.tokensIn).toBe(10_000_000n);
    const verdict = survivesItsOwnImpact(musdc, belief, MUSDC_DECIMALS, 0n);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.why).toContain(rate(-24n));
  });
});

describe("the floor, and the refusals that are not about arithmetic", () => {
  const preview = orderFor(100n * WAD, W0G_DECIMALS);
  const belief = beliefWad(60);

  it("MIN_EDGE_BPS is a floor the trade must clear, not merely reach", () => {
    const atTheFloor = survivesItsOwnImpact(preview, belief, W0G_DECIMALS, 849n);
    expect(atTheFloor.ok).toBe(false);
    const justBelow = survivesItsOwnImpact(preview, belief, W0G_DECIMALS, 848n);
    expect(justBelow.ok).toBe(true);
  });

  it("refuses a quote of zero rather than dividing by it", () => {
    // A cost of zero is not a free trade; it is a market that has answered
    // something nobody should sign.
    const free: Preview = {...preview, tokensIn: 0n};
    const verdict = survivesItsOwnImpact(free, belief, W0G_DECIMALS, 0n);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.why).toContain("cost of zero");
  });

  it("the market a case-B order is quoted against is the one the fixtures describe", () => {
    // Guards the fixtures themselves: every number above is derived from this q,
    // so a fixture that quietly stopped describing a 50/50 book would make the
    // assertions above pass while testing something else.
    const book = marketAt(EVEN_BOOK);
    expect(pct(book.impliedProbabilityWad[1])).toBe("50.00%");
    expect(book.feeBps).toBe(FEE_BPS);
  });
});
