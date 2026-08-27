import {beforeEach, describe, expect, it} from "vitest";
import {dpm} from "@0g-delphi/protocol";
import {MockSource} from "@/lib/data/mock";
import {CapabilityUnavailableError} from "@/lib/data/types";

describe("MockSource", () => {
  let source: MockSource;
  beforeEach(() => {
    source = new MockSource();
  });

  it("melaporkan mode dan seluruh kemampuan secara bawaan", () => {
    expect(source.mode).toBe("mock");
    expect(source.capabilities.has("PRICE_HISTORY")).toBe(true);
    expect(source.capabilities.has("TRADE_TAPE")).toBe(true);
  });

  it("mengembalikan market fixture", async () => {
    const markets = await source.listMarkets();
    expect(markets.length).toBeGreaterThanOrEqual(2);
    expect(markets[0]!.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("mengambil satu market berdasarkan alamat", async () => {
    const [first] = await source.listMarkets();
    const detail = await source.getMarket(first!.address);
    expect(detail.address).toBe(first!.address);
    expect(detail.question).toBe(first!.question);
  });

  it("melempar untuk alamat yang tidak dikenal", async () => {
    await expect(source.getMarket("0x0000000000000000000000000000000000000009")).rejects.toThrow(
      /tidak ditemukan/,
    );
  });

  /**
   * Fixture yang tidak konsisten merender keadaan yang tidak mungkin ada di
   * rantai. poolWad DITURUNKAN dari q, tidak pernah diketik tangan.
   */
  it("setiap fixture memenuhi invarian pool protokol", async () => {
    for (const m of await source.listMarkets()) {
      expect(m.poolWad).toBe(dpm.costUp(m.q));
    }
  });

  it("mengembalikan tape trade", async () => {
    const [first] = await source.listMarkets();
    const trades = await source.getTrades(first!.address, 50);
    expect(trades.length).toBeGreaterThan(0);
    expect(trades[0]!.timestamp).toBeGreaterThan(trades[trades.length - 1]!.timestamp);
  });

  /**
   * Mekanisme pusat spec: kemampuan yang absen MELEMPAR, bukan mengembalikan
   * larik kosong. Larik kosong berarti "tidak ada data" — klaim yang berbeda
   * dari "aku tidak bisa tahu". MockSource bisa mensimulasikan mode terbatas
   * supaya perilaku ini teruji tanpa menunggu ChainSource ada.
   */
  it("melempar CapabilityUnavailableError untuk kemampuan yang dihilangkan", async () => {
    const limited = new MockSource({omit: ["PRICE_HISTORY", "TRADE_TAPE"]});
    const [first] = await limited.listMarkets();

    expect(limited.capabilities.has("PRICE_HISTORY")).toBe(false);
    await expect(limited.getCandles(first!.address, "1h")).rejects.toBeInstanceOf(
      CapabilityUnavailableError,
    );
    await expect(limited.getTrades(first!.address, 50)).rejects.toBeInstanceOf(
      CapabilityUnavailableError,
    );
  });

  it("error membawa kemampuan dan mode yang gagal", async () => {
    const limited = new MockSource({omit: ["TRADE_TAPE"]});
    const [first] = await limited.listMarkets();
    await limited.getTrades(first!.address, 10).catch((error: unknown) => {
      const e = error as CapabilityUnavailableError;
      expect(e.capability).toBe("TRADE_TAPE");
      expect(e.mode).toBe("mock");
    });
    expect.assertions(2);
  });

  /**
   * getCandles harus MENGAGREGASI trade ke dalam bucket, bukan memetakan satu
   * candle per trade. Dengan jadwal fixture (24 trade, satu per jam), interval
   * "1d" membuktikannya: 24 trade jatuh ke hanya 2 bucket harian, jadi harus
   * kembali sebagai 2 candle — bukan 24 candle dengan bucketStart berulang.
   */
  describe("getCandles", () => {
    it("setiap candle punya bucketStart unik, untuk setiap interval", async () => {
      const [first] = await source.listMarkets();
      for (const interval of ["1m", "5m", "1h", "1d"] as const) {
        const candles = await source.getCandles(first!.address, interval);
        const bucketStarts = candles.map((c) => c.bucketStart);
        expect(new Set(bucketStarts).size).toBe(bucketStarts.length);
      }
    });

    it("interval 1d menggabungkan 24 trade per-jam menjadi 2 candle, bukan 24", async () => {
      const [first] = await source.listMarkets();
      const daily = await source.getCandles(first!.address, "1d");
      expect(daily.length).toBe(2);
    });

    it("candle terurut naik berdasarkan bucketStart, dan high >= low", async () => {
      const [first] = await source.listMarkets();
      const daily = await source.getCandles(first!.address, "1d");
      for (const c of daily) {
        expect(c.high).toBeGreaterThanOrEqual(c.low);
      }
      for (let i = 1; i < daily.length; i++) {
        expect(daily[i]!.bucketStart).toBeGreaterThan(daily[i - 1]!.bucketStart);
      }
    });

    /**
     * open/close harus berasal dari trade PERTAMA/TERAKHIR di dalam bucket itu
     * sendiri — bukan trade dari bucket sebelumnya. Nilai berikut dihitung
     * independen dari trade tape (bukan dari implementasi getCandles), supaya
     * refactor yang mengacak agregasi (mis. tertukar open/close atau high/low)
     * tertangkap alih-alih diam-diam lolos karena kebetulan cocok.
     */
    it("open/close berasal dari ujung bucket, high/low dari rentang bucket", async () => {
      const [first] = await source.listMarkets();
      const [bucket1, bucket2] = await source.getCandles(first!.address, "1d");

      expect(bucket1).toEqual({
        bucketStart: 1_789_862_400,
        open: 578_644_172_410_245_859n,
        high: 715_959_126_093_847_223n,
        low: 578_644_172_410_245_859n,
        close: 665_648_274_019_505_739n,
        volume: 384_598_038n,
      });
      expect(bucket2).toEqual({
        bucketStart: 1_789_948_800,
        open: 675_749_908_101_684_148n,
        high: 743_063_497_078_439_176n,
        low: 642_384_089_982_411_739n,
        close: 730_815_432_720_936_047n,
        volume: 596_033_022n,
      });
    });
  });
});
