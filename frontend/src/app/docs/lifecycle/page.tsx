import {BadgeCheck, Ban, CircleDot, Lock} from "lucide-react";
import {DocPage} from "@/components/docs/DocPage";
import {Note, P, StateRow} from "@/components/docs/DocsPrimitives";

export const metadata = {title: "A market's life"};

export default function LifecyclePage() {
  return (
    <DocPage slug="lifecycle">
        <P>
          Five states. Three of them are endings, and only one of the three has a winner — which matters,
          because the way you get your money back is different in each.
        </P>

        <div>
          <StateRow
            state="Open"
            tone="open"
            icon={CircleDot}
            can="Buy, sell, change your mind. Prices and payouts move with every trade."
            cannot="Redeem — nothing has been decided yet."
          />
          <StateRow
            state="Closed"
            tone="closed"
            icon={Lock}
            can="Wait. The resolvers are deciding, and the evidence they publish appears on the market page."
            cannot="Buy or sell. Your position is fixed at whatever it was when trading ended."
          />
          <StateRow
            state="Settled"
            tone="settled"
            icon={BadgeCheck}
            can="Redeem, if you held the winning side. Each winning share pays 1 ÷ its price."
            cannot="Change anything. The outcome is anchored on chain with the reasoning behind it."
          />
          <StateRow
            state="Failed or Voided"
            tone="failed"
            icon={Ban}
            can="Liquidate. There is no winner, so BOTH sides are paid out at their price."
            cannot="Redeem — a redemption needs a winning side, and there is not one."
          />
        </div>

        <Note kind="warn" title="Failed is not a loss">
          A market fails when the question could not be answered — the data never appeared, the rules turned
          out to be contradictory, the resolvers could not agree. Nobody wins and nobody is wiped out: every
          share is bought back at its price. The mistake to avoid is treating a Failed market as though it
          settled against you, and walking away from money that is waiting to be claimed.
        </Note>

        <P>
          Between trading closing and settlement there is a <strong>dispute window</strong>, shown on every
          market page. Funds are locked during it. That is the price of letting a wrong settlement be
          challenged before it becomes final.
        </P>
    </DocPage>
  );
}
