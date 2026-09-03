# @0g-brier/example-agent

A trading agent for [Brier](../README.md) with the opinion left out. Everything
here except one file is plumbing that already works — it resolves a network
without guessing, reads the book and each market's question off 0G Storage,
sizes an order against both the bankroll and the depth, checks that the edge
survives the order's own market impact, signs, and claims what settles. The
opinion lives in `src/strategy.ts` and ships refusing to form one, so an
unmodified run reports the whole book and buys nothing. **Take it by copying the
directory out** — `cp -r example-agent ~/my-agent`, `npm install`, fill `.env`,
edit that one file. It is not a script inside the SDK; it is a project you own.

```
src/config.ts     env → config → client, refusing to guess anywhere a guess costs money
src/strategy.ts   ← THE SEAM. Your rules. The only file you have to change.
src/agent.ts      the loop: scan → believe → edge → size → trade
src/redeem.ts     claim after settlement — redeem a winner, liquidate a failure
```

---

## Quickstart

A first run cannot spend anything, and not because it is careful. `--dry` builds
the SDK's **keyless** client: `BrierClient` is constructed with no `privateKey`
at all, so there is no signer for a write to reach and every write throws by
name. Nothing is signed because nothing can be.

From inside this repository:

```bash
npm install
cd example-agent
CHAIN_ID=16661 DRY_BUDGET=1 npm run dry
```

That reads every Open market on 0G mainnet, prints the book, the question, the
size it would take and the quote it would sign, and stops. `DRY_BUDGET` is
required because a keyless client has no wallet and therefore no balance to size
against; it is the amount you want the run to *reason* about, in the market's
own collateral units, and it is reported as `DRY_BUDGET, not a balance`
everywhere it appears.

Then give it a key and let it trade:

```bash
cp .env.example .env && chmod 600 .env   # put AGENT_KEY in the file, not on a command line
set -a; . ./.env; set +a
npm run agent
```

| command | what it does |
|---|---|
| `npm run dry` | one full pass, keyless, signs nothing |
| `npm run agent` | the same pass with `AGENT_KEY` loaded |
| `npm run redeem` | claim settled markets; `npm run redeem -- --dry` lists what is claimable |
| `npm run typecheck` | `tsc --noEmit` under the same options the SDK compiles with |
| `npm test` | `vitest run` |

Copied out of this repository there is no `deployments/` directory to read, so
set `FACTORY` and `OUTCOME_SHARES` — the live mainnet pair is in `.env.example`.
Inside it, `make demo` deploys the whole stack to a local anvil and writes
`deployments/31337.json`, which `CHAIN_ID=31337` then reads; note that anvil has
no 0G Storage network, so every market's question reads as unavailable there and
the shipped strategy abstains on all of them rather than pretending it knows
what is being asked.

A deployment can also require that orders come from an address the AgentRegistry
knows. The loop asks `client.requiresRegisteredTrader()` up front and stops with
an explanation rather than discovering it from a revert — registration is
permissionless, and what it costs is a name nobody else has taken
(`client.registerAgent({name: "your-agent"})`).

---

## Where your rules go

`src/strategy.ts`, and nowhere else. The seam takes no model with it: there is
no 0G Compute import, no LLM SDK, no HTTP client. Whatever forms your belief —
a hosted model, a TEE-attested one on 0G Compute, a scraper, a spreadsheet, a
person — lives behind this signature and the rest of the project never learns
which.

```ts
export interface Belief {
  /** The agent's OWN probability that the outcome resolves YES, wad (1e18 = 100%). */
  impliedProbabilityWad: bigint;
  /** Why. Printed in the report; a position nobody can review later is not reviewable. */
  rationale: string;
}

export interface StrategyContext {
  spec: MarketSpec | null;                     // the question off 0G Storage; null = not readable
  position: readonly [bigint, bigint] | null;  // [NO, YES] wad shares; null in a dry run
  spendableTokens: bigint;                     // in the MARKET's collateral decimals, not always 18
  spendableSource: "wallet" | "config";        // measured, or stated for a dry run
  now: number;                                 // unix seconds, one instant for the whole pass
  dryRun: boolean;                             // forming a belief usually costs money
}

export type Strategy = (market: MarketView, ctx: StrategyContext) => Promise<Belief | null>;
```

