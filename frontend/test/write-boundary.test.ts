import {describe, expect, it} from "vitest";
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";

/**
 * Batas ini adalah keputusan produk (spec §1 F3): manusia hanya mengamati.
 * Aturan yang hanya ditulis di dokumen akan dilanggar; yang gagal di CI tidak.
 */
describe("lapisan data tidak menulis ke rantai", () => {
  const dir = join(process.cwd(), "src/lib/data");

  it("tidak ada berkas di lib/data yang menyebut operasi tulis", () => {
    const forbidden = /\b(buyShares|sellShares|redeem|liquidate|writeContract|sendTransaction|getSigner|privateKey)\b/;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(dir, file), "utf8");
      const hit = src.match(forbidden);
      expect(hit?.[0], `${file} menyebut operasi tulis: ${hit?.[0]}`).toBeUndefined();
    }
  });

  it("DataSource hanya mengekspos metode baca", async () => {
    const {MockSource} = await import("@/lib/data/mock");
    const src = new MockSource();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(src))
      .filter((n) => n !== "constructor" && typeof (src as never)[n] === "function");
    const allowed = new Set([
      "listMarkets", "getMarket", "getTrades", "getCandles",
      "getPositions", "getReceipt", "require", "find",
    ]);
    for (const m of methods) {
      expect(allowed.has(m), `metode tak terduga di MockSource: ${m}`).toBe(true);
    }
  });
});
