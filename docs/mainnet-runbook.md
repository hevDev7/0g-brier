# Deploying Brier to 0G mainnet

Chain **16661**. Everything below was read out of the scripts that will run it,
not written from memory, and the paragraphs that say "this is irreversible" are
the ones to read twice.

**This has now been done.** What is live on 16661, verified on chain rather than
copied from a transcript:

| | |
|---|---|
| ConfigRegistry | `0x3289fcb307714774ac45de9606af6f95d2b2b4dd` |
| MarketFactory | `0x4c79210ce5236803d1369691c56e79c21dfd8fe0` |
| ResolutionModule | `0xd3ab1d14d85fbf24698d8e679c2e32c26c5c0fbb` |
| AgentRegistry | `0xe87a66e1ed8c1fee635ac0df70e0f7f03c695963` |
| Timelock | `0x4810a1bf3ef8f7d52d9d7a01155ddb171cea8d4e` (48 h) |
| Collateral | W0G `0x1cd0690ff9a693f5ef2dd976660a8dafc81a109c` |
| Deployed at | block 43180916, 2026-09-01 |

Fourteen resolvers are registered and staked at 0.2 W0G each — five for a round,
nine more for a dispute drawn from outside those five. The full manifest is
`deployments/16661.json`, rebuilt from the chain rather than from the deploy's own
simulation; see step 2 for why that distinction cost an afternoon.

**The first market**, `0x7c1f9c8b2C1b17fbB054d18735982cD9a696099E`, asks whether the
Coinbase ETH-USD close for the minute ending 2026-09-30 23:59:59 UTC is strictly
above 4000.00 USD. Trading runs to 2026-10-01 00:00 UTC and it must be settled by
2026-10-08. Its spec is `0x2081bf1b86b4acdead29092e69639ee100c2821c613449a69bbed822ad5041d3`
on MAINNET 0G Storage — the same root returns "File not found" from the testnet
indexer, which is the check worth repeating on any market you create.

That question settles through the ARITHMETIC route: `decideByThreshold` reads
"strictly greater than 4000.00", compares two numbers, and never calls an enclave.
The 3 0G Compute ledger in step 4 is therefore still unspent, and is only needed
for a market whose rules require judgement.

**A second market**, `0xCDc13Cc2830240518ce76a0a6ecbA51a4DBA8c35`, is the first that can
run a whole lifecycle in a day: DETERMINISTIC tier, a committee of three with a
threshold of two, trading to 2026-09-01 22:40 UTC and settlement by 2026-09-02
06:40 UTC. It asks whether one baseball game's combined final score beats 8.

Two things about its timing are worth copying rather than rediscovering. The
settlement window is EIGHT hours, not the four the tier's machinery needs, because
the game itself runs about three hours AFTER trading closes and the committee
cannot answer before the score is Final — the four hours of machinery have to fit
after the event, not after the market. And `MIN_SETTLEMENT_WINDOW` was lowered from
72 hours to 4 to permit this class of market at all. That is safe to change with
markets open: it is read only by `Market.initialize`, so an existing clone keeps
the deadline it was born with. `COMMIT_WINDOW`, `REVEAL_WINDOW` and the dispute
windows are NOT safe to change that way — they are read during settlement, so
moving them rewrites the rules of every market already waiting on one.

**The cliff is still open.** All four contracts remain owned by the deployer.

---

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

Copy `.env.mainnet.example` to `.env.mainnet` and fill it in — the deploy script
prefers that file over `.env`, so the Galileo config keeps working and no mainnet
key sits beside the testnet deployer that must never touch this chain. Every
entry there is marked either 🔑 (this machine signs with it) or 📬 (an address
only; the wallet signs for itself, elsewhere). `chmod 600` it; `.gitignore`
covers `.env.*` now rather than two names.

| env | what it ends up controlling |
|---|---|
| `GOVERNANCE` | proposer and executor on the timelock — every parameter, every upgrade |
| `GUARDIAN` | the pause. Fast, deliberately outside the timelock |
| `TREASURY` | receives the protocol's share of fees |
| `CURATOR_SIGNER` | signs the EIP-712 approval that lets a market be created |

