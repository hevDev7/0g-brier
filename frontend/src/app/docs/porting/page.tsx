import Link from "next/link";
import {DocPage} from "@/components/docs/DocPage";
import {C, H3, Note, P} from "@/components/docs/DocsPrimitives";
import {PortingTable} from "@/components/docs/SdkReference";

export const metadata = {title: "Coming from Gensyn's Delphi"};

export default function PortingPage() {
  return (
    <DocPage slug="porting">
        <P>
          The SDK surface was deliberately shaped to be familiar to anyone who has written a Delphi agent, so
          most calls map across. The differences are small in code and large in consequence.
        </P>

        <PortingTable
          rows={[
            {from: "quoteBuy", to: "previewBuy", trap: <>Also returns the payout before and after the order, which the Delphi SDK does not report at all — and here it changes with every trade, including yours.</>},
            {from: "quoteSell", to: "quoteSell", trap: "Same shape."},
            {from: "buyShares", to: "buyShares", trap: <><C>outcomeIdx</C> becomes <C>outcome</C>, and the index convention is REVERSED — see below.</>},
            {from: "sellShares", to: "sellShares", trap: "Same shape."},
            {from: "redeemMarket", to: "redeem", trap: <>Pays <C>1 ÷ price</C> per share. If you came from the LMSR competition, that is where the fixed payout of 1 goes.</>},
            {from: "liquidate(idxs)", to: "liquidate(market)", trap: <>No index list: both sides are collected, so nothing can be left locked by omission.</>},
            {from: "ensureTokenApproval", to: "ensureAllowance", trap: "Same idea."},
            {from: "listPositions", to: "getPosition + getSeedShares", trap: <>Two calls, because seed shares are held elsewhere and are easy to miss.</>},
            {from: "spotImpliedProbability", to: "market.impliedProbabilityWad", trap: <>Already on the market view; no extra call.</>},
            {from: "spotPrice", to: "market.marginalPriceWad", trap: <>Never a probability. See <Link href="/docs/probability" className="text-accent underline decoration-accent/40">Price is not probability</Link>.</>},
          ]}
        />

        <Note kind="warn" title="The outcome index is reversed">
          Gensyn&rsquo;s SDK types document <C>0 = YES, 1 = NO</C>. Here it is <C>0 = NO, 1 = YES</C>. There is
          no mathematics behind either choice, which is exactly what makes it dangerous: a ported agent
          compiles, runs, and buys the wrong side of every market with complete confidence.
        </Note>

        <H3>Three assumptions that do not survive the port</H3>
        <P>
          <strong>Price is not probability.</strong> Delphi&rsquo;s SDK exposes <C>spotPrice</C> and{" "}
          <C>spotImpliedProbability</C> as two separate calls, which is the right shape — but code that
          treats them as interchangeable, or that falls back from one to the other when a field is missing,
          will be wrong here by up to five points and never say so.
        </P>
        <P>
          <strong>Kelly takes probability, not price.</strong> The formula is the same; the variable is not.
          Feeding a marginal price into it over-sizes systematically — about a third too much at ordinary skew.
        </P>
        <P>
          <strong>Hold-to-settlement is not free.</strong> Delphi agents commonly hold until the thesis breaks,
          and say so in their own comments: under LMSR a correct share pays 1.0. Here the payout floats, so a
          position decays as your own side is bought, and an exit rule blind to that will watch a good position
          erode without ever triggering.
        </P>
    </DocPage>
  );
}
