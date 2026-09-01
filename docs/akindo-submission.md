# Akindo submission — 0G Bridge Wave 3

Every field below matches one on `app.akindo.io/communities/mVMJEx4xOIgKDlkj/create-product`,
in form order. Copy each block as it stands.

Every number in here was run on 2026-08-29 and is checkable by a judge. Nothing is
projected, and the two things that do not work yet are named in **What's next** rather
than left for someone to discover.

---

## 1. Product name

```
Brier
```

---

## 2. Tagline  *(max 90 characters — the form's "100 words" helper text is wrong)*

```
Agent-only prediction markets on 0G. The site shows everything and can execute nothing.
```

87 characters. The second clause is the differentiator and it is literally true: the web
app holds no key and no write path, and a test fails if anyone adds one.

Alternates, if a different emphasis is wanted:

- `The prediction market humans cannot trade on. Every order comes from an agent, on 0G.` — 85
- `Prediction markets priced for programs. Every trade comes from an agent, never a browser.` — 89
- `An agent-native prediction market on 0G. Humans observe; only agents can trade.` — 79

---

## 3. Product type

```
Functional
```

Live on 0G Galileo (chain 16602), with contracts deployed, three SDK packages published
to npm, and a full trade cycle run end to end against the chain.

---

## 4. About  *(Markdown — all seven headings required, 5,900 characters max)*

Keep every `##` heading: the form pre-fills all seven and the last is `## What's next for`,
not `## What's next`.

**5,773 characters as written.** The margin is deliberate — no field on this form carries a
`maxLength` attribute, so length is checked on submit, and if the editor stores line breaks
as CRLF the count rises by one per line (103 lines here, so 5,876 worst case). That is also
why the tagline helper text says "100 words" while the real limit is 90 characters.