Optional: `COLLATERAL` (an existing token; otherwise one is deployed),
`RESOLVER` (allowlisted at deploy, before the cliff — see step 4),
`TIMELOCK_DELAY` (**48 hours** by default), and `ERC8004_IDENTITY` /
`ERC8004_REPUTATION`.

**Leave the ERC-8004 pair EMPTY on mainnet.** Both canonical addresses hold an
ERC-1967 proxy with an empty implementation slot on 16661 — 130 bytes of code, so
a check on `code.length` passes, and every call through them reverts. On Galileo
the same addresses answer `"AgentIdentity"`. A deployment wired to them would look
fine and then fail at `linkErc8004` long afterwards. `Deploy.s.sol` and the
wrapper both call `name()` now rather than trusting code length, so a paste of
them is refused; unset means reputation publishing is simply off, which
`_publish` tolerates and settlement never notices. Governance can wire them later
if the registries are ever brought up.

The history is worth knowing because it is how the gap survived: until
2026-08-31 those addresses were only ever written by `UpgradeErc8004.s.sol`, run
against the live testnet after the fact — so they existed there and in no fresh
deployment, and mainnet is a fresh deployment.

The script only checks that these are distinct addresses. It cannot check that
they are *multisigs*, and it should not have to — but `GOVERNANCE` as a single
EOA means one stolen key eventually rewrites the protocol, with the 48-hour
delay as the only alarm. Use a Safe. The delay is there to give people time to
react to a proposal; a proposal nobody is watching for is just a slower theft.

---

## 1a. What each wallet has to hold

Gas on 0G mainnet was **4.0 gwei** when this was measured, the same as Galileo, so
the gas figures below are the measured ones and not a conversion. Everything in the
first table is **native 0G**.

| wallet | needs | why |
|---|---|---|
| **deployer** | **4 0G** | 0.15 to deploy (37.5M gas measured), 0.02 to register and stake fourteen resolvers, 0.07 handed on to their operator wallets, and **3 0G for the 0G Compute ledger** — that last item is the bulk of it and is easy to forget |
| **keeper** | **0.5 0G** | 0.008 per market settled, 0.016 if disputed. Half a token is about thirty disputed markets. It is the one wallet that runs unattended, so give it a margin you are not watching |
| **uploader** | **0.05 0G** | 0G Storage charged 2.5e-7 0G per upload; the flow transaction's gas dominates it and is still tiny |
| **guardian** | **0.05 0G** | `pause()` costs about 0.0002 0G. The amount is irrelevant; the point is that a guardian with an empty wallet is not a guardian, and you find that out during the incident |
| **governance** | **0.05 0G** | eight timelock transactions to take the four contracts, plus Safe overhead |
| **curator** | **nothing** | it signs EIP-712 approvals off-chain and never sends a transaction. Fund it only if the same wallet also creates markets |
| **treasury** | **nothing** | it receives. It never signs |

### The collateral is the larger bill

These are **not** gas, and they are denominated in the collateral — W0G, 18 decimals:

| | default | fourteen resolvers / one market |
|---|---|---|
| `MIN_RESOLVER_STAKE` | 100 W0G | **2,800 W0G** (the script stakes 2× the floor) |
| `MIN_SEED` | 100 W0G | 100 W0G per market |
| `MIN_SETTLEMENT_DEPOSIT` | 20 W0G | 20 W0G per market |
| `DISPUTE_BOND` | 50 W0G | 50 W0G, posted by whoever disputes |

The stake is locked, not spent, and returns after `UNSTAKE_COOLDOWN`. The seed is
liquidity and comes back through the market. Neither is a fee — but both have to be
on hand on the day.

**These four numbers are policy, not plumbing.** They read `100` because the
deployment they were written for settled in a 6-decimal stablecoin where 100 meant a
hundred dollars. A hundred W0G is a different quantity of belief. The deployer owns
the registry until the cliff closes, which is the window to set them, and the bounds
allow anything from one whole token upward. If you are launching to demonstrate the
protocol rather than to hold real open interest, say so in the parameters:

