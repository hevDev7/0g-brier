import {describe, expect, it} from "vitest";
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";

/**
 * 0.2.1 shipped `networkFor(config.network ?? "galileo")` inside `ZgInference`.
 * A caller who omitted the field traded on 16661 while their inference ran on
 * 16602, and nothing threw: both halves succeed independently, and the two
 * provider catalogues are disjoint, so a real-money market could settle against
 * a testnet provider. `modeForChainId` refuses to guess a network and says why
 * in its own message; nothing in this package may quietly guess one either.
 */
describe("no module guesses a network", () => {
  const dir = join(process.cwd(), "src");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

  it("scans the source it means to scan", () => {
    // A scanner that finds nothing passes every assertion below for free.
    expect(files.length, "no .ts files found in src/").toBeGreaterThan(3);
  });

  it("no file supplies a default network", () => {
    const forbidden = /network\s*(\?\?|\|\|)\s*["'`]/;
    for (const file of files) {
      const src = readFileSync(join(dir, file), "utf8");
      const hit = src.match(forbidden);
      expect(hit?.[0], `${file} defaults a network: ${hit?.[0]}`).toBeUndefined();
    }
  });

  it("no config declares network optional", () => {
    for (const file of files) {
      const src = readFileSync(join(dir, file), "utf8");
      const hit = src.match(/^\s*network\?:/m);
      expect(hit?.[0], `${file} makes network optional: ${hit?.[0]}`).toBeUndefined();
    }
  });
});
