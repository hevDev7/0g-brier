# 0G-Delphi — An Agent-Native Binary Prediction Market on 0G Chain

**Status:** Design spec (v1) · **Date:** 2026-08-27 · **Target chain:** 0G Galileo testnet (16602) → 0G mainnet (16661)

---

## 1. Executive Summary

0G-Delphi is a binary prediction market in which **the entire market lifecycle is driven by AI agents**: agents that design and fund markets, agents that guard their quality, agents that resolve their outcomes through TEE-verified inference, and a user's own agents that take buy/sell positions.

Three choices shape this system:

1. **Prices come from the DPM cost function** `C(q) = √(Σ qᵢ²)`. The pool funds its own payouts, so the protocol **structurally cannot become insolvent** and needs no liquidity subsidy.
2. **Settlement is performed by a staked committee of agents** running inference on 0G Compute with mandatory TeeML attestation, storing the complete receipt on 0G Storage, through commit–reveal with a dispute window and slashing.
3. **Agent risk limits are enforced in the contracts**, not in agent code. Every user has their own `AgentAccount`; an agent never holds the user's wallet key and cannot exceed the policy that was set.

The main differentiator against Delphi (Gensyn), the closest existing reference: **Delphi forbids agents from creating markets** — "Agents cannot create markets. Markets must be created through the Delphi UI." In 0G-Delphi, market creation is a first-class agent action.

---

## 2. Locked Decisions

| # | Decision | Reason |
|---|---|---|
| D1 | Pricing mechanism: **Pennock DPM** `C(q)=√(Σqᵢ²)` | Pool-funded ⇒ always solvent, no LP subsidy, needs only `sqrt` in Solidity, and the creator's symmetric seed has a stateable loss bound (29.29% — see §14.1 INV-7 for why that figure is the symmetric case and not a general LP bound) |
| D2 | Collateral: **6-decimal mUSDC**, internal maths in 18-decimal wad | The decimal normalization layer is exercised from day one; switching to a real stablecoin is a configuration change |
| D3 | Resolution: **a k-of-n AI committee on 0G Compute** + commit–reveal + dispute + slashing | The "agent-driven" premise holds all the way through settlement; verifiability comes from TeeML |
| D4 | Agents: **a managed runtime + a thin SDK**, identity on the **ERC-7857** path | Demo and production do not depend on third-party agents; identity remains an on-chain asset |
| D5 | Target: **a serious product heading for 0G mainnet** | Split into P0–P7, each phase with its own spec and plan |
| D6 | 0G testnet funds are available (>5 0G) | The `INFERENCE_MODE=compute` (TEE) path is tested live from P4 rather than deferred |

**Adopted from Delphi:** DPM (not LMSR/CLOB), tiered settlement, creators writing their own settlement prompt, `failed` status → liquidation (not redemption), SDK ergonomics.
**Not adopted:** the ban on agents creating markets, and the dependency on a managed subgraph.

---

## 3. Verified Environment Facts (probed 2026-08-27)

### 3.1 0G Chain

| Item | Galileo testnet | Mainnet |
|---|---|---|
| Chain ID | `16602` | `16661` |
| RPC | `https://evmrpc-testnet.0g.ai` | `https://evmrpc.0g.ai` |
| Explorer | `https://chainscan-galileo.0g.ai` | — |
| Faucet | `https://faucet.0g.ai` — **0.1 0G / wallet / day** | — |
| Faucet alt | `https://cloud.google.com/application/web3/faucet/0g/galileo` | — |
| Native token | `0G` | `0G` |

Galileo system contracts: Flow `0x22E03a6A89B950F1c82ec5e74F8eCa321a105296` · Mine `0x00A9E9604b0538e06b268Fb297Df333337f9593b` · Reward `0xA97B57b4BdFEA2D0a25e535bd849ad4e6C440A69` · DAEntrance `0xE75A073dA5bb7b0eC622170Fd268f35E675a957B`

### 3.2 0G Storage

Package: **`@0gfoundation/0g-storage-ts-sdk`** (peer dep `ethers`). Testnet indexer: `https://indexer-storage-testnet-turbo.0g.ai`.

```ts
const file       = new MemData(bytes);           // or ZgFile.fromFilePath(path)
const [tree,err] = await file.merkleTree();      // tree.rootHash() — no network needed
const indexer    = new Indexer(indexerRpc);
const [tx, uerr] = await indexer.upload(file, evmRpc, signer);   // needs 0G Chain gas
const derr       = await indexer.download(rootHash, outPath, /*withProof*/ true);
```

**Reading needs none of that.** `GET {indexer}/file?root=0x…` returns the bytes over plain HTTPS
with `access-control-allow-origin: *`, so a browser can fetch a document directly, and a root a
node has never seen comes back as `{"code":101,"message":"File not found"}` at HTTP 200. The
frontend therefore carries no SDK and no `ethers`: it fetches, recomputes the Merkle root with
`keccak256`, and compares. See `frontend/src/lib/data/zg-storage.ts`, pinned to the SDK by 19
vectors.

The tree is 256-byte chunks under 1024-chunk segments, and two details of it are easy to get
subtly wrong: padding above 16 chunks rounds up to a multiple of a sixteenth of the next power of
two rather than to the power of two itself, and an odd node is carried unchanged to the back of
the queue rather than paired with itself.

### 3.3 0G Compute

Paket: **`@0gfoundation/0g-compute-ts-sdk`** (v0.8.0+).
⚠️ `@0glabs/0g-serving-broker` is **deprecated** — do not use it in new code.

```ts
const broker = await createZGComputeNetworkBroker(wallet);
await broker.ledger.depositFund(10);                                   // min 3 0G to create a ledger
await broker.ledger.transferFund(provider, 'inference', 1n * 10n**18n); // min 1 0G per provider
const services = await broker.inference.listService();                 // the catalogue shifts: DO NOT hardcode
const { endpoint, model } = await broker.inference.getServiceMetadata(provider);
const headers = await broker.inference.getRequestHeaders(provider);    // single-use, per request
const res  = await fetch(`${endpoint}/chat/completions`, { method:'POST', headers:{...headers,'Content-Type':'application/json'}, body: JSON.stringify({ messages, model, temperature: 0 }) });
const chatID   = res.headers.get('ZG-Res-Key') ?? (await res.json()).id;
const verified = await broker.inference.processResponse(provider, chatID);  // ← atestasi TEE
```

Default rate limit: **30 rpm sustained, burst 5, 5 concurrent** per user. HTTP 429 = the limit was hit. Fees settle in batches, not per request.

**Alternative path — the Compute Router:** OpenAI-compatible, testnet `https://router-api-testnet.integratenetwork.work/v1`, mainnet `https://router-api.0g.ai/v1`, one API key + one on-chain balance, automatic provider failover. **It does not expose TEE attestation** ⇒ it may be used only for the `FAST` tier and for trader-agent reasoning, **never** for the `VERIFIED` tier.

### 3.4 Architectural consequences of the facts above

| Fact | Consequence |
|---|---|
| The provider catalogue shifts | Provider discovery **at runtime** + a TTL cache + a preference list, not hardcoded addresses |
| 30 rpm / 5 concurrent | A queue + rate limiter in the agent runtime; committee settlement jobs are scheduled, never bursted |
| The router has no TEE | Two separate inference clients behind one `IInferenceClient` interface |
| There is no subgraph on 0G | Our own indexer is mandatory, not optional |
| Faucet 0.1 0G/hari | Skrip `fund-compute.mts` + monitor saldo ledger; alarm sebelum ledger kering |

---

## 4. The DPM Maths

### 4.1 Definitions

For a binary market with share supply `q = (q₀, q₁)` (index 0 = NO, 1 = YES), all in wad:

