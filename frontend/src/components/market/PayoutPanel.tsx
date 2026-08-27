import {payoutPerShareWad} from "@/lib/dpm-view";
import {formatPayout} from "@/lib/format";

/**
 * A DPM payout is funded entirely by the pool, and the consequence is that an
 * early buyer's payout is diluted by later buyers. Hiding that makes this page
 * lie about the instrument it displays.
 *
 * That disclosure used to appear twice: here, and on the order ticket before
 * confirmation. Since execution moved to `@0g-delphi/agent-kit` the ticket is
 * gone — so the paragraph below is the ONLY place a human is ever told that the
 * payout in this market floats. It must not be trimmed, shrunk, or folded away
 * behind an interaction.
 */
export function PayoutPanel({q}: {q: readonly [bigint, bigint]}) {
  return (
    <div data-testid="payout-panel" className="rounded-lg border border-border px-4 py-3">
      <div className="flex flex-col gap-1.5">
        {([1, 0] as const).map((outcome) => (
          <div key={outcome} className="flex items-baseline justify-between">
            <span className="text-[13px] text-text-muted">
              Payout if {outcome === 1 ? "YES" : "NO"} wins
            </span>
            <span className="text-[15px] text-text">
              {/* The value is wrapped in an element of its own: without this it
                  shares a text node with " per share" and would never match an
                  exact-text search for the payout string alone. */}
              <span>{formatPayout(payoutPerShareWad(q, outcome))}</span> per share
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 border-t border-border pt-3 text-[12px] leading-relaxed text-warn">
        Payout floats until the market closes. The more that is bought on one side, the smaller
        the payout per share on that side — including purchases your own agent makes. Positions
        can only be sold while the market is Open, and selling walks back down the curve: the
        price received is below the one on screen, minus fee.
      </p>
    </div>
  );
}