```bash
K(){ cast keccak "$1"; }
S(){ cast send "$CONFIG" 'setParam(bytes32,uint256)' "$(K "$1")" "$2" \
       --rpc-url "$RPC" --private-key "$DEPLOYER_KEY"; }
S MIN_RESOLVER_STAKE      1000000000000000000   # 1 W0G  → roster costs 28, not 2,800
S MIN_SEED                5000000000000000000   # 5 W0G
S MIN_SETTLEMENT_DEPOSIT  1000000000000000000   # 1 W0G
S DISPUTE_BOND            1000000000000000000   # 1 W0G
```

Run this BEFORE `setup-committee.sh`, which reads `MIN_RESOLVER_STAKE` to decide
what to stake, and before creating any market. Raising them afterwards is a
governance call and leaves members already staked above the new floor alone.

---

## 2. Deploy

```bash
bash scripts/deploy-mainnet.sh              # SIMULATES. Sends nothing.
bash scripts/deploy-mainnet.sh --broadcast  # actually deploys
```

Simulation is the default, and that is the one place this differs from the
Galileo script on purpose. On a testnet a wrong deploy costs a redeploy; here the
bounds set in the first transaction are permanent and the money is real, so
sending has to be something you asked for rather than something you got.

Everything it refuses, it refuses before a single transaction: the compromised
Galileo deployer **by address**, any role left unset or held by the deployer,
governance equal to guardian, a `COLLATERAL` with no code on 16661 or more than
eighteen decimals, an ERC-8004 pair half-configured, a balance too thin, and a
dirty working tree — because a mainnet manifest must correspond to a commit you
can point at. `DeployLib.resolveRoles` refuses most of it too; refusing it twice
is the point, since here it costs nothing and names the variable rather than a
Solidity selector.

Underneath it is the same script the runbook used to invoke directly:

```bash
forge script script/Deploy.s.sol --rpc-url "$MAINNET_RPC" --broadcast
```

In one transaction sequence this deploys the contracts, applies the bounds and
parameters, seeds the six categories, deploys the timelock, and calls
`transferOwnership` on four contracts.

### Which token to settle in

Read off chain on 2026-08-31 by scanning sixteen thousand blocks of `Transfer`
events — not from a token list, because a token list cannot tell you which chain
an address belongs to.

| token | address | dec | verdict |
|---|---|---|---|
| **W0G** | `0x1cd0690ff9a693f5ef2dd976660a8dafc81a109c` | 18 | **use this** |
| USDC.e | `0x1f3aa82227281ca364bfb3d253b0f1af1da6473e` | 6 | only with eyes open |
| USDT | — | — | not deployed |

**W0G is wrapped native 0G.** `deposit()`/`withdraw()` in the WETH9 shape, no
`upgradeTo`, no `pause`, no blacklist and no `owner` anywhere in its bytecode, and
not a proxy — all three ERC-1967 slots read zero. Nothing can change what it does,
which is the property that matters most for a token an unaudited protocol holds.

*A correction to an earlier reading of this file.* It said the token was "backed
exactly" because its native balance equalled `totalSupply` to the wei. That
comparison proves nothing: the contract is verified on chainscan as `WrappedA0GI`,
and

```solidity
function totalSupply() public view returns (uint) {
    return address(this).balance;
}
```

so the check compared the balance against itself. It could not have come out any
other way, on any wrapper of this shape, in any state.

What actually holds the backing up is the arithmetic, which is worth more than the
tautology was. `deposit()` credits `balanceOf[msg.sender] += msg.value` and
`withdraw()` debits exactly `wad` before sending exactly `wad`, so every path an
ordinary user can reach moves both sides together. There is no fee on transfer, no
rebase, and `transferFrom` moves precisely the amount asked for — which is the
property the pool's accounting depends on, since a market credits a trader with the
amount it requested rather than the amount that arrived.

