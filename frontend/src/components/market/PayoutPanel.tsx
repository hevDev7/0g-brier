import {Panel, PanelHeader} from "@/components/primitives/Panel";
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
 * behind an interaction. It carries `data-testid="dilution-disclosure"` so the
 * test that guards its wording does not depend on it happening to be the first
 * paragraph in the panel.
 */
export function PayoutPanel({q}: {q: readonly [bigint, bigint]}) {
  return (
    <Panel testId="payout-panel">
      <PanelHeader eyebrow="If the market settles now" title="Payout per share" />
      <div className="grid grid-cols-2 divide-x divide-border">
        {([1, 0] as const).map((outcome) => (
          <div key={outcome} className="p-4 md:p-5">
            <p className="text-[12px] text-text-muted">
              Payout if {outcome === 1 ? "YES" : "NO"} wins
            </p>
            <p className="mt-1.5 text-[24px] leading-none font-medium text-text">
              {/* The value is wrapped in an element of its own: without this it
                  shares a text node with " per share" and would never match an
                  exact-text search for the payout string alone. */}
              <span className="font-mono">{formatPayout(payoutPerShareWad(q, outcome))}</span>{" "}
              <span className="text-[12px] text-text-muted">per share</span>
            </p>
          </div>
        ))}
      </div>
      <p
        data-testid="dilution-disclosure"
        className="border-t border-border bg-warn/8 px-4 py-3 text-[12px] leading-relaxed text-warn md:px-5"
      >
        Payout floats until the market closes. The more that is bought on one side, the smaller
        the payout per share on that side — including purchases your own agent makes. Positions
        can only be sold while the market is Open, and selling walks back down the curve: the
        price received is below the one on screen, minus fee.
      </p>
    </Panel>
  );
}
