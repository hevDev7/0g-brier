import {Panel, PanelHeader} from "@/components/primitives/Panel";
import {probabilityWad} from "@/lib/dpm-view";
import {wadToPercent} from "@/lib/chart";
import {formatProbability} from "@/lib/format";

/**
 * Shows P_i = p_i^2. The marginal price p_i NEVER appears here — it is only valid
 * as an execution price per share, not as a percentage.
 *
 * The bar underneath is drawn from `wadToPercent`, a layout coordinate. The
 * figures above it come from `formatProbability`, which never leaves bigint —
 * the number a reader sees and the number a bar is drawn from take different
 * routes on purpose.
 */
export function ProbabilityPanel({q}: {q: readonly [bigint, bigint]}) {
  const yes = probabilityWad(q, 1);
  const no = probabilityWad(q, 0);

  return (
    <Panel testId="probability-panel">
      <PanelHeader eyebrow="Current estimate" title="Implied probability" />
      <div className="p-4 md:p-5">
        <div className="grid grid-cols-2 gap-4">
          {(
            [
              {outcome: 1 as const, label: "YES", value: yes, tone: "text-pos"},
              {outcome: 0 as const, label: "NO", value: no, tone: "text-neg"},
            ]
          ).map(({label, value, tone}) => (
            <div key={label}>
              <p className={`eyebrow ${tone}`}>{label}</p>
              <p className="mt-1.5 font-mono text-[34px] leading-none font-medium tracking-[-0.04em] text-text">
                {formatProbability(value)}
              </p>
            </div>
          ))}
        </div>

        <div
          className="mt-5 flex h-2 overflow-hidden rounded-full bg-bg-sunken"
          role="img"
          aria-label={`YES ${formatProbability(yes)}, NO ${formatProbability(no)}`}
        >
          <span className="bg-pos" style={{width: `${wadToPercent(yes)}%`}} />
          <span className="flex-1 bg-neg/70" />
        </div>

        {/* End labels, so the bar reads as a fixed 0-100 scale rather than as a
            proportion of something unstated. The split itself is not labelled —
            both sides are already printed in full above it. */}
        <div className="mt-1.5 flex justify-between font-mono text-[10px] text-text-faint">
          <span>0%</span>
          <span>100%</span>
        </div>

        {/*
          The pair can come up one wad unit short of 100% — two independent floor
          divisions. Both are shown as they are; forcing the total would mean
          printing a number the contract does not hold.
        */}
        <p className="mt-2 text-[11px] text-text-faint">
          Implied probability is the square of the marginal price, so the two sides sum to 100%.
        </p>
      </div>
    </Panel>
  );
}