```
Cost function        C(q)  = √(q₀² + q₁²)
Harga marginal       pᵢ    = ∂C/∂qᵢ = qᵢ / C(q)
Probabilitas implisit Pᵢ   = pᵢ²     = qᵢ² / (q₀² + q₁²)
Cost to buy Δ shares of i   ΔC       = C(q + Δeᵢ) − C(q)
Proceeds of selling Δ of i  ΔC       = C(q) − C(q − Δeᵢ)
Payout per winning share    C(q) / q_win     =  1 / p_win
```

### 4.2 The properties made into invariants

| Property | Statement | What it buys |
|---|---|---|
| **Solvency** | the contract's cash `= C(q)` at all times | the protocol cannot become insolvent |
| **Normalization** | `Σ pᵢ² = 1` | `pᵢ²` is a valid probability distribution |
| **Euler (homogeneous of degree 1)** | `Σ pᵢ·qᵢ = C(q)` | liquidation pays `pᵢ` per share and **exactly** exhausts the pool |
| **Path independence** | the cost depends only on the initial & final `q` | it cannot be arbitraged by splitting orders |
| **Provider loss bound** | loss ≤ `1 − min(p₀, p₁)` **at the moment of entry** — which equals `1 − 1/√2 ≈ 29.29%` ONLY when the book is symmetric | the risk bound can still be stated, but it is a function of the book's skew, not a constant |
| **LP neutrality** | adding `λ` proportionally ⇒ `Pᵢ` does not change | a liquidity primitive that does not move the price |

**Proof of the 29.29% bound, for a SYMMETRIC provider.** The general statement is `recovery ≥ deposit × min(p₀,p₁)` at entry (derived in §14.1); this is that formula evaluated at `p₀ = p₁ = 1/√2`. A provider deposits `L = C(q₀,q₀) = q₀√2` and receives `q₀` shares on each side. At settlement they receive `q₀ · C(q_final)/q_win`. Because `C(q) ≥ q_win` for all `q`, the receipt is `≥ q₀`. The worst-case ratio is `q₀ / (q₀√2) = 1/√2`. ∎

**Proof of LP neutrality.** `C` is homogeneous of degree 1 ⇒ `q → (1+λ)q` gives `C → (1+λ)C` and leaves `Pᵢ = qᵢ²/Σqⱼ²` unchanged. The cost is `= λ·C(q)`, and the shares received are `= λ·qᵢ` per outcome. ∎
Adding **the same absolute amount** to both sides is neutral only when `q₀ = q₁`; that is why the addition used is **proportional**.

### 4.3 A worked example (seed 1000/1000, mUSDC)

| Action | q₀ / q₁ | Pool | P(YES) | Note |
|---|---|---|---|---|
| Creator seed | 1000 / 1000 | 1414.21 | 50.0% | bayar `L` = 1414.21, pegang 1000+1000 (terkunci) |
| Agent buys 200 YES | 1000 / 1200 | 1562.05 | **59.0%** | pays 147.84 → 0.7392/share |
| Settle YES | — | 1562.05 | — | 1.3017/share → agent 260.35 (**1.76×**), creator 1301.71 (−7.95%) |
| (alternative) Failed | — | 1562.05 | — | liquidation: NO 0.6402/share, YES 0.7682/share → total 1562.05 ✓ |

The table above starts from `q`; the API starts from collateral. The conversion: a deposit `L` yields
`q₀ = q₁ = L/√2`. So `L = 1000 mUSDC` ⇒ `q = (707.11, 707.11)` and pool = 1000 — these are the numbers
the §14.3 e2e scenario uses, not the first row of this table.

### 4.4 Implementation & rounding

`q` in wad ⇒ `qᵢ²` is scaled by 1e36 ⇒ **an integer `sqrt` over `q₀² + q₁²` lands directly in wad** with no rescaling. Overflow bound: `qᵢ ≤ 1e33 wad` (a `require`), because `2·(1e33)² = 2e66 < 2²⁵⁶`.

Rounding policy — **always in the pool's favour**:

```solidity
// the pool is not "accumulated" but SET to a target. Rounding dust always ends up in the pool.
uint256 target = DPMMath.costUp(qNew);   // sqrt rounded UP
cost      = target - poolBalance;         // buy   (≥ biaya matematis)
proceeds  = poolBalance - target;         // sell  (≤ the mathematical result)
poolBalance = target;                     // the poolBalance == costUp(q) invariant holds by construction
```

At the token boundary (6 decimals): money in is rounded **up**, money out is rounded **down**.

Because of the rounding up, a very small `buy` could produce `cost == 0`. Every `buy`/`sell` therefore
requires `tokens >= minTradeTokens` (§17) and `require(cost > 0)` — dust trades are rejected, not
served for free.

### 4.5 A trade-off acknowledged openly

**Payout dilution.** The payout per winning share `= C(q)/q_win` **floats until the market closes**: later YES buyers raise `q_YES` faster than `C(q)`, which lowers the payout of earlier YES holders. LMSR locks the payout at 1.0 at purchase time; DPM does not. This is an unavoidable consequence of "the pool funds its own payouts".

Mitigation: `sell` is continuously available so a holder can exit and lock in a price, and the UI **must** display the running payout (not a locked one) together with its warning. This is a deliberate decision, and the same one Delphi made.

---

## 5. The Domain Model & Lifecycle

### 5.1 Market status

```
                       ┌──────── void() [guardian, pra-tutup] ────────┐
                       │                                              ▼
Draft ──approve──▶  Open ──tradingEnd──▶ Closed ──≥k reveal sepakat──▶ Proposed ──finalize──▶ Settled
(off-chain)            │                    │                             │                    (redeem)
                       │                    │                        dispute(bond)
                       │              settlementDeadline                  ▼
                       │                    │                        Disputed ──round 2 agrees──▶ Settled
                       ▼                    ▼                             │
                    Voided              Failed ◀──── round 2 fails ───────┘
                  (liquidate)         (liquidate)
```

| Status | Buy | Sell | Redeem | Liquidate |
|---|---|---|---|---|
| `Open` | ✓ | ✓ | — | — |
| `Closed` / `Proposed` / `Disputed` | — | — | — | — |
| `Settled` | — | — | ✓ (sisi menang) | — |
| `Failed` / `Voided` | — | — | — | ✓ (every side, `pᵢ`/share) |

`Closed` locks trading so that `q` — and therefore the payout — cannot be shifted while the committee is deliberating.

### 5.2 MarketSpec (JSON, stored on 0G Storage, with `specRoot` on chain)

```jsonc
{
  "version": 1,
  "question": "Will the ETH/USD closing price at 2026-09-30 23:59 UTC be above $4000?",
  "rules": "Resolves YES if ... Resolves NO if ... Deemed UNRESOLVABLE if ...",
  "category": "crypto",              // crypto|politics|sports|economics|science|culture
  "sources": [ { "kind": "http", "url": "...", "selector": "..." } ],
  "settlementPrompt": "<the creator's own prompt, inserted into the category template>",
  "tier": "VERIFIED",                // FAST | VERIFIED | DETERMINISTIC
  "tradingEnd": 1790000000,
  "settlementDeadline": 1790086400,
  "creatorAgentId": 42,
  "curatorApproval": { "agentId": 7, "signature": "0x..." }
}
```

`specRoot` **is** this document's 0G Storage Merkle root — stored verbatim, not hashed again.
The root is already a `bytes32` content address, and hashing it a second time would be one-way:
nothing could fetch the document, which is the entire purpose of anchoring it. The first live
market on Galileo shipped with `keccak256` of a string and no document behind it, and its
question is unreadable for exactly that reason.

The spec's content is **immutable** once the market is created — resolvers judge exactly what was
promised to traders — and a reader can prove it, because the bytes it receives must hash back to
the root the chain holds.

---

## 6. Contract Architecture

### 6.1 The module map

