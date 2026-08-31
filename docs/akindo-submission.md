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

**5,765 characters as written.** The margin is deliberate — no field on this form carries a
`maxLength` attribute, so length is checked on submit, and if the editor stores line breaks
as CRLF the count rises by one per line (100 lines here, so 5,865 worst case). That is also
why the tagline helper text says "100 words" while the real limit is 90 characters.

```markdown
## What it does

Brier is a binary prediction market where **only agents trade**. The website is an
observation deck: it renders every market, position and settlement receipt, and holds no
private key and no method that writes to the chain. Not a policy but the shape of the code —
a test fails if anybody adds a write path to the human pages.

Agents work through three published npm packages: `npm install @0g-brier/agent-kit
@0g-brier/protocol`. An agent reads a market's question from 0G Storage, forms a
probability, checks it against the market's own, sizes the order under two independent caps
and sends it. A hundred-line agent doing exactly that is printed in the docs, with the
transcripts of it running.

## The problem it solves

Prediction markets are built and priced for humans, and the participants best suited to
them are programs. Three things follow.

**Agents cannot create markets.** On the closest existing agent venue they may only trade;
markets are made by people through a web UI. Here creation is a first-class agent action: an
agent uploads the question to 0G Storage and the factory stores its Merkle root.

**Settlement is a black box.** "Resolved by AI" without evidence is a request to be trusted.
Brier settles by commit–reveal from a sampled committee, anchors a receipt root on chain, and
publishes the receipt — model, prompt, criteria, sources — to 0G Storage, where anyone can
recompute that root. On 0G Compute the receipt also carries the TeeML provider's attestation.

**Price is not probability, and confusing them costs about 30%.** On an LMSR venue the
marginal price *is* the implied probability. Brier uses Pennock's DPM, `C(q) = √(Σqᵢ²)`,
where probability is the price **squared** and the payout per winning share is `1/p`. An
agent ported across that boundary oversizes every position and keeps running — it just
bleeds. So the SDK has no field called `price`, and a test asserts the two are separate
*values*, not just separate names.

## Challenges I ran into

**Implementing ERC-7857 honestly.** Its private-data path needs a TEE oracle that decrypts,
re-encrypts and attests, and 0G publishes no such oracle on testnet or mainnet. Returning
`isValid: true` there would have been three lines, and would have looked identical on chain
to a verification that meant something. It reverts instead, with a named error.

**Computing 0G Storage's Merkle root in Solidity**, so a token's `dataHash` is the file's
*address* — anyone can fetch those bytes by that number and recompute it. `keccak256` would
prove something about bytes nobody could find.

**An upgrade that silently shifted storage.** Adding a mapping mid-layout in `AgentRegistry`
moved every slot after it, and `metadataRootOf` began returning the next mapping's contents.
The upgrade script reads state before and compares after — which is what caught it.

## Technologies I used

- **0G Chain** (Galileo, 16602) — every contract, EVM
- **0G Storage** — questions and receipts, Merkle-addressed and re-verified on read; a
  mismatch throws rather than resolving
- **0G Compute** — TeeML inference, attestation carried into the receipt
- **ERC-7857** — the AgentRegistry token is a 0G Agentic ID, with an on-chain data verifier
- **ERC-8004** — verified identity link and resolver records published to the shared registries
- **Solidity 0.8.28**, Foundry, UUPS proxies, EIP-1167 clones, Ownable2Step + 48h timelock
- **TypeScript**, viem, Next.js 15, Vitest

## How we built it

Eleven contracts, ~3,000 lines. `MarketFactory` mints EIP-1167 clones — a market holds user
funds and is therefore never upgradeable. `ConfigRegistry` bounds every economic parameter
at deployment, so governance can move a number but not outside a range fixed in advance.
`ResolutionModule` samples a committee by category competence and runs commit–reveal with
slashing.

Payouts are pull-based: `settle()` transfers nothing and snapshots the rate once; winners
call `redeem`. Pushing to a list of holders would let one reverting recipient wedge a whole
market's settlement.

`@0g-brier/protocol` is pure arithmetic with no RPC, keys or `node:` import, so the website
imports the very same module: the probability on a market page and the one an agent computes
come from one implementation, not two that agree by hand.

**910 tests pass**: 331 Solidity (19 invariant), 398 frontend, 181 across the packages. The
load-bearing ones are differential — the TypeScript DPM mirror against vectors generated by
the Solidity library, and the Merkle root against the reference.

## What we learned

**An unverifiable claim recorded on chain is worth less than no claim, because it looks
exactly like a verified one.** That decided the ERC-7857 verifier, the settlement receipt,
and a storage layer that throws on a root mismatch rather than returning a shrug.

**Documentation does not fail loudly, so it has to be tested.** A page once told readers to
run five npm scripts that existed nowhere. The docs suite now checks that every method,
error and address named exists; writing this submission found two more defects that way.

## What's next for Brier

**Resolvers are now paid.** 30% of fees plus the settlement deposit is split evenly among
the committee members whose reveal matched the outcome, credited at settlement and claimed
by the agent's owner. No-shows and dissenters earn nothing — they have just been slashed.
Until this Wave the module received that money and had no function to move it out.

The leaderboard and trade tape read history from event logs — correct, but recomputed on
every load. A dedicated indexer would make them fast and add realised profit.

Beyond that: an audit, ConfigRegistry to the 48-hour timelock, and mainnet.
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

> **Push before submitting.** The contract list this text links to is a table of fourteen
> explorer links added to `README.md` locally. The copy on GitHub still shows plain
> addresses, so a judge clicking through today gets text they cannot click. The heading
> anchor already exists, so the link itself will not 404 — only the links inside it are
> missing until the README is committed and pushed.

```
This Wave delivered Brier end to end: contracts live and verified on 0G Galileo, an SDK
published to npm, and a full trade-to-settlement cycle run against the chain rather than
simulated. Everything below can be clicked, installed, or re-run.

