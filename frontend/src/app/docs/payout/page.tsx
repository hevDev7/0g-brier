import Link from "next/link";
import {dpm, quote} from "@0g-brier/protocol";
import {DocPage} from "@/components/docs/DocPage";
import {C, Correction, H3, Note, P, Worked} from "@/components/docs/DocsPrimitives";

export const metadata = {title: "The prize moves while you hold it"};

const WAD = 10n ** 18n;
const link = "text-accent underline decoration-accent/40";

/** A Galileo market, mid-session: [NO, YES] in wad. */
const Q: readonly [bigint, bigint] = [707106781186547524400n, 781013648110694833841n];

/**
 * The table below is COMPUTED, not transcribed.
 *
 * It runs the same `@0g-brier/protocol` functions the chain's Solidity is pinned to
 * by a 512-vector differential test, so the figures cannot drift from the market
 * they describe and no typo can survive between here and the mechanism. Numbers
 * copied into prose go stale silently; numbers derived from the thing they
 * describe cannot.
 */
function dilution() {
  return [10, 50, 100, 200, 400, 800].map((stake) => {
    const spend = BigInt(stake) * WAD;
    const shares = dpm.sharesForSpend(Q, 0, spend);
    const after: readonly [bigint, bigint] = [Q[0] + shares, Q[1]];
    const rate = quote.payoutPerShareWad(after, 0);
    const back = (shares * rate) / WAD;
    return {
      stake,
      shares: Number(shares) / 1e18,
      rate: Number(rate) / 1e18,
      back: Number(back) / 1e18,
      profit: Number(back - spend) / 1e18,
      perUnit: Number(back - spend) / Number(spend),
    };
  });
}

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
          This is visible in your own order. Below is a real purchase on Galileo, the old test chain: an
          agent bought into a market seeded at even odds, and its own order moved the price it was buying at.
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

        <H3>How fast it shrinks</H3>
        <P>
          The order above moved the payout by five hundredths. A larger one moves it much further, and the
          effect compounds against itself: bigger stake, more shares, but a thinner rate on every one of them —
          including the shares you already held.
        </P>
        <P>
          Below is that market, with the same buy at six sizes. Each row assumes NO wins and you redeem.
        </P>

        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-border bg-bg-sunken text-left">
                {["Stake", "Shares", "Payout rate", "You receive", "Profit", "Per unit staked"].map((h) => (
                  <th key={h} className="px-4 py-2.5 font-mono text-[12px] tracking-wider text-text-faint uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {dilution().map((r) => (
                <tr key={r.stake}>
                  <td className="px-4 py-2.5 font-mono tabular-nums text-text">{r.stake}</td>
                  <td className="px-4 py-2.5 font-mono tabular-nums text-text-muted">{r.shares.toFixed(2)}</td>
                  <td className="px-4 py-2.5 font-mono tabular-nums text-text-muted">{r.rate.toFixed(4)}×</td>
                  <td className="px-4 py-2.5 font-mono tabular-nums text-text-muted">{r.back.toFixed(2)}</td>
                  <td className="px-4 py-2.5 font-mono tabular-nums text-text-muted">{r.profit.toFixed(2)}</td>
                  <td className="px-4 py-2.5 font-mono font-medium tabular-nums text-text">{r.perUnit.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <P>
          Read the last column. <strong>Staking eighty times more returns twenty-three times the profit</strong>{" "}
          — the profit still rises with every extra unit, but what each unit earns collapses from{" "}
          <C>1.18</C> to <C>0.34</C>. Nothing about the question changed; only how much of the winning side you
          bought.
        </P>
        <P>
          That is the whole argument for sizing against the book rather than only against the bankroll. A
          bankroll formula does not know your order moves the price it was computed from —{" "}
          <Link href="/docs/deciding" className={link}>
            What your agent decides
          </Link>{" "}
          covers the bound that fixes it.
        </P>

        <Note kind="info" title="What the table leaves out">
          These are the raw curve, before the 1% fee charged on the way in and again on the way out — so the
          real figures are slightly worse than shown, uniformly. It also assumes nobody else trades between
          your order and settlement, which is the one assumption on this page that will certainly be wrong. If
          the other side is bought after you, your rate recovers; if your side is, it thins further.
        </Note>

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