| Contract | Responsibility | Pattern | Upgradeable |
|---|---|---|---|
| `DPMMath` | cost/price/probability, semua wad, pure | library | — |
| `Market` | `q`, `poolBalance`, buy/sell/liquidity/exit, the lifecycle | an EIP-1167 clone | **No** (it holds funds) |
| `OutcomeShares` | ERC-1155 tradable positions, `id = uint160(market)<<8 \| outcome` — a market can only touch its own ids | singleton | No |
| `MarketFactory` | clone + registry + versi implementasi + parameter default | — | UUPS + timelock |
| `ResolutionModule` | komite, commit–reveal, threshold, dispute, slashing | — | UUPS + timelock |
| `AgentRegistry` | agent identity (the ERC-7857 path), the operator key, stake, reputation | ERC-721 → 7857 | UUPS + timelock |
| `AgentAccountFactory` / `AgentAccount` | custody of user funds + policy enforcement | one clone per user | No |
| `Treasury` | fee protokol, insurance fund, sweep dana tak diklaim | — | UUPS + timelock |
| `ConfigRegistry` | alamat, parameter, guardian, pause | — | UUPS + timelock |
| `MockUSDC` | a 6-decimal test collateral + a faucet | testnet only | — |
| `PythAdapter` / `MockPyth` | sumber resolusi `DETERMINISTIC` | — | — |

**The separation principle:** a contract that **holds user funds is never upgradeable**. Only coordination logic is upgradeable (factory, resolution, registry), and always behind a 48-hour timelock.

### 6.2 `DPMMath`

```solidity
library DPMMath {
    uint256 internal constant WAD   = 1e18;
    uint256 internal constant MAX_Q = 1e33;               // 2*(1e33)^2 = 2e66 < 2^256

    error QOverflow();
    error QUnderflow();

    /// @notice C(q) = sqrt(q0^2 + q1^2). q in wad → the result in wad. Rounded DOWN.
    function cost(uint256[2] memory q) internal pure returns (uint256);

    /// @notice cost() rounded UP (+1 wei when not exact). Used for all pool state.
    function costUp(uint256[2] memory q) internal pure returns (uint256);

    /// @notice p_i = q_i * WAD / C(q). Berlaku sum(p_i^2) == WAD^2 / WAD.
    function price(uint256[2] memory q, uint8 i) internal pure returns (uint256);

    /// @notice P_i = p_i^2 = q_i^2 * WAD / (q0^2 + q1^2). The probability the UI displays.
    function probability(uint256[2] memory q, uint8 i) internal pure returns (uint256);

    /// @notice The inverse: how many shares `spend` collateral (wad) buys. Newton, rounded DOWN.
    function sharesForSpend(uint256[2] memory q, uint8 i, uint256 spend) internal pure returns (uint256);
}
```

`sharesForSpend` has a closed form in the binary case and needs no iteration:
given `C₁ = C(q) + spend`, where `spend` is the portion entering the pool (**already net of fee**), find `x` such that `√((qᵢ+x)² + q_j²) = C₁` ⇒ **`x = √(C₁² − q_j²) − qᵢ`**. Exact, one `sqrt`, no Newton. (Newton is needed only if this is later extended beyond 2 outcomes.)

### 6.3 `Market`

```solidity
interface IMarket {
    enum Status { Open, Closed, Proposed, Disputed, Settled, Failed, Voided }

    struct Params {
        address collateral;          // ERC-20 (6-decimal mUSDC on testnet)
        uint8   collateralDecimals;
        address creator;
        uint256 creatorAgentId;
        uint64  tradingEnd;
        uint64  settlementDeadline;
        uint16  feeBps;              // atas notional
        uint8   tier;                // 0=FAST 1=VERIFIED 2=DETERMINISTIC
        bytes32 specRoot;            // 0G Storage
        bytes32 category;
    }

    // ── quotes (view, no side effects) ──────────────────────────────────────
    function quoteBuy(uint8 outcome, uint256 sharesOut)  external view returns (uint256 tokensIn,  uint256 fee);
    function quoteBuySpend(uint8 outcome, uint256 tokensIn) external view returns (uint256 sharesOut, uint256 fee);
    function quoteSell(uint8 outcome, uint256 sharesIn)  external view returns (uint256 tokensOut, uint256 fee);

    // ── perdagangan ─────────────────────────────────────────────────────────
    function buy (uint8 outcome, uint256 sharesOut, uint256 maxTokensIn, address to) external returns (uint256 tokensIn);
    function sell(uint8 outcome, uint256 sharesIn,  uint256 minTokensOut, address to) external returns (uint256 tokensOut);

    // ── proportional liquidity (probability-neutral) ────────────────────────
    function addLiquidity(uint256 tokensIn, uint256 minSharesOut, address to)
        external returns (uint256[2] memory seedSharesMinted);
    /// @param lambdaWad the wad fraction of the current q being withdrawn; withdrawal[i] = q[i]*lambdaWad/WAD.
    ///        Proporsional ⇒ netral terhadap probabilitas. Penarikan tak-proporsional dilarang
    ///        because it would amount to a directional trade with no fee.
    function removeLiquidity(uint256 lambdaWad, uint256 minTokensOut, address to)
        external returns (uint256 tokensOut);   // only while Status == Open

    // ── siklus hidup ────────────────────────────────────────────────────────
    function close() external;                                   // siapa pun, setelah tradingEnd
    function settle(uint8 outcome) external;                     // ResolutionModule only
    function fail() external;                                    // ResolutionModule, or after settlementDeadline
    function void(bytes32 reason) external;                      // Guardian only, pre-Closed only

    // ── keluar ──────────────────────────────────────────────────────────────
    function redeem(address to)    external returns (uint256 tokensOut);  // Settled: winning shares → C(q)/q_win
    function liquidate(address to) external returns (uint256 tokensOut);  // Failed/Voided: all shares → p_i
    function sweepUnclaimed() external;                                   // → Treasury, setelah sweepUnclaimedAfter

    // ── view ────────────────────────────────────────────────────────────────
    function q() external view returns (uint256[2] memory);
    function poolBalance() external view returns (uint256);        // wad, selalu == DPMMath.costUp(q)
    function probability(uint8 outcome) external view returns (uint256);
    function payoutPerShare(uint8 outcome) external view returns (uint256);
    function status() external view returns (Status);
    function seedSharesOf(address account) external view returns (uint256[2] memory);
}
```

**Seed shares vs tradable shares.** `qᵢ = tradableSupplyᵢ (ERC-1155) + seedSupplyᵢ`.
Seed shares (from `createMarket` and `addLiquidity`) are **not** minted as ERC-1155; they are recorded in `seedShares[account][outcome]` inside `Market`. Seed shares can never be transferred and can never be sold through `sell()`.

Withdrawal is split into two classes, and this distinction is **mandatory** — without it the `qᵢ > 0` guarantee collapses:

| Class | Source | Withdrawable? |
|---|---|---|
| **Creator seed** (`creatorSeedᵢ`, fixed at `createMarket`) | `createMarket` | **Never.** Only `redeem`/`liquidate` once the market is finished. |
| **LP seed** (`seedSupplyᵢ − creatorSeedᵢ`) | `addLiquidity` | Yes, through `removeLiquidity`, but **only while `Open`** and never through the `creatorSeedᵢ` floor. |

`removeLiquidity` therefore carries `require(seedSupplyᵢ - shares[i] >= creatorSeedᵢ)` for both outcomes.

**Reason (a design finding):** without this floor, `q_YES` could reach 0 while YES wins, making `C(q)/q_win` divide by zero and leaving the pool with no rightful owner. With the `creatorSeedᵢ` floor, `qᵢ ≥ seedSupplyᵢ ≥ creatorSeedᵢ > 0` holds forever, and it also prevents the probability from being pushed to a degenerate extreme with little capital. It is also what makes the 29.29% loss bound meaningful: the creator really does carry their position to the end.

**Fee accounting.** `feeAccrued` is a separate variable from `poolBalance` and is **never** part of `C(q)`.
`buy`: the user pays `ΔC + fee`. `sell`: the user receives `ΔC − fee`. Distribution at `Settled`/`Failed`:
`creatorFeeShareBps` → creator, `resolverFeeShareBps` → kas hadiah resolver, sisanya → `Treasury`.

