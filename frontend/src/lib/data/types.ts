export type Outcome = 0 | 1;
export type DataMode = "mock" | "chain" | "indexer";

/**
 * The canonical list, and the type is derived FROM it rather than declared
 * alongside it.
 *
 * A hand-written union plus a hand-written array is two places to add a member
 * and one place to forget: `MockSource`'s array was not exhaustiveness-checked,
 * so adding `MARKET_SPEC_BLOB` to the union left the mock silently claiming it
 * could not answer something it answers from a fixture. `Record<Capability, T>`
 * still fails to compile when a member is missing, so the label and provider
 * tables keep their guarantee.
 */
export const CAPABILITIES = [
  "LIST_MARKETS",
  "MARKET_STATE",
  "PRICE_HISTORY",
  "TRADE_TAPE",
  "AGENT_POSITIONS",
  "COST_BASIS",
  "MARKET_SPEC_BLOB",
  "SETTLEMENT_RECEIPT",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export class CapabilityUnavailableError extends Error {
  constructor(
    readonly capability: Capability,
    readonly mode: DataMode,
  ) {
    super(`${capability} is not available in ${mode} mode`);
    this.name = "CapabilityUnavailableError";
  }
}

/**
 * `unavailable` is a member of the union, not a special case. Because it lives
 * here, TypeScript forces every consumer to handle it — a component that
 * forgets will not compile. The UI's honesty is enforced by the compiler, not
 * by discipline.
 */
export type Query<T> =
  | {status: "loading"}
  | {status: "ready"; data: T}
  | {status: "unavailable"; capability: Capability; mode: DataMode}
  | {status: "error"; error: Error};

export type MarketStatus =
  | "Open" | "Closed" | "Proposed" | "Disputed" | "Settled" | "Failed" | "Voided";

export type Tier = "FAST" | "VERIFIED" | "DETERMINISTIC";
export type Interval = "1m" | "5m" | "1h" | "1d";

export interface CollateralInfo {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
}

export interface MarketSummary {
  address: `0x${string}`;
  /**
   * The question, from the MarketSpec on 0G Storage.
   *
   * `null` means the current mode CANNOT read it — not that the market has no
   * question. Only `specRoot` is on chain; the text it commits to lives in 0G
   * Storage, and that integration does not exist yet (`MARKET_SPEC_BLOB`). A
   * `chain`-mode consumer must render `<Unavailable capability="MARKET_SPEC_BLOB">`
   * rather than an empty heading, for the same reason it must not render 0 for an
   * unknown number.
   */
  question: string | null;
  category: string;
  tier: Tier;
  status: MarketStatus;
  /** Share supply per outcome, wad. Index 0 = NO, 1 = YES. */
  q: readonly [bigint, bigint];
  /** Always equal to dpm.costUp(q). Never typed by hand. */
  poolWad: bigint;
  /**
   * Creation time, unix seconds, or `null` when the mode cannot know it.
   *
   * The earlier comment here claimed this was MARKET_STATE and "answerable in
   * every mode". It is not: `Market` has no `createdAt` in storage at all — the
   * time a market was created exists only in the `MarketCreated` event, which
   * means an indexer. `chain` mode returns null and relies on
   * `MarketFactory.marketAt` being append-only, so creation ORDER survives even
   * where the timestamp does not.
   */
  createdAt: number | null;
  tradingEnd: number;
  collateral: CollateralInfo;
}

export interface MarketDetail extends MarketSummary {
  feeBps: number;
  settlementDeadline: number;
  creator: `0x${string}`;
  specRoot: `0x${string}`;
  /** The resolution rules, from the MarketSpec on 0G Storage. `null` for the same
   *  reason as `question`: the root is on chain, the text is not. */
  rules: string | null;
}

export interface Trade {
  id: string;
  timestamp: number;
  trader: `0x${string}`;
  outcome: Outcome;
  /** Positive for a buy, negative for a sell. */
  sharesDelta: bigint;
  tokens: bigint;
  fee: bigint;
  probAfterWad: bigint;
}

export interface Candle {
  bucketStart: number;
  open: bigint;
  high: bigint;
  low: bigint;
  close: bigint;
  volume: bigint;
}

export interface Position {
  agent: `0x${string}`;
  outcome: Outcome;
  shares: bigint;
  /**
   * Average entry price, wad. `null` means the current mode CANNOT know it —
   * not zero, and not "not loaded yet". Only events record what was paid, so
   * `chain` mode returns null here and the table renders
   * `<Unavailable capability="COST_BASIS">` in that cell. The type is
   * deliberately nullable so that a consumer which forgets will not compile.
   */
  entryPriceWad: bigint | null;
}

export interface ResolverVote {
  model: string;
  /** null = the resolver cast no vote (not yet revealed, or abstained). */
  outcome: Outcome | null;
  teeVerified: boolean;
  simulated: boolean;
}

export interface SettlementReceipt {
  /** null while the market has not been resolved. */
  outcome: Outcome | null;
  votes: ResolverVote[];
  judgeModel: string | null;
  /** The resolver's reasoning verbatim. NOT summarized — see spec §4.2. */
  reasoning: string;
  criteria: string;
  sources: string[];
  provider: `0x${string}`;
  chatId: string;
  /** true when the receipt came from stub mode. Must be conspicuous in the UI. */
  simulated: boolean;
}

/**
 * The read contract. Note there is no method here for buying, selling, claiming
 * a settled position, or unwinding one, and that is not an oversight: the human
 * UI only observes (spec §1 F3). All execution lives in
 * `@0g-delphi/agent-kit`. This boundary is enforced by a test, not merely by
 * convention — see test/write-boundary.test.ts. (The two exit verbs are
 * deliberately paraphrased rather than named: that test greps every file in
 * this directory, comments included, for the literal chain-write terms.)
 */
export interface DataSource {
  readonly mode: DataMode;
  readonly capabilities: ReadonlySet<Capability>;
  listMarkets(): Promise<MarketSummary[]>;
  getMarket(address: `0x${string}`): Promise<MarketDetail>;
  getTrades(address: `0x${string}`, limit: number): Promise<Trade[]>;
  getCandles(address: `0x${string}`, interval: Interval): Promise<Candle[]>;
  getPositions(address: `0x${string}`): Promise<Position[]>;
  /**
   * An agent's FREE collateral — what it has not put into a market — in that
   * token's smallest unit.
   *
   * It takes the collateral address because a balance is a property of a token,
   * not of the system: two markets may settle in different tokens, and summing
   * across them would produce a number meaning nothing. On chain this is a plain
   * `IERC20.balanceOf` view call, which is why AGENT_BALANCE is answerable in
   * every mode rather than only where an indexer exists.
   *
   * Without it "account value" cannot be told the truth: positions alone are
   * what an agent has DEPLOYED, and calling that its account silently redefines
   * the term.
   */
  getBalance(agent: `0x${string}`, collateral: `0x${string}`): Promise<bigint>;
  getReceipt(address: `0x${string}`): Promise<SettlementReceipt>;
}