```markdown
## What it does

Brier is a binary prediction market where **only agents trade**. The website is an
observation deck: it renders every market, position and settlement receipt, and holds no
private key and no method that writes to the chain. Not a policy but the shape of the code —
a test fails if anyone adds a write path to the human pages.

Agents work through three published npm packages: `npm install @0g-brier/agent-kit`. An
agent reads a market's question from 0G Storage, forms a probability, checks it against the
market's own, sizes the order under two independent caps and sends it. A hundred-line agent
doing exactly that is printed in the docs, with transcripts of it running.

## The problem it solves

Prediction markets are built and priced for humans; the participants best suited to them
are programs. Three things follow.

**Agents cannot create markets.** On the closest agent venue they may only trade; markets
are made by people through a web UI. Here creation is a first-class agent action: the agent
uploads the question to 0G Storage and the factory stores its Merkle root.

**Settlement is a black box.** "Resolved by AI" without evidence is a request to be trusted.
Brier settles by commit–reveal from a sampled committee, anchors a receipt root on chain, and
publishes the receipt — model, prompt, criteria, sources — to 0G Storage, where anyone can
recompute that root. On 0G Compute it also carries the TeeML provider's attestation.

**Price is not probability, and confusing them costs about 30%.** On an LMSR venue the
marginal price *is* the implied probability. Brier uses Pennock's DPM, `C(q) = √(Σqᵢ²)`,
where probability is the price **squared** and the payout per winning share is `1/p`. An
agent ported across that boundary oversizes every position and keeps running — it just
bleeds. So the SDK has no field called `price`, and a test asserts the two are separate
*values*, not just separate names.

## Challenges I ran into

**Implementing ERC-7857 honestly.** Its private-data path needs a TEE oracle that decrypts,
re-encrypts and attests, and 0G publishes none. Returning `isValid: true` was three lines,
and on chain would look identical to a verification that meant something. It reverts
instead, with a named error.

**Computing 0G Storage's Merkle root in Solidity**, so a token's `dataHash` is the file's
*address* — anyone can fetch those bytes by that number and recompute it. `keccak256` would
prove something about bytes nobody could find.

**An upgrade that silently shifted storage.** A mapping added mid-layout in `AgentRegistry`
moved every slot after it, and `metadataRootOf` began returning the next mapping's contents.
The upgrade script reads state before and compares after — which caught it.

## Technologies I used

- **0G Chain** — **mainnet 16661** and Galileo 16602; every contract, EVM
- **0G Storage** — questions and receipts, Merkle-addressed and re-verified on read; a
  mismatch throws
- **0G Compute** — TeeML inference, attestation carried into the receipt
- **ERC-7857** — the AgentRegistry token is a 0G Agentic ID, with an on-chain verifier
- **ERC-8004** — identity link and resolver records, published to the shared registries
- **Solidity 0.8.28**, Foundry, UUPS proxies, EIP-1167 clones, Ownable2Step + 48h timelock
- **TypeScript**, viem, Next.js 16, Vitest

## How we built it

Eight contracts of its own, ~3,500 lines. `MarketFactory` mints EIP-1167 clones — a market
holds user funds and is therefore never upgradeable. `ConfigRegistry` bounds every economic
parameter at deployment, so governance can move a number but not outside a fixed range.
`ResolutionModule` samples a committee by category competence and runs commit–reveal
with slashing.

`@0g-brier/protocol` is pure arithmetic — no RPC, keys or `node:` import — so the website
imports the very same module: the probability on a market page and the one an agent computes
come from one implementation, not two that agree by hand.

**1,004 tests pass**: 370 Solidity (53 invariant), 414 frontend, 220 across the packages. The
load-bearing ones are differential — the TypeScript DPM mirror against vectors generated by
the Solidity library, and the Merkle root against the reference.

## What we learned

**An unverifiable claim on chain is worth less than no claim, because it looks exactly like
a verified one.** That decided the ERC-7857 verifier, the settlement receipt, and a storage
layer that throws on a root mismatch rather than returning a shrug.

**Documentation does not fail loudly, so it has to be tested.** A page once told readers to
run five npm scripts that existed nowhere. The docs suite now checks that every method, error
and address named exists; revising this submission found five stale numbers the same way.

## What's next for Brier

**Resolvers are now paid.** 30% of fees plus the settlement deposit, split evenly among the
committee members whose reveal matched the outcome. No-shows and dissenters earn nothing —
they have just been slashed. Until this Wave the module took that money and could not move
it out.

**And it is on mainnet.** Thirteen addresses on 16661, verified on chainscan, settling in
W0G. Two markets open, fourteen resolvers staked.

Deploying found the defect that argues for deploying: every money default read `100e6`,
right for a 6-decimal testnet stablecoin and wrong by twelve orders against an 18-decimal
one. It would have set the resolver stake to 1e-10 W0G — a stake anyone can post is no
stake, and a committee with nothing to slash is not a committee.

Still ahead: an indexer, an audit, and ConfigRegistry to the timelock. The deployer still
holds all four upgradeable contracts, so the cliff is open and nothing behind it has been
reviewed outside this repository.
```

---

## 5. Deliverable URL

```
https://github.com/hevDev7/0g-brier
```

---

## 6. Video  *(optional — see note)*

Not recorded yet. If there is time, the highest-value 2 minutes is the runbook transcript:
`npx tsx agent.ts` reading a market's question from 0G Storage, printing its own
probability against the market's, being cut from a 125,011 mUSDC budget down to 63.84 by
the impact cap, filling, and the market moving 55.0% → 59.9% on screen.

---

## 7. Live demo

```
https://brier.mdloglabs.org
```

Served as a **production build** (`next build` + `next start`) behind a Cloudflare tunnel,
not the dev server. That matters for a judge: the dev server compiles each route on first
request and answers 403 to any `/_next/*` request carrying a foreign `Origin`, which left
the market list showing its loading skeleton forever with nothing in the console. Pages now
answer in about 0.2s. The market table itself fills a few seconds later — it is read from
the chain in the browser, and the public 0G RPC takes roughly 1.5s a call.

---

## 8. Build with  *(press Enter after each)*

```
0G Chain
0G Storage
0G Compute
```

---

## 9. Product Category  *(max 3)*

```
Prediction Market
AI Agents
Market Infrastructure
```

---

## 10. Tags  *(tech stack, max 10)*

```
Solidity
Foundry
TypeScript
viem
Next.js
React
Vitest
ERC-7857
ERC-8004
0G
```

---

## 11. Product detail visibility

```
Show
```

The repo is public and the judging criteria ask for it.

---

## 12. Connect

Fill in whichever accounts you want reachable. Email is the one worth setting:
`madilog2411@gmail.com`.

---

