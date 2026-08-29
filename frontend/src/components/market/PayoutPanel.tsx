import {Panel, PanelHeader} from "@/components/primitives/Panel";
import {payoutPerShareWad} from "@/lib/dpm-view";
import {formatPayout} from "@/lib/format";
import type {Outcome} from "@/lib/data/types";

/**
 * A DPM payout is funded entirely by the pool, and the consequence is that an
 * early buyer's payout is diluted by later buyers. Hiding that makes this page
 * lie about the instrument it displays.
 *
 * That disclosure used to appear twice: here, and on the order ticket before
 * confirmation. Since execution moved to `@hevdev7/agent-kit` the ticket is
 * gone — so the paragraph below is the ONLY place a human is ever told that the
 * payout in this market floats. It must not be trimmed, shrunk, or folded away
 * behind an interaction. It carries `data-testid="dilution-disclosure"` so the
 * test that guards its wording does not depend on it happening to be the first
 * paragraph in the panel.
 *
 * Both branches are only worth showing while both are still possible. Once the
 * market has an answer, "Payout if NO wins — 1.49× per share" is a price on an
 * outcome that cannot occur, printed in the same weight as the one that can, on
 * the page a holder reads to find out what their shares are worth. The losing
 * side pays nothing, and that is the number that belongs in its place.
 */
export function PayoutPanel({
  q,
  winningOutcome = null,
}: {
  q: readonly [bigint, bigint];
  winningOutcome?: Outcome | null;
}) {
  const resolved = winningOutcome !== null;
  return (
    <Panel testId="payout-panel">
      <PanelHeader
        eyebrow={resolved ? "Fixed at settlement" : "If the market settles now"}
        title="Payout per share"
      />
      <div className="grid grid-cols-2 divide-x divide-border">
        {([1, 0] as const).map((outcome) => {
          const lost = resolved && outcome !== winningOutcome;
          return (
          <div key={outcome} className={`p-4 md:p-5 ${lost ? "opacity-55" : ""}`}>
            <p className="text-[13px] text-text-muted">
              {resolved
                ? `${outcome === 1 ? "YES" : "NO"} shares ${lost ? "pay" : "redeem for"}`
                : `Payout if ${outcome === 1 ? "YES" : "NO"} wins`}
            </p>
            <p className="mt-1.5 text-[26px] leading-none font-medium text-text">
              {/* The value is wrapped in an element of its own: without this it
                  shares a text node with " per share" and would never match an
                  exact-text search for the payout string alone. */}
              {/* A losing share is worth zero — not "a small number this panel
                  would rather round". `payoutPerShareWad` answers a conditional
                  question, and for the side that lost the condition is false. */}
              <span className="font-mono">
                {lost ? "0.00×" : formatPayout(payoutPerShareWad(q, outcome))}
              </span>{" "}
              <span className="text-[13px] text-text-muted">per share</span>
            </p>
          </div>
          );
        })}
      </div>
      <p
        data-testid="dilution-disclosure"
        className="border-t border-border bg-warn/8 px-4 py-3 text-[13px] leading-relaxed text-warn md:px-5"
      >
        {resolved ? (
          <>
            Payout floated until the market closed, and this is where it stopped: the pool divided
            by the winning side&rsquo;s shares. It moved with every purchase on that side while
            trading was open — including purchases your own agent made — and there is nothing left
            to sell, only to redeem.
          </>
        ) : (
          <>
            Payout floats until the market closes. The more that is bought on one side, the smaller
            the payout per share on that side — including purchases your own agent makes. Positions
            can only be sold while the market is Open, and selling walks back down the curve: the
            price received is below the one on screen, minus fee.
          </>
        )}
      </p>
    </Panel>
  );
}