**Guardian & pause.** `ConfigRegistry.paused()` blocks `createMarket`, `buy`, and `addLiquidity`.
It **never** blocks `sell`, `redeem`, `liquidate`, or `AgentAccount.withdraw` — a user can always exit. This is an explicit test, not merely a convention.

**Events (the contract with the indexer):**

```solidity
event MarketCreated(address indexed market, uint256 indexed creatorAgentId, bytes32 specRoot, uint256 seed, uint8 tier);
event Trade(address indexed market, address indexed trader, uint256 indexed agentId, uint8 outcome,
            int256 sharesDelta, uint256 tokens, uint256 fee, uint256[2] qAfter, uint256 probAfter);
event LiquidityChanged(address indexed market, address indexed provider, int256 lambdaWad, uint256[2] qAfter);
event StatusChanged(address indexed market, Status from, Status to);
event Settled(address indexed market, uint8 outcome, bytes32 receiptRoot, uint256 payoutPerShare);
event Redeemed(address indexed market, address indexed account, uint256 shares, uint256 tokensOut);
event Liquidated(address indexed market, address indexed account, uint256[2] shares, uint256 tokensOut);
```

`Trade` deliberately carries `qAfter` and `probAfter` so an indexer can reconstruct the probability curve without any historical `eth_call`.

### 6.4 `MarketFactory`

```solidity
function createMarket(
    IMarket.Params calldata p,
    uint256 seedCollateral,          // ≥ minSeed
    uint256 settlementDeposit,       // ≥ minSettlementDeposit
    bytes   calldata curatorSig      // EIP-712 from an agent in the Curator role
) external returns (address market);
```

`seedCollateral = L` ⇒ `q₀ = q₁ = L/√2` seed shares for the creator.
`curatorSig` menandatangani `keccak256(specRoot, tradingEnd, settlementDeadline, tier, creatorAgentId, nonce, chainId)`.
The `permissionlessCreation` flag in `ConfigRegistry` allows a curator-free path later (a larger bond, a longer dispute window) — **off in v1**.

---

## 7. The Resolution Module

### 7.1 The three tiers

| Tier | Inference path | Evidence | Committee | Dispute window | Resolver fee |
|---|---|---|---|---|---|
| `FAST` | Compute **Router** | a receipt on 0G Storage, no attestation | 1 | 24 h | low |
| `VERIFIED` | **broker** `@0gfoundation/0g-compute-ts-sdk` | `processResponse() == true` **wajib** + receipt | 5, k=3 | 6 jam | sedang |
| `DETERMINISTIC` | adapter data/harga (Pyth Hermes) | atestasi EIP-712 worker | 3, k=2 | 2 jam | rendah |

Lower trust ⇒ a **longer** dispute window, not a shorter one.

### 7.2 The interface

```solidity
interface IResolutionSource {
    function kind() external view returns (bytes32);           // "TEE_COMMITTEE" | "ROUTER" | "PRICE_FEED"
    function isEligible(address resolver, address market) external view returns (bool);
    function validateReveal(address market, uint8 outcome, bytes32 receiptRoot, bytes calldata proof)
        external view returns (bool);
}

interface IResolutionModule {
    struct Round {
        uint8     n; uint8 k; uint8 index;
        uint64    commitDeadline; uint64 revealDeadline;
        address[] committee;
        uint16    commits; uint16 reveals;
        uint16[3] tally;                 // [NO, YES, UNRESOLVABLE]
        uint8     proposedOutcome;
        uint64    disputeDeadline;
    }

    function openResolution(address market) external;                       // dipanggil Market.close()
    function commitVote(address market, bytes32 commitment) external;       // committee members only
    function revealVote(address market, uint8 outcome, bytes32 salt, bytes32 receiptRoot) external;
    function finalize(address market) external;                             // setelah disputeDeadline
    function dispute(address market, bytes32 evidenceRoot) external;        // butuh disputeBond
    function markFailed(address market) external;                           // setelah settlementDeadline

    function roundOf(address market) external view returns (Round memory);
    function receiptRootOf(address market, address resolver) external view returns (bytes32);
}
```

`commitment = keccak256(abi.encode(market, outcome, salt, receiptRoot, msg.sender))` — binds the resolver so a commitment cannot be copied.

### 7.3 The flow

```
1. Market.close()                → ResolutionModule.openResolution()
                                   deterministic committee sampling from active staked resolvers
                                   commitDeadline = now + commitWindow
2. commitVote()                  → the hash only; nobody can copy anyone
3. revealVote()                  → outcome + salt + receiptRoot; validateReveal() dipanggil
4. ≥ k reveal sepakat            → Status=Proposed, disputeDeadline = now + disputeWindow(tier)
   (if the outcome that reaches the threshold is UNRESOLVABLE, finalize() calls Market.fail()
    rather than Market.settle() — the exit path is liquidation)
5a. no dispute    → finalize()   → Market.settle(outcome)
                                   resolver sepakat: bagi kas hadiah
                                   resolver beda   : slash disagreeSlashBps
                                   no reveal       : slash noShowSlashBps
5b. dispute(bond)                → Status=Disputed, round 2 (n=9,k=5), excluding round-1 members
      round 2 ≠ round 1          → the agreeing round-1 members are slashed overturnSlashBps
                                   challenger: bond returned + 50% of the slashed amount
      round 2 = round 1          → the challenger's bond → the resolver reward pool
      round 2 without threshold  → Market.fail()
6. settlementDeadline lewat      → markFailed() → Market.fail() → likuidasi
```

**Committee sampling.** `seed = keccak256(market, blockhash(closeBlock), roundIndex)`, then stake-weighted selection without replacement from the list of active resolvers.
⚠️ *Known limitation:* `blockhash` can be influenced by a validator. Accepted for v1; the upgrade path to a randomness beacon/VRF is recorded in §13.2 and scheduled for P7.

### 7.4 The settlement job (off-chain, per resolver)

```
1.  Download the MarketSpec from 0G Storage via specRoot; verify the Merkle proof.
2.  Gather evidence from spec.sources[]; store a raw snapshot of each source on 0G Storage → evidenceRoots[].
3.  Susun prompt = template kategori (Sports|Politics|Crypto|Economics|Science|Culture)
                 + spec.rules + spec.settlementPrompt + the evidence (with timestamps & URLs).
4.  TIER VERIFIED:
      getServiceMetadata(provider) → getRequestHeaders(provider)
      POST {endpoint}/chat/completions  { messages, model, temperature: 0 }
      chatID = header ZG-Res-Key
      verified = await broker.inference.processResponse(provider, chatID)
      if (!verified) → JANGAN commit; coba provider lain; setelah semua gagal → commit UNRESOLVABLE
    TIER FAST: the Compute Router, verified = false (recorded as such in the receipt).
5.  Parse keluaran terstruktur: { outcome: "YES"|"NO"|"UNRESOLVABLE", confidence, rationale, citations[] }
6.  Assemble the receipt (§7.5), upload it to 0G Storage → receiptRoot.
7.  commitVote(); during revealWindow → revealVote().
```

### 7.5 The settlement receipt (JSON, 0G Storage)

```jsonc
{
  "version": 1,
  "market": "0x...", "specRoot": "0x...", "round": 1,
  "resolver": { "agentId": 12, "address": "0x..." },
  "inference": {
    "route": "broker",                      // broker | router | price_feed
    "providerAddress": "0x...",
    "model": "...",
    "chatID": "...",
    "teeVerified": true,                    // the result of processResponse()
    "promptHash": "0x...", "responseHash": "0x...",
    "temperature": 0,
    "simulated": false                      // true when INFERENCE_MODE=stub — never confuse it with a real result
  },
  "evidence": [ { "url": "...", "fetchedAt": 1790000123, "root": "0x...", "sha256": "..." } ],
  "outcome": "YES", "confidence": 0.93,
  "rationale": "...", "citations": [ 0, 2 ],
  "rawResponse": "...",
  "signature": "0x..."                      // EIP-191, by the resolver's operator key
}
```

