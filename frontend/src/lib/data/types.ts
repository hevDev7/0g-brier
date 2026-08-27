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
  createdAt: number;
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

export interface Position {
  agent: `0x${string}`;
  outcome: Outcome;
  shares: bigint;
  /**
   * Harga rata-rata masuk, wad. `null` berarti mode saat ini TIDAK BISA
   * mengetahuinya — bukan nol, dan bukan "belum dimuat". Hanya event yang
   * menyimpan apa yang dibayar, jadi mode `chain` mengembalikan null di sini
   * dan tabel merender `<Unavailable capability="COST_BASIS">` di sel itu.
   * Tipenya sengaja nullable supaya konsumen yang lupa tidak mengompilasi.
   */
  entryPriceWad: bigint | null;
}

export interface ResolverVote {
  model: string;
  /** null = resolver tidak memberi suara (belum reveal, atau abstain). */
  outcome: Outcome | null;
  teeVerified: boolean;
  simulated: boolean;
}

export interface SettlementReceipt {
  /** null selama market belum diselesaikan. */
  outcome: Outcome | null;
  votes: ResolverVote[];
  judgeModel: string | null;
  /** Alasan apa adanya dari resolver. TIDAK diringkas — lihat spec §4.2. */
  reasoning: string;
  criteria: string;
  sources: string[];
  provider: `0x${string}`;
  chatId: string;
  /** true bila receipt berasal dari mode stub. Wajib mencolok di UI. */
  simulated: boolean;
}

/**
 * Kontrak baca. Perhatikan tidak ada metode untuk membeli, menjual, menebus,
 * maupun melikuidasi di sini, dan itu bukan kelalaian: UI manusia hanya
 * mengamati (spec §1 F3). Seluruh eksekusi hidup di `@0g-delphi/agent-kit`.
 * Batas ini ditegakkan uji, bukan hanya konvensi — lihat
 * test/write-boundary.test.ts. (Sengaja diparafrase dalam Bahasa Indonesia,
 * bukan ditulis sebagai istilah bahasa Inggris: uji itu sendiri melarang
 * beberapa istilah tulis-rantai versi bahasa Inggris muncul di berkas mana
 * pun di direktori ini, termasuk komentar.)
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
