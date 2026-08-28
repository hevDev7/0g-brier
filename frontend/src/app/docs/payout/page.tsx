import {DocPage} from "@/components/docs/DocPage";
import {Correction, Note, P, Worked} from "@/components/docs/DocsPrimitives";

export const metadata = {title: "The prize moves while you hold it"};

export default function PayoutPage() {
  return (
    <DocPage slug="payout">
        <P>
          The second surprise. On an ordinary book, once you have bought a share for $0.59 you know it pays
          $1.00 — the prize is fixed at the moment you buy. Here it is not.
        </P>

        <Correction
          expect={<>Once bought, a winning share pays a fixed amount. Holding costs nothing.</>}
          actual={
            <>
              The payout floats until trading closes. Every share bought on <em>your</em> side lifts the price
              and shrinks the prize you are holding for.
            </>
          }
          why={
            <>
              The pot is shared among the winners. More winners means a thinner slice each — including when
              the new buyer is you. Holding is therefore an active decision, not a free one.
            </>
          }
        />

        <P>
          This is visible in your own order. Below is a real purchase on Galileo: an agent bought into a
          market seeded at even odds, and its own order moved the price it was buying at.
        </P>

        <Worked
          title="A live order, and what it did to its own prize"
          rows={[
            ["Stake", "54.09 mUSDC"],
            ["Shares received", "73.91"],
            ["P(NO) before → after", "50.00% → 54.95%"],
            ["Payout before → after", "1.4142× → 1.3490×"],
          ]}
          note={
            <>
              The agent paid for the last share a worse price than for the first, and finished holding a
              smaller multiple than the screen showed before it started. This is why an order is bounded by
              how far it may move the price, not only by how much money there is.
            </>
          }
        />

        <P>
          It cuts the other way too. If the other side gets bought after you, your price falls and your prize
          grows. The number on the market page is always the <em>current</em> payout, never the one you
          locked in — because there is none to lock in.
        </P>

        <Note kind="tip" title="You can leave before the end">
          Selling is available for as long as the market is Open. You sell back down the same curve you bought
          up, so you will receive slightly less than the screen price, and the fee is charged in both
          directions. What you cannot do is sell after trading closes.
        </Note>
    </DocPage>
  );
}