**The one thing that could break it is `mint`, and it deserves reading closely:**

```solidity
function mint(address recipient, uint wad) external {
    (bool success, ) = address(WRAPPED_A0GI_BASE).call(
        abi.encodeWithSignature("mint(address,uint256)", msg.sender, wad)
    );
    require(success, "wrapped a0gi base mint failed");
    balanceOf[recipient] += wad;
    ...
}
```

`mint` is callable by ANYONE and has no caller check in this contract at all. An
earlier reading of this file said it "reverts for an arbitrary caller", and that is
not what it does. From an unauthorised EOA:

```
mint(0xdead…, 0)     -> 0x        SUCCEEDS
mint(0xdead…, 1)     -> reverted: wrapped a0gi base mint failed
mint(0xdead…, 1e18)  -> reverted: wrapped a0gi base mint failed
```

The zero-amount call **succeeds**. Execution passes every check in the wrapper and
every check in the precompile; only a comparison against an amount stops it. Probing
`0x0000000000000000000000000000000000001002` directly tells you what the two guards
actually are: from an EOA it answers `sender is not WA0GI`, and from the wrapper it
answers `insufficient mint cap`. So the wrapper is the only permitted caller, and
each address the wrapper forwards carries a **quota**. 0G's own precompile
documentation describes exactly this — quota-based mint and burn on top of a
conventional wrapper, with each address's quota set by the chain.

The honest statement is therefore not "nothing can inflate the supply". It is: **any
address 0G governance grants a nonzero mint quota can mint W0G permissionlessly**,
and today no ordinary address has one — no `Transfer` from the zero address appears
in the last 200,000 blocks. That is a consensus-layer capability, roughly the trust
you already extend by holding native 0G, and it is not the same as immutability.

Note too what `totalSupply()` cannot tell you. It compiles to `SELFBALANCE`, so it
reports the native currency held and nothing about `balanceOf` at all. A mint
credits `balanceOf[recipient]` directly. Whether the precompile also moves native
into the wrapper — the source comment says it does — is not verifiable from the EVM,
because the precompile has no bytecode and no published source. So the check that
was cited as proof of solvency is structurally incapable of detecting the one thing
that would break it.

**And there is a look-alike on this chain.** `0x7f73a890f0f608fa32e1dd29a5f552bc7dda0e01`
also answers `name()` "Wrapped 0G" and `symbol()` "W0G" on 16661. It is not
canonical — unverified source, 4 holders against 2,297, 344 transfers against
627,650 — but name and symbol are free to set, and copying an address out of a
search result is how the wrong one gets deployed. The address in this file is the
canonical wrapper, and the way you know is usage and the `WRAPPED_A0GI_BASE()`
getter, not the name.

**Two more things about W0G worth knowing before you settle in it.** Supply is
concentrated: a single EOA holds 66.9% of it, with no code and five nonces. And
`withdraw()` pays out through `payable(msg.sender).transfer(wad)` with its 2300-gas
stipend, so a *contract* holding W0G whose `receive()` does real work cannot unwrap.
Neither touches Brier — the Market never unwraps, and concentration is a liquidity
fact rather than a control one — but an agent whose address is a contract should
know the second one.

*One more thing the explorer will tell you, and it is not a forgery.* The verified
source declares `name = "Wrapped A0GI"` and `symbol = "WA0GI"`; the chain answers
"Wrapped 0G" and "W0G". Both are true. Those are storage variables written by the
constructor, so they live in the creation code and never appear in the runtime,
and verification compares runtime — which is why a source carrying the pre-rebrand
literals still verifies. The deployed runtime is byte-identical to the runtime
embedded in the creation transaction, the creation code plants `"Wrapped 0G"` and
`"W0G"`, and storage slots 0 and 1 hold exactly those. Every line of logic in the
published source is the logic that is deployed.

**Settling in W0G means every agent must wrap before it can trade.** Native 0G is
not an ERC-20 — it has no `transferFrom`, so no market can ever hold it — and an
agent arriving with a funded wallet owns nothing a market will accept. On Galileo
this never came up, because `MockUSDC` had an open `mintTo` and collateral was
free. It is the first thing that will surprise a trader on mainnet.

