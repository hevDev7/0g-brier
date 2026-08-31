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
      // Value stays KNOWN — that is what this test is about. But the losing side of
      // a settled market is worth exactly nothing, and that zero is a fact, not a
      // gap: `pnlTokens` is the field that goes null when the cost basis is missing.
      if (row.redeemable && row.market.winningOutcome !== row.outcome) {
        expect(row.currentValueTokens).toBe(0n);
      } else {
        expect(row.currentValueTokens).toBeGreaterThan(0n);
      }
    }
  });
});

describe("holdingStatus", () => {
  it("names what needs doing without offering to do it", () => {
    const all: MarketStatus[] = [
      "Open", "Closed", "Proposed", "Disputed", "Settled", "Failed", "Voided",
    ];
    // A clock far before `tradingEnd`, so this loop still exercises the status
    // branches; the deadline branch has its own test below.
    const live = (status: MarketStatus) => ({status, tradingEnd: 2_000_000_000});
    for (const status of all) {
      const label = holdingStatus(live(status), 1_000_000_000);
      expect(label.length).toBeGreaterThan(0);
      // It reports what the AGENT can do, never what this page can.
      expect(label).not.toMatch(/^(redeem|liquidate|claim)$/i);
    }
    expect(holdingStatus(live("Settled"), 1_000_000_000)).toMatch(/agent can redeem/i);
    expect(holdingStatus(live("Voided"), 1_000_000_000)).toMatch(/agent can liquidate/i);
  });

  /**
   * The window this column used to misreport. `status` still reads `Open` — nobody
   * has called `close()` — while the chain already refuses buy, sell, addLiquidity
   * and removeLiquidity alike with `TradingEnded`. A holding labelled "Open" here
   * promised the agent could still sell, when nothing on earth could.
   */
  it("does not call a holding Open once its market's trading deadline has passed", () => {
    const m = {status: "Open" as MarketStatus, tradingEnd: 1_000_000_000};
    expect(holdingStatus(m, 1_000_000_500)).not.toBe("Open");
    expect(holdingStatus(m, 1_000_000_500)).toMatch(/nothing can be traded/i);
    // One second earlier it is genuinely open, and still says so.
    expect(holdingStatus(m, 999_999_999)).toBe("Open");
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
  /**
   * The defect this pins. A settled market pays the winning side `1/p` per share —
   * the RECIPROCAL of the price — and the losing side nothing. This book valued
   * every position at the marginal price regardless, so a real holding on Galileo
   * read +0.695439 mUSDC when it could be redeemed for +45.604931: sixty-five times
   * too small, in the direction that tells an agent its correct call barely paid.
   */
  it("values a settled position at what it redeems for, not at the marginal price", async () => {
    const {markets, lists} = await book();
    const settled = markets.find((m) => m.winningOutcome !== null);
    expect(settled, "a fixture must be settled for this to mean anything").toBeDefined();
    const idx = markets.findIndex((m) => m.address === settled!.address);
    const all = agentBook([settled!], [lists[idx]!], lists[idx]![0]!.agent);
    for (const row of all) {
      const marginal = (row.shares * row.currentPriceWad) / 10n ** 18n;
      if (row.outcome === settled!.winningOutcome) {
        // The winner is worth MORE than the marginal price suggests, never less.
        expect(row.worthPerShareWad).toBeGreaterThan(row.currentPriceWad);
        expect((row.shares * row.worthPerShareWad) / 10n ** 18n).toBeGreaterThan(marginal);
      } else {
        // And the loser is worth nothing at all, not a positive number.
        expect(row.worthPerShareWad).toBe(0n);
        expect(row.currentValueTokens).toBe(0n);
      }
      expect(row.redeemable).toBe(true);
    }
  });

  it("sums exact amounts rather than the rounded row figures", async () => {
    const {markets, lists} = await book();
    // FOUR UNRESOLVED fixtures, and both halves of that are deliberate.
    //
    // Unresolved, because a settled market values its positions at the `1/p`
    // redemption rate rather than the marginal price, and the losing side at zero.
    // Those are the right numbers and they are two orders of magnitude larger,
    // which drowns the sub-cent remainders this test exists to show — with a
    // settled row in the set the two totals agree and the test proves nothing.
    //
    // Four rather than three, because three of these happen to round cleanly. The
    // count is chosen to make the discrepancy appear, not to count rows.
    const some = markets.filter((m) => m.winningOutcome === null).slice(0, 4);
    const rows = agentBook(some, lists, "0xbb0c000000000000000000000000000000000000");
    expect(rows).toHaveLength(4);

    const exact = rows.reduce((sum, r) => sum + (r.pnlTokens ?? 0n), 0n);
    expect(exact).toBe(-53_233_386n);

    // The total the UI shows: the exact sum, rounded once.
    expect(formatCollateral(exact, 6)).toBe("-53.23");

    // What a reader gets by adding the printed column. Number() on DISPLAY
    // STRINGS is deliberate and is not a violation of the no-floats-on-money
    // rule: the point is to reproduce what a human does with the rendered
    // figures, which is exactly a lossy float addition.
    const printed = rows.map((r) => formatCollateral(r.pnlTokens!, 6));
    expect(printed).toEqual(["-1.67", "-1.09", "-85.84", "35.36"]);
    const handSum = printed.reduce((a, text) => a + Number(text), 0);
    expect(handSum.toFixed(2)).toBe("-53.24");
  });
});
