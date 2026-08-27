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
});
