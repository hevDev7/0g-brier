import {describe, expect, it} from "vitest";
import {seriesPath, yTicks, xTicks, type Box} from "@/lib/chart";
import type {Candle} from "@/lib/data/types";

const WAD = 10n ** 18n;
const BOX: Box = {width: 600, height: 300, padLeft: 40, padRight: 8, padTop: 8, padBottom: 24};

function candle(t: number, closeWad: bigint): Candle {
  return {bucketStart: t, open: closeWad, high: closeWad, low: closeWad, close: closeWad, volume: 0n};
}

describe("seriesPath", () => {
  it("maps 0% to the bottom of the plot and 100% to its top", () => {
    const cs = [candle(0, 0n), candle(100, WAD)];
    const d = seriesPath(cs, BOX, {minT: 0, maxT: 100}, (c) => c.close);
    // y for 0% = height - padBottom = 276 ; y for 100% = padTop = 8
    expect(d).toBe("M40,276L592,8");
  });

  it("returns an empty string for empty data", () => {
    expect(seriesPath([], BOX, {minT: 0, maxT: 1}, (c) => c.close)).toBe("");
  });

  it("places a single point rather than a broken line", () => {
    const d = seriesPath([candle(5, WAD / 2n)], BOX, {minT: 5, maxT: 5}, (c) => c.close);
    expect(d.startsWith("M")).toBe(true);
    expect(d).not.toContain("NaN");
  });

  it("never produces NaN when the time span is zero", () => {
    const cs = [candle(7, 0n), candle(7, WAD)];
    const d = seriesPath(cs, BOX, {minT: 7, maxT: 7}, (c) => c.close);
    expect(d).not.toContain("NaN");
  });
});

describe("yTicks", () => {
  it("is always 0%..100%, and does not follow the data", () => {
    expect(yTicks(BOX).map((t) => t.label)).toEqual(["0%", "25%", "50%", "75%", "100%"]);
  });
});

describe("xTicks", () => {
  it("returns nothing for empty data", () => {
    expect(xTicks([], BOX, {minT: 0, maxT: 1}, 4)).toEqual([]);
  });

  it("never exceeds the requested count", () => {
    const cs = Array.from({length: 50}, (_, i) => candle(i * 60, WAD / 2n));
    expect(xTicks(cs, BOX, {minT: 0, maxT: 2940}, 4).length).toBeLessThanOrEqual(4);
  });
});
