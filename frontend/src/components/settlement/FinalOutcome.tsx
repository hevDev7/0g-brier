import {Gavel} from "lucide-react";
import {Panel, PanelHeader} from "@/components/primitives/Panel";
import {payoutPerShareWad} from "@/lib/dpm-view";
import {formatPayout} from "@/lib/format";
import type {MarketDetail, SettlementReceipt} from "@/lib/data/types";

/** A stub receipt must never be mistaken for a real one. */
function SimulatedBanner({testId}: {testId: string}) {
  return (
    <div
      data-testid={testId}
      role="status"
      className="border-b border-warn/40 bg-warn/10 px-4 py-2.5 text-[12px] font-semibold tracking-wide text-warn uppercase md:px-5"
    >
      Simulated result — not a real resolution by the AI committee
    </div>
  );
}

/**
 * The committee's verdict: the winner, and the payout rate per share for it.
 *
 * The rate MUST come from `payoutPerShareWad` (1/p_i), never from 1/P_i — using
 * the probability instead of the price overstates the payout by around 30% at
 * ordinary skew, exactly the direction that hurts a reader who trusts it. This
 * project's own first spec draft made that mistake; see dpm-view.ts.
 */
/**
 * The winner comes from `Market.winningOutcome` on chain, NOT from the receipt.
 *
 * The contract is what pays out, so it is what decides — and it answers in every
 * mode, because `winningOutcome` is a plain view. Reading the receipt instead
 * left a settled market on a live chain saying "resolution evidence not
 * available" where the chain knew the answer perfectly well, and would have let
 * a receipt that disagreed with the contract put the wrong side on screen.
 *
 * `receipt` is now only what qualifies the verdict — today, whether it was
 * simulated. `null` means no receipt could be read, which does not stop us
 * naming a winner.
 */
export function FinalOutcome({
  receipt,
  market,
}: {
  receipt: SettlementReceipt | null;
  market: MarketDetail;
}) {
  const outcome = market.winningOutcome;

  // A null outcome means the market IS NOT RESOLVED — not "NO", and not an
  // unexplained empty panel. Outcome 0 is a real answer and must not collapse
  // into absence. Just like `unavailable` in Query<T>: not knowing is rendered
  // as such.
  if (outcome === null) {
    return (
      <Panel testId="final-outcome">
        <PanelHeader eyebrow="Committee verdict" title="Final outcome" icon={Gavel} />
        <p className="p-4 text-[14px] text-text-muted md:p-5">
          Not resolved yet — the chain has recorded no outcome for this market.
        </p>
      </Panel>
    );
  }

  const label = outcome === 1 ? "YES" : "NO";
  const payout = payoutPerShareWad(market.q, outcome);

  return (
    <Panel testId="final-outcome" className="overflow-hidden">
      <PanelHeader eyebrow="Committee verdict" title="Final outcome" icon={Gavel} />
      {receipt?.simulated === true && <SimulatedBanner testId="final-outcome-simulated" />}
      <div className="flex flex-col gap-3 p-4 md:p-5">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-[14px] text-text-muted">Winner</span>
          <span
            data-testid="winner"
            className={`font-mono text-[30px] leading-none font-medium ${
              outcome === 1 ? "text-pos" : "text-neg"
            }`}
          >
            {label}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-t border-border pt-3">
          <span className="text-[14px] text-text-muted">Payout per share</span>
          <span data-testid="payout" className="font-mono text-[16px] text-text">
            {formatPayout(payout)}
          </span>
        </div>
      </div>
    </Panel>
  );
}