The SDK had no wrap path at all until this was found; it now does:

```ts
await client.wrapNative(collateral, parseEther("10"));   // 10 0G  -> 10 W0G, 1:1
await client.ensureAllowance(market, collateral, amount); // wrapping is not approving
```

`wrapNative` reads the token's bytecode first and refuses anything without
`deposit()` and `withdraw(uint256)`. That guard is not ceremony: sending native
currency to a plain ERC-20 with a payable fallback would be accepted, mint nothing,
and there is no second attempt at it. `unwrapNative` reverses the trade, with the
WETH9 caveat that it pays out through a bare `transfer` and its 2300-gas stipend —
ample for a key, not necessarily for a contract that does work in `receive()`.

**USDC.e is upgradeable and carries a blacklist.** `upgradeTo(address)` is in the
bytecode and `owner()` answers `0xecf08409A5e35aA58A887Cf892c6Af6648727281`. The
blacklist bites harder here than it looks: `Market._distributeFees` **pushes** to
the creator, the resolver pool and the treasury inside `settle`, `fail` and
`void`. Blacklist any one of those three and the settlement reverts and that
market's collateral is stuck for good. That is a wedge rather than a theft, and
it has no cure short of governance.

**Two things about USDC.e that an independent re-check added.** Its upgrade admin
is `0xc97a437cf5e495df5f1153b07dc3b179f33b52a8` and it is an EOA, not a multisig —
one key can replace the implementation and rewrite every balance, with no timelock.
And **a second, different token on 0G also carries the symbol `USDC.e`**:
`0x8a2b28364102bea189d99a475c494330ef2bdd0b`, "Bridged USDC (Stargate)", also 6
decimals, also a FiatToken proxy, under a different admin. Choosing this collateral
by symbol rather than by address picks one of two tokens at random. Settleable depth
is also thinner than the supply suggests: about 608,000 USDC.e across three Uniswap
V3 0.30% pools, and concentrated liquidity means usable depth at any given price is
a fraction of that.

**Do not reach for the ones that look native.** `a0G` (Ascend Staked 0G) and
`st0G` (Gimo Staked 0G) are staking derivatives holding no native 0G at all;
their value accrues. Reward-bearing or rebasing collateral breaks the pool's
accounting silently, which is the one failure mode that arrives without an error
message. The `zv*` tokens are LP shares. `AGENT`, `UNI-V3-POS`, `0GL` and `NSC`
are not fungible tokens and have no `decimals()`.

**The trap: `0x4B948d64dE1F71fCd12fB586f4c776421a35b3eE`.** 0G's own docs give
this as the official bridged 0G on Ethereum and BNB, and it also carries 12,611
bytes of code on 16661 — so it looks live, and a `cast code` check passes. It is
not an ERC-20 there: `symbol()`, `name()`, `decimals()` and `totalSupply()` all
revert. `Market.initialize` would revert inside `IERC20Metadata.decimals()`, and
by then the market has already taken the creator's collateral. This is the single
most plausible way a wrong address reaches the allowlist, which is why
`deploy-mainnet.sh` calls `decimals()` rather than trusting `code.length`.

**If you do choose USDC.e, one invariant stops being true.** It is Circle's
Bridged USDC Standard (`FiatTokenV2`, `currency()` = "USD"), bridged by XSwap over
Chainlink CCIP — the route 0G Labs announced, though no address is published in
the docs. Its `pauser()` and `blacklister()` are the same key,
`0x1E344B7d221E8d9b34Ec8Eb6aE5A0b772A4bB316`, and both powers were exercised on a
fork: after `pause()` every transfer reverts, after `blacklist(addr)` that
address's transfers revert.

