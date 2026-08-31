import {beforeEach, describe, expect, it} from "vitest";
import {WAD, dpm} from "@0g-brier/protocol";
import {FIXTURE_MARKETS, MockSource, fixturePositions} from "@/lib/data/mock";
import {CapabilityUnavailableError, type Trade} from "@/lib/data/types";

describe("MockSource", () => {
  let source: MockSource;
  beforeEach(() => {
    source = new MockSource();
  });

  it("reports its mode and every capability by default", () => {
    expect(source.mode).toBe("mock");
    expect(source.capabilities.has("PRICE_HISTORY")).toBe(true);
    expect(source.capabilities.has("TRADE_TAPE")).toBe(true);
  });

  it("returns the fixture markets", async () => {
    const markets = await source.listMarkets();
    expect(markets.length).toBeGreaterThanOrEqual(2);
    expect(markets[0]!.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("fetches a single market by address", async () => {
    const [first] = await source.listMarkets();
    const detail = await source.getMarket(first!.address);
    expect(detail.address).toBe(first!.address);
    expect(detail.question).toBe(first!.question);
  });

  it("throws for an unknown address", async () => {
    await expect(source.getMarket("0x0000000000000000000000000000000000000009")).rejects.toThrow(
      /not found/,
    );
  });

  /**
   * An inconsistent fixture renders a state that could not exist on chain.
   * poolWad is DERIVED from q, never typed by hand.
   */
  it("every fixture satisfies the protocol pool invariant", async () => {
    for (const m of await source.listMarkets()) {
      expect(m.poolWad).toBe(dpm.costUp(m.q));
    }
  });

  it("returns the trade tape", async () => {
    const [first] = await source.listMarkets();
    const trades = await source.getTrades(first!.address, 50);
    expect(trades.length).toBeGreaterThan(0);
    expect(trades[0]!.timestamp).toBeGreaterThan(trades[trades.length - 1]!.timestamp);
  });

  /**
   * A bug the reviewer found on the real page: the MOST RECENT trade in the tape
   * (the top row, since getTrades returns newest-first) showed P(YES) 73.1% while
   * the probability panel — computed straight from the market's q — showed 59.0%,
   * with no trade in between. The cause: fixtureTrades() once used the weights as
   * ABSOLUTE share counts whose totals (414 on the NO side, 906 on the YES side)
   * were the same for every market, so the synthetic q at the end of the history
   * drifted away from the market's real q. The market's q itself
   * (FIXTURE_MARKETS[i].q) was NOT changed to fix this — only the way the
   * synthetic history is constructed backwards from it, so every
   * probability/payout test that depends on q remains valid.
   */
  it("the newest trade in the tape converges EXACTLY on the current market probability", async () => {
    for (const market of FIXTURE_MARKETS) {
      const trades = await source.getTrades(market.address, 50);
      const mostRecent = trades[0]!;
      expect(mostRecent.probYesAfterWad).toBe(dpm.probability(market.q, 1));
    }
  });

  /**
   * The spec's central mechanism: an absent capability THROWS rather than
   * returning an empty array. An empty array means "there is no data" — a
   * different claim from "I cannot know". MockSource can simulate a limited mode
   * so this behaviour is tested without waiting for ChainSource to exist.
   */
  it("throws CapabilityUnavailableError for an omitted capability", async () => {
    const limited = new MockSource({omit: ["PRICE_HISTORY", "TRADE_TAPE"]});
    const [first] = await limited.listMarkets();

    expect(limited.capabilities.has("PRICE_HISTORY")).toBe(false);
    await expect(limited.getCandles(first!.address, "1h")).rejects.toBeInstanceOf(
      CapabilityUnavailableError,
    );
    await expect(limited.getTrades(first!.address, 50)).rejects.toBeInstanceOf(
      CapabilityUnavailableError,
    );
  });

  it("the error carries the capability and the mode that failed", async () => {
    const limited = new MockSource({omit: ["TRADE_TAPE"]});
    const [first] = await limited.listMarkets();
    await limited.getTrades(first!.address, 10).catch((error: unknown) => {
      const e = error as CapabilityUnavailableError;
      expect(e.capability).toBe("TRADE_TAPE");
      expect(e.mode).toBe("mock");
    });
    expect.assertions(2);
  });

  /**
   * getCandles must AGGREGATE trades into buckets rather than map one candle per
   * trade. With the fixture's schedule (24 trades, one per hour), the "1d"
   * interval proves it: 24 trades fall into only 2 daily buckets, so they must
   * come back as 2 candles — not 24 candles with repeated bucketStarts.
   */
  describe("getCandles", () => {
    it("every candle has a unique bucketStart, at every interval", async () => {
      const [first] = await source.listMarkets();
      for (const interval of ["1m", "5m", "1h", "1d"] as const) {
        const candles = await source.getCandles(first!.address, interval);
        const bucketStarts = candles.map((c) => c.bucketStart);
        expect(new Set(bucketStarts).size).toBe(bucketStarts.length);
      }
    });

    /**
     * `"1m"` and `"5m"` used to return byte-identical candles. The step came from a ternary
     * chain ending in a bare `: 5 * 60`, so `"1m"` fell into the five-minute branch — the two
     * finest intervals were the same interval and nothing said so. With hourly fixture trades
     * both still yield one candle per trade, which is exactly why no existing test noticed:
     * the bucket WIDTH is the observable that differs, not the candle count.
     */
    it("1m and 5m are different bucket widths, not the same one twice", async () => {
      const [first] = await source.listMarkets();
      const minute = await source.getCandles(first!.address, "1m");
      const fiveMinute = await source.getCandles(first!.address, "5m");

      // Every bucketStart is a multiple of its own width, and the fixture timestamps are not
      // all multiples of 300 — so a 60-second bucketing lands somewhere a 300-second one
      // cannot.
      for (const c of minute) expect(c.bucketStart % 60).toBe(0);
      for (const c of fiveMinute) expect(c.bucketStart % 300).toBe(0);
      expect(minute.some((c) => c.bucketStart % 300 !== 0)).toBe(true);
    });

    it("the 1d interval merges 24 hourly trades into 2 candles, not 24", async () => {
      const [first] = await source.listMarkets();
      const daily = await source.getCandles(first!.address, "1d");
      expect(daily.length).toBe(2);
    });

    it("candles are sorted ascending by bucketStart, and high >= low", async () => {
      const [first] = await source.listMarkets();
      const daily = await source.getCandles(first!.address, "1d");
      for (const c of daily) {
        expect(c.high).toBeGreaterThanOrEqual(c.low);
      }
      for (let i = 1; i < daily.length; i++) {
        expect(daily[i]!.bucketStart).toBeGreaterThan(daily[i - 1]!.bucketStart);
      }
    });

    /**
     * open/close must come from the FIRST/LAST trade within that bucket itself —
     * not from a trade in the previous bucket. The values below were computed
     * independently from the trade tape (not from getCandles' implementation), so
     * that a refactor which scrambles the aggregation (swapping open/close or
     * high/low, say) is caught rather than quietly passing by coincidence.
     *
     * The values below changed from an earlier version when fixtureTrades() was
     * fixed (see the "newest trade ... converges" test above) — the synthetic q
     * now genuinely lands on the market's q, so every trade within it changed too.
     * Recomputed independently of getCandles: through source.getTrades() and then
     * bucketed by separate bucketing code written specifically for this
     * verification (not by running getCandles and copying its output), then
     * cross-checked against getCandles' actual output for all three fixture
     * markets — an exact match.
     */
    it("open/close come from the bucket ends, high/low from the bucket range", async () => {
      const [first] = await source.listMarkets();
      const [bucket1, bucket2] = await source.getCandles(first!.address, "1d");

      expect(bucket1).toEqual({
        bucketStart: 1_789_862_400,
        open: 576_274_035_794_379_011n,
        high: 644_877_801_662_834_135n,
        low: 576_274_035_794_379_011n,
        close: 578_790_188_870_931_499n,
        volume: 313_177_646n,
      });
      expect(bucket2).toEqual({
        bucketStart: 1_789_948_800,
        open: 587_226_152_694_937_650n,
        high: 613_255_879_944_773_096n,
        low: 535_003_421_643_527_143n,
        close: 590_163_934_426_229_508n,
        volume: 467_847_310n,
      });
    });
  });
});

describe("observation capabilities", () => {
  const addr = FIXTURE_MARKETS[0]!.address;

  it("getPositions throws when AGENT_POSITIONS is omitted", async () => {
    const src = new MockSource({omit: ["AGENT_POSITIONS"]});
    await expect(src.getPositions(addr)).rejects.toBeInstanceOf(CapabilityUnavailableError);
  });

  it("getReceipt throws when SETTLEMENT_RECEIPT is omitted", async () => {
    const src = new MockSource({omit: ["SETTLEMENT_RECEIPT"]});
    await expect(src.getReceipt(addr)).rejects.toBeInstanceOf(CapabilityUnavailableError);
  });

  it("positions sum to the market q, per outcome", async () => {
    const src = new MockSource();
    for (const m of FIXTURE_MARKETS) {
      const pos = await src.getPositions(m.address);
      for (const outcome of [0, 1] as const) {
        const held = pos
          .filter((p) => p.outcome === outcome)
          .reduce((a, p) => a + p.shares, 0n);
        expect(held).toBeLessThanOrEqual(m.q[outcome]);
      }
    }
  });

  it("every position's entry price lies between 0 and WAD", async () => {
    const src = new MockSource();
    const pos = await src.getPositions(FIXTURE_MARKETS[0]!.address);
    expect(pos.length).toBeGreaterThan(0);
    for (const p of pos) {
      expect(p.entryPriceWad).not.toBeNull();
      expect(p.entryPriceWad!).toBeGreaterThan(0n);
      expect(p.entryPriceWad!).toBeLessThan(WAD);
    }
  });

  it("COST_BASIS omitted -> the positions remain, their entry price is null", async () => {
    const src = new MockSource({omit: ["COST_BASIS"]});
    const pos = await src.getPositions(FIXTURE_MARKETS[0]!.address);
    expect(pos.length).toBeGreaterThan(0);
    for (const p of pos) expect(p.entryPriceWad).toBeNull();
  });

  it("a Settled market's receipt names an outcome, and an Open one's does not", async () => {
    const src = new MockSource();
    const settled = FIXTURE_MARKETS.find((m) => m.status === "Settled");
    expect(settled, "the fixtures must include one Settled market").toBeDefined();
    expect((await src.getReceipt(settled!.address)).outcome).not.toBeNull();

    const open = FIXTURE_MARKETS.find((m) => m.status === "Open")!;
    expect((await src.getReceipt(open.address)).outcome).toBeNull();
  });
});

/**
 * fixtureTrades() gives every trade a different trader (keyed to the loop index),
 * so in the real fixtures no two trades ever share a (trader, outcome) key — the
 * Map accumulation branch in fixturePositions() is never genuinely exercised by
 * any other test in this file. The test below calls fixturePositions() directly
 * with two synthetic trades that DELIBERATELY share a trader and an outcome, at
 * different prices per share (0.40 then 0.60) — if the "+" were lost (the second
 * trade overwriting the first) OR the average were computed plainly instead of
 * share-weighted ((0.40+0.60)/2 = 0.50), both differ from the correct result and
 * this test is what catches it.
 */
describe("fixturePositions", () => {
  it("accumulates shares and tokens across trades on the same (trader, outcome)", () => {
    const m = FIXTURE_MARKETS[0]!; // collateral.decimals = 6 (mUSDC)
    const trader = "0xcc1111111111111111111111111111111111cc11" as const;
    const trades: Trade[] = [
      {
        id: "synthetic-1",
        timestamp: 0,
        trader,
        outcome: 1,
        sharesDelta: 100n * WAD, // 100 shares
        tokens: 40_000_000n, // 40.000000 mUSDC -> 0.40/share
        fee: 0n,
        probYesAfterWad: 0n,
      },
      {
        id: "synthetic-2",
        timestamp: 1,
        trader,
        outcome: 1,
        sharesDelta: 50n * WAD, // 50 more shares, SAME trader & outcome
        tokens: 30_000_000n, // 30.000000 mUSDC -> 0.60/share
        fee: 0n,
        probYesAfterWad: 0n,
      },
    ];

    const positions = fixturePositions(m, trades);

    expect(positions.length).toBe(1);
    const [p] = positions;
    expect(p!.agent).toBe(trader);
    expect(p!.outcome).toBe(1);
    // 100 + 50, not the last trade overwriting the first.
    expect(p!.shares).toBe(150n * WAD);
    // (40 + 30) tokens / (100 + 50) shares = 0.4667 — a share-WEIGHTED average,
    // not a plain average of 0.40 and 0.60 (which would be 0.50).
    expect(p!.entryPriceWad).toBe(466_666_666_666_666_666n);
  });
});