**`null` means no opinion, and the loop honours it exactly**: it moves on
without trading, without warning, and without counting it as a failure.
Abstaining is a correct answer here rather than a missing one, and most markets
most of the time should get it. The shipped `strategy` returns nothing else —
it runs four real preconditions (no readable spec, no declared sources,
`tradingEnd` already passed, no budget) and then stops where your model goes.
That is deliberate: a placeholder that traded would look like a working agent
while taking real positions on a signal nobody designed, and the first thing
anyone learned from this project would be a bug.

A replacement is the whole body, not a fragment:

```ts
// src/strategy.ts — everything above is unchanged; this replaces `export const strategy`.
import {askMyModel} from "./my-model.js";   // your file, whatever it wraps

export const strategy: Strategy = async (market, ctx) => {
  // Keep these four. They are the checks that make a market unfit to have an
  // opinion about at all, and they are the same whatever your model is.
  if (ctx.spec === null) return null;               // we were never told what it asks
  if (ctx.spec.sources.length === 0) return null;   // nothing the committee will look at
  if (market.tradingEnd - ctx.now <= 0) return null; // Open is not the same as tradable
  if (ctx.spendableTokens <= 0n) return null;       // nothing to act on, so do not pay to think

  const answer = await askMyModel({
    question: ctx.spec.question,
    rules: ctx.spec.rules,            // read them: a question and its rules often disagree in spirit
    sources: ctx.spec.sources,        // the same shape `gatherEvidence` takes
    secondsLeft: market.tradingEnd - ctx.now,
    cheaply: ctx.dryRun,              // a dry run that still buys inference is a surprise
  });

  // No answer is not 50%. A belief defaulted to a half is a position against
  // whatever the book currently says, and it gets sized and signed like any other.
  if (answer === null) return null;

  // A PROBABILITY, not a price — see the next section. `beliefFromProbability`
  // throws rather than clamping, for the same reason `null` is a real answer.
  return beliefFromProbability(answer.probability, answer.why);
};
```

`beliefFromProbability(0.7, "…")` is already exported from that file and rounds
to 1e-6; it throws on a non-finite value, on anything outside `0…1`, and on a
blank rationale.

---

## The three things that will bite you

These are the three arithmetic mistakes this repository has actually paid for.
An agent ported from an LMSR venue makes all three, keeps running, and bleeds.

### 1 · The probability is `pᵢ²`, not `pᵢ`

Brier is a Dynamic Pari-mutuel Market (Pennock), where `Σpᵢ² = WAD`. The
marginal price and the implied probability are two different numbers, and the
SDK names them apart — `marginalPriceWad` and `impliedProbabilityWad` — so that
reading one for the other has to be typed out on purpose.

At a fresh 50/50 book the price reads **0.7071** where the probability reads
**0.5000**. The repair an LMSR reader reaches for — normalising the two prices
so they sum to one — does not close it either: at `q = [1000, 1200]` the
normalised price is 54.55% against a true `P(YES)` of **59.02%**, still 4.5
points out, which is larger than most real edges.

**Compare your belief against `market.impliedProbabilityWad[outcome]`.** That is
what `src/agent.ts` does, on both sides — a belief of 70% YES is equally a
belief of 30% NO, and the cheap side is not always YES. It is also what the
Kelly fraction takes: `f* = (P̂ − P)/(1 − P)`, where the shape matches the LMSR
form and the variable does not, because net odds here are
`(1/p)/p − 1 = (1−P)/P`.

### 2 · The payout is `1/pᵢ`, not `1/Pᵢ`