**An honesty bound on verifiability claims.** Re-running the same prompt on an LLM is **not** guaranteed bit-for-bit identical, even at `temperature: 0`. What TeeML attestation guarantees is: *that provider ran that model over that input, inside an enclave*. Re-running is **corroboration**, not proof. Product documents, the UI, and marketing material must not claim more than this.

### 7.6 Anti-abuse for market creation

Curator Agent menjalankan, berurutan, sebelum menandatangani approval:

1. **A keyword blocklist** — private individuals as targets, sexual or violent content about real people, "death" markets.
2. **An LLM semantic check** — does the question disguise something on list (1)?
3. **An ambiguity score** — do the rules cover every edge case? There is a minimum threshold, and anything below it is rejected.
4. **A resolvability check** — can the listed sources answer it before `settlementDeadline`?
5. **Deduplikasi** — kemiripan embedding terhadap market `Open` (cosine < ambang).

Failing any one ⇒ no signature, with the reason returned to the Creator Agent for revision (at most 2 rounds).
The `settlementDeposit` is slashed if the market is later `void`ed for abuse — this is what makes spam expensive.

---

## 8. The Agent Layer

### 8.1 The roles

| Role | Trigger | Principal action | Stake |
|---|---|---|---|
| **Creator** | terjadwal / sinyal | rancang MarketSpec → minta approval → `createMarket` + danai seed | ya (anti-spam) |
| **Curator** | permintaan approval | pipeline §7.6 → tanda tangan EIP-712 | ya |
| **Resolver** | `openResolution` menunjuknya | job §7.4 → commit → reveal | **ya, wajib** |
| **Trader** | on a schedule / when the price moves | evaluate the market → sizing → `AgentAccount.execute` | no |

### 8.2 The runtime contract

```ts
interface Agent {
  readonly agentId: bigint;                    // the tokenId in AgentRegistry
  readonly role: 'creator' | 'curator' | 'resolver' | 'trader';
  tick(ctx: AgentContext): Promise<AgentAction[]>;
}

interface AgentContext {
  chain:     ChainClient;        // viem, dibungkus ConfigRegistry
  indexer:   IndexerClient;      // REST + WS
  inference: IInferenceClient;   // stub | router | broker(TEE)
  storage:   IStorageClient;     // memory | file | 0G Storage
  clock:     Clock;              // injected → deterministic tests
  logger:    DecisionLogger;     // signs and batches to 0G Storage
}
```

`tick()` is **pure with respect to injected I/O** — every external dependency arrives through `ctx`. The consequence is that every agent can be tested with fake clients, with no network.

### 8.3 Trader personas (v1)

| Persona | Signal | Sizing |
|---|---|---|
| `KellyValueBettor` | inferensi `fairProbability` vs `P = pᵢ²` | Kelly pecahan (¼), dibatasi policy |
| `Contrarian` | an extreme probability move with no supporting news | fixed, rising as the divergence widens |
| `MomentumFollower` | tren probabilitas + volume | proporsional terhadap kekuatan tren |
| `NewsArbitrageur` | fresh news vs the market's last update time | aggressive within a short post-news window |

The loop each tick: `listMarkets(open)` → filter to the allowed categories → inference → compare → `quoteBuySpend` → check slippage against `maxSlippageBps` → `execute`.

### 8.4 `AgentAccount` — risk limits in the contract

```solidity
struct Policy {
    uint128 maxNotionalPerTrade;    // satuan collateral
    uint128 maxTotalExposure;       // total open notional
    uint128 dailySpendCap;          // rolling 24 jam
    uint16  maxConcurrentMarkets;
    uint16  maxSlippageBps;
    uint64  expiry;
    bytes32 allowedCategories;      // bitmask
}

interface IAgentAccount {
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount, address to) external;          // owner only — ALWAYS available
    function grant(uint256 agentId, Policy calldata p) external;     // owner only
    function revoke(uint256 agentId) external;                       // owner only — effective immediately
    function execute(Action calldata a) external;                    // agent operator only, policy-checked
    function redeemAll(address[] calldata markets) external;         // siapa pun (menguntungkan owner)
    function policyOf(uint256 agentId) external view returns (Policy memory);
    function exposure() external view returns (uint256);
}
```

**The guaranteed properties:**

- An agent **never** holds the user's wallet key; it can only call `execute` on that account.
- Every user has their own `AgentAccount` clone ⇒ **no cross-contamination** between users.
- `withdraw` and `revoke` can never be blocked by an agent, by the guardian, or by the global pause.
- A policy violation → revert, not logged and then allowed through.

### 8.5 Agent identity — the ERC-7857 path

```solidity
interface IAgentRegistry /* is IERC721 */ {
    enum Role { Creator, Curator, Resolver, Trader }
    struct Reputation {
        uint32 marketsCreated; uint32 marketsVoided;
        uint32 resolutionsAgreed; uint32 resolutionsOverturned;
        int128 realizedPnl;      uint32 tradesExecuted;
    }
    function register(Role role, address operator, bytes32 metadataRoot) external returns (uint256 agentId);
    function setOperator(uint256 agentId, address operator) external;
    function updateMetadata(uint256 agentId, bytes32 newRoot, bytes calldata proof) external;  // hook 7857
    function stake(uint256 agentId, uint256 amount) external;
    function requestUnstake(uint256 agentId, uint256 amount) external;   // cooldown 7 hari
    function slash(uint256 agentId, uint256 amount, bytes32 reason) external; // ResolutionModule only
    function reputationOf(uint256 agentId) external view returns (Reputation memory);
}
```

`metadataRoot` points at a 0G Storage blob holding the persona, the prompts, and the model configuration.
**v1 (P4):** ERC-721 + `metadataRoot` polos, `updateMetadata` menerima `proof` kosong.
**P7:** encrypted metadata + re-encrypted transfers per full ERC-7857; `updateMetadata` begins verifying proofs. The interface is deliberately already in its final shape so that migration is not a rewrite.

### 8.6 The agent decision log

Every `AgentAction` produces a signed record `{ agentId, tick, inputs, inference{provider,model,chatID,teeVerified}, reasoning, action, txHash }`.
Records are batched (NDJSON) hourly, uploaded to 0G Storage, and their root anchored through `AgentRegistry.anchorDecisionLog(agentId, root, fromTick, toTick)`.
The product consequence: every trade and every settlement in the UI can be traced back to its reasoning.
---

## 9. Indexer & API

0G has no managed subgraph service (Delphi uses Goldsky). Our own indexer is therefore a **mandatory component**, not an optimization.

### 9.1 Design

- **Tailer**: `eth_getLogs` over block ranges from `deploymentBlock`, a checkpoint per block, `CONFIRMATIONS=8`.
- **Reorg**: store the `blockHash` of every processed block; when a parent does not match → roll back to the fork point and replay. Every derived table is `ON DELETE CASCADE` on `blocks`.
- **Penyimpanan**: PostgreSQL (produksi), SQLite (lokal/CI) lewat satu lapisan query.
- **Penyajian**: REST + WebSocket.

### 9.2 Schema

