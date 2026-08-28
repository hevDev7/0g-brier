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

/**
 * The same line, closed down to the baseline so it can be filled.
 *
 * The fill carries no information the line does not — it is a legibility aid,
 * which is why it is drawn at low opacity and only under ONE series. Filling
 * both would put two translucent washes over each other wherever they cross,
 * and the eye would read the overlap as a third value.
 */
export function areaPath(
  candles: Candle[],
  box: Box,
  extent: Extent,
  pick: (c: Candle) => bigint,
): string {
  const line = seriesPath(candles, box, extent, pick);
  if (line === "") return "";
  const bottom = round(plotBottom(box));
  return `${line}L${round(plotRight(box))},${bottom}L${round(plotLeft(box))},${bottom}Z`;
}


export function yTicks(box: Box): {y: number; label: string}[] {
  const h = plotBottom(box) - plotTop(box);
  return [0, 25, 50, 75, 100].map((pct) => ({
    y: round(plotBottom(box) - (pct / 100) * h),
    label: `${pct}%`,
  }));
}

/** Where a probability sits on the plot, in viewBox units. */
export function valueY(value: bigint, box: Box): number {
  const h = plotBottom(box) - plotTop(box);
  return round(plotBottom(box) - wadToUnit(value) * h);
}

/**
 * Where each series ENDS, so its last value can be printed against it.
 *
 * The point of the exercise: a gridline says 75%, but the line finishing just under
 * it is at 72.7%, and a reader tracing the endpoint to the nearest label reads the
 * wrong number. The badge carries the value the line actually reached.
 *
 * Two series ending close together would print one label over the other, so they are
 * nudged apart — the LOWER one down, the upper one up, by half the shortfall each, so
 * neither is moved further from its line than the other. A label a few pixels off its
 * endpoint is still unambiguous; two overlapping labels are not readable at all.
 *
 * @param minGap the smallest vertical distance two labels may sit at, in viewBox units.
 */
export function endLabels(
  series: readonly {value: bigint; key: string}[],
  box: Box,
  minGap = 13,
): {key: string; y: number; value: bigint}[] {
  const placed = series
    .map((s) => ({key: s.key, value: s.value, y: valueY(s.value, box)}))
    .sort((a, b) => a.y - b.y);

  for (let i = 1; i < placed.length; i++) {
    const above = placed[i - 1]!;
    const below = placed[i]!;
    const gap = below.y - above.y;
    if (gap >= minGap) continue;
    const push = (minGap - gap) / 2;
    above.y -= push;
    below.y += push;
  }
  // Kept inside the plot, so a series at 0% or 100% does not print off the edge.
  return placed.map((p) => ({
    ...p,
    y: round(Math.min(Math.max(p.y, plotTop(box) + 4), plotBottom(box) - 2)),
  }));
}

const TWO_DAYS = 2 * 86_400;

/**
 * Ticks are dated or timed depending on the window they span.
 *
 * A 24-hour window of hourly buckets labelled by date prints the same day five
 * times, which tells a reader nothing about where they are on the axis. Below
 * two days the label becomes the hour; above it, the date. The threshold is on
 * the EXTENT rather than on the interval, because a sparse day of 1m buckets
 * spans a day just as an hourly one does.
 */
function tickLabel(bucketStart: number, spanSeconds: number): string {
  const at = new Date(bucketStart * 1000);
  return spanSeconds < TWO_DAYS
    ? at.toLocaleTimeString("en-US", {hour: "2-digit", minute: "2-digit", hour12: false})
    : at.toLocaleDateString("en-US", {day: "numeric", month: "short"});
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
      label: tickLabel(c.bucketStart, span),
    });
  }
  return out;
}