Brier promises that **the pause never blocks an exit** — `sell`, `redeem` and
`liquidate` stay open while the protocol is paused, and a test enforces it. That
promise is enforced at the Market layer and no ERC-20 with a pauser can honour it
end to end: if the token is paused, the exit reverts inside `safeTransfer` where
Brier has no say. This is true of canonical USDC on every chain, so it is a thing
to state rather than a disqualifier — but it must be stated, because the spec
currently reads as though exits are unconditionally safe.

**Liquidity bounds a sensible market size.** The deepest pool is W0G/USDC.e at
`0x23336572435ec92d25ef0dd2d468b2a1abf7bb4f`, holding 165,973 USDC.e against
429,963 W0G; USDC.e's entire supply on the chain is 1.63M. The only DEX is a
Uniswap V3 fork (factory `0x6F3945Ab27296D1D66D8EEB042ff1B4fb2E0CE70`) with 22
pools ever created, three of them throwaway test tokens. Size the seed against
that, not against the token's market cap elsewhere.

**A note for anyone repeating this.** `chainscan.0g.ai` runs ConfluxScan software
and returns CIP-37 base32 addresses (`net16661:aatxzmbce…`), not hex — addresses
copied from its API are unusable without decoding. Its `/v1/token` endpoint
answers 200 with an empty list; the working one is
`/stat/tokens/list?transferType=ERC20`. There is no token list to import, which
is why everything above was found by scanning `Transfer` and `PoolCreated` logs.

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

**The resolver allowlist — NOT on mainnet.** `setResolver(resolver, true)` gates
exactly four functions on ResolutionModule: `settle`, `fail`, `markProposed` and
`markDisputed`. Those are the DIRECT-settlement path, where one allowlisted address
writes an outcome on its own signature with no committee, no commit-reveal and no
dispute round. `Deploy.s.sol` refuses to set it on 16661 for that reason, and
`deploy-mainnet.sh` now refuses before it even reaches forge.

The committee path does not touch `isResolver` at all — `commitVote`, `revealVote`
and `finalize` check committee membership, not the allowlist. So on mainnet this
step is: leave it empty, and confirm it. `isResolver(<anyone>)` should answer false.

This entry used to read "setResolver(resolver, true) on ResolutionModule" with no
qualification, which is right for a local demo and would tell a mainnet operator to
install the one key that can decide every market.

**Enough staked resolvers to form a committee.** A committee is sampled only
from agents registered as resolvers whose `activeStake` is at least
`MIN_RESOLVER_STAKE` — **100 whole collateral tokens** at the deployed default,
so 100 W0G on a W0G deployment, not the 100e6 wei that the same literal meant
against the 6-decimal testnet mock. Below that count,
`openResolution` reverts with `NotEnoughResolvers` and every closed market waits
until its settlement deadline passes and it **fails** — which looks like a
committee that refused to show up, when it is really a launch that forgot to
staff itself.

Size the roster against the largest round you intend to reach, which is the
DISPUTE round at **nine**, not the five a VERIFIED market samples — and round two
excludes every member of round one, so nine *more* than the five already sitting.
**Price the roster before you build it.** `setup-committee.sh` stakes twice the
floor per member so that a slash cannot drop one below it mid-run, so fourteen
resolvers at the default lock **2,800 W0G**. That is locked, not spent — it comes
back after `UNSTAKE_COOLDOWN` — but it has to be held on the day.

The stake is policy, and its bounds are `1 .. UNBOUNDED`, so it is a parameter you
choose rather than one you inherit. The deployer still owns the registry until the
cliff, which is exactly the window in which to set it:

```bash
# 1 W0G per resolver instead of 100 — a launch roster costs 28 W0G, not 2,800
cast send "$CONFIG" 'setParam(bytes32,uint256)' \
  "$(cast keccak MIN_RESOLVER_STAKE)" 1000000000000000000 \
  --rpc-url "$RPC" --private-key "$DEPLOYER_KEY"
```

Do it BEFORE `setup-committee.sh`, which reads the parameter to decide what to
stake. Raising it later is a governance call and does not disturb members already
staked above the new floor; it only gates the next registration. Understand what a
low stake buys, though: the committee's honesty is bought with the stake, and a
roster that risks 1 W0G a head is secured by 14 W0G against whatever the open
interest turns out to be. It is the right number for a launch with no money in it
and the wrong number the moment there is.

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

