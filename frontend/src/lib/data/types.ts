export type Outcome = 0 | 1;
export type DataMode = "mock" | "chain" | "indexer";

export type Capability =
  | "LIST_MARKETS"
  | "MARKET_STATE"
  | "QUOTE"
  | "EXECUTE"
  | "PRICE_HISTORY"
  | "TRADE_TAPE";

export class CapabilityUnavailableError extends Error {
  constructor(
    readonly capability: Capability,
    readonly mode: DataMode,
  ) {
    super(`${capability} tidak tersedia di mode ${mode}`);
    this.name = "CapabilityUnavailableError";
  }
}

/**
 * `unavailable` adalah anggota union, bukan kasus khusus. Karena ia ada di
 * sini, TypeScript memaksa setiap konsumen menanganinya — komponen yang lupa
 * tidak akan mengompilasi. Kejujuran UI ditegakkan compiler, bukan disiplin.
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
  /** Pasokan lembar per outcome, wad. Indeks 0 = NO, 1 = YES. */
  q: readonly [bigint, bigint];
  /** Selalu sama dengan dpm.costUp(q). Tidak pernah diketik tangan. */
  poolWad: bigint;
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
  /** Positif untuk beli, negatif untuk jual. */
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

export interface DataSource {
  readonly mode: DataMode;
  readonly capabilities: ReadonlySet<Capability>;
  listMarkets(): Promise<MarketSummary[]>;
  getMarket(address: `0x${string}`): Promise<MarketDetail>;
  getTrades(address: `0x${string}`, limit: number): Promise<Trade[]>;
  getCandles(address: `0x${string}`, interval: Interval): Promise<Candle[]>;
}
