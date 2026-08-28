import {WAD, dpm, scaleFor} from "@0g-delphi/protocol";
import {candlesFrom, positionsFrom} from "./derive";
import {
  CAPABILITIES,
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

// Every capability, taken from the one canonical list — the fixtures answer all
// of them, including the MarketSpec text that a real chain keeps in 0G Storage.
const ALL_CAPABILITIES: readonly Capability[] = CAPABILITIES;

const MUSDC: CollateralInfo = {
  address: "0x9AA0C7DDC6D72BEEb77E4e497b6fbfa4D81A0153",
  symbol: "mUSDC",
  decimals: 6,
};

const HOUR = 3_600;

const NOW = 1_790_000_000;

/**
 * poolWad is derived, never typed — a fixture must not break a chain invariant.
 *
 * The resolution fields default to "not resolved" and the MarketSpec extras to
 * "none listed", so an OPEN fixture says nothing about a settlement it has not
 * had. A settled fixture must state its own winner: defaulting that would let a
 * fixture claim NO by omission, and outcome 0 is a real answer.
 */
function market(
  partial: Omit<MarketDetail, "poolWad" | "collateral" | "winningOutcome" | "resolvedAt" | "sources" | "settlementPrompt"> &
    Partial<Pick<MarketDetail, "winningOutcome" | "resolvedAt" | "sources" | "settlementPrompt">>,
): MarketDetail {
  return {
    winningOutcome: null,
    resolvedAt: null,
    sources: [],
    settlementPrompt: null,
    ...partial,
    poolWad: dpm.costUp(partial.q),
    collateral: MUSDC,
  };
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
    settlementPrompt:
      "Read the euro-area annual HICP figure from the Eurostat flash release for " +
      "October 2026. Answer YES if it is strictly below 2.0%, NO otherwise. Use only " +
      "the flash release; ignore member-state preliminaries and later revisions.",
    sources: [
      {
        kind: "http",
        url: "https://ec.europa.eu/eurostat/web/hicp/data/database",
        selector: "euro area, annual rate, flash",
      },
    ],
    // The chain's own answer, not the receipt's. FIXTURE_RECEIPT agrees with it,
    // and the settlement report reads THIS one — a receipt that disagreed with
    // the contract that pays out would be the receipt that is wrong.
    winningOutcome: 1,
    resolvedAt: NOW - 1 * HOUR,
  }),
  // Three more categories, so the filter has something to filter and the list shows
  // the breadth the registry allows. Appended rather than inserted: several tests
  // index FIXTURE_MARKETS[0] and expect the first three to be what they were.
  market({
    address: "0x4444444444444444444444444444444444444444",
    question: "Will the United Kingdom hold a general election before 1 January 2028?",
    rules:
      "Resolves YES if polling day for a UK general election falls on or before 2027-12-31, " +
      "per the UK Parliament. An announced or scheduled election that has not been held does not count.",
    category: "politics",
    tier: "VERIFIED",
    status: "Open",
    q: [900n * WAD, 1400n * WAD],
    createdAt: NOW - 300 * HOUR,
    tradingEnd: NOW + 30 * 24 * HOUR,
    settlementDeadline: NOW + 31 * 24 * HOUR,
    feeBps: 100,
    creator: "0xAaAaAaAa00000000000000000000000000000004",
    specRoot: "0xd4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3",
    settlementPrompt:
      "Find whether a UK general election has been HELD on or before 2027-12-31. An " +
      "announcement, a dissolution, or a scheduled date is not a held election.",
    sources: [{kind: "http", url: "https://www.parliament.uk/about/how/elections-and-voting/general/", selector: null}],
  }),
  market({
    address: "0x5555555555555555555555555555555555555555",
    question: "Will Manchester City win the 2026-27 English Premier League title?",
    rules:
      "Resolves YES if Manchester City are champions of the 2026-27 Premier League at the end " +
      "of the season, per the official table. A league leader mid-season is not a champion.",
    category: "sports",
    tier: "FAST",
    status: "Open",
    q: [1600n * WAD, 800n * WAD],
    createdAt: NOW - 60 * HOUR,
    tradingEnd: NOW + 60 * 24 * HOUR,
    settlementDeadline: NOW + 61 * 24 * HOUR,
    feeBps: 100,
    creator: "0xAaAaAaAa00000000000000000000000000000005",
    specRoot: "0xe5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4",
    settlementPrompt: "Read the final 2026-27 Premier League table. Answer YES only if Manchester City are first.",
    sources: [{kind: "http", url: "https://www.premierleague.com/tables", selector: "final standings"}],
  }),
  market({
    address: "0x6666666666666666666666666666666666666666",
    question: "Will NASA's Artemis III crewed lunar landing launch before 1 July 2028?",
    rules:
      "Resolves YES if Artemis III lifts off on or before 2028-06-30 UTC, per NASA. A scrubbed " +
      "attempt does not count; a launch that fails after liftoff does.",
    category: "science",
    tier: "DETERMINISTIC",
    status: "Closed",
    q: [1100n * WAD, 1300n * WAD],
    createdAt: NOW - 500 * HOUR,
    tradingEnd: NOW - 3 * HOUR,
    settlementDeadline: NOW + 21 * HOUR,
    feeBps: 100,
    creator: "0xAaAaAaAa00000000000000000000000000000006",
    specRoot: "0xf60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5",
    settlementPrompt: "Determine whether Artemis III has LIFTED OFF on or before 2028-06-30.",
    sources: [{kind: "http", url: "https://www.nasa.gov/mission/artemis-iii/", selector: null}],
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
      probYesAfterWad: dpm.probability(q, 1),
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
  return positionsFrom(trades, m.collateral.decimals);
}

/**
 * A deterministic stand-in for an agent's free collateral.
 *
 * Derived from the address rather than listed per agent, so a new fixture agent
 * gets a balance without anyone editing a table, and so the value is stable
 * across runs — a balance that moved between reloads would make the
 * leaderboard's ordering meaningless and its rank column a lie.
 *
 * The spread is deliberate: identical balances would hide whether the ordering
 * is doing anything at all.
 */
export function fixtureBalance(agent: string, decimals: number): bigint {
  let acc = 0n;
  for (const ch of agent.slice(2).toLowerCase()) {
    const digit = parseInt(ch, 16);
    acc = (acc * 31n + BigInt(Number.isNaN(digit) ? 0 : digit)) % 1_000_003n;
  }
  const units = 250n + (acc * 4_750n) / 1_000_002n;
  return units * 10n ** BigInt(decimals);
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
    return candlesFrom(fixtureTrades(this.find(address)), interval);
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

  async getBalance(agent: `0x${string}`, collateral: `0x${string}`): Promise<bigint> {
    this.require("AGENT_BALANCE");
    const known = FIXTURE_MARKETS.find(
      (m) => m.collateral.address.toLowerCase() === collateral.toLowerCase(),
    );
    // An unknown token is not a zero balance: the two read identically on screen
    // and mean completely different things.
    if (known === undefined) throw new Error(`Collateral ${collateral} not found`);
    return fixtureBalance(agent, known.collateral.decimals);
  }

  /**
   * Fixture names for the fixture traders.
   *
   * Deliberately incomplete: some addresses have a name and some do not, because the
   * list has to render both. A fixture where everyone was named would never exercise
   * the fallback, and the fallback is what most rows will use for a long time.
   */
  async getAgentNames(agents: readonly `0x${string}`[]): Promise<ReadonlyMap<string, string>> {
    const known: Record<string, string> = {
      // `fixtureTrades` derives a trader per index: 0xbb + the index + zeros.
      "0xbb00000000000000000000000000000000000000": "Nostradamus",
      "0xbb01000000000000000000000000000000000000": "Pythia",
      "0xbb0c000000000000000000000000000000000000": "Cassandra",
    };
    const names = new Map<string, string>();
    for (const agent of agents) {
      const name = known[agent.toLowerCase()];
      if (name) names.set(agent.toLowerCase(), name);
    }
    return names;
  }

  async getReceipt(address: `0x${string}`): Promise<SettlementReceipt> {
    this.require("SETTLEMENT_RECEIPT");
    const m = this.find(address);
    return m.status === "Settled" ? FIXTURE_RECEIPT : PENDING_RECEIPT;
  }
}
