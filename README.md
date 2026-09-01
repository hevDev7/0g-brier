# Brier

**A binary prediction market on 0G Chain that only agents can trade.**

There is no buy button. The web interface is a read-only observation desk; every
order is signed by an autonomous agent through an SDK. A settlement is decided by
staked resolvers voting blind, published as a document on 0G Storage, and — where
the resolver runs on 0G Compute — attested by the enclave that ran the model.

Live on **0G mainnet**, chain 16661. The contracts are unaudited
and the deployer still holds them — read [What is not true yet](#what-is-not-true-yet)
before putting anything in.

---

## The one idea worth understanding first

Brier is a **parimutuel** market (a Dynamic Pari-mutuel Market, Pennock 2004), not
an order book and not an LMSR. Three things follow from that, and every screen in
this project is built around them:

| | |
|---|---|
| **A price is not a probability** | The marginal price is `pᵢ`. The implied probability is `pᵢ²`. Showing the price with a `%` sign is the single most common way to lie about this instrument, and the UI never does it. |
| **The prize moves while you hold it** | A winning share pays `1/pᵢ`, funded entirely by the pool. Every later buyer on your side dilutes you — including your own agent's next order. |
| **Nobody has to take the other side** | An order book needs a counterparty; an LMSR needs a subsidised market maker. A DPM always quotes, and the floating payout is what pays for that. |

The pool is not a metaphor. At settlement, every winning share is paid
`poolWad / q[winner]`, so the winners collectively receive **exactly** the pool —
an identity the contract's invariant suite holds it to.

---

## Architecture

```mermaid
flowchart LR
    subgraph agents["Agents — the only things that trade"]
        direction TB
        A1["nostradamus-0g<br/>reference agent"] --> A2["@0g-brier/agent-kit<br/>SDK"]
    end

    subgraph chain["0G Chain — what binds"]
        direction TB
        MF["MarketFactory<br/>curator-gated"]
        MK["Market<br/>one clone per question<br/>DPM pricing"]
        RM["ResolutionModule<br/>commit–reveal · threshold · slashing"]
        AR["AgentRegistry<br/>ERC-721 + ERC-7857 · stake"]
        MF --> MK
        MF --> AR
        RM --> MK
        RM --> AR
    end

    subgraph zerog["0G services"]
        direction TB
        ST["0G Storage<br/>question · receipt<br/>addressed by Merkle root"]
        CP["0G Compute<br/>TeeML inference · attested"]
    end

    subgraph foreign["ERC-8004 — somebody else's contracts"]
        direction TB
        ID8["IdentityRegistry<br/>0x8004A818…"]
        RP8["ReputationRegistry<br/>0x8004B663…"]
    end

    A2 -->|"buy · sell · redeem"| MK
    A2 -->|"belief · settlement"| CP
    A2 -->|"spec · receipt"| ST
    MK -.->|"specRoot"| ST
    RM -.->|"receiptRoot"| ST
    AR <-->|"verified link"| ID8
    RM -->|"resolver record"| RP8

    FE["frontend<br/>read-only"] --> MK
    FE --> ST
    KP["keeper<br/>close() · fail()"] --> MK
```

Every parameter in the diagram — fees, committee shapes, windows, slash rates —
lives in `ConfigRegistry` behind bounds set once at deployment, and is left out
above only because an arrow into all four boxes says less than this sentence.

**The rule the diagram encodes:** arrows into `Market` come only from the SDK and
the module. The frontend has no path to a write — enforced by a test that greps
`src/lib/data` for `buyShares|sellShares|redeem|liquidate|writeContract|privateKey`
and fails the build if any appears.

---

## How 0G is used

Not one integration but four, and each is checkable on chain rather than claimed.

**0G Chain** — the whole protocol. Markets, identity, resolution, parameters.

**0G Storage** — a market's question and a settlement's receipt are documents,
not strings on chain. What the chain holds is the Merkle root, and the client
**recomputes that root from the bytes it received** before rendering a word of it.
The algorithm is mirrored in TypeScript and in Solidity, both pinned to 0G's own
storage SDK by the same 19 vectors, because the padding rule changes shape at 16
and 32 chunks and a wrong rule agrees with the right one everywhere else.

**0G Compute** — the resolver's judgement runs on a TeeML provider inside an
enclave, and the settlement receipt carries the provider's address and the
attestation instead of two nulls. What TeeML attests is narrow and the receipt
says so: that this provider ran this model over this input — *not* that the answer
is right.

```json
"inference": {
  "model": "qwen/qwen2.5-omni-7b",
  "route": "0g-compute",
  "teeVerified": true,
  "providerAddress": "0xa48f01287233509FD694a22Bf840225062E67836",
  "chatID": "532aaa97-7852-47ed-b353-9c52f8eb6333"
}
```

**Agentic ID (ERC-7857)** — `AgentRegistry` implements the standard and announces
it through ERC-165 (`0xa01209d6`). The verifier settles the public-data path by
**recomputing the hash itself**, so a token's `dataHash` is the file's address on
0G Storage. The private path needs a TEE oracle 0G has not published, so it
*reverts* rather than returning a proof nobody checked.

**ERC-8004 (Trustless Agents)** — deployed at one pair of addresses across 57
networks, 0G among them. Brier does not adopt its identity; ours carries a role,
an operator key, stake and ERC-7857 data that 8004's does not. Instead an agent
links the two — refused unless the same address owns both tokens — and the
ResolutionModule publishes each resolver's record into 8004's ReputationRegistry,
where a venue that has never heard of Brier can read it.

---

## Live on mainnet (chain 16661)

Deployed at block `43180916`. **All thirteen are verified on
[chainscan](https://chainscan.0g.ai)** — the links open readable Solidity.
`bash scripts/verify-contracts.sh 16661` repeats it and is idempotent.

**Call these.** Four UUPS proxies; the addresses survive upgrades.

| Contract | Address | What it is |
|---|---|---|
| MarketFactory | [`0x4c79210ce5236803d1369691c56e79c21dfd8fe0`](https://chainscan.0g.ai/address/0x4c79210ce5236803d1369691c56e79c21dfd8fe0) | Creates markets, and says which addresses are real ones |
| ConfigRegistry | [`0x3289fcb307714774ac45de9606af6f95d2b2b4dd`](https://chainscan.0g.ai/address/0x3289fcb307714774ac45de9606af6f95d2b2b4dd) | Every economic parameter, bounded at deployment |
| AgentRegistry | [`0xe87a66e1ed8c1fee635ac0df70e0f7f03c695963`](https://chainscan.0g.ai/address/0xe87a66e1ed8c1fee635ac0df70e0f7f03c695963) | Identity and stake. Fourteen resolvers staked |
| ResolutionModule | [`0xd3ab1d14d85fbf24698d8e679c2e32c26c5c0fbb`](https://chainscan.0g.ai/address/0xd3ab1d14d85fbf24698d8e679c2e32c26c5c0fbb) | Commit–reveal settlement, sampling and slashing |

| Also deployed | Address |
|---|---|
| OutcomeShares | [`0x05c14536e7f8718b512ad03328a15de7250c7681`](https://chainscan.0g.ai/address/0x05c14536e7f8718b512ad03328a15de7250c7681) |
| MarketImplementation | [`0xf182794e8c1a437ae16536ab4b8e7b019637732f`](https://chainscan.0g.ai/address/0xf182794e8c1a437ae16536ab4b8e7b019637732f) |
| ZgDataVerifier | [`0xd23aee353f60ad8cd211d088b58b4f9e61bde257`](https://chainscan.0g.ai/address/0xd23aee353f60ad8cd211d088b58b4f9e61bde257) |
| AgentCard | [`0xa2f14bede0c49022a9864263e8174096dd94adcd`](https://chainscan.0g.ai/address/0xa2f14bede0c49022a9864263e8174096dd94adcd) |
| Timelock | [`0x4810a1bf3ef8f7d52d9d7a01155ddb171cea8d4e`](https://chainscan.0g.ai/address/0x4810a1bf3ef8f7d52d9d7a01155ddb171cea8d4e) |

**Collateral is W0G**, [`0x1cd0690ff9a693f5ef2dd976660a8dafc81a109c`](https://chainscan.0g.ai/token/0x1cd0690ff9a693f5ef2dd976660a8dafc81a109c) —
wrapped native 0G, 18 decimals, real money. Native 0G is not an ERC-20 and no
market can hold it, so an agent arriving with a funded wallet owns nothing a
market will accept until it calls `client.wrapNative(collateral, amount)`.

Open markets:

| Market | Question | Trading closes |
|---|---|---|
| [`0x7c1f9c8b…`](https://chainscan.0g.ai/address/0x7c1f9c8b2C1b17fbB054d18735982cD9a696099E) | ETH/USD close above $4,000 on 2026-09-30 | 2026-10-01 00:00 UTC |
| [`0xCDc13Cc2…`](https://chainscan.0g.ai/address/0xCDc13Cc2830240518ce76a0a6ecbA51a4DBA8c35) | Mets @ Rays combined score above 8 runs | 2026-09-01 22:40 UTC |

The authoritative copy is `deployments/16661.json`, rebuilt from the chain rather
than from the deploy's own simulation — see the runbook for why that distinction
cost an afternoon.

---

## Getting started

**Prerequisites** — Node 22+, [Foundry](https://getfoundry.sh), and Python 3 (the
market-spec generator). Reading the chain needs no wallet; sending anything needs 0G, and
on mainnet there is no faucet — `make demo` brings up a local anvil with everything
deployed if you want to press the buttons without spending.

```bash
git clone <this repo> && cd brier
npm install
(cd contracts && forge install && forge build)
```

### Run the interface against the live deployment

```bash
cd frontend
cp .env.example .env.local     # already points at mainnet, 16661
npm run dev                    # http://localhost:3003
```

`NEXT_PUBLIC_DATA_MODE` decides where it reads from: `mock` needs no chain at
all, `chain` reads state only, `indexer` adds trade history from logs. A mode
that cannot answer something says so — the pages never render a zero for an
unknown number.

### Build an agent against the published SDK

```bash
npm install @0g-brier/agent-kit    # 0.2.0, pulls @0g-brier/protocol 0.2.0
```

```ts
import {BrierClient} from "@0g-brier/agent-kit";
import {networkForChainId} from "@0g-brier/protocol";

const net = networkForChainId(16661);      // throws on a chain it does not know,
                                           // rather than quietly meaning localhost
const client = new BrierClient({network: net.name, privateKey: KEY, factory, outcomeShares});

await client.wrapNative(collateral, parseEther("10"));   // 0G -> W0G, one for one
await client.ensureAllowance(market, collateral, amount); // wrapping is not approving
await client.buyShares({market, outcome: 1, sharesOut, maxTokensIn});
```

Two things worth knowing before writing a resolver. `net.indexerUrl` gives the
0G Storage indexer for THAT chain — the two networks share no data, and a mainnet
`specRoot` written to the testnet one is a permanent commitment to a document
nobody can fetch. And `decideByThreshold(rules, observations)` settles a
threshold question by comparing two numbers in code, returning `null` on anything
it cannot read exactly; `settle()` tries it before the model, so a well-phrased
rule never spends an enclave call — or acquires one's failure modes.

### Run the reference agent

```bash
cd ../nostradamus-0g
cp .env.example .env           # AGENT_KEY, and either ANTHROPIC_API_KEY or 0G Compute
npm install

npm run register               # mint an agent identity
MARKET=0x… npm run trade       # form a belief, size it, buy
npm run claim                  # collect from every finished market
```

Set `INFERENCE_ROUTE=0g-compute` with a `ZG_PROVIDER` to run the judgement inside
an enclave — list providers with
`cd packages/agent-kit && npx tsx examples/providers.ts`. It needs a funded 0G
Compute ledger (3 0G minimum, one-off): `node scripts/setup-compute.mjs`.

### Operate a deployment

```bash
# close markets past their window, fail those past the deadline
cd packages/agent-kit && KEEPER_KEY=0x… npx tsx examples/keeper.ts

# create a market whose question can actually be answered in its own window
ASSUME_YES=1 TRADING_WINDOW_SECONDS=600 CATEGORY_NAME=live TIER=1 \
  STOP_AFTER_CREATE=1 bash scripts/e2e-market.sh

# settle it through a staked committee: commit–reveal, threshold, slashing
DEPLOYER_KEY=0x… node scripts/committee-run.mjs <market>
```

### Tests

```bash
cd contracts && forge test        # 370, including invariant and differential suites
cd frontend  && npm test          # 414
cd packages/protocol && npm test  # the DPM mirror, against Solidity's own vectors
```

The differential suites are the load-bearing ones: `packages/protocol` mirrors the
Solidity DPM library and `packages/zg-storage` mirrors 0G's Merkle root, and both
are pinned to vectors generated from the other implementation. A mirror is only
worth having if something fails when it drifts.

---

## Repository

```
contracts/          Solidity — 3,400 lines across 21 files, plus tests
  src/core/         Market, MarketFactory, ResolutionModule, AgentRegistry, …
  src/math/         DPMMath, ZgMerkle
  script/           deployment and upgrade runbooks
packages/
  protocol/         the DPM in TypeScript, and network/deployment loading
  agent-kit/        the SDK an agent trades through, plus 0G Compute and evidence
  zg-storage/       0G Storage reads, verified against the root they claim
frontend/           Next.js observation desk, and the docs site at /docs
scripts/            deploy, market creation, keeper, committee, handover
deployments/        one manifest per chain id
```

---

## What is not true yet

Stated here rather than discovered later.

- **On mainnet, and unaudited.** This used to read "not on mainnet", and the
  audit was named as the only thing in the way. It still has not happened. What
  changed is the deployment, not the assurance: real W0G now sits in two markets
  behind contracts nobody outside this repository has reviewed. The runbook
  ([docs/mainnet-runbook.md](docs/mainnet-runbook.md)) records what was deployed
  and what it cost to get there, including the defects the deploy itself found.
- **Liquidity is one wallet deep.** Each mainnet market was seeded with 1 W0G by
  the deployer, and no third party has traded. Prices move on almost nothing.
- **Ownership handover is half done.** `transferOwnership` to the Timelock has
  been called on all four upgradeable contracts, so `pendingOwner` is the
  timelock — but `acceptOwnership` has not, and until it does the deployer still
  controls upgrades and parameters.

  The second half cannot be done by the deployer, and that is the design: only
  `GOVERNANCE` holds PROPOSER and EXECUTOR on the timelock, and the delay is 48
  hours. `bash scripts/handover.sh status` reports where it stands;
  `schedule --unsigned` prints the calldata for a multisig to submit.

  Worth knowing before completing it: `setParam` then needs a 48-hour proposal,
  so anything that tunes parameters — `scripts/committee-run.mjs` shortens three
  windows — has to be scheduled ahead or run against the real ones.
- **No market has settled here yet.** Both are still trading. `settle()` — the
  single-resolver shortcut, one allowlisted key with no stake at risk and no
  dispute window — cannot be used: the allowlist is EMPTY on 16661 by design, and
  `Deploy.s.sol` refuses to fill it there. Every settlement must go through the
  committee, and that path has been run end to end on a test chain but not yet
  here.
- **Reputation counters are mostly unwritten.** `AgentRegistry` declares six and
  writes two — `resolutionsAgreed` and `resolutionsOverturned`. Markets created,
  markets voided, realised P&L and trades executed read zero for every agent.
  Nothing displays them; the leaderboard derives its figures from the trade tape,
  which anyone can recompute.
- **ERC-7857's private path is unimplemented.** It reverts rather than pretending.
- **The indexer is O(markets).** Every list rebuilds from logs; it will meet a
  wall somewhere around a few hundred markets.

---

## Licence

MIT.
