import {WAD, dpm, scaleFor, toWad} from "@0g-delphi/protocol";
import {
  CapabilityUnavailableError,
  type Candle,
  type Capability,
  type CollateralInfo,
  type DataMode,
  type DataSource,
  type Interval,
  type MarketDetail,
  type MarketSummary,
  type Outcome,
  type Position,
  type SettlementReceipt,
  type Trade,
} from "./types";

const ALL_CAPABILITIES: Capability[] = [
  "LIST_MARKETS", "MARKET_STATE", "PRICE_HISTORY", "TRADE_TAPE",
  "AGENT_POSITIONS", "COST_BASIS", "SETTLEMENT_RECEIPT",
];

const MUSDC: CollateralInfo = {
  address: "0x9AA0C7DDC6D72BEEb77E4e497b6fbfa4D81A0153",
  symbol: "mUSDC",
  decimals: 6,
};

const HOUR = 3_600;

/**
 * Bucket width per interval. A `Record<Interval, number>` rather than a ternary
 * chain on purpose: the chain ended in a bare `: 5 * 60`, which quietly made
 * `"1m"` a five-minute bucket — the two finest intervals returned identical
 * candles and nothing said so. A Record makes TypeScript demand an entry when a
 * new interval is added, instead of letting it fall into whatever the last
 * branch happened to be.
 */
const BUCKET_SECONDS: Record<Interval, number> = {
  "1m": 60,
  "5m": 5 * 60,
  "1h": HOUR,
  "1d": 24 * HOUR,
};
const NOW = 1_790_000_000;

/** poolWad is derived, never typed — a fixture must not break a chain invariant. */
function market(
  partial: Omit<MarketDetail, "poolWad" | "collateral">,
): MarketDetail {
  return {...partial, poolWad: dpm.costUp(partial.q), collateral: MUSDC};
}

export const FIXTURE_MARKETS: MarketDetail[] = [
  market({
    address: "0x1111111111111111111111111111111111111111",
    question: "Will the ETH/USD closing price on 30 September 2026 be above $4,000?",
    rules:
      "Resolves YES if the daily ETH/USD closing price at 2026-09-30 23:59 UTC, per the listed " +
      "sources, is above $4,000.00. Resolves NO if it is at or below that. If no source " +
      "publishes a closing price on that day, the market is deemed UNRESOLVABLE and is wound " +
      "down.",
    category: "crypto",
    tier: "VERIFIED",
    status: "Open",
    q: [1000n * WAD, 1200n * WAD],
    createdAt: NOW - 72 * HOUR,
    tradingEnd: NOW + 52 * HOUR,
    settlementDeadline: NOW + 76 * HOUR,
    feeBps: 100,
    creator: "0xAaAaAaAa00000000000000000000000000000001",
    specRoot: "0xa1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
  }),
  market({
    address: "0x2222222222222222222222222222222222222222",
    question: "Will 0G Chain announce mainnet v2 before 1 December 2026?",
    rules:
      "Resolves YES if an official announcement is published on an official 0G Labs channel " +
      "before 2026-12-01 00:00 UTC. Third-party announcements do not count.",
    category: "crypto",
    tier: "FAST",
    status: "Open",
    q: [707_106_781_186_547_524_400n, 707_106_781_186_547_524_400n],
    createdAt: NOW - 240 * HOUR,
    tradingEnd: NOW + 9 * 24 * HOUR,
    settlementDeadline: NOW + 10 * 24 * HOUR,
    feeBps: 100,
    creator: "0xAaAaAaAa00000000000000000000000000000002",
    specRoot: "0xb2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1",
  }),
  market({
    address: "0x3333333333333333333333333333333333333333",
    question: "Will euro-area annual inflation fall below 2.0% in the October 2026 release?",
    rules: "Resolves according to the Eurostat HICP release for October 2026, the flash figure.",
    category: "economics",
    tier: "DETERMINISTIC",
    status: "Settled",
    q: [1800n * WAD, 600n * WAD],
    createdAt: NOW - 96 * HOUR,
    tradingEnd: NOW - 2 * HOUR,
    settlementDeadline: NOW + 22 * HOUR,
    feeBps: 100,
    creator: "0xAaAaAaAa00000000000000000000000000000003",
    specRoot: "0xc3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2",
  }),
];

/** An i-dependent pseudo-random side pattern: 1 trade in 3 on the NO side, the rest YES. */
function syntheticOutcome(i: number): Outcome {
  return (i % 3 === 0 ? 0 : 1) as Outcome;
}

/** An i-dependent pseudo-random weight — a RELATIVE proportion, not an absolute share count (see fixtureTrades). */
function syntheticWeight(i: number): bigint {
  return BigInt(12 + ((i * 37) % 90));
}

