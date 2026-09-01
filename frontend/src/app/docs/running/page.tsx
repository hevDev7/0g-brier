import {DocPage} from "@/components/docs/DocPage";
import {C, Cmd, H3, Note, P, Run} from "@/components/docs/DocsPrimitives";
import {MethodGroup} from "@/components/docs/SdkReference";

export const metadata = {title: "Running it, end to end"};

export default function RunningPage() {
  return (
    <DocPage slug="running">
      <P>
        <a href="/docs/setup" className="text-accent underline decoration-accent/40 underline-offset-2">
          Setting it up
        </a>{" "}
        ends with a client that can read the book. This page is the other half: the same client given
        a key and a policy, carried through to a filled order and the position read back off the
        chain. It is where the whole <C>.env</C> is described, because every setting in it exists to
        bound something this page actually does. Every command below was run, and every transcript is
        what it printed.
      </P>

      <Note kind="warn" title="This spends real testnet collateral">
        Nothing here is a dry run. The transcripts show an agent buying into a live Galileo market
        and moving its probability, because a runbook whose last step is simulated is a runbook whose
        last step is untested.
      </Note>

      <H3>The configuration</H3>
      <P>
        Two kinds of setting live in one file: where the chain is, and how much the agent is willing
        to risk. Only the first line is a secret.
      </P>

      <Run cwd="my-agent">{`cp ../brier/packages/agent-kit/.env.example .env
chmod 600 .env`}</Run>

      <Cmd>{`AGENT_KEY=0x…                                             # the only secret here
CHAIN_ID=16602
RPC_URL=https://evmrpc-testnet.0g.ai
DEPLOYMENTS_DIR=../brier/deployments
ZG_INDEXER=https://indexer-storage-testnet-turbo.0g.ai
AGENT_NAME=Nostradamus

BANKROLL_FRACTION_CAP=0.25   # never stake more than a quarter, whatever Kelly says
MAX_IMPACT_BPS=500           # never move the probability more than 5 points
SLIPPAGE_BPS=100             # 1% over the quote
MIN_EDGE_BPS=200             # below 2 points of edge, the fee eats it
REVERSAL_EDGE_BPS=600        # 6 points AGAINST the position closes it`}</Cmd>

      <P>
        The first six say where the chain is and who the agent is. The five below them decide what it
        actually does, and they are the difference between a program that trades and one that empties
        itself into a single market.
      </P>

      <MethodGroup
        title="Connection"
        methods={[
          {sig: "AGENT_KEY", does: <><strong className="text-neg">Private key.</strong> Signs every trade. Give it a wallet of its own — a program trading on a loop is the wrong place for a key holding anything else. Shape-checked at startup, so a malformed one names itself rather than failing eight transactions in.</>},
          {sig: "ANTHROPIC_API_KEY", does: <><strong className="text-neg">Secret.</strong> Only if your agent forms its beliefs with Claude. Nothing in the SDK requires it.</>},
          {sig: "CHAIN_ID", does: <>16602 for Galileo, 31337 for a local anvil.</>},
          {sig: "RPC_URL", does: <>Defaults to the public Galileo endpoint below.</>},
          {sig: "DEPLOYMENTS_DIR", does: <>Path to the protocol repo&rsquo;s <C>deployments/</C>. Reading the manifest rather than pasting addresses is what keeps an agent pointed at the same contracts these pages are reading.</>},
          {sig: "ZG_INDEXER", does: <>0G Storage gateway, for fetching a market&rsquo;s question. Without it an agent cannot verify what it is trading on.</>},
          {sig: "AGENT_NAME", does: <>The handle to register. Permissionless, and refused only if taken.</>},
        ]}
      />

      <MethodGroup
        title="Policy"
        note={
          <>
            These are the reference agent&rsquo;s own values, not placeholders. Each is a refusal:
            a condition under which the agent declines to act, rather than a target it aims at.
          </>
        }
        methods={[
          {
            sig: "MIN_EDGE_BPS",
            does: (
              <>
                How far the agent&rsquo;s probability must be from the market&rsquo;s before it will
                trade at all. At <C>200</C>, two points. Below that the fee eats the edge, so the
                trade is a loss dressed as a position.
              </>
            ),
          },
          {
            sig: "BANKROLL_FRACTION_CAP",
            does: (
              <>
                A <strong>fraction</strong>, not basis points &mdash; <C>0.25</C> means a quarter of
                the bankroll, whatever Kelly computes. Kelly is optimal only if the probability is
                right, and a model&rsquo;s probability sometimes is not.
              </>
            ),
          },
          {
            sig: "MAX_IMPACT_BPS",
            does: (
              <>
                The most the order may move the implied probability. This is the cap that matters on
                a DPM and has no analogue on a fixed-payout venue: the order walks the price it is
                paying, so past some size the agent is buying its own edge away.
              </>
            ),
          },
          {
            sig: "SLIPPAGE_BPS",
            does: (
              <>
                How far above the quote the fill may land before the contract rejects it. <C>100</C>{" "}
                is one percent. Somebody else&rsquo;s order can land between the quote and the send.
              </>
            ),
          },
          {
            sig: "REVERSAL_EDGE_BPS",
            does: (
              <>
                The exit. At <C>600</C>, six points of edge <strong>against</strong> the position
                closes it. The agent below does not implement this &mdash;{" "}
                <a href="/docs/deciding" className="text-accent underline decoration-accent/40 underline-offset-2">
                  What your agent decides
                </a>{" "}
                is where the rule belongs, and on this book holding is a decision rather than a
                default.
              </>
            ),
          },
        ]}
      />

      <H3>Claiming an identity</H3>
      <P>
        The agent below prints <C>identity unregistered</C> until this is done, and trades anyway:
        on this deployment registration is for attribution rather than permission, which is what{" "}
        <C>requiresRegisteredTrader()</C> reports. A deployment may flip that, and an agent that
        checks it will learn so before an order is refused rather than after.
      </P>

      <Cmd>{`const me = await brier.myAgent();
if (me === null) {
  const id = await brier.registerAgent({name: "Pythia"});  // role defaults to "Trader"
  console.log(\`registered #\${id.agentId} as \${id.name}, operator \${id.operator}\`);
}`}</Cmd>

      <P>
        It mints an ERC-721 to the key that signs, which is also a <strong>0G Agentic ID</strong>:
        the registry implements ERC-7857, so a 7857-aware wallet can transfer, clone and authorise
        usage against the same token, and a persona document published to it is checked against 0G
        Storage&rsquo;s own Merkle root rather than taken on trust.{" "}
        <a href="/docs/agent" className="text-accent underline decoration-accent/40 underline-offset-2">
          Bringing an agent
        </a>{" "}
        goes through what that standard does and does not give you here.
      </P>

      <Note kind="info" title="What registration costs, and what it does not buy">
        A name nobody has taken, and the gas to write it. Nobody grants it and nobody can refuse it
        except by having got there first. The <C>operator</C> defaults to the signing key, so one key
        owns the identity and trades for it &mdash; splitting them is <C>setAgentOperator</C>, and
        worth doing only once a cold key is holding something worth protecting. Registration is not
        stake: a resolver bonds collateral separately, and only a resolver needs to.
      </Note>

      <H3>The agent</H3>
      <P>
        One file, a hundred lines, importing nothing but the three published packages. It reads a
        market, forms a belief, checks whether the belief is worth acting on, sizes the order twice
        over, prices it, approves the collateral and buys &mdash; then reads the result back off the
        chain rather than trusting what it just sent.
      </P>

      <Cmd>{`import {loadDeployment} from "@0g-brier/protocol/node";
import {WAD} from "@0g-brier/protocol";
import {BrierClient} from "@0g-brier/agent-kit";
import {ZgStore} from "@0g-brier/zg-storage";

const env = (k: string, fallback?: string) => {
  const v = process.env[k] ?? fallback;
  if (v === undefined) throw new Error(\`\${k} is not set\`);
  return v;
};

// ── policy ────────────────────────────────────────────────────────────────
const MIN_EDGE_BPS = BigInt(env("MIN_EDGE_BPS", "300"));
// A fraction, not basis points: 0.25 means never stake more than a quarter.
const BANKROLL_CAP_BPS = BigInt(Math.round(Number(env("BANKROLL_FRACTION_CAP", "0.25")) * 10_000));
const MAX_IMPACT_BPS = BigInt(env("MAX_IMPACT_BPS", "200"));
const SLIPPAGE_BPS = BigInt(env("SLIPPAGE_BPS", "100"));

const manifest = loadDeployment(Number(env("CHAIN_ID", "16602")), env("DEPLOYMENTS_DIR"));
const brier = new BrierClient({
  network: "galileo",
  privateKey: env("AGENT_KEY") as \`0x\${string}\`,
  factory: manifest.contracts.MarketFactory as \`0x\${string}\`,
  outcomeShares: manifest.contracts.OutcomeShares as \`0x\${string}\`,
});

const pct = (w: bigint) => \`\${(Number(w) / 1e16).toFixed(1)}%\`;
const usd = (t: bigint, d: number) => \`\${(Number(t) / 10 ** d).toFixed(2)}\`;

// ── 1. preflight ──────────────────────────────────────────────────────────
console.log(\`wallet     \${brier.address}\`);
const identity = await brier.myAgent();
console.log(\`identity   \${identity ? \`#\${identity.agentId} "\${identity.name}"\` : "unregistered"}\`);
console.log(\`gate       \${(await brier.requiresRegisteredTrader()) ? "registration required" : "open to anyone"}\`);

// ── 2. the market, and the question behind it ─────────────────────────────
const market = await brier.getMarket(env("MARKET") as \`0x\${string}\`);
const bank = await brier.getBalance(market.collateral);
console.log(\`bankroll   \${usd(bank, market.collateralDecimals)} \${market.collateralSymbol}\`);

const doc = (await new ZgStore(env("ZG_INDEXER")).get(market.specRoot)) as {question?: string} | null;
console.log(\`\\nmarket     \${market.address}  \${market.status}  \${market.category}\`);
console.log(\`question   \${doc?.question ?? "(spec unavailable)"}\`);
console.log(\`market says P(YES) \${pct(market.impliedProbabilityWad[1])}\`);

// ── 3. a belief, formed without looking at the price ───────────────────────
// Swap this for a model. \`ZgInference.connect(...)\` puts it on 0G Compute and
// makes the answer attestable; nothing below changes either way.
const belief = BigInt(Math.round(Number(env("BELIEF")) * 1e18));
console.log(\`agent says P(YES) \${pct(belief)}\`);

// ── 4. is there an edge, and on which side ────────────────────────────────
const side = belief > market.impliedProbabilityWad[1] ? 1 : 0;
const mine = side === 1 ? belief : WAD - belief;
const theirs = market.impliedProbabilityWad[side];
const edgeBps = ((mine - theirs) * 10_000n) / WAD;
console.log(\`\\nedge       \${edgeBps} bps on \${side === 1 ? "YES" : "NO"} (floor \${MIN_EDGE_BPS})\`);
if (edgeBps < MIN_EDGE_BPS) {
  console.log("no trade   edge below the floor");
  process.exit(0);
}

// ── 5. size it: bankroll cap first, then market impact ────────────────────
const budget = (bank * BANKROLL_CAP_BPS) / 10_000n;
const spend = await brier.sizeWithinImpact({
  market: market.address,
  outcome: side,
  budgetTokens: budget,
  maxImpactBps: MAX_IMPACT_BPS,
});
console.log(\`budget     \${usd(budget, market.collateralDecimals)} (\${env("BANKROLL_FRACTION_CAP", "0.25")} of bankroll)\`);
console.log(\`within cap \${usd(spend, market.collateralDecimals)} at \${MAX_IMPACT_BPS} bps of impact\`);
if (spend === 0n) {
  console.log("no trade   even the smallest size moves the price too far");
  process.exit(0);
}

// \`sizeWithinImpact\` answers in COLLATERAL. \`buyShares\` wants SHARES. Both are
// bigint and neither type says which, so the conversion has to be deliberate.
const {sharesOut: shares} = await brier.quoteBuySpend(market.address, side, spend);

// ── 6. price it before signing anything ───────────────────────────────────
const preview = await brier.previewBuy(market.address, side, shares);
console.log(\`size       \${(Number(shares) / 1e18).toFixed(2)} shares for \${usd(preview.tokensIn, market.collateralDecimals)}\`);
console.log(\`impact     P(\${side ? "YES" : "NO"}) \${pct(preview.impliedProbabilityBeforeWad)} -> \${pct(preview.impliedProbabilityAfterWad)}\`);
console.log(\`payout     \${(Number(preview.payoutPerShareAfterWad) / 1e18).toFixed(4)}x per winning share\`);

// ── 7. approve, but only when the allowance is short ──────────────────────
const maxIn = preview.tokensIn + (preview.tokensIn * SLIPPAGE_BPS) / 10_000n;
const approval = await brier.ensureAllowance(market.address, market.collateral, maxIn);
console.log(\`\\nallowance  \${approval ? \`approved in \${approval}\` : "already sufficient"}\`);

// ── 8. buy ────────────────────────────────────────────────────────────────
const fill = await brier.buyShares({market: market.address, outcome: side, sharesOut: shares, maxTokensIn: maxIn});
console.log(\`filled     \${usd(-fill.tokensDelta, market.collateralDecimals)} in tx \${fill.hash}\`);

// ── 9. the fill already read the chain back, so trust it over the quote ───
console.log(\`\\nposition   \${(Number(fill.sharesAfter) / 1e18).toFixed(2)} \${side ? "YES" : "NO"} shares\`);
console.log(\`bankroll   \${usd(await brier.getBalance(market.collateral), market.collateralDecimals)} left\`);
console.log(\`market now P(YES) \${pct(fill.impliedProbabilityAfterWad[1])}\`);`}</Cmd>

      <Note kind="warn" title="sizeWithinImpact answers in collateral; buyShares wants shares">
        The one conversion on this page that is easy to miss, and it is silent. Both are{" "}
        <C>bigint</C> and neither type says which unit it holds, so passing the budget straight into{" "}
        <C>buyShares</C> reads <C>54.09</C> mUSDC as <C>0.000000054</C> shares &mdash; a valid order
        for nothing, which then reverts on a <C>maxTokensIn</C> of 1. <C>quoteBuySpend</C> is the
        step between them. This page was written after making exactly that mistake.
      </Note>

      <H3>The first pass</H3>
      <P>
        Against a market that had just opened at even odds, with a belief of 62%: twelve points of
        edge, an order capped by impact to 54.09 mUSDC of a 125,011 budget, and 73.91 YES shares that
        moved the market from 50.0% to 55.0%.
      </P>

      <H3>The second pass</H3>
      <P>
        The same command again. What changed is the market, and it changed because of the first
        order: the agent is now trading against its own footprint. The edge has shrunk from 1200 bps
        to 704, and the position line counts both orders.
      </P>

      <Run cwd="my-agent">{`$ npx tsx agent.ts

wallet     0x93Aa10d8F3B35A86E9D6722917E8DF75F8E1e161
identity   #1 "Nostradamus"
gate       open to anyone
bankroll   499991.51 mUSDC

market     0x72f6C938965656E1A5de5b1979488B9aE1bA6f00  Open  crypto
question   Will this end-to-end market be settled with outcome YES?
market says P(YES) 55.0%
agent says P(YES) 62.0%

edge       704 bps on YES (floor 200)
budget     124997.88 (0.25 of bankroll)
within cap 63.84 at 500 bps of impact
size       83.37 shares for 63.84
impact     P(YES) 55.0% -> 59.9%
payout     1.2920x per winning share

allowance  approved in 0x3e170eefb7c5ae25eba5228a21a01246576293c3a28f3f09465283ef80ea1e75
filled     63.84 in tx 0x57f366479c5bad0bf275fcc5265036811d19dad1e86b256ac905c77283bea9b2

position   157.28 YES shares
bankroll   499927.67 left
market now P(YES) 59.9%`}</Run>

      <P>
        Read the two sizing lines together, because they are the whole argument for the impact cap.
        The bankroll cap allowed 124,997.88 mUSDC. The impact cap allowed 63.84 &mdash; three orders
        of magnitude less. A Kelly-sized order here would have walked the probability to certainty
        and collapsed the payout to 1.0×, destroying the edge it was computed from.
      </P>

      <H3>When it declines</H3>
      <P>
        A third pass, with the market at 59.9% and a belief of 60%. Nine basis points of edge against
        a floor of two hundred. Declining is the common case for a working agent, and an agent that
        never prints this line is one whose floor is too low.
      </P>

      <Run cwd="my-agent">{`$ npx tsx agent.ts

wallet     0x93Aa10d8F3B35A86E9D6722917E8DF75F8E1e161
identity   #1 "Nostradamus"
gate       open to anyone
bankroll   499927.67 mUSDC

market     0x72f6C938965656E1A5de5b1979488B9aE1bA6f00  Open  crypto
question   Will this end-to-end market be settled with outcome YES?
market says P(YES) 59.9%
agent says P(YES) 60.0%

edge       9 bps on YES (floor 200)
no trade   edge below the floor`}</Run>

      <H3>Running it on a loop</H3>
      <P>
        Three passes by hand is the shape of the loop. Making it one is a scheduler and a market
        list, not new protocol: <C>listMarkets()</C> gives every market the factory has minted, and{" "}
        <C>status</C> says which are still tradable.
      </P>

      <Cmd>{`for (const m of await brier.listMarkets()) {
  if (m.status !== "Open") continue;         // closed, settled, or waiting on a resolver
  if (m.tradingEnd * 1000 < Date.now()) continue;  // Open, but past its last tradable second
  await considerOne(m);                      // everything from step 2 onward
}`}</Cmd>

      <Note kind="info" title="Open is a status, not a promise that trading is live">
        <C>close()</C> is permissionless and nothing obliges anybody to call it, so a market can sit
        at <C>Open</C> for hours after its window has ended. An agent that trusts the enum without
        checking <C>tradingEnd</C> will send orders that revert.
      </Note>

      <H3>Collecting</H3>
      <P>
        Nothing arrives on its own for a trader. Settlement snapshots the rate and transfers nothing;
        the winner calls for it. The contract burns the <strong>sender&rsquo;s</strong> shares and pays
        a <C>to</C> of its choosing, so the key holding the position must send the transaction even
        though the proceeds need not return to it. The SDK always passes the agent&rsquo;s own
        address: through <C>brier.redeem</C> the money comes back to the wallet that traded, and
        paying somewhere else means calling the market directly.
      </P>

      <Cmd>{`const tokens = await brier.redeem(market.address);   // settled: pays 1/p per winning share
const back = await brier.liquidate(market.address);   // failed or voided: pays p per share, both sides`}</Cmd>

      <Note kind="warn" title="Redemption expires">
        Collateral nobody claimed can be swept to the treasury <C>SWEEP_UNCLAIMED_AFTER</C> seconds
        after settlement &mdash; <C>31536000</C> on this deployment, a full year. After the sweep the
        shares are worth nothing and there is no appeal: the money is gone because it was never
        asked for. An agent that trades and never redeems is an agent slowly donating.
      </Note>

      <H3>Who else gets paid</H3>
      <P>
        A trader&rsquo;s winnings are one of several claims on a settled market, and they are the only
        one that has to be asked for. The fee is 1% of what enters the pool, and settlement splits it
        three ways before anybody redeems anything.
      </P>

      <MethodGroup
        title="Every payment a settlement makes"
        note={
          <>
            Two of these are <strong>pushed</strong> as the market settles and need no call at all;
            the rest wait to be collected. The percentages are the deployment&rsquo;s current values,
            read from the ConfigRegistry rather than assumed.
          </>
        }
        methods={[
          {
            sig: "the winning holder",
            does: (
              <>
                <C>redeem</C>. Pull-based, and the only claim in this table an agent must remember to
                make. Pays <C>1/p</C> per winning share at the rate snapshotted when the market
                settled, not the rate now.
              </>
            ),
          },
          {
            sig: "any holder of a failed market",
            does: (
              <>
                <C>liquidate</C>. Both sides are paid <C>p</C> per share, which is what the position
                was worth when the market gave up. Also pull-based, and under the same sweep deadline.
              </>
            ),
          },
          {
            sig: "the market creator",
            does: (
              <>
                40% of the fee, transferred at settlement without being asked for. The seed is
                separate: it was a position on both sides, so the creator redeems or liquidates it
                like any other holder.
              </>
            ),
          },
          {
            sig: "each resolver who agreed",
            does: (
              <>
                30% of the fee plus the settlement deposit &mdash; at least 20 whole units of the
                market&rsquo;s collateral &mdash; split
                evenly among the committee members whose reveal matched the outcome, and claimed
                with <C>claim(agentId, to)</C> on the ResolutionModule. Pull-based, like redemption.
                A resolver who no-showed or dissented earns nothing: both have just been slashed,
                and paying them for the same act would cancel the penalty.
              </>
            ),
          },
          {
            sig: "a resolver's own stake",
            does: (
              <>
                Not a reward: it was always theirs unless slashed. Recovering it is two calls on the
                AgentRegistry, <C>requestUnstake</C> then <C>withdrawUnstaked</C>, with a{" "}
                <C>604800</C>-second cooldown between them. The SDK has no method for either; a
                resolver sends them as plain contract calls.
              </>
            ),
          },
          {
            sig: "the treasury",
            does: <>The remaining 30% of the fee, any slashed deposit, and anything swept unclaimed.</>,
          },
        ]}
      />

      <Note kind="info" title="Earnings are per agent, not per market">
        A resolver judging fifty markets accrues one balance, not fifty, and takes it in one
        transaction. <C>claim</C> binds the agent&rsquo;s <strong>owner</strong> rather than its
        operator: the operator key votes from a machine running unattended, and one stolen from
        there must not also be able to withdraw. Anything the ledger does not owe &mdash; the
        remainder of an uneven split, the deposit of a market nobody judged &mdash; is reachable
        only by governance, and only above the amount resolvers are owed.
      </Note>

      <P>
        <a href="/docs/risks" className="text-accent underline decoration-accent/40 underline-offset-2">
          What can go wrong
        </a>{" "}
        covers the rest of the ways a position ends badly, and{" "}
        <a href="/docs/parameters" className="text-accent underline decoration-accent/40 underline-offset-2">
          The numbers that govern it
        </a>{" "}
        holds the bounds every percentage here may be changed within.
      </P>

    </DocPage>
  );
}
