import {agentBook, agentsSeen} from "@/lib/agent-book";
import type {MarketSummary, Position, Trade} from "@/lib/data/types";

export interface LeaderboardRow {
  agent: `0x${string}`;
  /** null when TRADE_TAPE cannot be read. Never 0 — an unknown count is not none. */
  trades: number | null;
  /** Unsigned traded value, collateral units. TRADE_TAPE. */
  volumeTokens: bigint | null;
  /** Fees paid, collateral units. TRADE_TAPE. */
  feesTokens: bigint | null;
  /** How many markets the agent currently holds a position in. null without AGENT_POSITIONS. */
  marketsHeld: number | null;
  /** Value of what the agent has DEPLOYED, at the current marginal price. null without AGENT_POSITIONS. */
  positionValueTokens: bigint | null;
  /** Unrealised profit on open positions. null without COST_BASIS. */
  unrealisedTokens: bigint | null;
  /** Free collateral. null without AGENT_BALANCE. */
  balanceTokens: bigint | null;
  /** Free collateral plus deployed value. null when the balance is unknown. */
  accountValueTokens: bigint | null;
}

export type SortKey = "account" | "unrealised" | "volume" | "trades";

/**
 * Per-agent performance, composed from the same reads the rest of the UI uses.
 *
 * Every metric here carries its own availability, because they do not come from
 * the same place: the counts and volume are TRADE_TAPE, the deployed value is
 * MARKET_STATE plus AGENT_POSITIONS, the profit needs COST_BASIS, and the free
 * collateral needs AGENT_BALANCE. A leaderboard that went dark whenever one of
 * the four was missing would throw away three facts for the sake of one.
 *
 * The agent set is the UNION of who holds a position and who appears in a tape.
 * Taking holders alone would silently drop an agent that closed everything out,
 * and reporting a leaderboard that omits whoever exited is not a leaderboard.
 */
export function leaderboard(input: {
  markets: readonly MarketSummary[];
  /** null when AGENT_POSITIONS is unavailable — NOT an empty list, which would
   *  read as "this agent holds nothing" rather than "we cannot see holdings". */
  positionsByMarket: readonly (readonly Position[])[] | null;
  /** null when TRADE_TAPE is unavailable for every market. */
  tradesByMarket: readonly (readonly Trade[])[] | null;
  /** Keyed by lowercased address. A missing key means AGENT_BALANCE is unknown. */
  balances: ReadonlyMap<string, bigint>;
  balancesKnown: boolean;
}): LeaderboardRow[] {
  const {markets, positionsByMarket, tradesByMarket, balances, balancesKnown} = input;

  const tallies = new Map<string, {count: number; volume: bigint; fees: bigint}>();
  const order: `0x${string}`[] = [];
  const seen = new Set<string>();

  function remember(agent: `0x${string}`): void {
    const key = agent.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      order.push(agent);
    }
  }

  if (positionsByMarket !== null) {
    for (const agent of agentsSeen(positionsByMarket)) remember(agent);
  }

  if (tradesByMarket !== null) {
    for (const tape of tradesByMarket) {
      for (const trade of tape) {
        remember(trade.trader);
        const key = trade.trader.toLowerCase();
        const tally = tallies.get(key) ?? {count: 0, volume: 0n, fees: 0n};
        tally.count += 1;
        // A sell is volume too. Summing signed values would make a busy agent
        // look idle because its buys and sells cancel.
        tally.volume += trade.tokens < 0n ? -trade.tokens : trade.tokens;
        tally.fees += trade.fee;
        tallies.set(key, tally);
      }
    }
  }

  return order.map((agent) => {
    const key = agent.toLowerCase();
    const book = positionsByMarket === null ? null : agentBook(markets, positionsByMarket, agent);
    const positionValueTokens =
      book === null ? null : book.reduce((sum, row) => sum + row.currentValueTokens, 0n);

    // A total is reported only when EVERY row's cost basis is known: summing the
    // rows that happen to have one would read as the agent's whole result.
    const unrealisedTokens =
      book !== null && book.length > 0 && book.every((row) => row.pnlTokens !== null)
        ? book.reduce((sum, row) => sum + (row.pnlTokens ?? 0n), 0n)
        : null;

    const balanceTokens = balancesKnown ? (balances.get(key) ?? null) : null;
    const tally = tallies.get(key);

    return {
      agent,
      trades: tradesByMarket === null ? null : (tally?.count ?? 0),
      volumeTokens: tradesByMarket === null ? null : (tally?.volume ?? 0n),
      feesTokens: tradesByMarket === null ? null : (tally?.fees ?? 0n),
      marketsHeld: book === null ? null : book.length,
      positionValueTokens,
      unrealisedTokens,
      balanceTokens,
      // Both halves or nothing: free collateral alone is not an account value,
      // and adding a known half to an unknown one produces a number that looks
      // complete and is not.
      accountValueTokens:
        balanceTokens === null || positionValueTokens === null
          ? null
          : balanceTokens + positionValueTokens,
    };
  });
}

/**
 * Ranking, with unknown values sorted LAST rather than as zero.
 *
 * An agent whose account value cannot be read is not the poorest agent — it is
 * an agent whose value is not known, and putting it at the bottom of a column
 * sorted by value asserts the first when only the second is true. Sorting it out
 * of the ranked set entirely is the honest position.
 */
export function compareRows(a: LeaderboardRow, b: LeaderboardRow, sort: SortKey): number {
  const pick = (row: LeaderboardRow): bigint | number | null => {
    switch (sort) {
      case "account":
        return row.accountValueTokens;
      case "unrealised":
        return row.unrealisedTokens;
      case "volume":
        return row.volumeTokens;
      case "trades":
        return row.trades;
    }
  };
  const left = pick(a);
  const right = pick(b);
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  if (typeof left === "number" && typeof right === "number") return right - left;
  return left === right ? 0 : (right as bigint) > (left as bigint) ? 1 : -1;
}
