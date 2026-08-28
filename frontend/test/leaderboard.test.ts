import {describe, expect, it} from "vitest";
import {compareRows, leaderboard, type LeaderboardRow} from "@/lib/leaderboard";
import {FIXTURE_MARKETS, MockSource} from "@/lib/data/mock";
import type {Capability, MarketSummary, Position, Trade} from "@/lib/data/types";

async function board(omit: Capability[] = []) {
  const source = new MockSource({omit});
  const markets = await source.listMarkets();
  const positionsByMarket = source.capabilities.has("AGENT_POSITIONS")
    ? await Promise.all(markets.map((m) => source.getPositions(m.address)))
    : null;
  const tradesByMarket = source.capabilities.has("TRADE_TAPE")
    ? await Promise.all(markets.map((m) => source.getTrades(m.address, 500)))
    : null;
  const collateral = markets[0]!.collateral;
  const agents = [
    ...new Set([
      ...(positionsByMarket ?? []).flat().map((p) => p.agent),
      ...(tradesByMarket ?? []).flat().map((t) => t.trader),
    ]),
  ];
  const balances = new Map<string, bigint>();
  const balancesKnown = source.capabilities.has("AGENT_BALANCE");
  if (balancesKnown) {
    for (const a of agents) {
      balances.set(a.toLowerCase(), await source.getBalance(a, collateral.address));
    }
  }
  return {
    markets,
    tradesByMarket,
    rows: leaderboard({markets, positionsByMarket, tradesByMarket, balances, balancesKnown}),
  };
}

describe("leaderboard", () => {
  it("lists every agent exactly once", async () => {
    const {rows} = await board();
    const keys = rows.map((r) => r.agent.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    expect(rows.length).toBeGreaterThan(1);
  });

  it("counts every trade in the tapes, and no more", async () => {
    const {rows, tradesByMarket} = await board();
    const counted = rows.reduce((sum, r) => sum + (r.trades ?? 0), 0);
    expect(counted).toBe(tradesByMarket!.flat().length);
    // 24 synthetic trades per fixture market. Derived, so adding a market to the
    // fixtures does not turn a true assertion into a false one.
    expect(counted).toBe(FIXTURE_MARKETS.length * 24);
  });

  /** A sell is volume too: signed sums make a busy agent look idle. */
  it("counts volume unsigned", () => {
    const agent = `0x${"a".repeat(40)}` as const;
    const trade = (tokens: bigint): Trade => ({
      id: `${tokens}`,
      timestamp: 1,
      trader: agent,
      outcome: 1,
      sharesDelta: tokens,
      tokens,
      fee: 0n,
      probYesAfterWad: 10n ** 18n / 2n,
    });
    const rows = leaderboard({
      markets: [] as MarketSummary[],
      positionsByMarket: [],
      tradesByMarket: [[trade(100n), trade(-40n)]],
      balances: new Map(),
      balancesKnown: false,
    });
    expect(rows[0]!.volumeTokens).toBe(140n);
    expect(rows[0]!.trades).toBe(2);
  });

  it("account value is free collateral plus deployed value, both or neither", async () => {
    const {rows} = await board();
    for (const row of rows) {
      expect(row.accountValueTokens).toBe(row.balanceTokens! + row.positionValueTokens!);
    }
    // The derivation must actually spread, or the ranking says nothing.
    expect(new Set(rows.map((r) => r.balanceTokens)).size).toBe(rows.length);
  });

  it("includes an agent that appears only in a tape, with nothing deployed", () => {
    const onlyTraded = `0x${"c".repeat(40)}` as const;
    const rows = leaderboard({
      markets: [] as MarketSummary[],
      positionsByMarket: [[] as Position[]],
      tradesByMarket: [
        [
          {
            id: "1", timestamp: 1, trader: onlyTraded, outcome: 1,
            sharesDelta: 5n, tokens: 5n, fee: 0n, probYesAfterWad: 10n ** 18n / 2n,
          },
        ],
      ],
      balances: new Map(),
      balancesKnown: false,
    });
    expect(rows).toHaveLength(1);
    // Positions ARE readable and hold nothing: that is zero, a real fact, not null.
    expect(rows[0]!.positionValueTokens).toBe(0n);
    expect(rows[0]!.marketsHeld).toBe(0);
  });
});

describe("leaderboard in a limited mode", () => {
  it("without TRADE_TAPE, the counts are unknown and the holdings are not", async () => {
    const {rows} = await board(["TRADE_TAPE"]);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.trades).toBeNull();
      expect(row.volumeTokens).toBeNull();
      expect(row.positionValueTokens).not.toBeNull();
      expect(row.accountValueTokens).not.toBeNull();
    }
  });

  it("without COST_BASIS, only the profit is unknown", async () => {
    const {rows} = await board(["COST_BASIS"]);
    for (const row of rows) {
      expect(row.unrealisedTokens).toBeNull();
      expect(row.positionValueTokens).not.toBeNull();
      expect(row.trades).not.toBeNull();
    }
  });

  /**
   * Without AGENT_POSITIONS the deployed value is UNKNOWN, not zero — and an
   * account value built from a known half and an unknown one would look complete
   * while being nothing of the sort.
   */
  it("without AGENT_POSITIONS, deployed and account value are unknown, not zero", async () => {
    const {rows} = await board(["AGENT_POSITIONS"]);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.positionValueTokens).toBeNull();
      expect(row.marketsHeld).toBeNull();
      expect(row.accountValueTokens).toBeNull();
      expect(row.trades).not.toBeNull(); // the tape still answers
    }
  });

  it("without AGENT_BALANCE, the free collateral and the account value are unknown", async () => {
    const {rows} = await board(["AGENT_BALANCE"]);
    for (const row of rows) {
      expect(row.balanceTokens).toBeNull();
      expect(row.accountValueTokens).toBeNull();
      expect(row.positionValueTokens).not.toBeNull();
    }
  });
});

