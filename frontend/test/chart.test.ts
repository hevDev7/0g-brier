import {describe, expect, it} from "vitest";
import {areaPath, endLabels, seriesPath, valueY, yTicks, xTicks, type Box} from "@/lib/chart";
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

  /**
   * A 24-hour window labelled by date prints the same day at every tick, which
   * says nothing about where a reader is on the axis. The exact strings are
   * deliberately not pinned — they depend on the running machine's timezone —
   * only the SHAPE, which is the decision being locked down.
   */
  it("labels a sub-two-day window by time, not by date", () => {
    const hourly = Array.from({length: 24}, (_, i) => candle(i * 3600, WAD / 2n));
    const labels = xTicks(hourly, BOX, {minT: 0, maxT: 23 * 3600}, 5).map((t) => t.label);
    expect(labels.length).toBeGreaterThan(1);
    for (const label of labels) expect(label).toMatch(/^\d{2}:\d{2}$/);
    // The whole point: the ticks differ from one another.
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("labels a longer window by date", () => {
    const daily = Array.from({length: 10}, (_, i) => candle(i * 86_400, WAD / 2n));
    const labels = xTicks(daily, BOX, {minT: 0, maxT: 9 * 86_400}, 4).map((t) => t.label);
    for (const label of labels) expect(label).not.toMatch(/^\d{2}:\d{2}$/);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("areaPath", () => {
  const box: Box = {width: 600, height: 300, padLeft: 40, padRight: 8, padTop: 8, padBottom: 24};
  const extent = {minT: 0, maxT: 3600};
  const candles: Candle[] = [
    {bucketStart: 0, open: WAD / 2n, high: WAD / 2n, low: WAD / 2n, close: WAD / 2n, volume: 0n},
    {bucketStart: 3600, open: WAD, high: WAD, low: WAD, close: WAD, volume: 0n},
  ];

  it("is the series line closed down to the baseline", () => {
    const line = seriesPath(candles, box, extent, (c) => c.close);
    const area = areaPath(candles, box, extent, (c) => c.close);
    expect(area.startsWith(line)).toBe(true);
    expect(area.endsWith("Z")).toBe(true);
    // The two closing corners sit on the plot's bottom edge, y = 300 - 24.
    expect(area.slice(line.length)).toBe("L592,276L40,276Z");
  });

  it("stays empty for empty input, so no stray shape is filled", () => {
    expect(areaPath([], box, extent, (c) => c.close)).toBe("");
  });

  it("never emits NaN, even for a single bucket", () => {
    const one = [candles[0]!];
    expect(areaPath(one, box, {minT: 0, maxT: 0}, (c) => c.close)).not.toContain("NaN");
  });
});

/**
 * The point of moving the axis: a gridline says 75%, but a line finishing just under
 * it is at 72.7%, and a reader tracing the endpoint to the nearest label reads the
 * wrong number. The badge carries what the line actually reached.
 */
describe("endLabels", () => {
  const box: Box = {width: 600, height: 300, padLeft: 8, padRight: 54, padTop: 8, padBottom: 24};
  const pct = (n: number) => (WAD * BigInt(n)) / 100n;

  it("places a label at the value's own height", () => {
    const [only] = endLabels([{key: "yes", value: pct(50)}], box);
    expect(only!.y).toBe(valueY(pct(50), box));
  });

  /** Two labels on top of each other are not readable at all. */
  it("pushes two labels apart when they would collide", () => {
    const ends = endLabels(
      [{key: "yes", value: pct(50)}, {key: "no", value: pct(50)}],
      box,
      13,
    );
    expect(Math.abs(ends[0]!.y - ends[1]!.y)).toBeGreaterThanOrEqual(13);
  });

  /** …by the SAME amount each, so neither is further from its line than the other. */
  it("moves both by half the shortfall, not one out of the way of the other", () => {
    const at = valueY(pct(50), box);
    const ends = endLabels([{key: "yes", value: pct(50)}, {key: "no", value: pct(50)}], box, 13);
    const drifts = ends.map((e) => Math.abs(e.y - at));
    expect(drifts[0]).toBeCloseTo(drifts[1]!, 5);
  });

  it("leaves labels alone when they already clear each other", () => {
    const ends = endLabels([{key: "yes", value: pct(90)}, {key: "no", value: pct(10)}], box, 13);
    expect(ends.find((e) => e.key === "yes")!.y).toBe(valueY(pct(90), box));
    expect(ends.find((e) => e.key === "no")!.y).toBe(valueY(pct(10), box));
  });

  /** A series at 0% or 100% must not print off the canvas. */
  it("keeps an extreme value inside the plot", () => {
    const ends = endLabels([{key: "yes", value: WAD}, {key: "no", value: 0n}], box, 13);
    for (const e of ends) {
      expect(e.y).toBeGreaterThanOrEqual(box.padTop);
      expect(e.y).toBeLessThanOrEqual(box.height - box.padBottom);
    }
  });
});