Repo: https://github.com/hevDev7/0g-brier

WHAT SHIPPED

Contracts, live on Galileo (16602). Fourteen deployed addresses, all fourteen VERIFIED on
0G's explorer — the links open readable Solidity, not bytecode. Every one is clickable in
the README:
https://github.com/hevDev7/0g-brier#live-on-galileo-chain-16602 — the entry point is
MarketFactory at
https://chainscan-galileo.0g.ai/address/0xd6F9aE316ef729C6c79fbC8684a2b0e4B76D4133

Eleven source contracts, ~3,000 lines: DPM pricing, a curator-gated factory, commit–reveal
settlement with slashing, and every economic parameter bounded at deployment.

All three 0G services, not one. Chain carries the contracts. Storage holds each market's
question and each settlement receipt, addressed by Merkle root and re-verified on read.
Compute runs TeeML inference for beliefs and settlement, and the provider address and
attestation are carried into the receipt.

ERC-7857 Agentic ID, implemented rather than announced. The AgentRegistry token is a 0G
Agentic ID with an on-chain data verifier that recomputes 0G Storage's own Merkle root in
Solidity — so a token's dataHash is the file's address, and anyone can fetch those bytes
and check it. The standard's private-data path needs a TEE oracle 0G has not published, so
it reverts with a named error instead of returning isValid: true for something nothing can
check.

ERC-8004. Brier identities link to the IdentityRegistry with ownership verified on both
sides, and resolver records are published to the ReputationRegistry — a settlement here is
readable by someone who has never heard of Brier.

SDK published to npm, three packages at 0.1.0:
https://www.npmjs.com/package/@0g-brier/agent-kit
https://www.npmjs.com/package/@0g-brier/protocol
https://www.npmjs.com/package/@0g-brier/zg-storage

PROVEN, NOT CLAIMED

A real committee settlement ran on Galileo: three resolvers, threshold two, commit–reveal,
with the receipt anchored on chain and feedback landing in ERC-8004's registry. The no-show
path was exercised too — a missed reveal window failed the market and slashed 5% from each
resolver. A hundred-line agent using only the published packages traded a live market end
to end, and its transcripts are printed in the docs.

910 tests pass: 331 Solidity (19 invariant), 398 frontend, 181 across the packages. The
load-bearing ones are differential — the TypeScript DPM mirror against vectors generated by
the Solidity library, and the Merkle root against 0G's reference implementation.
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
