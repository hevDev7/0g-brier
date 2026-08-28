import {TrendingUp} from "lucide-react";
import {Panel, PanelHeader} from "@/components/primitives/Panel";
import {formatProbability} from "@/lib/format";
import {areaPath, seriesPath, xTicks, yTicks, type Box} from "@/lib/chart";
import type {Candle, Interval} from "@/lib/data/types";

const WAD = 10n ** 18n;
const BOX: Box = {width: 600, height: 300, padLeft: 40, padRight: 8, padTop: 8, padBottom: 24};

/**
 * The Y axis is fixed at 0–100% and is never scaled to the data range: a market
 * that moved from 49% to 51% must look like a market that barely moved. It is
 * labelled P(YES) explicitly so no reader takes it for the marginal price p_i.
 */
/**
 * The bucket widths a reader can choose between, coarsest last.
 *
 * `30d` is thirty days and is labelled so. Calling it "1M" would put February and
 * August on one axis as equals, which is a small lie of exactly the kind a chart
 * makes easy and a reader cannot check.
 */
export const CHART_INTERVALS: readonly {value: Interval; label: string}[] = [
  {value: "1h", label: "1h"},
  {value: "1d", label: "1d"},
  {value: "1w", label: "1w"},
  {value: "30d", label: "30d"},
];

function IntervalPicker({
  interval,
  onChange,
}: {
  interval: Interval;
  onChange: (next: Interval) => void;
}) {
  return (
    <div className="flex gap-0.5" role="group" aria-label="Bucket width">
      {CHART_INTERVALS.map((option) => (
        <button
          key={option.value}
          type="button"
          data-testid={`interval-${option.value}`}
          aria-pressed={option.value === interval}
          onClick={() => onChange(option.value)}
          className={`rounded px-2 py-1 font-mono text-[11px] transition-colors ${
            option.value === interval
              ? "bg-accent/15 text-accent"
              : "text-text-faint hover:bg-bg-sunken hover:text-text"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ProbabilityChart({
  candles,
  interval,
  onIntervalChange,
}: {
  candles: Candle[];
  interval: Interval;
  onIntervalChange: (next: Interval) => void;
}) {
  const picker = <IntervalPicker interval={interval} onChange={onIntervalChange} />;
  if (candles.length === 0) {
    return (
      <Panel testId="probability-chart">
        <PanelHeader
          eyebrow="Observation history"
          title="P(YES) over time"
          icon={TrendingUp}
          action={picker}
        />
        {/* The picker stays reachable here on purpose. An empty chart is often a
            bucket too WIDE or too narrow for the history that exists, and a reader
            who cannot change it has to guess whether the market is quiet or the
            question was wrong. */}
        <p className="px-4 py-10 text-center text-[13px] text-text-muted">
          No history in {interval} buckets yet for this market.
        </p>
      </Panel>
    );
  }

  /**
   * A single bucket is not a curve, and drawing one is worse than drawing
   * nothing. `seriesPath` collapses one point to a bare `M x,y`, which is
   * invisible as a stroke — but the area path closes that point down to the
   * baseline, and the result is a filled wedge sloping to zero. On the first live
   * market, whose whole life was four minutes, that wedge showed P(YES) falling
   * from 57% to 0% when it had in fact gone 66.98% → 62.20% inside one bucket.
   *
   * So the value is stated instead of plotted. The reader learns the same fact
   * without being shown a trend that never happened.
   */
  if (candles.length === 1) {
    const only = candles[0]!;
    return (
      <Panel testId="probability-chart">
        <PanelHeader
          eyebrow="Observation history"
          title="P(YES) over time"
          icon={TrendingUp}
          action={picker}
        />
        <div className="px-4 py-8 text-center md:px-5">
          <p className="font-mono text-[24px] leading-none text-text">{formatProbability(only.close)}</p>
          <p className="mt-2 text-[13px] leading-relaxed text-text-muted">
            One observation bucket so far — every trade in this market landed inside the same
            {" "}{interval} interval, so there is no movement to plot yet. A narrower bucket may
            show the movement inside it.
          </p>
        </div>
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
        action={picker}
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