A winning share is paid out of the pool at one over the **price**. At
`P = 59%` that is **1.30×**; `1/P` would claim **1.69×**, which is 30% more than
the pool holds. At `P = 10%` it is 3.16× against `1/P`'s 10.0×. Both are
plausible-looking multiples, which is why this shipped in the spec once and had
to be corrected.

**Never compute a payout.** Read `Preview.payoutPerShareAfterWad` from
`previewBuy`. There must be no `1/probability` anywhere, in this example or in
what you write next to it.

### 3 · The payout floats — and this is the one that costs money quietly

Under LMSR a winning share pays exactly 1, fixed at purchase. Under a DPM it
pays `1/pᵢ` and the prize is diluted by every later buyer on your side —
**including your own order, while it is filling**. An LMSR-trained agent has no
concept of this. There is no field it fails to read and no error it raises: it
computes an edge against the pre-trade payout, the edge is real, the trade is
smaller than it looks, and it loses the difference on every order in the same
direction.

Concretely, at `q = [1000, 1000]`, buying 300 YES shares moves `P(YES)` from
50.00% to **62.83%** and the payout from 1.4142× to **1.2616×**. Value that
position at the payout that was on screen when you decided to buy it and you
overstate what it can pay by **12.1%**.

So the edge is checked *after* the order, not before it. `src/agent.ts` exports
`survivesItsOwnImpact` — the piece most worth lifting into your own agent — and
it refuses the trade on two independent grounds:

- the order must not walk the book **past the agent's own belief**
  (`preview.impliedProbabilityAfterWad > beliefWad`), because the last shares in
  such an order are ones the agent's own model prices as too expensive: the tail
  of the order is a bet against the head;
- expected value must still exceed cost, computed as
  `sharesOut × payoutPerShareAfterWad × P̂` against `preview.tokensIn` — gross,
  with the fee already inside it, which is why the default floor is break-even
  rather than a number somebody picked.

Sizing is `client.sizeWithinImpact({…, maxImpactBps})` — the SDK's own inversion
of the curve — and never a formula invented locally. The impact ceiling handed
to it is the *smaller* of `MAX_IMPACT_BPS` and the edge itself: derived, not
chosen, for the same reason as the first check above.

There are no other magic numbers in this project. Every remaining bound is read
from the chain, taken from configuration, or derived in closed form with a
comment saying where it came from.

---

## Configuration

`.env` is not read automatically — load it however you already load secrets
(`set -a; . ./.env; set +a`). Keeping the key in a file rather than on a command
line is the point: an `export AGENT_KEY=0x…` typed at a prompt lands in shell
history, and in an agent-driven session it lands in a transcript too. The key is
read once inside `connect()` and handed straight to the SDK; it is deliberately
**not a field of `AgentConfig`**, because a config object is the thing people
print when a run misbehaves.

| variable | required | default | what it does |
|---|---|---|---|
| `CHAIN_ID` | **yes** | *none, ever* | 16661 mainnet · 16602 Galileo · 31337 local anvil |
| `AGENT_KEY` | yes, unless dry | — | the **agent's own** key. `0x` + 64 hex; never printed, not even in its own parse error |
| `DRY_RUN` | — | off | `1` or `true`. `npm run dry` sets it via `--dry` |
| `DRY_BUDGET` | yes for a dry `agent` run; never for `redeem` | — | what the keyless run sizes orders against, in collateral units, e.g. `1.5`. A claim is whatever the chain already owes, so `redeem --dry` needs no budget. |
| `RPC_URL` | no | derived from `CHAIN_ID` | set it and it is checked against the chain id the endpoint reports |
| `FACTORY`, `OUTCOME_SHARES` | only outside this repo | `deployments/<CHAIN_ID>.json` | both or neither; half an override is one deployment mixed with another |
| `DEPLOYMENTS_DIR` | no | this repo's `deployments/` | where to look for `<CHAIN_ID>.json` |
| `MARKET` | no | every Open market | consider one address only; also narrows `npm run redeem` |
| `MAX_IMPACT_BPS` | no | `500` | never move `P` further than this in one order — 5 percentage points |
| `MIN_EDGE_BPS` | no | `0` | the return the trade must still show after its own impact and fee |
| `SLIPPAGE_BPS` | no | `100` | headroom over the chain's quote, used as the `maxTokensIn` bound |
| `BANKROLL_CAP_BPS` | no | `2500` | ceiling on Kelly as a fraction of free collateral |
| `ZG_INDEXER` | no | derived | 0G Storage indexer. The two storage networks share no data |

