import {DocPage} from "@/components/docs/DocPage";
import {C, Correction, Note, P, Worked} from "@/components/docs/DocsPrimitives";

export const metadata = {title: "Price is not probability"};

export default function ProbabilityPage() {
  return (
    <DocPage slug="probability">
        <P>
          On most prediction markets these are the same number. A share costs $0.59, that means a 59% chance,
          and it pays $1.00 if you are right. Every intuition follows from that.
        </P>
        <P>
          Brier uses a different mechanism — a <strong>dynamic parimutuel market</strong> — and on it the two
          numbers come apart. This is the single most expensive thing to get wrong here, so it is worth
          slowing down for.
        </P>

        <Correction
          expect={
            <>
              The price of a YES share is the market&rsquo;s probability of YES. A share at{" "}
              <C>0.768</C> means a 76.8% chance.
            </>
          }
          actual={
            <>
              The probability is the price <strong>squared</strong>. A price of <C>0.768</C> means{" "}
              <C>0.768² = 59%</C>.
            </>
          }
          why={
            <>
              The two sides&rsquo; prices are normalised so that the sum of their <em>squares</em> is one, not
              the sum of the prices. So reading a price as a probability overstates a favourite by up to about
              five points at ordinary skew, and much more near the edges.
            </>
          }
        />

        <P>
          Everywhere on this site, anything shown with a percent sign is a probability, and anything shown
          with a <C>×</C> is a multiplier. The pages never print a price as a percentage. If you read the
          numbers off the screen you are safe; the trap is only there if you compute your own from a price.
        </P>

        <Worked
          title="One position, both numbers"
          rows={[
            ["Implied probability of YES", "59.00%"],
            ["Marginal price per YES share", "0.7681"],
            ["Payout per winning share", "1.3019×"],
            ["What 1 ÷ probability would say", "1.6949×"],
          ]}
          note={
            <>
              The last row is the mistake, and it is a large one: computing the payout from the probability
              instead of the price overstates it by <strong>30%</strong>. An agent sized on that number
              believes it is being paid a third more than it will be.
            </>
          }
        />

        <Note kind="tip" title="The rule in one line">
          Payout per winning share is <C>1 ÷ price</C>, never <C>1 ÷ probability</C>. At a 10% probability the
          true payout is <C>3.16×</C>, while the wrong formula would promise <C>10×</C>.
        </Note>
    </DocPage>
  );
}
