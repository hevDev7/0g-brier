import Link from "next/link";
import {DocPage} from "@/components/docs/DocPage";
import {C, H3, Note, P, Worked} from "@/components/docs/DocsPrimitives";

export const metadata = {title: "Why a parimutuel"};

const link = "text-accent underline decoration-accent/40";

export default function ParimutuelPage() {
  return (
    <DocPage slug="parimutuel">
      <P>
        The two pages before this one describe three things that surprise people: the price is not the
        probability, the payout moves after you buy, and buying shrinks the prize you just bought into. They
        read like three separate oddities to memorise.
      </P>
      <P>
        They are one decision, seen from three angles. This page is that decision — what it buys and what it
        costs — because a mechanism you understand the reason for is one you can reason about, and a list of
        quirks is only something to remember.
      </P>

      <H3>The mechanism</H3>
      <P>
        Brier is a <strong>dynamic parimutuel market</strong>, with the cost function{" "}
        <C>C(q) = √(Σqᵢ²)</C>. Everything else follows from that one choice:
      </P>
      <Worked
        title="What the cost function implies"
        rows={[
          ["Marginal price", "pᵢ = qᵢ ÷ C(q)"],
          ["Normalisation", "Σpᵢ² = 1     (not Σpᵢ = 1)"],
          ["Implied probability", "Pᵢ = pᵢ²"],
          ["Payout per winning share", "1 ÷ pᵢ,  floating until close"],
        ]}
      />

      <H3>The property that explains it</H3>
      <P>
        A parimutuel pool is shared out among whoever was right. What makes this one work is that the sharing
        comes out exact: <strong>whichever side wins, the total paid is precisely the pool</strong>. Not
        approximately — the algebra collapses.
      </P>
      <P>
        Winners hold <C>qᵢ</C> shares and each pays <C>1 ÷ pᵢ</C>. Since <C>pᵢ = qᵢ ÷ C(q)</C>, the total is{" "}
        <C>qᵢ × C(q) ÷ qᵢ = C(q)</C> — and <C>C(q)</C> is exactly what the pool holds, because the contract
        keeps <C>poolWad</C> as the cost function itself.
      </P>

      <Worked
        title="A real market, both outcomes"
        rows={[
          ["q", "[707.106781 NO, 781.013648 YES]"],
          ["C(q) = poolWad", "1053.556984 mUSDC"],
          ["If NO wins", "707.106781 × 1.4900× = 1053.556984"],
          ["If YES wins", "781.013648 × 1.3490× = 1053.556984"],
        ]}
        note={
          <>
            Measured on an open market, not constructed — a Galileo run, in the old testnet&rsquo;s mUSDC —
            and quoted to six decimals so that recomputing{" "}
            <C>C(q)</C> from these figures gives this <C>C(q)</C>. At four it does not: the rounding moves the
            total by twenty-three micro-units, which is small enough to look like agreement and is not.
            <span className="mt-2 block">
              The two sides pay wildly different multiples and settle the same total. That is the whole trick —
              the house never gains and never loses, so nobody has to fund it.
            </span>
          </>
        }
      />

      <H3>What that buys, and what it costs</H3>
      <P>
        Prediction markets pick two of three properties. This is the trade, and it is why the surprises above
        exist:
      </P>

      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-border bg-bg-sunken text-left">
              {["Mechanism", "Needs a subsidy?", "Always tradable?", "Payout"].map((h) => (
                <th key={h} className="px-4 py-2.5 font-mono text-[12px] tracking-wider text-text-faint uppercase">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[
              ["Order book — Polymarket, Kalshi", "No", "No — needs a counterparty", "Fixed at 1"],
              ["LMSR — Augur, early Gnosis", "Yes — bounded loss someone funds", "Yes", "Fixed at 1"],
              ["Dynamic parimutuel — Brier", "No", "Yes", "Floating, 1 ÷ pᵢ"],
            ].map(([mech, subsidy, tradable, payout], i) => (
              <tr key={mech} className={i === 2 ? "bg-bg-sunken" : undefined}>
                <td className="px-4 py-3 align-top font-medium text-text">{mech}</td>
                <td className="px-4 py-3 align-top text-text-muted">{subsidy}</td>
                <td className="px-4 py-3 align-top text-text-muted">{tradable}</td>
                <td className="px-4 py-3 align-top text-text-muted">{payout}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <P>
        On an order book a thin market does not trade at all — there is nobody on the other side, and the
        quoted price is a hope. An LMSR always quotes, but its market maker carries a real bounded loss, and
        somebody has to put that money up before the first trade: a subsidy per market, paid whether or not
        anyone shows up.
      </P>
      <P>
        A dynamic parimutuel gets both. There is always a price, and no one funds it — because there is no
        market maker to fund, only the pool the traders themselves make.
      </P>

      <Note kind="tip" title="The floating payout is the price of that, not a defect">
        If the pool is exactly what went in, and it is divided among whoever turns out to be right, then each
        winner&rsquo;s share must depend on how many other winners there are — and that is not known until
        trading closes. A fixed payout would mean promising an amount the pool might not contain.
        <p className="mt-2">
          So the three surprises are the same fact stated three ways. The payout moves because the pool is
          shared. Your own buying shrinks it because you joined the side sharing it. And the probability is the
          price squared because <C>Σpᵢ² = 1</C> is the normalisation that makes the sharing come out exact.
        </p>
      </Note>

      <H3>What it means at the keyboard</H3>
      <P>
        Three things follow, and none of them is obvious from a screenshot.
      </P>
      <P>
        <strong>A thin market is a different instrument from a deep one at the same probability.</strong> Depth
        decides how far your own order moves the price, so two markets showing 60% can behave nothing alike.
        Depth is on every market page for that reason, next to the probability rather than buried.
      </P>
      <P>
        <strong>Size against the book, not only the bankroll.</strong> A position large enough to move the
        probability past your own estimate is a bet against yourself for its last part —{" "}
        <Link href="/docs/deciding" className={link}>
          What your agent decides
        </Link>{" "}
        covers the bound.
      </P>
      <P>
        <strong>Holding is a position, not a pause.</strong> On a fixed-payout venue a correct share is worth
        the same whenever you look at it. Here it is worth <C>1 ÷ pᵢ</C>, and that number moves while you do
        nothing. An exit rule carried over from such a venue will watch a good position erode without ever
        firing.
      </P>
    </DocPage>
  );
}
