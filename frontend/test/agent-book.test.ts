import {describe, expect, it} from "vitest";
import {agentBook, agentsSeen, holdingStatus} from "@/lib/agent-book";
import {FIXTURE_MARKETS, MockSource} from "@/lib/data/mock";
import {formatCollateral} from "@/lib/format";
import type {MarketStatus, Position} from "@/lib/data/types";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

async function book(source = new MockSource()) {
  const markets = await source.listMarkets();
  const lists = await Promise.all(markets.map((m) => source.getPositions(m.address)));
  return {markets, lists};
}

describe("agentsSeen", () => {
  it("lists every distinct agent exactly once", async () => {
    const {lists} = await book();
    const seen = agentsSeen(lists);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThan(0);
  });

  /**
   * The portfolio address field validates what it is given, so a fixture agent
   * that is not a well-formed address would be rejected by the very page meant
   * to inspect it.
   */
  it("every fixture agent is a well-formed 40-character address", async () => {
    const {lists} = await book();
    for (const agent of agentsSeen(lists)) expect(agent).toMatch(ADDRESS);
  });
});

describe("agentBook", () => {
  it("returns only the rows belonging to the requested agent", async () => {
    const {markets, lists} = await book();
    const agent = agentsSeen(lists)[0]!;
    const rows = agentBook(markets, lists, agent);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const holders = lists[markets.indexOf(row.market)]!;
      expect(holders.some((p) => p.agent === agent && p.outcome === row.outcome)).toBe(true);
    }
  });

  it("matches the address case-insensitively", async () => {
    const {markets, lists} = await book();
    const agent = agentsSeen(lists)[0]!;
    expect(agentBook(markets, lists, agent.toUpperCase().replace("0X", "0x"))).toHaveLength(
      agentBook(markets, lists, agent).length,
    );
  });

  it("returns nothing for an address that holds nothing", async () => {
    const {markets, lists} = await book();
    expect(agentBook(markets, lists, `0x${"9".repeat(40)}`)).toHaveLength(0);
  });

  /**
   * Value uses the MARGINAL PRICE, never the probability. At q = [1000, 1200]
   * the NO price is 0.6402 while P(NO) is 41.0%; valuing at the probability
   * would understate this holding by more than a third.
   */
  it("values a holding at the marginal price, not at the probability", async () => {
    const market = FIXTURE_MARKETS[0]!;
    const positions: Position[] = [
      {
        agent: `0x${"a".repeat(40)}`,
        outcome: 0,
        shares: 100n * 10n ** 18n,
        entryPriceWad: (10n ** 18n * 50n) / 100n,
      },
    ];
    const [row] = agentBook([market], [positions], `0x${"a".repeat(40)}`);
    // p(NO) = 0.640184399664…, so 100 shares are worth 64.018439 mUSDC once
    // floored to six decimals. Bounds rather than a bare constant, so the test
    // states the claim (a hundred shares priced just above 0.64) instead of
    // restating the implementation's arithmetic back at it.
    expect(row!.currentValueTokens).toBeGreaterThan(64_018_000n);
    expect(row!.currentValueTokens).toBeLessThan(64_019_000n);
    expect(row!.currentValueTokens).toBe(64_018_439n);
    // Valuing at P(NO) = 41.0% instead would give 40.983606 — a third less.
    expect(row!.currentValueTokens).not.toBe(40_983_606n);
  });

  it("reports profit and loss signed, rounded towards zero", async () => {
    const market = FIXTURE_MARKETS[0]!;
    const agent = `0x${"a".repeat(40)}` as const;
    const shares = 100n * 10n ** 18n;
    // Bought above the current price -> a loss.
    const dear: Position[] = [{agent, outcome: 0, shares, entryPriceWad: (10n ** 18n * 80n) / 100n}];
    // Bought below it -> a gain.
    const cheap: Position[] = [{agent, outcome: 0, shares, entryPriceWad: (10n ** 18n * 50n) / 100n}];
    expect(agentBook([market], [dear], agent)[0]!.pnlTokens).toBeLessThan(0n);
    expect(agentBook([market], [cheap], agent)[0]!.pnlTokens).toBeGreaterThan(0n);
  });

  /**
   * COST_BASIS is the one thing `chain` mode cannot answer. The holding, its
   * current price and its value all stay known; only what was paid, and
   * therefore the profit and loss, become unknown — null, never zero.
   */
  it("leaves entry and PnL unknown without COST_BASIS, but keeps the value", async () => {
    const {markets, lists} = await book(new MockSource({omit: ["COST_BASIS"]}));
    const agent = agentsSeen(lists)[0]!;
    for (const row of agentBook(markets, lists, agent)) {
      expect(row.entryPriceWad).toBeNull();
      expect(row.pnlTokens).toBeNull();
      expect(row.currentValueTokens).toBeGreaterThan(0n);
    }
  });
});

describe("holdingStatus", () => {
  it("names what needs doing without offering to do it", () => {
    const all: MarketStatus[] = [
      "Open", "Closed", "Proposed", "Disputed", "Settled", "Failed", "Voided",
    ];
    for (const status of all) {
      const label = holdingStatus(status);
      expect(label.length).toBeGreaterThan(0);
      // It reports what the AGENT can do, never what this page can.
      expect(label).not.toMatch(/^(redeem|liquidate|claim)$/i);
    }
    expect(holdingStatus("Settled")).toMatch(/agent can redeem/i);
    expect(holdingStatus("Voided")).toMatch(/agent can liquidate/i);
  });
});

describe("aggregate totals", () => {
  /**
   * A total is summed from the EXACT amounts and rounded once, never from the
   * rounded row figures. The fixture book makes the difference visible: the rows
   * display -1.67, -1.09 and -0.71, which a reader adds to -3.47, while the
   * exact sum is -3.462942 and therefore displays as -3.46. Rounding first would
   * make the total wrong; the UI says instead that rows are rounded and totals
   * are not.
   */
  it("sums exact amounts rather than the rounded row figures", async () => {
    const {markets, lists} = await book();
    // Scoped to the FIRST THREE fixtures on purpose. This test is not counting rows,
    // it is demonstrating one specific piece of arithmetic — three figures whose
    // printed forms add to a different number than their exact ones do. Widening it
    // to every fixture would change the numbers and lose the demonstration.
    const three = markets.slice(0, 3);
    const rows = agentBook(three, lists, "0xbb0c000000000000000000000000000000000000");
    expect(rows).toHaveLength(3);

    const exact = rows.reduce((sum, r) => sum + (r.pnlTokens ?? 0n), 0n);
    expect(exact).toBe(-3_462_942n);

    // The total the UI shows: the exact sum, rounded once.
    expect(formatCollateral(exact, 6)).toBe("-3.46");

    // What a reader gets by adding the printed column. Number() on DISPLAY
    // STRINGS is deliberate and is not a violation of the no-floats-on-money
    // rule: the point is to reproduce what a human does with the rendered
    // figures, which is exactly a lossy float addition.
    const printed = rows.map((r) => formatCollateral(r.pnlTokens!, 6));
    expect(printed).toEqual(["-1.67", "-1.09", "-0.71"]);
    const handSum = printed.reduce((a, text) => a + Number(text), 0);
    expect(handSum.toFixed(2)).toBe("-3.47");
  });
});
