import {probabilityWad} from "@/lib/dpm-view";
import {formatProbability} from "@/lib/format";

/**
 * Shows P_i = p_i^2. The marginal price p_i NEVER appears here — it is only valid
 * as an execution price per share, not as a percentage.
 */
export function ProbabilityPanel({q}: {q: readonly [bigint, bigint]}) {
  return (
    <div
      data-testid="probability-panel"
      className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border"
    >
      {([1, 0] as const).map((outcome) => (
        <div key={outcome} className="bg-bg px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide text-text-faint">
            {outcome === 1 ? "YES" : "NO"}
          </div>
          <div className="mt-1 text-[28px] leading-none text-text">
            {formatProbability(probabilityWad(q, outcome))}
          </div>
        </div>
      ))}
    </div>
  );
}
