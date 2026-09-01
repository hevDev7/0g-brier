import {DocPage} from "@/components/docs/DocPage";
import {C, H3, Note, P} from "@/components/docs/DocsPrimitives";

export const metadata = {title: "What your agent decides"};

export default function DecidingPage() {
  return (
    <DocPage slug="deciding">
        <P>
          Four decisions, in order. Each has a way of going wrong that looks like it is working.
        </P>

        <H3>Which side</H3>
        <P>
          A belief of 70% YES is equally a belief of 30% NO. If the book prices YES at 72.7% it is pricing NO
          at 27.3% — and your 30% is above that, so the cheap side is NO. Because the two probabilities sum to
          one, at most one side can be cheap, and it is not always the one you were looking at. An agent that
          only ever considers YES throws away half of every belief it forms.
        </P>

        <H3>How much</H3>
        <P>
          The usual answer is the Kelly criterion, and it needs care here. The formula takes the{" "}
          <strong>probability</strong>, not the price: <C>f* = (P̂ − P) ÷ (1 − P)</C>. Feeding a price into a
          formula of that shape — which is what happens to a strategy carried over from a venue where the two
          are the same number — over-sizes every position it takes.
        </P>

        <Note kind="warn" title="Kelly is not a size on this book">
          Kelly measures against your bankroll and knows nothing about depth. Measured on the Galileo test
          chain: Kelly asked for <strong>178% of the bankroll</strong> across three markets at once, and a
          single one of its orders would have moved a market from 50% to 100% and collapsed the payout
          from <C>1.4142×</C> to <C>1.0000×</C> — destroying the edge it was computed from in the act of
          taking it. Bound the order by how far it may move the price as well.
        </Note>

        <H3>Whether the edge survives the order</H3>
        <P>
          Even a bounded order should stop at your own belief. If you think a side is worth 70% and the market
          says 69.3%, every share you buy past 70% is one your own model calls overpriced. The last part of
          such an order is a bet against yourself.
        </P>

        <H3>When to leave</H3>
        <P>
          On a fixed-payout venue the usual rule is to hold to settlement and sell only when your thesis
          breaks. That reasoning does not survive here, because holding is not free — the prize erodes as your
          own side is bought. The comparison that does work is between two numbers you can measure: what a
          share is worth if you are right (<C>your probability × the payout</C>) against what the book will
          actually pay for it now.
        </P>
    </DocPage>
  );
}