## 13. Updates in this Wave  *(max 2,900 characters)*

2,739 characters. This is the whole project rather than a diff against a previous
submission, because Wave 3 is where all of it was built.

> **Pushed.** The mainnet contract table this text links to is live on GitHub as of
> commit `7bd1737`, every address checked to have code on chain before the link was
> written.

```
This Wave delivered Brier end to end, then put it on mainnet: contracts live and verified,
an SDK on npm, and a full trade-to-settlement cycle run against the chain. Everything below
can be clicked, installed, or re-run.

Repo: https://github.com/hevDev7/0g-brier

WHAT SHIPPED

Contracts, live on MAINNET (16661) and Galileo (16602). Thirteen mainnet addresses, all
VERIFIED on 0G's explorer — the links open readable Solidity, not bytecode. Every one is
clickable in the README:
https://github.com/hevDev7/0g-brier#live-on-mainnet-chain-16661 — the entry point is
MarketFactory at
https://chainscan.0g.ai/address/0x4c79210ce5236803d1369691c56e79c21dfd8fe0

Collateral is W0G — wrapped native 0G, real money. Two markets open, fourteen resolvers
staked. Eight source contracts, ~3,500 lines: DPM pricing, a curator-gated factory,
commit–reveal settlement with slashing, every economic parameter bounded at deployment.

All three 0G services, not one. Chain carries the contracts. Storage holds each market's
question and settlement receipt, Merkle-addressed and re-verified on read. Compute runs
TeeML inference, with the provider address and attestation carried into the receipt.

ERC-7857 Agentic ID, implemented rather than announced. An on-chain verifier recomputes 0G
Storage's Merkle root in Solidity, so a token's dataHash IS the file's address — anyone can
fetch those bytes and check it. The private-data path needs a TEE oracle 0G has not
published, so it reverts with a named error instead of a meaningless isValid: true.

ERC-8004. Identities link to the IdentityRegistry with ownership verified both sides;
resolver records go to the ReputationRegistry, so a settlement here is readable by someone
who has never heard of Brier.

SDK on npm — `agent-kit` and `protocol` at 0.2.0, `zg-storage` at 0.1.1:
https://www.npmjs.com/package/@0g-brier/agent-kit

PROVEN, NOT CLAIMED

A real committee settlement ran on Galileo: three resolvers, threshold two, commit–reveal,
receipt anchored on chain, feedback in ERC-8004's registry. The no-show path was exercised
too — a missed reveal window failed the market and slashed 5% from each resolver. A
hundred-line agent using only the published packages traded a live market, with transcripts
in the docs.

Deploying found what testnet could not: every money default read 100e6, right for a
6-decimal test stablecoin and wrong by twelve orders against 18-decimal W0G. It would have
set the resolver stake to 1e-10 W0G, and a committee with nothing to slash is not one.
Caught before broadcast.

1,004 tests pass: 370 Solidity (53 invariant), 414 frontend, 220 across the packages. The
load-bearing ones are differential — the TypeScript DPM mirror against vectors from the
Solidity library, and the Merkle root against 0G's reference implementation.
```

---

## 14. Milestone 4th Wave  *(max 300 characters)*

250 characters.

```
A security audit, then handing ConfigRegistry to the 48-hour timelock — mainnet deploys with a Safe multisig as governance from block one, so no hot key ever owns a contract holding funds.
```

---

## 15. Milestone 5th Wave  *(max 300 characters)*

191 characters.

```
Mainnet on 0G chain 16661, once audited. Then a dedicated indexer so the leaderboard stops recomputing from event logs, and REQUIRE_REGISTERED_TRADER once the registry is populated.
```

---

## Images you still have to supply

The form requires a **product icon** and **at least one gallery image** (up to 5). These
cannot be pasted. The screens worth capturing, in order of how much they prove:

1. **A market detail page** — probability chart, positions, and the settlement receipt with
   its 0G Storage root
2. **`/docs/running`** — the agent transcript, which is the clearest evidence the thing runs
3. **The markets list** filtered to Live
4. **`/docs/packages`** — the three npm packages and what each is for
5. **A settled market's ResolutionEvidence** — the committee verdict with the TeeML
   provider address

## Deadline

The form showed **1 day 09:58 remaining** when this was written (2026-08-29).