**The committee settled a market wrong, and nothing stopped it.** This is no
longer a risk to reason about. On 2026-08-31, market
`0xC5B6db9a7342Ff0F414ef524460078cddEaf16EE` asked whether the Coinbase ETH-USD
close for a pinned minute was above $2,425.00. The close was **$2,450.66**. The
rules say YES. All three sampled resolvers answered **NO** — each running
`qwen/qwen2.5-omni-7b` inside a TEE, each attestation verified, each giving the
same rationale:

> "The Coinbase ETH-USD close ... was $2450.66, which is above $2,425.00."

The sentence states the premise correctly and emits the opposite label. Three
times, identically. The threshold of two was met and the market settled NO on
chain, `viaCommittee: true`.

Everything the protocol enforces worked. The draw was fair, the commitments bound
their senders, the reveals matched, the threshold counted, the receipts are on 0G
Storage and readable. The mechanism carried a wrong answer faithfully to
settlement, because a committee of one model is a committee of one — and TeeML
attests that an enclave ran the model, never that the model was right.

Two things follow for a deployment carrying value:

- **Correlated resolvers were a TESTNET limitation, and mainnet lifts it.** On
  Galileo 0G Compute serves two services, one of them image editing — so a
  committee there is one text model, `qwen/qwen2.5-omni-7b`, counted N times,
  which is exactly how the wrong settlement above happened. Mainnet lists
  **twelve services, seven of them TeeML-attested text models**: `GLM-5-FP8`,
  `qwen3.7-plus`, `gpt-5.4-mini`, `glm-5.2`, `0GM-1.0-35B-A3B`, `MiniMax-H3` and
  `0GM-1.0-35B-A3B-SIA`. (`claude-opus-5` and `claude-fable-5` are listed as
  `standard` verifiability rather than TeeML, so `resolve.ts` will refuse their
  answers and abstain — do not count them.) List them yourself with
  `CHAIN_ID=16661 npx tsx examples/providers.ts`.

  `examples/resolve.ts` now takes `ZG_PROVIDERS` — a comma-separated list handed
  out round-robin across the sampled committee, so five members across five
  providers is five different models judging the same evidence. That is the
  configuration in which the threshold means something and a dissent is a real
  signal rather than an impossibility. It is opt-in because it costs: each
  provider needs its own sub-account and TEE acknowledgement, so run
  `scripts/setup-compute.mjs --provider 0x…` once per address, at 1 0G each on
  top of the 3 0G ledger.

  Two caveats worth carrying. The evidence is still read ONCE and shared, by
  design — three fetches of the same candle seconds apart would produce three
  legitimately different readings and a split vote nothing was wrong with. And a
  numeric-threshold question no longer reaches a model at all; `decideByThreshold`
  settles it in code. Model diversity is what protects the questions that need
  judgement, not the ones that need arithmetic.
- **The dispute round is the only correction, and it costs a bond.** Nobody
  disputed this one because nobody was watching. On mainnet, whoever holds the
  losing side is the party who must notice within the window — a security model
  rather than an accident, and one to state to users rather than assume.

`scripts/committee-run.mjs` decides the same class of question deterministically
from the source and got it right on the market before this one. That is the
comparison worth keeping in view: the arithmetic is not what failed.

**Resolver registration is permissionless.** Anyone may register as a Resolver
and become eligible by staking `MIN_RESOLVER_STAKE`. The committee's security is
therefore the distribution of stake, nothing more: an entity holding a majority of
staked value holds the outcomes. Size `MIN_RESOLVER_STAKE` against that, and watch
the concentration, not just the count.

**Fee earnings are pull-based and unclaimed balances persist.** A resolver who
agreed with the settled outcome accrues a share and collects it with
`claim(agentId, to)`. Nothing sweeps it to them; nothing expires it into the
treasury either — `sweepUnallocated` cannot touch what is owed.
