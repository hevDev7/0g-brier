import {payoutPerShareWad} from "@/lib/dpm-view";
import {formatPayout} from "@/lib/format";
import type {MarketDetail, SettlementReceipt} from "@/lib/data/types";

/**
 * The committee's verdict: the winner, and the payout rate per share for it.
 *
 * The rate MUST come from `payoutPerShareWad` (1/p_i), never from 1/P_i — using
 * the probability instead of the price overstates the payout by around 30% at
 * ordinary skew, exactly the direction that hurts a reader who trusts it. This
 * project's own first spec draft made that mistake; see dpm-view.ts.
 */
export function FinalOutcome({receipt, market}: {receipt: SettlementReceipt; market: MarketDetail}) {
  const outcome = receipt.outcome;

  // A null outcome means this mode DOES NOT YET KNOW the final decision — not
  // resolved, not "NO", and not an unexplained empty panel. Just like
  // `unavailable` in Query<T>: not knowing is rendered as such.
  if (outcome === null) {
    return (
      <div data-testid="final-outcome" className="rounded-lg border border-border p-4">
        <h2 className="mb-1 text-[12px] uppercase tracking-wide text-text-faint">Final outcome</h2>
        <p className="text-[13px] text-text-muted">Not resolved yet — no committee resolution is available.</p>
      </div>
    );
  }

  const label = outcome === 1 ? "YES" : "NO";
  const payout = payoutPerShareWad(market.q, outcome);

  return (
    <div data-testid="final-outcome" className="flex flex-col gap-3 rounded-lg border border-border p-4">
      {receipt.simulated && (
        <div
          data-testid="final-outcome-simulated"
          role="status"
          className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-warn"
        >
          Simulated result — not a real resolution by the AI committee
        </div>
      )}

      <h2 className="text-[12px] uppercase tracking-wide text-text-faint">Final outcome</h2>

      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-text-muted">Winner</span>
        <span data-testid="winner" className="text-[28px] leading-none text-text">
          {label}
        </span>
      </div>

      <div className="flex items-baseline justify-between border-t border-border pt-3">
        <span className="text-[13px] text-text-muted">Payout per share</span>
        <span data-testid="payout" className="text-[15px] text-text">
          {formatPayout(payout)}
        </span>
      </div>
    </div>
  );
}
