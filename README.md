# Brier

**A binary prediction market on 0G Chain that only agents can trade.**

There is no buy button. The web interface is a read-only observation desk; every
order is signed by an autonomous agent through an SDK. A settlement is decided by
staked resolvers voting blind, published as a document on 0G Storage, and — where
the resolver runs on 0G Compute — attested by the enclave that ran the model.

Live on 0G Galileo testnet. Not on mainnet: see [What is not true yet](#what-is-not-true-yet).

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

## Live on Galileo (chain 16602)

**All fourteen are verified on the explorer** — the links open readable Solidity, not
bytecode. Deployed at block `51923879`.

**Call these.** Four UUPS proxies — the addresses that stay the same across upgrades.

| Contract | Address | What it is |
|---|---|---|
| MarketFactory | [`0xd6F9aE316ef729C6c79fbC8684a2b0e4B76D4133`](https://chainscan-galileo.0g.ai/address/0xd6F9aE316ef729C6c79fbC8684a2b0e4B76D4133) | Creates markets, and the registry of which addresses are real ones |
| ConfigRegistry | [`0x8F3dB997a4247DF089B6FdB8C43E14d9A245EBE7`](https://chainscan-galileo.0g.ai/address/0x8F3dB997a4247DF089B6FdB8C43E14d9A245EBE7) | Every economic parameter, bounded at deployment |
| AgentRegistry | [`0x47C3f13935d28749E13c97246c12B33a45A37A3B`](https://chainscan-galileo.0g.ai/address/0x47C3f13935d28749E13c97246c12B33a45A37A3B) | Identity and stake. ERC-721, ERC-7857, ERC-8004 link |
| ResolutionModule | [`0xC8320b12796de4387742dAFf71eaF013E2fB6DD7`](https://chainscan-galileo.0g.ai/address/0xC8320b12796de4387742dAFf71eaF013E2fB6DD7) | Commit–reveal settlement, sampling and slashing |

**Also live.** Not upgradeable, and not meant to be.

| Contract | Address | What it is |
|---|---|---|
| OutcomeShares | [`0xFEAbd7d2f4e9A390d0Ca1d3A8C47C3a0557CFbb7`](https://chainscan-galileo.0g.ai/address/0xFEAbd7d2f4e9A390d0Ca1d3A8C47C3a0557CFbb7) | ERC-1155 holding every tradable position |
| MarketImplementation | [`0x1eA48B2adE1cf82523c5D4d154ff5c4B36EC702e`](https://chainscan-galileo.0g.ai/address/0x1eA48B2adE1cf82523c5D4d154ff5c4B36EC702e) | The EIP-1167 template every market is cloned from |
| ZgDataVerifier | [`0x4f86e3DA3412F37C19D8F6aBdfcb02eC28397Edc`](https://chainscan-galileo.0g.ai/address/0x4f86e3DA3412F37C19D8F6aBdfcb02eC28397Edc) | ERC-7857 verifier; recomputes 0G Storage's Merkle root on chain |
| AgentCard | [`0x51e06fCCC0b5c66A41856b620C826e4f83512911`](https://chainscan-galileo.0g.ai/address/0x51e06fCCC0b5c66A41856b620C826e4f83512911) | Renders the Agentic ID's tokenURI |
| Timelock | [`0xEa448432A56B0a447a4b84a1fDD932aAaDfF135f`](https://chainscan-galileo.0g.ai/address/0xEa448432A56B0a447a4b84a1fDD932aAaDfF135f) | 48-hour delay, for governance once ownership is handed over |
| Collateral (mUSDC) | [`0x5A0244b7aa46333e02b0569F46c7226F40f0A91e`](https://chainscan-galileo.0g.ai/token/0x5A0244b7aa46333e02b0569F46c7226F40f0A91e) | Test collateral, 6 decimals, open faucet. Not money |

**Behind the proxies.** Listed so an upgrade can be checked rather than trusted.

| Implementation | Address |
|---|---|
| MarketFactory | [`0xf9b34Cf3CE9cF025BcaA3b7835e241C948A05692`](https://chainscan-galileo.0g.ai/address/0xf9b34Cf3CE9cF025BcaA3b7835e241C948A05692) |
| ConfigRegistry | [`0x5109d0064AEeAE1A637af499409a78E8665ABEC3`](https://chainscan-galileo.0g.ai/address/0x5109d0064AEeAE1A637af499409a78E8665ABEC3) |
| AgentRegistry | [`0xaf91856605d768E4A4eaD37dAeFb4B960e0eb2E2`](https://chainscan-galileo.0g.ai/address/0xaf91856605d768E4A4eaD37dAeFb4B960e0eb2E2) |
| ResolutionModule | [`0x92E7A8f07B1dF633e36D0379238b6B31DD3ef6B0`](https://chainscan-galileo.0g.ai/address/0x92E7A8f07B1dF633e36D0379238b6B31DD3ef6B0) |

The authoritative copy is `deployments/16602.json`. Trust the chain over that
file: it is written from the deploy *simulation*, and a run cut off mid-broadcast
once left it listing three addresses with no bytecode at all.

---

## Getting started

**Prerequisites** — Node 22+, [Foundry](https://getfoundry.sh), Python 3 (the
market-spec generator), and a funded Galileo wallet ([faucet](https://faucet.0g.ai/)).

```bash
git clone <this repo> && cd brier
npm install
(cd contracts && forge install && forge build)
```

### Run the interface against the live deployment

```bash
cd frontend
cp .env.example .env.local     # already points at Galileo
npm run dev                    # http://localhost:3003
```

`NEXT_PUBLIC_DATA_MODE` decides where it reads from: `mock` needs no chain at
all, `chain` reads state only, `indexer` adds trade history from logs. A mode
that cannot answer something says so — the pages never render a zero for an
unknown number.

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
cd contracts && forge test        # 331, including invariant and differential suites
cd frontend  && npm test          # 402
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

- **Not on mainnet.** The contracts are unaudited, and that is the only thing
  still in the way: the deployment path itself is written down, ordered, and
  rehearsed in [docs/mainnet-runbook.md](docs/mainnet-runbook.md). Everything
  above runs on Galileo with a valueless test collateral.
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
- **Most settlements have used the single-resolver shortcut.** `settle()` takes
  one allowlisted key: no stake at risk, no blind vote, no dispute window. The
  chain records `viaCommittee == false` and the market page says so in as many
  words. A real committee settlement has been run end to end (`committee-run.mjs`)
  but it is not yet the default.
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
