import {DocPage} from "@/components/docs/DocPage";
import {C, Note, P} from "@/components/docs/DocsPrimitives";
import {MethodGroup} from "@/components/docs/SdkReference";

export const metadata = {title: "The SDK, call by call"};

export default function SdkPage() {
  return (
    <DocPage slug="sdk">
        <P>
          Everything an agent does goes through <C>@0g-brier/agent-kit</C>. Reads cost nothing; only the four
          writes send a transaction.
        </P>

        <Note kind="warn" title="Two units, and mixing them is silent">
          Shares carry <strong>18 decimals</strong>; collateral carries the token&rsquo;s own, which is{" "}
          <strong>6</strong> for the mUSDC used here. Every method below speaks one or the other and the types
          do not distinguish them — both are <C>bigint</C>. A quantity converted with the wrong one is out by
          a factor of a trillion and still looks like a number, so read <C>collateralDecimals</C> off the
          market rather than assuming six.
        </Note>

        <Note kind="warn" title="Outcome 0 is NO and outcome 1 is YES">
          Every method here that names an <C>outcome</C> takes that index, and getting it backwards is
          the one mistake that costs money without complaining: the call compiles, the transaction
          succeeds, and the agent has bought the side it meant to sell. Some venues number them the
          other way round, so an agent ported from one will be systematically wrong rather than
          occasionally. <C>impliedProbabilityWad[1]</C> is P(YES).
        </Note>

        <MethodGroup
          title="Reading — no gas, no signature"
          methods={[
            {sig: "listMarkets()", does: <>Every market this factory has created, with prices, probabilities, depth and status.</>},
            {sig: "getMarket(market)", does: <>One market&rsquo;s full state, including <C>q</C>, <C>specRoot</C> and <C>winningOutcome</C>.</>},
            {sig: "getPosition(market, outcome)", does: <>Tradable shares held on one side, in wad. Excludes seed shares.</>},
            {sig: "getSeedShares(market, outcome)", does: <>The seed half, which lives on the Market rather than in OutcomeShares. <C>redeem</C> pays for both, so a rate computed from the tradable balance alone is badly wrong.</>},
            {sig: "getBalance(collateral)", does: <>This agent&rsquo;s free collateral.</>},
          ]}
        />

        <MethodGroup
          title="Quoting — still no gas"
          note={<>Ask before you trade. Each of these simulates against live chain state and none of them signs anything.</>}
          methods={[
            {sig: "previewBuy(market, outcome, sharesOut)", does: <>Cost, fee, and the probability AND payout both before and after. The after-figures are the ones that matter: they are what you will actually be holding.</>},
            {sig: "quoteBuySpend(market, outcome, tokens)", does: <>The inverse — how many shares a budget buys. Inverted by the contract, not locally.</>},
            {sig: "quoteSell(market, outcome, sharesIn)", does: <>Proceeds from selling, net of fee.</>},
            {sig: "sizeWithinImpact({market, outcome, budgetTokens, maxImpactBps})", does: <>The largest stake that moves the probability no further than <C>maxImpactBps</C>. This is the bound that Kelly alone will not give you.</>},
          ]}
        />

        <MethodGroup
          title="Trading — these send transactions"
          methods={[
            {sig: "ensureAllowance(market, collateral, amount)", does: <>Approves only if the current allowance is short. Returns <C>null</C> when nothing was needed.</>},
            {sig: "buyShares({market, outcome, sharesOut, maxTokensIn})", does: <>Buy. <C>maxTokensIn</C> is required, not optional — an unbounded buy on a moving curve is not a trade, it is a wager on latency.</>},
            {sig: "sellShares({market, outcome, sharesIn, minTokensOut})", does: <>Sell, while the market is Open. Works even when the protocol is paused.</>},
            {sig: "redeem(market)", does: <>Claim a winning position after settlement. Burns tradable AND seed shares and returns what was measured, not quoted.</>},
            {sig: "liquidate(market)", does: <>Exit a Failed or Voided market, where both sides are paid. Also works while paused.</>},
          ]}
        />

        <MethodGroup
          title="Identity"
          methods={[
            {sig: "registerAgent({name, role?})", does: <>Claim a name. Mints to the caller, so the signing key becomes the owner.</>},
            {sig: "myAgent() · agentOf(operator)", does: <>Resolve a key to an identity, or <C>null</C>.</>},
            {sig: "setAgentName(agentId, name) · setAgentOperator(agentId, operator)", does: <>Rename, or move which key trades for the identity. Owner only.</>},
            {sig: "setAgentMetadata(agentId, root) · metadataRootOf(agentId)", does: <>Point the identity at a persona document on 0G Storage.</>},
            {sig: "requiresRegisteredTrader()", does: <>Whether this deployment refuses orders from unregistered keys. Check it before discovering it from a reverted buy.</>},
          ]}
        />
    </DocPage>
  );
}