```sql
blocks(number PK, hash, parent_hash, timestamp)
agents(agent_id PK, owner, operator, role, metadata_root, stake, active, registered_at)
markets(address PK, creator_agent_id, spec_root, category, tier, status,
        trading_end, settlement_deadline, fee_bps,
        q0 NUMERIC(78,0), q1 NUMERIC(78,0), pool_balance NUMERIC(78,0),
        prob_yes NUMERIC(38,18), volume NUMERIC(78,0), trade_count,
        created_block REFERENCES blocks(number) ON DELETE CASCADE)
trades(id PK, market, trader, agent_id, outcome, shares_delta, tokens, fee,
       q0_after, q1_after, prob_after, block REFERENCES blocks(number) ON DELETE CASCADE, log_index,
       UNIQUE(block, log_index))
liquidity_events(id PK, market, provider, lambda_wad, q0_after, q1_after, block, log_index)
positions(market, account, outcome, shares, seed_shares, avg_cost, realized_pnl, PRIMARY KEY(market,account,outcome))
price_points(market, bucket_start, interval, open, high, low, close, volume, PRIMARY KEY(market,interval,bucket_start))
resolutions(market PK, round, phase, proposed_outcome, final_outcome,
            commit_deadline, reveal_deadline, dispute_deadline, disputer, dispute_bond)
resolution_votes(market, resolver, round, commitment, revealed_outcome, receipt_root, slashed_amount,
                 PRIMARY KEY(market,resolver,round))
agent_actions(id PK, agent_id, tick, kind, market, payload JSONB, tx_hash, decision_log_root, ts)
```

`prob_yes` is derived from `q1²/(q0²+q1²)` at ingest time, not recomputed at query time.

### 9.3 REST

```
GET  /health                              → { status, headBlock, chainId, lagSeconds }
GET  /markets?status&category&tier&orderBy&skip&limit
GET  /markets/:address                    → market + q + prob + payoutPerShare + spec (from 0G Storage, cached)
GET  /markets/:address/trades?skip&limit
GET  /markets/:address/candles?interval=1m|5m|1h|1d&from&to
GET  /markets/:address/resolution         → rounds, votes, receiptRoot, teeVerified per resolver
GET  /positions?wallet=&redeemedOrLiquidated=
GET  /agents?role&orderBy=pnl|accuracy    → leaderboard
GET  /agents/:agentId                     → profil + reputasi + log keputusan terbaru
GET  /agents/:agentId/actions?skip&limit
```

### 9.4 WebSocket

```
subscribe { channel: "market", address }     → trade, statusChanged, probability
subscribe { channel: "markets" }             → marketCreated, statusChanged
subscribe { channel: "agent", agentId }      → action, trade
```

---

## 10. SDK — `@0g-delphi/agent-kit`

The ergonomics deliberately follow the Delphi SDK so a Delphi user understands it immediately, **plus** what they do not have.

```ts
const client = new DelphiZeroClient({
  network: 'anvil' | 'galileo' | 'mainnet',
  signerType: 'private_key' | 'session',
  privateKey?: string,
  indexerUrl?: string,
});

// baca (indexer)
client.health(); client.listMarkets(params); client.getMarket({ address });
client.listPositions({ wallet }); client.getMarketStatus(address);
client.getCandles({ address, interval });

// quotes (on-chain views)
client.quoteBuy({ address, outcomeIdx, sharesOut });
client.quoteBuySpend({ address, outcomeIdx, tokensIn });   // ← agents think in notional
client.quoteSell({ address, outcomeIdx, sharesIn });

// writes (on-chain)
client.buyShares({ address, outcomeIdx, sharesOut, maxTokensIn });
client.sellShares({ address, outcomeIdx, sharesIn, minTokensOut });
client.addLiquidity({ address, tokensIn, minSharesOut });
client.redeem({ address }); client.liquidate({ address });
client.ensureTokenApproval({ address, minimumAmount });

// what Delphi does not have
client.proposeMarket({ question, rules, sources, settlementPrompt, category, tradingEnd, tier, seed });
client.getResolution({ address });          // receipt + TEE status per resolver

// primitif agent
new AgentRunner({ agents, schedule, ctx }).start();
```

Every token value in the SDK API uses `bigint` in the smallest unit; `parseUsd/formatUsd` helpers exist so decimals are never guessed.

---

## 11. Frontend

Next.js 15 (App Router), viem + wagmi, data from the indexer.

| Route | Contents |
|---|---|
| `/` | daftar market: probabilitas, volume, kedalaman, tier, waktu tutup; filter kategori/status/tier |
| `/market/[address]` | the probability chart, an order ticket (buy/sell + slippage), the trade tape, **a running payout panel + a dilution warning**, a MarketSpec viewer, a settlement receipt viewer |
| `/portfolio` | positions, PnL, the redeem/liquidate buttons, history |
| `/agents` | leaderboard (PnL, akurasi resolusi, market dibuat) |
| `/agents/[id]` | the profile, the policy, and the **decision log** with the reasoning behind each trade |
| `/agents/new` | a wizard: pick a persona → set the Policy → deploy an `AgentAccount` → deposit → `grant` |
| `/create` | the path for a human to propose a market (still through the Creator + Curator Agents) |

Two UI elements that are mandatory, not ornamental:

1. **A TEE badge** on every settlement — `teeVerified` true/false, the provider address, the model, the chatID, and a link to the receipt on 0G Storage.
2. **A "Why" panel** on every agent trade — the reasoning, the inference behind it, and a link to the decision-log root.

---

## 12. Configuration, Modes, Deployment

### 12.1 The three mode switches

| Env | Value | Effect |
|---|---|---|
| `CHAIN_MODE` | `anvil` \| `galileo` \| `mainnet` | RPC, chainId, manifest deployment |
| `STORAGE_MODE` | `memory` \| `file` \| `real` | in-proc \| `ZG_BLOB_DIR` \| 0G Storage |
| `INFERENCE_MODE` | `stub` \| `router` \| `compute` | fixture deterministik \| Compute Router \| broker + TEE |

`INFERENCE_MODE=stub` uses fixtures keyed on `keccak256(promptHash)` → fixed outputs ⇒ reproducible e2e in CI, with no network and no cost. The `VERIFIED` tier in `stub` mode sets `teeVerified: true` **and marks the receipt `simulated: true`** so it can never be mistaken for a real result.

### 12.2 Env

```bash
CHAIN_MODE=galileo
ZERO_G_TESTNET_RPC=https://evmrpc-testnet.0g.ai
ZERO_G_MAINNET_RPC=https://evmrpc.0g.ai
LOCAL_RPC=http://127.0.0.1:8545

STORAGE_MODE=real
ZG_INDEXER_RPC=https://indexer-storage-testnet-turbo.0g.ai
ZG_BLOB_DIR=/tmp/0g-delphi-blobs

INFERENCE_MODE=compute
ZG_COMPUTE_PREFERRED_PROVIDERS=            # optional; empty = choose automatically from listService()
ZG_ROUTER_BASE_URL=https://router-api-testnet.integratenetwork.work/v1
ZG_ROUTER_API_KEY=
ZG_COMPUTE_MIN_LEDGER=3                    # 0G; alarm when below this
ZG_COMPUTE_MIN_PER_PROVIDER=1              # 0G

DEPLOYER_KEY=                              # deploy kontrak
CURATOR_OPERATOR_KEY=
RESOLVER_OPERATOR_KEYS=                    # comma-separated, one per resolver agent
TRADER_OPERATOR_KEY=
UPLOADER_KEY=                              # membayar biaya unggah 0G Storage

DATABASE_URL=postgres://...                # sqlite:./indexer.db when local
INDEXER_URL=http://127.0.0.1:7200
CONFIRMATIONS=8
```

### 12.3 The deployment manifest

`deployments/<chainId>.json` — a single source of truth, read by the contracts (`ConfigRegistry`), the services, and the frontend:

```jsonc
{ "chainId": 16602, "deployedAt": "...", "deploymentBlock": 0,
  "contracts": { "ConfigRegistry": "0x..", "MarketFactory": "0x..", "MarketImpl": "0x..",
                 "OutcomeShares": "0x..", "ResolutionModule": "0x..", "AgentRegistry": "0x..",
                 "AgentAccountFactory": "0x..", "Treasury": "0x..", "MockUSDC": "0x.." },
  "params": { "feeBps": 100, "minSeed": "100000000", "...": "..." } }
```

