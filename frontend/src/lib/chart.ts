import type {Candle} from "@/lib/data/types";

const WAD = 10n ** 18n;
/** Presisi konversi wad→number untuk koordinat. Cukup untuk 600px. */
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
 * Satu-satunya tempat nilai wad menyeberang ke `number` di seluruh frontend,
 * dan hanya untuk koordinat piksel — tidak pernah untuk angka yang dibaca
 * pengguna. Konversi lewat bigint dulu supaya pembagiannya tidak kehilangan
 * presisi sebelum diskalakan.
 */
function wadToUnit(v: bigint): number {
  const clamped = v < 0n ? 0n : v > WAD ? WAD : v;
  return Number((clamped * COORD_SCALE) / WAD) / Number(COORD_SCALE);
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
      // Rentang waktu nol terjadi pada satu bucket; sebarkan merata alih-alih
      // membagi dengan nol, yang akan menghasilkan NaN di atribut `d`.
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
      label: new Date(c.bucketStart * 1000).toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
      }),
    });
  }
  return out;
}
