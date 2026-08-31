# Deploying Brier to 0G mainnet

Chain **16661**. Everything below was read out of the scripts that will run it,
not written from memory, and the paragraphs that say "this is irreversible" are
the ones to read twice.

One idea shapes the whole order: **the deployer's power ends at a cliff, and
after the cliff every administrative act costs 48 hours.** Work that is cheap
before the handover is expensive forever after. So the sequence is not a
formality — it is the difference between launching in an afternoon and
launching over a fortnight.

---

## 0. Before anything, a key that has never been used

The Galileo deployer key is **compromised** — it was printed into a terminal
transcript by a `bash -x` run on 2026-08-30. It owns ConfigRegistry,
MarketFactory, AgentRegistry and ResolutionModule on the testnet, and that is
fine, because the testnet is disposable.

It must never touch mainnet. Generate a fresh key, and keep it in a `.env` with
mode 600 that is never sourced into a shell (`. ./.env` *executes* the file) and
never passed to a script under `set -x`.

The deployer is not a role you keep. It is a key that spends about ten minutes
being important and is then irrelevant — by design, see step 3.

---

## 1. Four addresses, none of them yours

`DeployLib.resolveRoles` **refuses** to deploy on 16661 unless all four are set,
none equals the deployer, and governance differs from the guardian. That last
rule exists because a guardian that is also governance can pause the protocol
*and* rewrite the rules underneath it, which is the concentration the split was
invented to prevent.

| env | what it ends up controlling |
|---|---|
| `GOVERNANCE` | proposer and executor on the timelock — every parameter, every upgrade |
| `GUARDIAN` | the pause. Fast, deliberately outside the timelock |
| `TREASURY` | receives the protocol's share of fees |
| `CURATOR_SIGNER` | signs the EIP-712 approval that lets a market be created |

Optional: `COLLATERAL` (an existing token; otherwise one is deployed),
`RESOLVER` (allowlisted at deploy, before the cliff — see step 4), and
`TIMELOCK_DELAY` (**48 hours** by default).

The script only checks that these are distinct addresses. It cannot check that
they are *multisigs*, and it should not have to — but `GOVERNANCE` as a single
EOA means one stolen key eventually rewrites the protocol, with the 48-hour
delay as the only alarm. Use a Safe. The delay is there to give people time to
react to a proposal; a proposal nobody is watching for is just a slower theft.

---

## 2. Deploy

```bash
forge script script/Deploy.s.sol --rpc-url "$MAINNET_RPC" --broadcast
```

In one transaction sequence this deploys the contracts, applies the bounds and
parameters, seeds the six categories, deploys the timelock, and calls
`transferOwnership` on four contracts.

Bounds are set **before** the values and are permanent. `FEE_BPS` gets a 3.00%
ceiling; nothing later — no governance vote, no upgrade — raises it. Getting a
bound wrong is the one mistake on this page that a redeploy is the only cure for.

---

## 3. The cliff

`transferOwnership` is the first half of an `Ownable2Step` handover. **Ownership
has not moved yet.** The deployer still controls all four contracts, and will
until governance schedules and executes `acceptOwnership()` on each — four
proposals, each waiting out the 48-hour delay.

That window is real, and the script prints it rather than pretending the job is
done. Two things follow:

- The deployer key is live and dangerous during it. Treat the window as an
  incident in progress: short, watched, and closed deliberately.
- **Everything in step 4 is cheap only while the window is open.**

---

## 4. Do this before you close the cliff

Each of these is `onlyOwner`. Before acceptance, the deployer does them in one
transaction. After acceptance, each is a timelock proposal and a two-day wait.

**Categories beyond the six.** `crypto`, `politics`, `sports`, `economics`,
`science`, `culture` are seeded. A seventh — `weather`, say — is `addCategory`
on ConfigRegistry, and `createMarket` reverts with `UnknownCategory` until it
exists. The assigned index is **permanent**: categories are never removed, only
abandoned, because the index is the bit an agent's `allowedCategories` policy
sets and reordering would silently repoint every policy already granted.

*This is the step that has already gone wrong once.* On Galileo, `weather` was
missing and the first market of that kind simply could not be created.

**The resolver allowlist.** `setResolver(resolver, true)` on ResolutionModule.

**Enough staked resolvers to form a committee.** A committee is sampled only
from agents registered as resolvers whose `activeStake` is at least
`MIN_RESOLVER_STAKE` (100 mUSDC at the deployed default). Below that count,
`openResolution` reverts with `NotEnoughResolvers` and every closed market waits
until its settlement deadline passes and it **fails** — which looks like a
committee that refused to show up, when it is really a launch that forgot to
staff itself.

Size the roster against the largest round you intend to reach, which is the
DISPUTE round at **nine**, not the five a VERIFIED market samples — and round two
excludes every member of round one, so nine *more* than the five already sitting.
Fourteen staked resolvers is the floor at which a disputed VERIFIED market can be
reviewed at all; below it `openDisputeRound` reverts `NotEnoughResolvers` and the
dispute stalls, which now costs the challenger its bond.

Stake also has a `7 day` unstake cooldown, so a resolver cannot answer a question
and leave before the dispute over it is finished.