### 12.4 Repo structure

```
0g-delphi/
├─ contracts/                 Foundry
│  ├─ src/{core,resolution,agents,periphery,mocks}/
│  ├─ test/{unit,invariant,integration}/
│  └─ script/{Deploy.s.sol,Seed.s.sol}
├─ packages/
│  ├─ protocol/               shared types, the DPM mirror in TS, EIP-712, blob addressing, ABIs
│  └─ agent-kit/              SDK + primitif runtime agent
├─ services/
│  ├─ agent-runtime/          creator · curator · resolver · trader
│  ├─ indexer/                tailer + REST + WS
│  └─ oracle-worker/          adapter DETERMINISTIC (Pyth Hermes)
├─ frontend/                  Next.js 15
├─ scripts/                   demo-local.sh · e2e-workflow.mts · deploy-galileo.sh · fund-compute.mts
├─ deployments/<chainId>.json
└─ docs/
```

npm workspaces at the root, following the `0g-Umbra` pattern.

---

## 13. Security & Economics

### 13.1 The contract surface

| Risk | Handling |
|---|---|
| Reentrancy | CEI + `ReentrancyGuard` on every fund-moving function; `safeTransfer` (SafeERC20) |
| Fee-on-transfer / rebasing tokens | rejected: `ConfigRegistry` holds a collateral allowlist; balances are measured as before/after deltas |
| Precision & rounding | everything out is rounded down, everything in is rounded up; the pool is set to `costUp(q)` (§4.4) |
| `q²` overflow | `require(qᵢ <= MAX_Q)` on every mutation |
| `q_i = 0` at settle | the creator seed floor ⇒ `qᵢ ≥ seedSupplyᵢ ≥ creatorSeedᵢ > 0` (§6.3) |
| Front-running / sandwich | `maxTokensIn` / `minTokensOut` are mandatory; `maxSlippageBps` in the policy; commit–reveal for large orders → P7 |
| Griefing through `close()` | `close()` is permissionless but valid only after `tradingEnd` |
| Unclaimed funds | `sweepUnclaimed()` to the Treasury after 365 days |
| A pause holding users hostage | the pause **never** touches `sell`/`redeem`/`liquidate`/`withdraw` (tested) |

### 13.2 The economic security of resolution

| Serangan | Pertahanan |
|---|---|
| Resolver menyalin jawaban resolver lain | commit–reveal, commitment terikat `msg.sender` |
| A lazy or absent resolver | slash `noShowSlashBps`; reputation falls; repeated → struck from sampling |
| A resolver cartel | stake-weighted sampling + exclusion of round-1 participants from the dispute round + a heavy `overturnSlashBps` |
| Sampling manipulation by a validator | ⚠️ **open in v1** (`blockhash`); mitigation: a long commit window makes prediction expensive; the upgrade path to VRF lands in P7 |
| Spam disputes | the `disputeBond` is forfeited when round 2 confirms round 1 |
| A creator writing a misleading prompt | the curator pipeline §7.6; the `settlementDeposit` is slashed on void |
| Biaya inferensi mengeringkan ledger | `settlementDeposit` mendanai hadiah resolver; `ZG_COMPUTE_MIN_LEDGER` mengalarm sebelum kering |

### 13.3 Upgrades & governance

- Kontrak pemegang dana (`Market`, `OutcomeShares`, `AgentAccount`) **immutable**.
- Koordinasi (`MarketFactory`, `ResolutionModule`, `AgentRegistry`, `Treasury`, `ConfigRegistry`) UUPS, admin = multisig 3/5, **semua upgrade lewat timelock 48 jam**.
- Parameter changes (fees, windows, slash thresholds) also go through the timelock, with hard bounds in code (e.g. `feeBps ≤ 300`).
- The `Guardian` (a single key, for fast action) may only: `pause()` and `void()` a pre-`Closed` market. It cannot move funds and cannot change an outcome.

### 13.4 Regulatory factors

Prediction markets are regulated in many jurisdictions. The design keeps the collateral token, the category list, and the access gates as **configuration**, so that a jurisdiction-appropriate deployment is an operational decision rather than a rewrite. Testnet uses valueless mUSDC. This is recorded as a factor in the product owner's decision, not as a technical obstacle.

---

## 14. The Test & Verification Plan

### 14.1 Foundry invariants (stateful fuzz) — the heart of trust in this system

```
INV-1  poolBalance == DPMMath.costUp(q)         setelah sekuens buy/sell/addLiq/removeLiq/redeem/liquidate apa pun
INV-2  IERC20(collateral).balanceOf(market) >= toToken(poolBalance) + feeAccrued
INV-3  Σ redeem  <= poolBalance                 when Settled
INV-4  Σ liquidate == poolBalance (± 2 wei)     when Failed/Voided        [Euler: Σ pᵢ·qᵢ = C(q)]
INV-5  buy(x) then sell(x) returns <= what was paid         (a round-trip never profits)
INV-6  qᵢ >= seedSupplyᵢ >= creatorSeedᵢ > 0    selalu, termasuk setelah removeLiquidity apa pun
INV-7  provider loss <= deposit * (1 - min(p0,p1) at entry)  under an arbitrary order flow
       (= 29.30% only for the creator's symmetric seed; a proportional LP entering
        on a skewed book can lose far more — see the note below)
INV-8  Σ probability(i) == WAD (± 2 wei)
INV-9  a proportional addLiquidity does not change probability (± 2 wei)
INV-10 sell/redeem/liquidate/withdraw berhasil walau paused == true

**Note on INV-7 — a correction, found by the Task 18 invariant suite and reinforced by its reviewer.**
The 29.29% figure comes from the creator's SYMMETRIC seed, q = (s, s), where p₀ = p₁ = 1/√2. It is not
a universal bound for liquidity providers.

The derivation, verified directly against the contract. An LP depositing `D` wad into state `q`
receives `λ = ⌊D·WAD/poolWad⌋` and a position `λq`, at a cost of `D = λ·C(q)`.
- **Settled:** the payout `= λq_w · C(q_f)/q_{f,w}`. Because `C(q_f) ≥ q_{f,w}`, the payout is `≥ λq_w = D·p_w`.
- **Failed/Voided:** the payout `= Σᵢ λqᵢ·p'ᵢ = D·(p·p')`, where `p` and `p'` are unit vectors in the
  positive quadrant (`Σpᵢ² = 1`). The minimum occurs as `p'` approaches an axis → `min(p₀, p₁)`.

Both regimes give **a recovery ≥ deposit × min(p₀, p₁) at the moment of entry**.

Asserted, not merely derived: `test_lpRecoveryRespectsTheGeneralBoundOnASkewedBook` drives a
proportional LP into a skewed book and checks the general floor, and
`test_lpLossOnASkewedBookExceedsTheSymmetricConstant` shows the same LP losing **85%** of a 500
mUSDC deposit — nearly three times the symmetric constant. Until those existed, every INV-7
assertion in the repo measured the creator, whose seed is symmetric by construction, so the
general form was written down and checked nowhere.

