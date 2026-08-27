import {describe, expect, it} from "vitest";
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";

/**
 * This boundary is a product decision (spec §1 F3): humans only observe. A rule
 * written only in a document gets broken; one that fails CI does not.
 */
describe("the data layer does not write to the chain", () => {
  const dir = join(process.cwd(), "src/lib/data");

  it("no file in lib/data names a write operation", () => {
    const forbidden = /\b(buyShares|sellShares|redeem|liquidate|writeContract|sendTransaction|getSigner|privateKey)\b/;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(dir, file), "utf8");
      const hit = src.match(forbidden);
      expect(hit?.[0], `${file} names a write operation: ${hit?.[0]}`).toBeUndefined();
    }
  });

  it("DataSource exposes only read methods", async () => {
    const {MockSource} = await import("@/lib/data/mock");
    const src = new MockSource();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(src))
      .filter((n) => n !== "constructor" && typeof (src as never)[n] === "function");
    const allowed = new Set([
      "listMarkets", "getMarket", "getTrades", "getCandles",
      "getPositions", "getReceipt", "require", "find",
    ]);
    for (const m of methods) {
      expect(allowed.has(m), `unexpected method on MockSource: ${m}`).toBe(true);
    }
  });
});