**Set the two windows deliberately.** `MIN_SETTLEMENT_WINDOW` (3 days by default)
is the narrowest gap a market may leave between `tradingEnd` and
`settlementDeadline`, and it has to exceed commit + reveal + the longest dispute
window + the dispute round — about 28 hours at the deployed defaults. It is read
by `Market.initialize`, which is **immutable**: a market keeps the window it was
born with, so raising this later protects only new markets.

---

## 5. Close the cliff

`scripts/handover.sh` does this and reports on it, so the four calls are not
retyped by hand:

```bash
bash scripts/handover.sh status              # where each contract stands
bash scripts/handover.sh schedule --unsigned # calldata for the multisig to submit
# ...48 hours...
bash scripts/handover.sh execute
bash scripts/handover.sh status              # every owner() should read the timelock
```

`--unsigned` prints calldata instead of sending, which is the form to use when
governance is a Safe — no governance key ever goes near this machine.

When `status` shows all four owned by the timelock, the deployer key is inert.
Retire it.

---

## 6. Keepers, plural

Nothing in the protocol advances on its own. Markets close and resolutions open
because a keeper calls them, and both calls are **permissionless** — anyone may
make them, which is what stops a market from being hostage to one machine.

**Opening a resolution is two transactions, and a keeper must make both.**
`requestResolution` books a block a short way ahead; `openResolution` draws the
committee from that block's hash once it exists. The gap is the whole security
property — a seed that is already on chain when the draw is asked for is a seed
the caller can read, and a caller who can read it does not have to accept it: it
simulates, declines, and asks again next block until the committee suits. That is
not a theoretical concern. Measured against the previous single-call version, an
attacker holding four of twenty-four equally-staked resolvers waited 185 blocks to
take three of five seats — the threshold — and holding eight of twenty-four took
the nine-member dispute round after **one** block and flipped a settled outcome.

Two consequences for operations:

- A draw expires. `blockhash` answers for 256 blocks and no further, after which
  `openResolution` reverts `DrawExpired` and the draw must be requested again. A
  keeper that ticks every two minutes has a wide margin on 0G; one that goes down
  for ten minutes does not. This is the second reason to run more than one.
- A **disputed** market needs `openDisputeRound` the same way. Round two is
  requested by `dispute` itself and drawn separately, and a dispute nobody draws
  stalls — which forfeits the challenger's bond and leaves the market to fail. A
  keeper that watches only `Closed` markets leaves every dispute to rot;
  `examples/keeper.ts` handles `Closed` and `Disputed` both.

Run **at least two**, on separate hosts, with separate funded keys. They race
harmlessly: each simulates before it sends, so the loser of a race logs a skip
and moves on instead of aborting its tick. That property is why a second keeper
is worth running rather than a liability.

A keeper key is not the deployer key and not a trading key.

**Run your own RPC endpoint.** The public one is not reliable enough to build on.
Rehearsing the resolution flow on Galileo on 2026-08-31, `evmrpc-testnet.0g.ai`
refused receipts for transactions that had already landed — once as "could not be
found", once as `-32000 no matching receipts found: this may indicate potential
data corruption`, on a transaction confirmed in block 52348572 with status 1. A
keeper that treats either as failure will re-send work that already succeeded.
`scripts/rehearse-resolution.mjs` shows the shape of the fix: poll for the receipt
yourself and treat "not found" as "wait", never as "failed".

---

## What is still open on launch day

**The audit.** The contracts have not been audited. Everything on this page is
about deploying them correctly; none of it is evidence that they are correct.

An internal review on 2026-08-31 found three fund-affecting defects in the
resolution path, each reproduced against the code before it was changed: a
committee a caller could shop for, a dispute round the challenger could pick and
finalize with nothing behind it, and a stalled dispute that refunded the
challenger while slashing the resolvers who had been right. All three are fixed
and carry regression tests in `test/unit/ResolutionHardening.t.sol`. That is
evidence the specific holes are closed; it is not evidence there are no others,
which is what the audit is for.

**Committee sampling still rests on a blockhash.** Deferring the draw removes the
caller's freedom to re-roll, but the proposer of the draw block can still choose
between the hash it produces and producing nothing. That is one re-roll, on one
block it has to be scheduled for, rather than unlimited free ones — a much
narrower lever, and not zero. The randomness beacon remains the P7 upgrade.

**Resolver independence is thinner than the design implies.** A committee's
value is that its members judged separately. Today 0G Compute serves one text
model, so a five-member committee is five runs of the same model with the same
evidence — correlated in exactly the way the committee exists to avoid. The
receipts record this honestly (each names its model), and it is a reason to
prefer the DETERMINISTIC tier for questions with a mechanical answer until a
second model is available.

**Resolver registration is permissionless.** Anyone may register as a Resolver
and become eligible by staking `MIN_RESOLVER_STAKE`. The committee's security is
therefore the distribution of stake, nothing more: an entity holding a majority of
staked value holds the outcomes. Size `MIN_RESOLVER_STAKE` against that, and watch
the concentration, not just the count.

**Fee earnings are pull-based and unclaimed balances persist.** A resolver who
agreed with the settled outcome accrues a share and collects it with
`claim(agentId, to)`. Nothing sweeps it to them; nothing expires it into the
treasury either — `sweepUnallocated` cannot touch what is owed.