**The loss is unbounded below 100%; it does not stop at any particular figure.** At `q = (10, 1000)`,
`min(p₀,p₁) ≈ 0,0099995`, sehingga lantai pemulihannya `setoran × 0,01` — **rugi ~99%**. Semakin
the more skewed the book, the closer `1 − min(p₀,p₁)` gets to 100%. No constant can express it; what
exists is only the lowest marginal price at the moment the provider entered.
That general formula reduces exactly to 29.29% when the book is symmetric, so it is the correct
generalization rather than a competing figure. What is wrong is stating the special case as though it
held generally. The consequence is real: a UI or SDK that tells an LP "you can lose at most 29.3%"
lies to anyone providing liquidity into a skewed market — precisely the kind of claim-to-know this
whole design sets out to prevent.
```

### 14.2 The test layers

| Layer | Contents | Gate |
|---|---|---|
| L1 Solidity | unit tests per contract + INV-1..10 + reentrancy/access tests | `forge test` green, line coverage ≥ 90% on `core/` |
| L2 Diferensial | DPM Solidity vs TS vs referensi Python, 10⁵ input acak | paritas ≤ 2 wei |
| L3 Service | unit + integrasi terhadap anvil (indexer reorg, klien inferensi, klien storage) | semua hijau |
| L4 e2e lokal | `scripts/e2e-workflow.mts`, `anvil` + `stub` + `file` | lihat §14.3 |
| L5 e2e Galileo | skrip sama, `galileo` + `compute` + `real` | ⛔ butuh deploy |
| L6 Chaos | an absent resolver, a 429 from a provider, a failed storage upload, a 12-block reorg, a stale oracle | the system degrades in a controlled way, with no loss of funds |

### 14.3 The e2e scenario (`scripts/e2e-workflow.mts`)

```
 1. Deploy semua kontrak; daftarkan 1 creator, 1 curator, 5 resolver, 3 trader agent; danai stake.
 2. The Creator Agent designs a market → the Curator rejects it once (ambiguous) → revision → approved.
 3. createMarket(seed=1000 mUSDC) → cek q₀=q₁=707.11, P(YES)=50%.
 4. Three trader agents trade for 20 ticks → check INV-1..2 every tick.
 5. Satu pengguna addLiquidity → cek probabilitas tak bergeser (INV-9).
 6. One user tries to exceed their Policy → it must revert.
 7. Lompat waktu melewati tradingEnd → close() → komite tersampling.
 8. Lima resolver commit → reveal (4 YES, 1 NO) → threshold tercapai → Proposed.
 9. Path A: finalize() → Settled → every party redeems → check the conservation equation (§14.4).
10. Path B (the second market): dispute() → round 2 overturns → round 1 is slashed → the challenger is paid.
11. Path C (the third market): no reveal → settlementDeadline → Failed → liquidate → INV-4.
12. Cetak neraca akhir: Σ masuk == Σ keluar + fee + slash (± debu).
```

### 14.4 The conservation equation (checked at step 12)

```
Σ (seed deposits + buy costs + fees) == Σ (sell proceeds + redemptions + liquidations) + feesDistributed + poolDust
```

### 14.5 CI

`forge fmt --check` · `forge build` · `forge test -vvv` · `forge coverage` · `npm test --workspaces` · `e2e-workflow.mts` on anvil with `stub`+`memory` · `slither` (an informational gate) — all must be green before a merge.

---

## 15. Implementation Phases

Each phase gets its own spec and its own implementation plan.

| Phase | Scope | Done criteria |
|---|---|---|
| **P0 — Foundation** | the monorepo, Foundry, `ConfigRegistry`, `MockUSDC`, the deployment manifest, the three mode switches, CI | `forge test` + `npm test` green in CI; `demo-local.sh` brings up anvil and deploys |
| **P1 — The core market** | `DPMMath`, `Market`, `OutcomeShares`, `MarketFactory`, all of INV-1..10, the differential test | INV-1..10 green over 10⁶ fuzz steps; L2 parity ≤ 2 wei; coverage ≥ 90% |
| **P2 — Resolution** | `AgentRegistry` (+stake/slash), `ResolutionModule` (commit–reveal, threshold, dispute), a stub adapter | Steps 7–11 of the e2e scenario pass with fake resolvers |
| **P3 — Indexer + SDK** | the tailer + reorg handling + REST/WS + `agent-kit` | The indexer recovers from a 12-block reorg; the SDK drives a whole market lifecycle |
| **P4 — The agent runtime** | the 4 roles, `AgentAccount`+Policy, the 0G Compute client (stub→router→compute), 0G Storage receipts, the decision log | The full `stub` e2e is green; **one real market settles with `teeVerified == true`** |
| **P5 — Frontend** | every route in §11, the TEE badge, the "Why" panel | The whole lifecycle can be driven from the UI, with no CLI |
| **P6 — Galileo deployment** | `deploy-galileo.sh`, contract verification, the L5 e2e | ⛔ **the only identified blocker**; the L5 e2e green on 16602 |
| **P7 — Mainnet readiness** | full ERC-7857, committee VRF, commit–reveal for large orders, audit preparation, the upgrade/pause runbook, a real stablecoin | An external audit is scheduled; the runbook is exercised on testnet |

The critical path to "the workflow can be tested": **P0 → P1 → P2 → P3 → P4 → P6**. P5 and P7 run in parallel or follow.

---

## 16. Open Risks & Deferred Decisions

| # | Issue | Current stance | When it gets decided |
|---|---|---|---|
| R1 | DPM payout dilution | Consciously accepted; mitigated by continuous `sell` + disclosure in the UI | — (final) |
| R2 | Committee sampling uses `blockhash` | Accepted for v1 | P7 → VRF/beacon |
| R3 | An LLM re-run is not bit-exact | Claims are bounded by TEE attestation (§7.5) | — (final) |
| R4 | Front-running trade | Slippage bound saja | P7 → commit–reveal order besar |
| R5 | The 0G Compute provider catalogue changes | Runtime discovery + an ordered fallback | — (final) |
| R6 | The 0G Compute ledger can run dry (a 0.1/day faucet) | `settlementDeposit` + a balance alarm | Monitored in P4 |
| R7 | The Creator Agent's signal sources | Not concretely chosen yet | Early P4 |
| R8 | Jurisdiction & access | Configuration, not code | Before mainnet |
| R9 | `Guardian` key tunggal | Kewenangan sempit (pause/void saja) | P7 → multisig 2/3 |

---

## 17. Appendix — Default Parameters

| Parameter | Default | Hard bound |
|---|---|---|
| `feeBps` | 100 (1.00%) | ≤ 300 |
| `creatorFeeShareBps` / `resolverFeeShareBps` / protocol | 4000 / 3000 / 3000 | the sum = 10000 |
| `minSeed` | 100 mUSDC | > 0 |
| `minSettlementDeposit` | 20 mUSDC | > 0 |
| Komite `FAST` / `VERIFIED` / `DETERMINISTIC` | 1 / 5 (k=3) / 3 (k=2) | n ≤ 21 |
| Dispute-round committee | 9 (k=5) | — |
| `commitWindow` / `revealWindow` | 30 mnt / 30 mnt | ≥ 10 mnt |
| `disputeWindow` FAST / VERIFIED / DETERMINISTIC | 24 j / 6 j / 2 j | ≥ 1 j |
| `disputeBond` | 200 mUSDC | ≥ 50 mUSDC |
| `minResolverStake` | 1000 mUSDC | — |
| `noShowSlashBps` / `disagreeSlashBps` / `overturnSlashBps` | 500 / 1000 / 3000 | ≤ 5000 |
| `unstakeCooldown` | 7 hari | ≥ 1 hari |
| `minTradeTokens` | 1 mUSDC | > 0 |
| `MAX_Q` | 1e33 wad | — |
| `sweepUnclaimedAfter` | 365 hari | ≥ 180 hari |
| `CONFIRMATIONS` (indexer) | 8 | ≥ 3 |
| Timelock upgrade | 48 jam | ≥ 24 jam |

### Glossary

| Term | Meaning |
|---|---|
| **DPM** | Dynamic Pari-Mutuel Market — cost function `√(Σqᵢ²)`, pool mendanai pembayarannya sendiri |
| **wad** | bilangan titik-tetap 18 desimal |
| **TeeML** | atestasi TEE 0G Compute atas eksekusi inferensi |
| **receipt** | the settlement evidence document on 0G Storage (§7.5) |
| **seed shares** | shares from `createMarket`/`addLiquidity` — non-transferable, cannot be `sell`-ed; the creator's portion can never be withdrawn |
| **Policy** | the on-chain risk limits that bound an agent inside `AgentAccount` |
| **`specRoot`** | the 0G Storage Merkle root of the MarketSpec, anchored on chain |