**Nothing here guesses a network.** Commit `f443fd8` in this repository deleted a
`?? "galileo"` from the inference client because it put a mainnet agent's
inference on a superseded testnet and *nothing threw* — both halves succeed on
their own, and the two provider catalogues are disjoint. `modeForChainId` in
`@0g-brier/protocol` had already taken the same position for chain ids, where the
guess it replaced was localhost, "which looks like an empty protocol rather than
a misconfiguration". So: `CHAIN_ID` has no default; the RPC is *derived* from it
unless you supply one, so the two cannot disagree by construction; a supplied one
is checked against `eth_chainId` before anything is signed; and when a
`deployments/` manifest and the environment name different contracts, the run
**refuses** rather than choosing — one of the two is a superseded deployment, and
quoting one while signing against the other is not an error either would report.

### Collateral, on mainnet

Mainnet settles in W0G, wrapped native 0G. Native 0G is not an ERC-20 — it has
no `transferFrom`, so no market can hold it — and a funded wallet therefore owns
nothing a market will accept until it wraps:

```ts
await client.wrapNative(market.collateral, parseEther("10"));
```

Wrapping is not approving. The loop calls `client.ensureAllowance` before each
order, which is a no-op when there is already enough.

### Claiming

`npm run redeem` is the other half of a trading agent and the half people forget
to write. A market ends three ways and only one has a winner: `Settled` pays the
winning side through `redeem`, while `Failed` and `Voided` pay **both** sides at
their own marginal price through `liquidate` — a different function and a
different arithmetic, and what makes an unanswerable question survivable rather
than a total loss. `planFor` in `src/redeem.ts` is an exhaustive switch with no
`default`, so a new `MarketStatus` breaks the build instead of silently becoming
an exit path nobody noticed had gone missing.

One number to watch there: `Claim.sharesBefore` counts **tradable plus seed**.
Seed shares are held by the Market rather than by OutcomeShares, so
`getPosition` cannot see them while `redeem` pays for them anyway. Dividing the
proceeds by the tradable balance alone once printed an implied rate of 21.01×
for a market whose real rate was 1.3689×.

---

## What this example does not do

- **It does not forecast.** The shipped strategy abstains on every market by
  design. Until you write `src/strategy.ts`, this is a very thorough way of
  looking at a book.
- **It is not a resolver.** Deciding how a market settles is the staked
  committee's job — commit–reveal voting, evidence gathered from the market's
  declared sources, optionally attested inference on 0G Compute. That is a
  different program with different failure modes; see
  `packages/agent-kit/examples/resolve.ts` and `committee-tick.ts`.
- **It holds one key, its own.** The agent signs its own trades and holds its
  own collateral. Fund it with what you are willing to have it lose. Nothing
  here is built to act for somebody else's wallet.
- **It cannot be driven from the web UI, and neither can anything else.** The
  human interface is a read-only observation desk: `DataSource` has no method
  that writes to the chain and the frontend holds no signer. Every buy, sell,
  redeem and liquidate on Brier goes through the SDK. A test enforces it.
- **It has not been run against mainnet.** The arithmetic here was checked
  offline against the DPM library; no order from this directory has ever been
  signed. The first live one is yours. Start with `npm run dry`, read what it
  says it would do, and only then give it a key.

The contracts are unaudited and the deployer still holds them. Read
[What is not true yet](../README.md#what-is-not-true-yet) before funding
anything.

MIT.
