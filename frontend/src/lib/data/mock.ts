import {WAD, dpm, scaleFor} from "@0g-delphi/protocol";
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
  type Trade,
} from "./types";

const ALL_CAPABILITIES: Capability[] = [
  "LIST_MARKETS", "MARKET_STATE", "QUOTE", "EXECUTE", "PRICE_HISTORY", "TRADE_TAPE",
];

const MUSDC: CollateralInfo = {
  address: "0x9AA0C7DDC6D72BEEb77E4e497b6fbfa4D81A0153",
  symbol: "mUSDC",
  decimals: 6,
};

const HOUR = 3_600;
const NOW = 1_790_000_000;

/** poolWad diturunkan, tidak pernah diketik — fixture tak boleh melanggar invarian rantai. */
function market(
  partial: Omit<MarketDetail, "poolWad" | "collateral">,
): MarketDetail {
  return {...partial, poolWad: dpm.costUp(partial.q), collateral: MUSDC};
}

export const FIXTURE_MARKETS: MarketDetail[] = [
  market({
    address: "0x1111111111111111111111111111111111111111",
    question: "Apakah harga penutupan ETH/USD pada 30 September 2026 berada di atas $4.000?",
    rules:
      "Diselesaikan YES bila harga penutupan harian ETH/USD pada 2026-09-30 23:59 UTC menurut " +
      "sumber yang terdaftar berada di atas $4.000,00. Diselesaikan NO bila di bawah atau sama " +
      "dengan. Bila tidak ada sumber yang menerbitkan harga penutupan pada hari itu, market " +
      "dianggap UNRESOLVABLE dan dilikuidasi.",
    category: "crypto",
    tier: "VERIFIED",
    status: "Open",
    q: [1000n * WAD, 1200n * WAD],
    tradingEnd: NOW + 52 * HOUR,
    settlementDeadline: NOW + 76 * HOUR,
    feeBps: 100,
    creator: "0xAaAaAaAa00000000000000000000000000000001",
    specRoot: "0xa1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
  }),
  market({
    address: "0x2222222222222222222222222222222222222222",
    question: "Apakah 0G Chain akan mengumumkan mainnet v2 sebelum 1 Desember 2026?",
    rules:
      "Diselesaikan YES bila pengumuman resmi terbit di kanal resmi 0G Labs sebelum " +
      "2026-12-01 00:00 UTC. Pengumuman pihak ketiga tidak dihitung.",
    category: "crypto",
    tier: "FAST",
    status: "Open",
    q: [707_106_781_186_547_524_400n, 707_106_781_186_547_524_400n],
    tradingEnd: NOW + 9 * 24 * HOUR,
    settlementDeadline: NOW + 10 * 24 * HOUR,
    feeBps: 100,
    creator: "0xAaAaAaAa00000000000000000000000000000002",
    specRoot: "0xb2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1",
  }),
  market({
    address: "0x3333333333333333333333333333333333333333",
    question: "Apakah inflasi tahunan zona euro turun di bawah 2,0% pada rilis Oktober 2026?",
    rules: "Diselesaikan menurut rilis HICP Eurostat untuk Oktober 2026, angka flash.",
    category: "economics",
    tier: "DETERMINISTIC",
    status: "Closed",
    q: [1800n * WAD, 600n * WAD],
    tradingEnd: NOW - 2 * HOUR,
    settlementDeadline: NOW + 22 * HOUR,
    feeBps: 100,
    creator: "0xAaAaAaAa00000000000000000000000000000003",
    specRoot: "0xc3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2",
  }),
];

/** Pola sisi pseudo-acak i-dependent: 1 dari 3 trade di sisi NO, sisanya YES. */
function syntheticOutcome(i: number): Outcome {
  return (i % 3 === 0 ? 0 : 1) as Outcome;
}

/** Bobot pseudo-acak i-dependent — proporsi RELATIF, bukan hitungan lembar absolut (lihat fixtureTrades). */
function syntheticWeight(i: number): bigint {
  return BigInt(12 + ((i * 37) % 90));
}

function fixtureTrades(m: MarketDetail): Trade[] {
  const trades: Trade[] = [];
  const startQ: readonly [bigint, bigint] = [m.q[0] / 2n, m.q[1] / 2n];

  // Bobot di atas dulunya diperlakukan sebagai hitungan LEMBAR ABSOLUT.
  // Bug: totalnya (414 utk sisi NO, 906 utk sisi YES) sama untuk setiap
  // market, jadi q sintetis di akhir 24 trade melenceng dari m.q market ini
  // — trade TERBARU (yang tampil paling atas di tape) menunjukkan
  // probabilitas yang tak cocok dengan panel probabilitas, yang dihitung
  // langsung dari m.q.
  //
  // Di bawah ini bobot yang sama dipakai sebagai PROPORSI relatif per sisi,
  // diskalakan lewat distribusi bigint-eksak (bukan .toFixed / floating
  // point) supaya trade TERAKHIR tiap sisi tepat menutup q ke m.q — trade
  // tape jadi koheren dengan keadaan market saat ini, tanpa mengubah m.q itu
  // sendiri (setiap uji probabilitas/payout di suite ini bergantung padanya).
  const remainingWeight: [bigint, bigint] = [0n, 0n];
  for (let i = 0; i < 24; i++) {
    remainingWeight[syntheticOutcome(i)] += syntheticWeight(i);
  }
  const remainingAmount: [bigint, bigint] = [m.q[0] - startQ[0], m.q[1] - startQ[1]];

  let q: readonly [bigint, bigint] = startQ;
  for (let i = 0; i < 24; i++) {
    const outcome = syntheticOutcome(i);
    const w = syntheticWeight(i);
    // Distribusi proporsional bigint-eksak: saat trade TERAKHIR di sisi ini
    // diproses, remainingWeight[outcome] === w, jadi shares ===
    // remainingAmount[outcome] persis — sisa pembulatan antar-trade tidak
    // menumpuk ke mana-mana, ia disapu habis oleh trade penutup itu sendiri.
    const shares = (remainingAmount[outcome] * w) / remainingWeight[outcome];
    remainingAmount[outcome] -= shares;
    remainingWeight[outcome] -= w;

    const before = dpm.costUp(q);
    q = outcome === 0 ? [q[0] + shares, q[1]] : [q[0], q[1] + shares];
    const tokens = (dpm.costUp(q) - before) / scaleFor(m.collateral.decimals);
    trades.push({
      id: `${m.address}-${i}`,
      timestamp: NOW - (24 - i) * HOUR,
      trader: `0xbb${i.toString(16).padStart(2, "0")}${"0".repeat(34)}` as `0x${string}`,
      outcome,
      sharesDelta: shares,
      tokens,
      fee: (tokens * BigInt(m.feeBps)) / 10_000n,
      probAfterWad: dpm.probability(q, 1),
    });
  }
  return trades.reverse(); // terbaru dulu
}

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
    if (!found) throw new Error(`Market ${address} tidak ditemukan`);
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
    // fixtureTrades() adalah terbaru-dulu; balikkan ke urutan waktu naik supaya
    // trade pertama yang diproses per bucket benar-benar trade paling awal.
    const trades = [...fixtureTrades(this.find(address))].reverse();
    const step = interval === "1d" ? 24 * HOUR : interval === "1h" ? HOUR : 5 * 60;

    // Kelompokkan trade ke bucket berdasarkan bucketStart — SATU candle per
    // bucket, bukan satu candle per trade. open/close berasal dari trade
    // pertama/terakhir dalam bucket itu sendiri; high/low dari rentang bucket.
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
}