function fixtureTrades(m: MarketDetail): Trade[] {
  const trades: Trade[] = [];
  const startQ: readonly [bigint, bigint] = [m.q[0] / 2n, m.q[1] / 2n];

  // The weights above were once treated as ABSOLUTE share counts. The bug: their
  // totals (414 for the NO side, 906 for the YES side) were identical for every
  // market, so the synthetic q at the end of 24 trades drifted away from this
  // market's m.q — and the MOST RECENT trade (the one at the top of the tape)
  // showed a probability that did not match the probability panel, which is
  // computed directly from m.q.
  //
  // Below, the same weights are used as RELATIVE proportions per side, scaled
  // through an exact-bigint distribution (not .toFixed / floating point) so that
  // the LAST trade on each side closes q onto m.q exactly — the trade tape becomes
  // coherent with the current market state without changing m.q itself (every
  // probability/payout test in this suite depends on it).
  const remainingWeight: [bigint, bigint] = [0n, 0n];
  for (let i = 0; i < 24; i++) {
    remainingWeight[syntheticOutcome(i)] += syntheticWeight(i);
  }
  const remainingAmount: [bigint, bigint] = [m.q[0] - startQ[0], m.q[1] - startQ[1]];

  let q: readonly [bigint, bigint] = startQ;
  for (let i = 0; i < 24; i++) {
    const outcome = syntheticOutcome(i);
    const w = syntheticWeight(i);
    // An exact-bigint proportional distribution: when the LAST trade on this side
    // is processed, remainingWeight[outcome] === w, so shares ===
    // remainingAmount[outcome] exactly — the rounding remainder between trades
    // accumulates nowhere, it is swept up by that closing trade itself.
    const shares = (remainingAmount[outcome] * w) / remainingWeight[outcome];
    remainingAmount[outcome] -= shares;
    remainingWeight[outcome] -= w;

    const before = dpm.costUp(q);
    q = outcome === 0 ? [q[0] + shares, q[1]] : [q[0], q[1] + shares];
    const tokens = (dpm.costUp(q) - before) / scaleFor(m.collateral.decimals);
    trades.push({
      id: `${m.address}-${i}`,
      timestamp: NOW - (24 - i) * HOUR,
      // 36 zeros, not 34: "0x" + "bb" + 2 index digits + 36 = 40 hex characters,
      // the real width of an address. The old value was two characters short —
      // a shape the `0x${string}` type cannot catch, and one that any genuine
      // address validation (the portfolio address field, for one) rejects.
      trader: `0xbb${i.toString(16).padStart(2, "0")}${"0".repeat(36)}` as `0x${string}`,
      outcome,
      sharesDelta: shares,
      tokens,
      fee: (tokens * BigInt(m.feeBps)) / 10_000n,
      probAfterWad: dpm.probability(q, 1),
    });
  }
  return trades.reverse(); // newest first
}

/**
 * Positions are derived from the fixture trades, not written separately. Writing
 * them separately is the easiest way to make two panels on the same page
 * contradict each other — and that already happened in F0, when the tape ended at
 * 73.1% while the market was priced at 59.0%.
 */
export function fixturePositions(m: MarketSummary, trades: Trade[]): Position[] {
  const acc = new Map<string, {shares: bigint; tokens: bigint}>();
  for (const t of trades) {
    if (t.sharesDelta <= 0n) continue; // only purchases form an entry price
    const key = `${t.trader}:${t.outcome}`;
    const cur = acc.get(key) ?? {shares: 0n, tokens: 0n};
    acc.set(key, {shares: cur.shares + t.sharesDelta, tokens: cur.tokens + t.tokens});
  }
  const out: Position[] = [];
  for (const [key, v] of acc) {
    const [agent, outcomeStr] = key.split(":");
    if (v.shares === 0n) continue;
    out.push({
      agent: agent as `0x${string}`,
      outcome: Number(outcomeStr) as Outcome,
      shares: v.shares,
      // tokens is already in token units; scale it up to wad before dividing so the
      // result is a price per share in wad, not a fraction truncated to zero.
      entryPriceWad: (toWad(v.tokens, m.collateral.decimals) * WAD) / v.shares,
    });
  }
  return out.sort((a, b) => (a.shares === b.shares ? 0 : b.shares > a.shares ? 1 : -1));
}

