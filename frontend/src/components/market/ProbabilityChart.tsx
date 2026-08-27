import {seriesPath, xTicks, yTicks, type Box} from "@/lib/chart";
import type {Candle} from "@/lib/data/types";

const WAD = 10n ** 18n;
const BOX: Box = {width: 600, height: 300, padLeft: 40, padRight: 8, padTop: 8, padBottom: 24};

export function ProbabilityChart({candles}: {candles: Candle[]}) {
  if (candles.length === 0) {
    return (
      <div
        data-testid="probability-chart"
        className="rounded-lg border border-border px-4 py-8 text-center text-[13px] text-text-muted"
      >
        No history yet for this market.
      </div>
    );
  }

  const extent = {
    minT: candles[0]!.bucketStart,
    maxT: candles[candles.length - 1]!.bucketStart,
  };
  // P(YES) is dpm.probability = p_i^2, not the marginal price p_i. Candle.close
  // is ALREADY a probability (spec §5.1) — there is no arithmetic here beyond the
  // complement WAD - close, which is exact because the two probabilities are
  // guaranteed by construction to sum to WAD (not by rounding or approximation).
  const yes = seriesPath(candles, BOX, extent, (c) => c.close);
  const no = seriesPath(candles, BOX, extent, (c) => WAD - c.close);

  return (
    <div data-testid="probability-chart" className="rounded-lg border border-border p-3">
      <div className="mb-2 text-[12px] uppercase tracking-wide text-text-muted">
        P(YES) history
      </div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${BOX.width} ${BOX.height}`}
          className="w-full"
          role="img"
          aria-label="Probability history chart"
        >
          {yTicks(BOX).map((t) => (
            <g key={t.label}>
              <line x1={BOX.padLeft} x2={BOX.width - BOX.padRight} y1={t.y} y2={t.y}
                    className="stroke-border" strokeWidth={1} />
              <text x={0} y={t.y + 4} className="fill-text-faint text-[10px]">{t.label}</text>
            </g>
          ))}
          {xTicks(candles, BOX, extent, 5).map((t) => (
            <text key={t.x} x={t.x} y={BOX.height - 6}
                  textAnchor="middle" className="fill-text-faint text-[10px]">
              {t.label}
            </text>
          ))}
          <path data-series="no" d={no} fill="none" className="stroke-neg" strokeWidth={1.5} />
          <path data-series="yes" d={yes} fill="none" className="stroke-pos" strokeWidth={1.5} />
        </svg>
      </div>
      <div className="mt-1 flex gap-4 text-[11px] text-text-muted">
        <span className="text-pos">● YES</span>
        <span className="text-neg">● NO</span>
      </div>
    </div>
  );
}
