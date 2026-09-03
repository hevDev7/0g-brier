/**
 * `null` means NO OPINION, and it is a correct answer rather than a missing one.
 *
 * The seam is `(market, ctx) => Promise<Belief | null>`, and the whole design
 * rests on the loop honouring the null half: a forecaster that returns a number
 * for every market it is shown is not forecasting, it is filling in a form.
 * Most markets, most of the time, should get `null`.
 *
 * The shipped strategy returns nothing else, deliberately: a placeholder that
 * traded would look like a working agent while taking real positions on a
 * signal nobody designed, and the first thing anyone learned from this project
 * would be a bug. These tests hold it to that.
 */
import {describe, expect, it} from "vitest";
import {WAD} from "@0g-brier/protocol";
import type {MarketView} from "@0g-brier/agent-kit";
import {beliefFromProbability, strategy, type MarketSpec, type StrategyContext} from "../src/strategy.js";
import {EVEN_BOOK, marketAt} from "./fixtures.js";
import {fileNamed, loadSrc} from "./source.js";

const NOW = 1_800_000_000;

const spec: MarketSpec = {
  version: 1,
  question: "Will the 0G mainnet produce a block with more than 1,000 transactions before 2027?",
  rules: "Resolves YES if any single block on chain 16661 contains more than 1,000 transactions.",
  sources: [{kind: "http", url: "https://chainscan.0g.ai", selector: null}],
  settlementPrompt: null,
};

/** A market and a context with nothing at all wrong with them. */
const healthy: MarketView = marketAt(EVEN_BOOK, {tradingEnd: NOW + 86_400});
const ready: StrategyContext = {
  spec,
  position: [0n, 0n],
  spendableTokens: 100n * WAD,
  spendableSource: "wallet",
  now: NOW,
  dryRun: false,
};

describe("the shipped strategy never trades", () => {
  it("declines a market with a readable question, sources, time left and money to spend", () => {
    // The one that matters. Every other case below could be explained away as a
    // precondition; this one is the placeholder refusing to invent a forecast.
    return expect(strategy(healthy, ready)).resolves.toBeNull();
  });

  it("declines every market in a scan of a whole book", async () => {
    const book: readonly [bigint, bigint][] = [
      [1000n * WAD, 1000n * WAD],
      [10_000n * WAD, 11_997n * WAD],
      [30_000n * WAD, 10_000n * WAD],
    ];
    for (const q of book) {
      await expect(strategy(marketAt(q, {tradingEnd: NOW + 86_400}), ready)).resolves.toBeNull();
    }
  });
});

describe("abstaining is an answer, not an error", () => {
  const adverse: {why: string; market: MarketView; ctx: StrategyContext}[] = [
    {
      why: "the market's document could not be read or did not verify",
      market: healthy,
      ctx: {...ready, spec: null},
    },
    {
      why: "the market declares no sources for the committee to look at",
      market: healthy,
      ctx: {...ready, spec: {...spec, sources: []}},
    },
    {
      // Open is not the same as tradable: `close()` only becomes callable once
      // `tradingEnd` has passed and somebody still has to send it, so a market
      // sits in Open past its own window while every buy against it reverts.
      why: "the trading window has already closed while the status still says Open",
      market: marketAt(EVEN_BOOK, {status: "Open", tradingEnd: NOW - 1}),
      ctx: ready,
    },
    {
      why: "there is nothing to trade with",
      market: healthy,
      ctx: {...ready, spendableTokens: 0n},
    },
    {
      why: "a dry run with no wallet, so the position is unknown",
      market: healthy,
      ctx: {...ready, position: null, spendableSource: "config", dryRun: true},
    },
  ];

  for (const {why, market, ctx} of adverse) {
    it(`resolves to null rather than throwing when ${why}`, async () => {
      // `resolves` rather than a try/catch on purpose: a rejected promise here
      // would stop a scan over twenty markets on the first bad one, and none of
      // these is a fault — they are reasons to have no opinion.
      await expect(strategy(market, ctx)).resolves.toBeNull();
    });
  }
});

describe("a belief that did not parse is not a belief", () => {
  it("converts a probability to wad, rounded to 1e-6", () => {
    expect(beliefFromProbability(0.7, "the sources agree").impliedProbabilityWad).toBe(700_000_000_000_000_000n);
    expect(beliefFromProbability(0, "impossible").impliedProbabilityWad).toBe(0n);
    expect(beliefFromProbability(1, "certain").impliedProbabilityWad).toBe(WAD);
  });

  it("throws rather than substituting one", () => {
    // 0.5 is NOT neutral on a DPM book: it is a position against whatever the
    // market currently says, and it would be sized and signed like any other.
    expect(() => beliefFromProbability(Number.NaN, "why")).toThrow(/not a number/);
    expect(() => beliefFromProbability(1.5, "why")).toThrow(/not a probability/);
    expect(() => beliefFromProbability(-0.1, "why")).toThrow(/not a probability/);
    expect(() => beliefFromProbability(Number.POSITIVE_INFINITY, "why")).toThrow(/not a number/);
  });

  it("refuses a position nobody can review later", () => {
    expect(() => beliefFromProbability(0.7, "   ")).toThrow(/rationale/);
  });
});

describe("the loop's answer to null is a report line and no trade", () => {
  const agent = fileNamed(loadSrc(), "agent.ts");
  const atNullCheck = agent.code.indexOf("belief === null");

  it("scans the source it means to scan", () => {
    expect(atNullCheck, "agent.ts no longer checks the strategy's answer for null").toBeGreaterThan(-1);
    expect(agent.code).toContain("await strategy(market, ctx)");
  });

  it("prints why it did nothing and returns an outcome the summary counts", () => {
    const branch = agent.code.slice(atNullCheck, atNullCheck + 220);
    expect(branch).toContain("console.log(");
    expect(branch).toContain('return "abstained"');
    expect(agent.code, "the summary stopped reporting the markets it had no opinion on").toContain("no opinion");
  });

  it("reaches no write of any kind before the null check has returned", () => {
    // A strategy that abstains must cost nothing but the read that led to it.
    for (const write of ["client.ensureAllowance(", "client.buyShares(", "client.sellShares("]) {
      const at = agent.code.indexOf(write);
      if (at === -1) continue;
      expect(at, `agent.ts calls ${write} before it has looked at the belief`).toBeGreaterThan(atNullCheck);
    }
  });
});