const FIXTURE_RECEIPT: SettlementReceipt = {
  outcome: 1,
  votes: [
    {model: "claude-opus-5", outcome: 1, teeVerified: true, simulated: true},
    {model: "gpt-5.5", outcome: 1, teeVerified: true, simulated: true},
    {model: "qwen3-32b", outcome: 0, teeVerified: false, simulated: true},
  ],
  judgeModel: "claude-opus-5",
  // Resolved for the third market (euro-area inflation) — see FIXTURE_MARKETS.
  // criteria/reasoning/sources MUST refer to that question and not another market's:
  // the only market whose receipt can be queried is the one whose status is Settled,
  // so off-topic content here would never be covered by some other market that
  // "happens" to match.
  reasoning:
    "Two of three resolvers concluded YES. The Eurostat flash HICP release for " +
    "October 2026 put euro-area annual inflation at 1.9%, below the 2.0% threshold " +
    "the criteria set. The third resolver cited a preliminary estimate from one " +
    "member state, published earlier and showing 2.1%, and answered NO on that " +
    "basis; that source is not the Eurostat flash release the criteria require.",
  criteria:
    "YES if euro-area annual flash HICP inflation for October 2026, per the " +
    "Eurostat release, is below 2.0%. Only the official Eurostat flash release " +
    "counts; a member state's preliminary estimate or a subsequent revision does " +
    "not change the decision.",
  sources: ["https://ec.europa.eu/eurostat/web/hicp/data/database"],
  provider: "0x0000000000000000000000000000000000000000",
  chatId: "stub-0001",
  simulated: true,
};

/** Nothing to report yet — resolution has not started, it is not being hidden. */
const PENDING_RECEIPT: SettlementReceipt = {
  outcome: null,
  votes: [],
  judgeModel: null,
  reasoning: "",
  criteria: "",
  sources: [],
  provider: "0x0000000000000000000000000000000000000000",
  chatId: "",
  simulated: true,
};

export class MockSource implements DataSource {
  readonly mode: DataMode = "mock";
  readonly capabilities: ReadonlySet<Capability>;

  constructor(options: {omit?: Capability[]} = {}) {
    const omitted = new Set(options.omit ?? []);
    this.capabilities = new Set(ALL_CAPABILITIES.filter((c) => !omitted.has(c)));
  }

  private require(capability: Capability): void {
    if (!this.capabilities.has(capability)) {
      throw new CapabilityUnavailableError(capability, this.mode);
    }
  }

  private find(address: string): MarketDetail {
    const found = FIXTURE_MARKETS.find(
      (m) => m.address.toLowerCase() === address.toLowerCase(),
    );
    if (!found) throw new Error(`Market ${address} not found`);
    return found;
  }

  async listMarkets(): Promise<MarketSummary[]> {
    this.require("LIST_MARKETS");
    return FIXTURE_MARKETS;
  }

  async getMarket(address: `0x${string}`): Promise<MarketDetail> {
    this.require("MARKET_STATE");
    return this.find(address);
  }

  async getTrades(address: `0x${string}`, limit: number): Promise<Trade[]> {
    this.require("TRADE_TAPE");
    return fixtureTrades(this.find(address)).slice(0, limit);
  }

  async getCandles(address: `0x${string}`, interval: Interval): Promise<Candle[]> {
    this.require("PRICE_HISTORY");
    // fixtureTrades() is newest-first; reverse into ascending time order so the
    // first trade processed per bucket really is the earliest one.
    const trades = [...fixtureTrades(this.find(address))].reverse();
    const step = BUCKET_SECONDS[interval];

    // Group trades into buckets by bucketStart — ONE candle per bucket, not one
    // candle per trade. open/close come from the first/last trade within that
    // bucket; high/low from the bucket's range.
    const buckets = new Map<number, Candle>();
    for (const t of trades) {
      const bucketStart = t.timestamp - (t.timestamp % step);
      const candle = buckets.get(bucketStart);
      if (candle === undefined) {
        buckets.set(bucketStart, {
          bucketStart,
          open: t.probAfterWad,
          high: t.probAfterWad,
          low: t.probAfterWad,
          close: t.probAfterWad,
          volume: t.tokens,
        });
      } else {
        if (t.probAfterWad > candle.high) candle.high = t.probAfterWad;
        if (t.probAfterWad < candle.low) candle.low = t.probAfterWad;
        candle.close = t.probAfterWad;
        candle.volume += t.tokens;
      }
    }

    return [...buckets.values()].sort((a, b) => a.bucketStart - b.bucketStart);
  }

  async getPositions(address: `0x${string}`): Promise<Position[]> {
    this.require("AGENT_POSITIONS");
    const m = this.find(address);
    const positions = fixturePositions(m, fixtureTrades(m));
    // COST_BASIS omitted -> the position itself is still known (AGENT_POSITIONS is
    // present), but its entry price is not: only events record what was paid. null
    // here, not an empty array and not zero.
    if (!this.capabilities.has("COST_BASIS")) {
      return positions.map((p) => ({...p, entryPriceWad: null}));
    }
    return positions;
  }

  async getReceipt(address: `0x${string}`): Promise<SettlementReceipt> {
    this.require("SETTLEMENT_RECEIPT");
    const m = this.find(address);
    return m.status === "Settled" ? FIXTURE_RECEIPT : PENDING_RECEIPT;
  }
}
