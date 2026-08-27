import type {Candle} from "@/lib/data/types";

const WAD = 10n ** 18n;
/** Precision of the wad→number conversion for coordinates. Enough for 600px. */
const COORD_SCALE = 10_000n;

export interface Box {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
}

export interface Extent {
  minT: number;
  maxT: number;
}

const plotLeft = (b: Box) => b.padLeft;
const plotRight = (b: Box) => b.width - b.padRight;
const plotTop = (b: Box) => b.padTop;
const plotBottom = (b: Box) => b.height - b.padBottom;

/**
 * The only place a wad value crosses into `number` anywhere in the frontend, and
 * only for pixel coordinates — never for a number a user reads. The conversion
 * goes through bigint first so the division does not lose precision before being
 * scaled.
 */
function wadToUnit(v: bigint): number {
  const clamped = v < 0n ? 0n : v > WAD ? WAD : v;
  return Number((clamped * COORD_SCALE) / WAD) / Number(COORD_SCALE);
}

/**
 * A wad probability as a percentage NUMBER, for layout only — a bar width, a
 * coordinate. Never for anything a reader sees: displayed percentages come from
 * `formatProbability`, which stays in bigint the whole way. It lives in this
 * module because this module is the one place allowed to cross from wad to
 * `number`, and keeping that single exception single is the point.
 */
export function wadToPercent(value: bigint): number {
  return wadToUnit(value) * 100;
}

export function seriesPath(
  candles: Candle[],
  box: Box,
  extent: Extent,
  pick: (c: Candle) => bigint,
): string {
  if (candles.length === 0) return "";
  const span = extent.maxT - extent.minT;
  const w = plotRight(box) - plotLeft(box);
  const h = plotBottom(box) - plotTop(box);
  return candles
    .map((c, i) => {
      // A zero time span happens with a single bucket; spread evenly instead of
      // dividing by zero, which would put NaN in the `d` attribute.
      const tx = span === 0
        ? (candles.length === 1 ? 0 : i / (candles.length - 1))
        : (c.bucketStart - extent.minT) / span;
      const x = plotLeft(box) + tx * w;
      const y = plotBottom(box) - wadToUnit(pick(c)) * h;
      return `${i === 0 ? "M" : "L"}${round(x)},${round(y)}`;
    })
    .join("");
}

const round = (n: number) => Math.round(n * 100) / 100;

export function yTicks(box: Box): {y: number; label: string}[] {
  const h = plotBottom(box) - plotTop(box);
  return [0, 25, 50, 75, 100].map((pct) => ({
    y: round(plotBottom(box) - (pct / 100) * h),
    label: `${pct}%`,
  }));
}

export function xTicks(
  candles: Candle[],
  box: Box,
  extent: Extent,
  count: number,
): {x: number; label: string}[] {
  if (candles.length === 0 || count <= 0) return [];
  const span = extent.maxT - extent.minT;
  const w = plotRight(box) - plotLeft(box);
  const step = Math.max(1, Math.floor(candles.length / count));
  const out: {x: number; label: string}[] = [];
  for (let i = 0; i < candles.length && out.length < count; i += step) {
    const c = candles[i]!;
    const tx = span === 0 ? 0 : (c.bucketStart - extent.minT) / span;
    out.push({
      x: round(plotLeft(box) + tx * w),
      label: new Date(c.bucketStart * 1000).toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
      }),
    });
  }
  return out;
}
