export type Outcome = 0 | 1;
export type DataMode = "mock" | "chain" | "indexer";

export type Capability =
  | "LIST_MARKETS"
  | "MARKET_STATE"
  | "PRICE_HISTORY"
  | "TRADE_TAPE"
  | "AGENT_POSITIONS"
  | "COST_BASIS"
  | "SETTLEMENT_RECEIPT";

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
  question: string;
  category: string;
  tier: Tier;
  status: MarketStatus;
  /** Share supply per outcome, wad. Index 0 = NO, 1 = YES. */
  q: readonly [bigint, bigint];
  /** Always equal to dpm.costUp(q). Never typed by hand. */
  poolWad: bigint;
  /**
   * Creation time, unix seconds. It lives on the SUMMARY rather than only on
   * the detail because the market list sorts by it, and a list may not reach
   * for a field the type it receives does not carry. It costs nothing to
   * provide: it is MARKET_STATE, answerable in every mode.
   */
  createdAt: number;
  tradingEnd: number;
  collateral: CollateralInfo;
}

export interface MarketDetail extends MarketSummary {
  feeBps: number;
  settlementDeadline: number;
  creator: `0x${string}`;
  specRoot: `0x${string}`;
  rules: string;
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
  getReceipt(address: `0x${string}`): Promise<SettlementReceipt>;
}