describe("compareRows", () => {
  const row = (over: Partial<LeaderboardRow>): LeaderboardRow => ({
    agent: `0x${"1".repeat(40)}`,
    name: null,
    trades: 0, volumeTokens: 0n, feesTokens: 0n, marketsHeld: 0,
    positionValueTokens: 0n, unrealisedTokens: 0n, balanceTokens: 0n,
    accountValueTokens: 0n, ...over,
  });

  it("ranks the larger value first", () => {
    const big = row({accountValueTokens: 100n});
    const small = row({accountValueTokens: 10n});
    expect([small, big].sort((a, b) => compareRows(a, b, "account"))[0]).toBe(big);
  });

  /**
   * An agent whose value cannot be read is not the poorest agent. Sorting it
   * below a genuine zero asserts a fact about the agent when the only fact is
   * about the source.
   */
  it("sorts an unknown value last, below a real zero", () => {
    const unknown = row({accountValueTokens: null});
    const zero = row({accountValueTokens: 0n});
    expect([unknown, zero].sort((a, b) => compareRows(a, b, "account"))[0]).toBe(zero);
    expect([zero, unknown].sort((a, b) => compareRows(a, b, "account"))[1]).toBe(unknown);
  });

  it("ranks by trade count as a number, not as a string", () => {
    const many = row({trades: 100});
    const few = row({trades: 9});
    expect([few, many].sort((a, b) => compareRows(a, b, "trades"))[0]).toBe(many);
  });
});

/**
 * A `Trade` carries `msg.sender` and nothing else, so a name is only ever reachable
 * by going backwards from the key that signed it. What the column must never do is
 * go blank when that lookup finds nothing.
 */
describe("agent identity on the leaderboard", () => {
  const rowsWith = (names?: ReadonlyMap<string, string>) =>
    leaderboard({
      markets: FIXTURE_MARKETS,
      positionsByMarket: null,
      tradesByMarket: [[{
        id: "t1",
        timestamp: 1,
        trader: `0x${"ab".repeat(20)}` as `0x${string}`,
        outcome: 1,
        sharesDelta: 1n,
        tokens: 1n,
        fee: 0n,
        probYesAfterWad: 5n * 10n ** 17n,
      }]],
      balances: new Map(),
      balancesKnown: false,
      ...(names ? {names} : {}),
    });

  it("carries the registered handle when one is known", () => {
    const named = new Map([[`0x${"ab".repeat(20)}`, "Nostradamus"]]);
    expect(rowsWith(named)[0]?.name).toBe("Nostradamus");
  });

  /**
   * Null, and the row then shows its address. Two causes collapse here — the key
   * acts for no agent, or no registry is configured — and they collapse SAFELY,
   * because the address is a true and complete identity in both.
   */
  it("carries null rather than an empty string when no name is known", () => {
    expect(rowsWith()[0]?.name).toBeNull();
    expect(rowsWith(new Map())[0]?.name).toBeNull();
  });

  it("matches an address whatever its casing", () => {
    const named = new Map([[`0x${"ab".repeat(20)}`, "Pythia"]]);
    const rows = rowsWith(named);
    expect(rows[0]?.name).toBe("Pythia");
  });
});
