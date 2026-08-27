import {TrendingUp} from "lucide-react";
import {Panel, PanelHeader} from "@/components/primitives/Panel";
import {areaPath, seriesPath, xTicks, yTicks, type Box} from "@/lib/chart";
import type {Candle} from "@/lib/data/types";

const WAD = 10n ** 18n;
const BOX: Box = {width: 600, height: 300, padLeft: 40, padRight: 8, padTop: 8, padBottom: 24};

/**
 * The Y axis is fixed at 0–100% and is never scaled to the data range: a market
 * that moved from 49% to 51% must look like a market that barely moved. It is
 * labelled P(YES) explicitly so no reader takes it for the marginal price p_i.
 */
export function ProbabilityChart({candles}: {candles: Candle[]}) {
  if (candles.length === 0) {
    return (
      <Panel testId="probability-chart">
        <PanelHeader eyebrow="Observation history" title="P(YES) over time" icon={TrendingUp} />
        <p className="px-4 py-10 text-center text-[13px] text-text-muted">
          No history yet for this market.
        </p>
      </Panel>
    );
  }

  const extent = {
    minT: candles[0]!.bucketStart,
    maxT: candles[candles.length - 1]!.bucketStart,
  };
  // P(YES) is dpm.probability = p_i^2, not the marginal price p_i. Candle.close
  // is ALREADY a probability (spec §5.1) — there is no arithmetic here beyond
  // the complement WAD - close, which is exact because the two probabilities are
  // guaranteed to sum to WAD by construction, not by rounding.
  const yes = seriesPath(candles, BOX, extent, (c) => c.close);
  const yesArea = areaPath(candles, BOX, extent, (c) => c.close);
  const no = seriesPath(candles, BOX, extent, (c) => WAD - c.close);

  return (
    <Panel testId="probability-chart">
      <PanelHeader
        eyebrow="Observation history"
        title="P(YES) over time · fixed 0–100% scale"
        icon={TrendingUp}
      />
      <div className="p-3 md:p-4">
        <div className="overflow-x-auto">
          <svg
            viewBox={`0 0 ${BOX.width} ${BOX.height}`}
            className="w-full"
            role="img"
            aria-label={`Probability history, ${candles.length} recorded buckets, on a fixed 0 to 100 percent scale`}
          >
            {yTicks(BOX).map((t) => (
              <g key={t.label}>
                <line
                  x1={BOX.padLeft}
                  x2={BOX.width - BOX.padRight}
                  y1={t.y}
                  y2={t.y}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <text x={0} y={t.y + 4} className="fill-text-faint text-[10px]">
                  {t.label}
                </text>
              </g>
            ))}
            {xTicks(candles, BOX, extent, 5).map((t) => (
              <text
                key={t.x}
                x={t.x}
                y={BOX.height - 6}
                textAnchor="middle"
                className="fill-text-faint text-[10px]"
              >
                {t.label}
              </text>
            ))}
            {/* No data-series on the fill: it is the same value as the YES
                line, and the tests count series, not ink. */}
            <path data-area="yes" d={yesArea} className="fill-pos/10" stroke="none" />
            <path data-series="no" d={no} fill="none" className="stroke-neg" strokeWidth={1.5} />
            <path data-series="yes" d={yes} fill="none" className="stroke-pos" strokeWidth={1.5} />
          </svg>
        </div>
        <div className="mt-1 flex gap-4 text-[11px]">
          <span className="text-pos">● P(YES)</span>
          <span className="text-neg">● P(NO)</span>
        </div>
      </div>
    </Panel>
  );
}
