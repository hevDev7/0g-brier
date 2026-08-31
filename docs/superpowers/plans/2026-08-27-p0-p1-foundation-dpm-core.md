# Brier P0 + P1 — Fondasi & Inti Market DPM

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Brier monorepo together with an on-chain DPM market engine proven solvent — to the point where one binary market can be created, traded, closed, resolved, and redeemed entirely on a local anvil, guarded by ten stateful-fuzz invariants.

**Architecture:** Foundry contracts in `contracts/`, with `Market` as an immutable EIP-1167 clone that holds the funds, and `ConfigRegistry`/`MarketFactory` as UUPS behind it. Prices come from the dynamic pari-mutuel cost function `C(q) = √(q₀² + q₁²)`; the pool's cash is **set** to `costUp(q)` on every operation rather than accumulated, so solvency holds by construction. The TypeScript package `packages/protocol` holds the DPM mirror, the unit conversions, and the mode switches; that mirror generates the test vectors Solidity re-verifies (the differential test).

**Tech Stack:** Foundry (forge 1.5.1-stable) · Solidity 0.8.28 · OpenZeppelin Contracts 5.4.0 + Contracts-Upgradeable 5.4.0 · Node 22 + npm workspaces · TypeScript 5 + vitest · anvil · GitHub Actions

**Spec:** `docs/superpowers/specs/2026-08-27-brier-design.md`

---

## Global Constraints

Every task below is subject to all of the following.

- **Solidity 0.8.28**, `evm_version = "cancun"` (proven to deploy to Galileo 16602 in the `0g-Umbra` project).
- **All DPM maths is in wad (1e18).** Collateral has 6 decimals; conversion happens only at the token boundary.
- **`WAD = 1e18`, `MAX_Q = 1e33`.** Every mutation of `q` must enforce `qᵢ ≤ MAX_Q` (`2·(1e33)² = 2e66 < 2²⁵⁶`).
- **Seed shares are derived through squares, not through a √2 constant:** `q₀ = ⌊√(⌊seedWad²/2⌋)⌋`. Dividing by `⌊√2·1e18⌋` produces a `q₀` that is too large and makes the pool demand more collateral than was deposited (Task 11).
- **Rounding always favours the pool:** money in uses `ceilDiv`, money out uses floor division, and `poolWad` is always `costUp` (sqrt rounded up).
- **A contract holding funds is never upgradeable:** `Market`, `OutcomeShares`. Only `ConfigRegistry` and `MarketFactory` are UUPS.
- **The pause never blocks an exit.** `sell`, `redeem`, and `liquidate` must still succeed while `paused == true`. This is tested, not assumed.
- **No `unchecked`** on the DPM arithmetic paths. Gas is not a P1 priority; correctness is.
- **No magic numbers in the contracts.** Every parameter is read from `ConfigRegistry`.
- **Every task ends with a commit.** Commit messages use the Conventional Commits prefixes (`feat:`, `test:`, `chore:`, `fix:`).
- **All tests must be green before a commit.** `forge test` for Solidity, `npm test -ws` for TypeScript.

### Two deviations from the spec (deliberate, already verified)

| Spec | Rencana | Alasan |
|---|---|---|
| §6.3 `removeLiquidity(uint256[2] seedShares, ...)` | `removeLiquidity(uint256 lambdaWad, ...)`, a withdrawal **proportional to the current `q`** | A non-proportional withdrawal is a directional trade **with no fee** — an arbitrage hole. A proportional withdrawal is probability-neutral, the exact mirror of `addLiquidity`. |
| §6.3 `id = marketId<<8 \| outcome` | `id = uint256(uint160(market))<<8 \| outcome` | The id is derived from `msg.sender` ⇒ a market can **structurally** only mint/burn its own ids. Authorization becomes an arithmetic property rather than a permission list. |

The spec was updated to match before any task was executed (Task 0).

---

## File Structure

```
brier/
├─ package.json                              npm workspaces root
├─ Makefile                                  jalan pintas: build, test, fmt, deploy, demo
├─ .github/workflows/ci.yml                  gerbang CI
├─ contracts/
│  ├─ foundry.toml
│  ├─ remappings.txt
│  ├─ src/
│  │  ├─ math/DPMMath.sol                    cost/costUp/price/probability/sharesForSpend  (murni)
│  │  ├─ core/ConfigKeys.sol                 the bytes32 keys for parameters & addresses
│  │  ├─ core/ConfigRegistry.sol             parameter + alamat + guardian + pause (UUPS)
│  │  ├─ core/OutcomeShares.sol              ERC-1155 tradable positions
│  │  ├─ core/Market.sol                     mesin DPM + siklus hidup + jalan keluar
│  │  ├─ core/MarketFactory.sol              clone + createMarket + tanda tangan kurator (UUPS)
│  │  ├─ interfaces/IMarket.sol              enum Status, struct Params, event
│  │  └─ mocks/MockUSDC.sol                  ERC-20 6 desimal + faucet (testnet saja)
│  ├─ test/
│  │  ├─ unit/{MockUSDC,ConfigRegistry,DPMMath,OutcomeShares,Market*,MarketFactory}.t.sol
│  │  ├─ invariant/{MarketHandler.sol,MarketInvariants.t.sol}
│  │  ├─ differential/DPMDifferential.t.sol
│  │  ├─ vectors/dpm.json                    dihasilkan cermin TS, diverifikasi Solidity
│  │  └─ helpers/Fixtures.sol                penyiapan bersama
│  └─ script/Deploy.s.sol                    deploy + write deployments/<chainId>.json
├─ packages/protocol/
│  ├─ src/{units,modes,networks,deployments,dpm,index}.ts
│  ├─ test/{units,modes,dpm,deployments}.test.ts
│  └─ scripts/gen-vectors.ts                 menulis contracts/test/vectors/dpm.json
├─ scripts/demo-local.sh                     anvil → deploy → seed → cetak alamat
└─ deployments/<chainId>.json
```

**Responsibility boundaries.** `DPMMath` is pure and knows nothing about tokens, statuses, or fees. `Market` knows one market and nothing about any other. `OutcomeShares` knows only ownership. `ConfigRegistry` only stores numbers and addresses. No file crosses two of these responsibilities.

---

## Task 0: Align the spec with the two deviations

**Files:**
- Modify: `docs/superpowers/specs/2026-08-27-brier-design.md`

**Interfaces:**
- Consumes: —
- Produces: a spec that matches the code Tasks 10 and 13 are going to write.

- [ ] **Step 1: Fix the `removeLiquidity` signature in §6.3**

Replace these lines in the `interface IMarket` block:

```solidity
    function removeLiquidity(uint256[2] calldata seedShares, uint256 minTokensOut, address to)
        external returns (uint256 tokensOut);   // only while Status == Open
```

to:

```solidity
    /// @param lambdaWad the wad fraction of the current q being withdrawn; withdrawal[i] = q[i]*lambdaWad/WAD.
    ///        Proporsional ⇒ netral terhadap probabilitas. Penarikan tak-proporsional dilarang
    ///        because it would amount to a directional trade with no fee.
    function removeLiquidity(uint256 lambdaWad, uint256 minTokensOut, address to)
        external returns (uint256 tokensOut);   // only while Status == Open
```

- [ ] **Step 2: Fix the ERC-1155 id scheme in §6.1**

Ganti sel tabel `OutcomeShares`:

```
| `OutcomeShares` | ERC-1155 tradable positions, `id = marketId<<8 \| outcome` | singleton | No |
```

to:

```
| `OutcomeShares` | ERC-1155 tradable positions, `id = uint160(market)<<8 \| outcome` — a market can only touch its own ids | singleton | No |
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-27-brier-design.md
git commit -m "docs: proportional removeLiquidity + ERC-1155 ids derived from the market address"
```

---

## Task 1: The monorepo skeleton, Foundry, and CI

**Files:**
- Create: `package.json`, `Makefile`, `.github/workflows/ci.yml`
- Create: `contracts/foundry.toml`, `contracts/remappings.txt`, `contracts/test/helpers/Sanity.t.sol`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: —
- Produces: a runnable `forge test` and `npm test -ws`; the `forge-std/`, `@openzeppelin/contracts/`, and `@openzeppelin/contracts-upgradeable/` remappings.

- [ ] **Step 1: Write the failing sanity test**

Buat `contracts/test/helpers/Sanity.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev Proves the toolchain is wired up correctly: forge-std is linked, and OZ Math
///      offers sqrt with rounding modes — the foundation of all of DPMMath.
contract SanityTest is Test {
    function test_ozSqrtSupportsRounding() public pure {
        assertEq(Math.sqrt(2, Math.Rounding.Floor), 1);
        assertEq(Math.sqrt(2, Math.Rounding.Ceil), 2);
        assertEq(Math.sqrt(4, Math.Rounding.Ceil), 2);
    }

    function test_ozMulDivHandles512Bit() public pure {
        // 1e66 * 1e18 exceeds uint256 if multiplied directly; mulDiv must still be correct.
        uint256 big = 1e33 * 1e33;
        assertEq(Math.mulDiv(big, 1e18, big), 1e18);
    }
}
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd contracts && forge test
```
Expected: FAIL — `forge-std/Test.sol` is not found (no `lib/` yet, no `foundry.toml` yet).

- [ ] **Step 3: Write `contracts/foundry.toml`**

```toml
[profile.default]
src            = "src"
out            = "out"
libs           = ["lib"]
test           = "test"
script         = "script"
solc_version   = "0.8.28"
evm_version    = "cancun"
optimizer      = true
optimizer_runs = 800
via_ir         = false
bytecode_hash  = "none"
fs_permissions = [
  { access = "read-write", path = "../deployments" },
  { access = "read",       path = "./test/vectors" },
]

[profile.default.fuzz]
runs = 512

[profile.default.invariant]
runs            = 128
depth           = 64
fail_on_revert  = false

# Release profile: via_ir on. CI must build this profile so that
# "it only compiles without via_ir" can never slip through unnoticed.
[profile.prod]
via_ir         = true
optimizer_runs = 20000

[profile.ci.fuzz]
runs = 4096

[profile.ci.invariant]
runs  = 512
depth = 128

[fmt]
line_length = 120
tab_width   = 4
bracket_spacing = false
int_types   = "long"

[rpc_endpoints]
local   = "http://127.0.0.1:8545"
galileo = "${ZERO_G_TESTNET_RPC}"
mainnet = "${ZERO_G_MAINNET_RPC}"
```

- [ ] **Step 4: Write `contracts/remappings.txt`**

```
forge-std/=lib/forge-std/src/
@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/
@openzeppelin/contracts-upgradeable/=lib/openzeppelin-contracts-upgradeable/contracts/
```

- [ ] **Step 5: Pasang dependensi**

```bash
cd contracts
forge install foundry-rs/forge-std@v1.9.6 --no-git
forge install OpenZeppelin/openzeppelin-contracts@v5.4.0 --no-git
forge install OpenZeppelin/openzeppelin-contracts-upgradeable@v5.4.0 --no-git
```

If the network is unavailable, copy them from a neighbouring project that already has them:
```bash
cp -r /home/mdlog/Project-MDlabs/Akindo/0g-Umbra/contracts/lib/forge-std contracts/lib/
cp -r /home/mdlog/Project-MDlabs/Akindo/0g-Umbra/contracts/lib/openzeppelin-contracts contracts/lib/
```

- [ ] **Step 6: Run the tests and confirm they pass**

```bash
cd contracts && forge test -vv
```
Expected: PASS — 2 lulus.

- [ ] **Step 7: Write the root `package.json`**

```json
{
  "name": "brier",
  "version": "0.1.0",
  "private": true,
  "description": "Agent-native binary prediction market on 0G Chain — DPM pricing, a TEE-backed resolver committee.",
  "workspaces": ["packages/*"],
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "gen:vectors": "npm run gen:vectors -w @0g-brier/protocol"
  }
}
```

- [ ] **Step 8: Write `Makefile`**

```makefile
.PHONY: build test fmt fmt-check prod invariant vectors demo clean

build:      ; cd contracts && forge build
prod:       ; cd contracts && FOUNDRY_PROFILE=prod forge build
test:       ; cd contracts && forge test -vv && npm test --workspaces --if-present
fmt:        ; cd contracts && forge fmt
fmt-check:  ; cd contracts && forge fmt --check
invariant:  ; cd contracts && FOUNDRY_PROFILE=ci forge test --match-path 'test/invariant/*' -vv
vectors:    ; npm run gen:vectors
demo:       ; bash scripts/demo-local.sh
clean:      ; cd contracts && forge clean
```

- [ ] **Step 9: Write `.github/workflows/ci.yml`**

```yaml
name: ci
on: [push, pull_request]

jobs:
  contracts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: foundry-rs/foundry-toolchain@v1
        with: { version: stable }
      - name: format
        run: cd contracts && forge fmt --check
      - name: build (default)
        run: cd contracts && forge build
      - name: build (prod, via_ir)
        run: cd contracts && FOUNDRY_PROFILE=prod forge build
      - name: test
        run: cd contracts && FOUNDRY_PROFILE=ci forge test -vvv

  typescript:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm test --workspaces --if-present
```

- [ ] **Step 10: Update `.gitignore`**

```
node_modules/
.env
.env.local
contracts/out/
contracts/cache/
contracts/broadcast/
contracts/lib/
.next/
*.log
coverage/
lcov.info
```

- [ ] **Step 11: Run every gate**

```bash
make fmt && make build && make prod && make test
```
Expected: everything passes; `forge test` reports 2 passing, npm reports no workspaces (there are none yet).

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: the monorepo skeleton, Foundry, and CI"
```

---

## Task 2: `packages/protocol` — satuan, mode, jaringan

**Files:**
- Create: `packages/protocol/{package.json,tsconfig.json,vitest.config.ts}`
- Create: `packages/protocol/src/{units.ts,modes.ts,networks.ts,index.ts}`
- Test: `packages/protocol/test/{units.test.ts,modes.test.ts,networks.test.ts}`

**Interfaces:**
- Consumes: —
- Produces:
  - `WAD: bigint`, `scaleFor(decimals: number): bigint`, `toWad(tokens: bigint, decimals: number): bigint`, `toTokensFloor(wad: bigint, decimals: number): bigint`, `toTokensCeil(wad: bigint, decimals: number): bigint`
  - `type ChainMode = 'anvil'|'galileo'|'mainnet'`, `type StorageMode = 'memory'|'file'|'real'`, `type InferenceMode = 'stub'|'router'|'compute'`
  - `interface Modes { chain: ChainMode; storage: StorageMode; inference: InferenceMode }`, `loadModes(env?): Modes`
  - `interface NetworkConfig { name: ChainMode; chainId: number; rpcUrl: string; explorer: string | null }`, `networkFor(mode: ChainMode, env?): NetworkConfig`

- [ ] **Step 1: Write the failing tests for konversi satuan**

Buat `packages/protocol/test/units.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { WAD, scaleFor, toWad, toTokensFloor, toTokensCeil } from '../src/units.js';

describe('units', () => {
  it('WAD is 1e18', () => {
    expect(WAD).toBe(1_000_000_000_000_000_000n);
  });

  it('scaleFor maps decimals to a wad multiplier', () => {
    expect(scaleFor(6)).toBe(10n ** 12n);
    expect(scaleFor(18)).toBe(1n);
    expect(scaleFor(0)).toBe(10n ** 18n);
  });

  it('scaleFor rejects out-of-range decimals', () => {
    expect(() => scaleFor(19)).toThrow(RangeError);
    expect(() => scaleFor(-1)).toThrow(RangeError);
  });

  it('toWad menaikkan skala token 6 desimal', () => {
    expect(toWad(1_000_000n, 6)).toBe(WAD);
  });

  it('toTokensFloor rounds down, toTokensCeil rounds up', () => {
    const almostOne = WAD - 1n;
    expect(toTokensFloor(almostOne, 6)).toBe(999_999n);
    expect(toTokensCeil(almostOne, 6)).toBe(1_000_000n);
    expect(toTokensFloor(WAD, 6)).toBe(1_000_000n);
    expect(toTokensCeil(WAD, 6)).toBe(1_000_000n);
  });

  it('toTokensCeil(0) is 0, not 1', () => {
    expect(toTokensCeil(0n, 6)).toBe(0n);
  });

  it('rejects negative values', () => {
    expect(() => toWad(-1n, 6)).toThrow(RangeError);
    expect(() => toTokensFloor(-1n, 6)).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd packages/protocol && npx vitest run
```
Expected: FAIL — the `../src/units.js` module is not found.

- [ ] **Step 3: Buat konfigurasi paket**

`packages/protocol/package.json`:

```json
{
  "name": "@0g-brier/protocol",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "build": "tsc --noEmit",
    "gen:vectors": "tsx scripts/gen-vectors.ts"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^3.0.5"
  }
}
```

`packages/protocol/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src", "test", "scripts"]
}
```

`packages/protocol/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
```

Then install: `npm install` from the repo root.

- [ ] **Step 4: Implement `src/units.ts`**

```ts
/** All DPM maths uses wad (1e18). Collateral uses its own decimals (6 for mUSDC).
 *  Conversion happens ONLY at the token boundary — never in the middle of a calculation. */
export const WAD = 10n ** 18n;

const MAX_DECIMALS = 18;

function assertNonNegative(v: bigint, label: string): void {
  if (v < 0n) throw new RangeError(`${label} must not be negative: ${v}`);
}

/** Multiplier from token units to wad. 6 decimals → 1e12. */
export function scaleFor(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new RangeError(`unsupported decimals: ${decimals} (must be an integer 0..18)`);
  }
  return 10n ** BigInt(MAX_DECIMALS - decimals);
}

export function toWad(tokens: bigint, decimals: number): bigint {
  assertNonNegative(tokens, 'tokens');
  return tokens * scaleFor(decimals);
}

/** Funds OUT: always rounded down so the pool is never short. */
export function toTokensFloor(wad: bigint, decimals: number): bigint {
  assertNonNegative(wad, 'wad');
  return wad / scaleFor(decimals);
}

/** Funds IN: always rounded up so the pool is never short. */
export function toTokensCeil(wad: bigint, decimals: number): bigint {
  assertNonNegative(wad, 'wad');
  const s = scaleFor(decimals);
  return (wad + s - 1n) / s;
}
```

- [ ] **Step 5: Run them and confirm they pass**

```bash
cd packages/protocol && npx vitest run test/units.test.ts
```
Expected: PASS — 7 lulus.

- [ ] **Step 6: Write the failing tests for saklar mode**

Buat `packages/protocol/test/modes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadModes } from '../src/modes.js';

describe('loadModes', () => {
  it('default aman: anvil + memory + stub', () => {
    expect(loadModes({})).toEqual({ chain: 'anvil', storage: 'memory', inference: 'stub' });
  });

  it('reads all three switches from env', () => {
    expect(loadModes({ CHAIN_MODE: 'galileo', STORAGE_MODE: 'real', INFERENCE_MODE: 'compute' }))
      .toEqual({ chain: 'galileo', storage: 'real', inference: 'compute' });
  });

  it('rejects an unknown value and names the allowed ones', () => {
    expect(() => loadModes({ CHAIN_MODE: 'sepolia' })).toThrow(/anvil, galileo, mainnet/);
  });

  it('rejects stub inference on mainnet', () => {
    expect(() => loadModes({ CHAIN_MODE: 'mainnet', STORAGE_MODE: 'real', INFERENCE_MODE: 'stub' }))
      .toThrow(/INFERENCE_MODE=stub/);
  });

  it('rejects memory storage outside anvil', () => {
    expect(() => loadModes({ CHAIN_MODE: 'galileo', STORAGE_MODE: 'memory' }))
      .toThrow(/STORAGE_MODE=memory/);
  });

  it('allows router on galileo', () => {
    expect(loadModes({ CHAIN_MODE: 'galileo', STORAGE_MODE: 'file', INFERENCE_MODE: 'router' }))
      .toEqual({ chain: 'galileo', storage: 'file', inference: 'router' });
  });
});
```

- [ ] **Step 7: Run them and confirm they fail**

```bash
cd packages/protocol && npx vitest run test/modes.test.ts
```
Expected: FAIL — the `../src/modes.js` module is not found.

- [ ] **Step 8: Implement `src/modes.ts`**

```ts
export const CHAIN_MODES = ['anvil', 'galileo', 'mainnet'] as const;
export const STORAGE_MODES = ['memory', 'file', 'real'] as const;
export const INFERENCE_MODES = ['stub', 'router', 'compute'] as const;

export type ChainMode = (typeof CHAIN_MODES)[number];
export type StorageMode = (typeof STORAGE_MODES)[number];
export type InferenceMode = (typeof INFERENCE_MODES)[number];

export interface Modes {
  chain: ChainMode;
  storage: StorageMode;
  inference: InferenceMode;
}

type Env = Record<string, string | undefined>;

function pick<T extends string>(env: Env, key: string, allowed: readonly T[], fallback: T): T {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  throw new Error(`${key}="${raw}" is not recognized; allowed: ${allowed.join(', ')}`);
}

/** Reads the three mode switches and enforces combinations that must not occur.
 *  The cross-checks below exist so a dangerous configuration fails at startup,
 *  not after it has already touched real funds. */
export function loadModes(env: Env = process.env): Modes {
  const chain = pick(env, 'CHAIN_MODE', CHAIN_MODES, 'anvil');
  const storage = pick(env, 'STORAGE_MODE', STORAGE_MODES, 'memory');
  const inference = pick(env, 'INFERENCE_MODE', INFERENCE_MODES, 'stub');

  if (chain === 'mainnet' && inference === 'stub') {
    throw new Error('INFERENCE_MODE=stub is forbidden when CHAIN_MODE=mainnet: simulated settlement must not touch real funds');
  }
  if (chain !== 'anvil' && storage === 'memory') {
    throw new Error(`STORAGE_MODE=memory is only for CHAIN_MODE=anvil; specRoot/receiptRoot must be re-fetchable on ${chain}`);
  }
  return { chain, storage, inference };
}
```

- [ ] **Step 9: Run them and confirm they pass**

```bash
cd packages/protocol && npx vitest run test/modes.test.ts
```
Expected: PASS — 6 lulus.

- [ ] **Step 10: Write the failing tests for konfigurasi jaringan**

Buat `packages/protocol/test/networks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { networkFor } from '../src/networks.js';

describe('networkFor', () => {
  it('anvil uses chain id 31337 and the local RPC', () => {
    const n = networkFor('anvil', {});
    expect(n.chainId).toBe(31337);
    expect(n.rpcUrl).toBe('http://127.0.0.1:8545');
    expect(n.explorer).toBeNull();
  });

  it('galileo uses chain id 16602 and the chainscan explorer', () => {
    const n = networkFor('galileo', {});
    expect(n.chainId).toBe(16602);
    expect(n.rpcUrl).toBe('https://evmrpc-testnet.0g.ai');
    expect(n.explorer).toBe('https://chainscan-galileo.0g.ai');
  });

  it('mainnet uses chain id 16661', () => {
    expect(networkFor('mainnet', {}).chainId).toBe(16661);
  });

  it('env menimpa RPC bawaan', () => {
    const n = networkFor('galileo', { ZERO_G_TESTNET_RPC: 'https://rpc.example' });
    expect(n.rpcUrl).toBe('https://rpc.example');
  });
});
```

- [ ] **Step 11: Implement `src/networks.ts` and `src/index.ts`**

`src/networks.ts`:

```ts
import type { ChainMode } from './modes.js';

export interface NetworkConfig {
  name: ChainMode;
  chainId: number;
  rpcUrl: string;
  explorer: string | null;
}

type Env = Record<string, string | undefined>;

/** Fakta diverifikasi 2026-08-27 — lihat §3.1 spec. */
export function networkFor(mode: ChainMode, env: Env = process.env): NetworkConfig {
  switch (mode) {
    case 'anvil':
      return { name: 'anvil', chainId: 31337, rpcUrl: env.LOCAL_RPC ?? 'http://127.0.0.1:8545', explorer: null };
    case 'galileo':
      return {
        name: 'galileo',
        chainId: 16602,
        rpcUrl: env.ZERO_G_TESTNET_RPC ?? 'https://evmrpc-testnet.0g.ai',
        explorer: 'https://chainscan-galileo.0g.ai',
      };
    case 'mainnet':
      return {
        name: 'mainnet',
        chainId: 16661,
        rpcUrl: env.ZERO_G_MAINNET_RPC ?? 'https://evmrpc.0g.ai',
        explorer: null,
      };
  }
}
```

`src/index.ts`:

```ts
export * from './units.js';
export * from './modes.js';
export * from './networks.js';
```

- [ ] **Step 12: Run the package's whole test suite**

```bash
cd packages/protocol && npx vitest run && npx tsc --noEmit
```
Expected: PASS — 17 lulus, tsc bersih.

- [ ] **Step 13: Commit**

```bash
git add packages/protocol package.json package-lock.json
git commit -m "feat(protocol): konversi satuan wad↔token, saklar mode, konfigurasi jaringan 0G"
```

---

## Task 3: `MockUSDC` — a 6-decimal collateral with a faucet

**Files:**
- Create: `contracts/src/mocks/MockUSDC.sol`
- Test: `contracts/test/unit/MockUSDC.t.sol`

**Interfaces:**
- Consumes: —
- Produces: `MockUSDC` — `decimals() → 6`, `claim()`, `mintTo(address,uint256)`, konstanta `FAUCET_AMOUNT = 10_000e6`, `FAUCET_COOLDOWN = 1 days`, error `FaucetCooldown(uint256 availableAt)`.

- [ ] **Step 1: Write the failing tests**

Buat `contracts/test/unit/MockUSDC.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../../src/mocks/MockUSDC.sol";

contract MockUSDCTest is Test {
    MockUSDC internal usdc;
    address internal alice = makeAddr("alice");

    function setUp() public {
        usdc = new MockUSDC();
    }

    function test_hasSixDecimals() public view {
        assertEq(usdc.decimals(), 6);
    }

    function test_claimMintsFaucetAmount() public {
        vm.prank(alice);
        usdc.claim();
        assertEq(usdc.balanceOf(alice), usdc.FAUCET_AMOUNT());
    }

    function test_claimTwiceWithinCooldownReverts() public {
        vm.startPrank(alice);
        usdc.claim();
        vm.expectRevert(
            abi.encodeWithSelector(MockUSDC.FaucetCooldown.selector, block.timestamp + usdc.FAUCET_COOLDOWN())
        );
        usdc.claim();
        vm.stopPrank();
    }

    function test_claimAgainAfterCooldownSucceeds() public {
        vm.startPrank(alice);
        usdc.claim();
        vm.warp(block.timestamp + usdc.FAUCET_COOLDOWN());
        usdc.claim();
        vm.stopPrank();
        assertEq(usdc.balanceOf(alice), usdc.FAUCET_AMOUNT() * 2);
    }

    function test_mintToIsOpenForTests() public {
        usdc.mintTo(alice, 5e6);
        assertEq(usdc.balanceOf(alice), 5e6);
    }
}
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd contracts && forge test --match-contract MockUSDCTest
```
Expected: FAIL — `src/mocks/MockUSDC.sol` is not found.

- [ ] **Step 3: Implement `contracts/src/mocks/MockUSDC.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC
/// @notice A 6-decimal test collateral for Brier. Testnet/local ONLY.
/// @dev Deliberately 6 decimals, not 18: every test must cross the decimal
///      normalization layer from day one, so a scaling bug does not first show up
///      when moving to a real stablecoin on mainnet.
contract MockUSDC is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 10_000e6;
    uint256 public constant FAUCET_COOLDOWN = 1 days;

    mapping(address => uint256) public lastClaim;

    error FaucetCooldown(uint256 availableAt);

    constructor() ERC20("Brier Mock USD", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function claim() external {
        uint256 last = lastClaim[msg.sender];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) {
            revert FaucetCooldown(last + FAUCET_COOLDOWN);
        }
        lastClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Unlimited mint — for test setup and demo seeding only.
    function mintTo(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

- [ ] **Step 4: Run them and confirm they pass**

```bash
cd contracts && forge test --match-contract MockUSDCTest -vv
```
Expected: PASS — 5 lulus.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/mocks/MockUSDC.sol contracts/test/unit/MockUSDC.t.sol
git commit -m "feat(contracts): 6-decimal MockUSDC with a cooldown faucet"
```

---

## Task 4: `ConfigRegistry` — parameter berbatas keras, alamat, guardian, pause

**Files:**
- Create: `contracts/src/core/ConfigKeys.sol`, `contracts/src/core/ConfigRegistry.sol`
- Test: `contracts/test/unit/ConfigRegistry.t.sol`

**Interfaces:**
- Consumes: —
- Produces:
  - `ConfigKeys` — konstanta `bytes32`: `FEE_BPS`, `CREATOR_FEE_SHARE_BPS`, `RESOLVER_FEE_SHARE_BPS`, `MIN_SEED`, `MIN_SETTLEMENT_DEPOSIT`, `MIN_TRADE_TOKENS`, `SWEEP_UNCLAIMED_AFTER`, `MARKET_FACTORY`, `OUTCOME_SHARES`, `TREASURY`, `RESOLUTION_MODULE`, `CURATOR_SIGNER`
  - `ConfigRegistry` — `initialize(address owner_, address guardian_)`, `params(bytes32) → uint256`, `addresses(bytes32) → address`, `allowedCollateral(address) → bool`, `paused() → bool`, `guardian() → address`, `setBounds(bytes32,uint128,uint128)`, `setParam(bytes32,uint256)`, `setAddress(bytes32,address)`, `setCollateralAllowed(address,bool)`, `pause()`, `unpause()`
  - Error: `UnboundedParam(bytes32)`, `BoundsLocked(bytes32)`, `ParamOutOfBounds(bytes32,uint256,uint256,uint256)`, `NotGuardian()`

- [ ] **Step 1: Write the failing tests**

Buat `contracts/test/unit/ConfigRegistry.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ConfigRegistry} from "../../src/core/ConfigRegistry.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";

contract ConfigRegistryTest is Test {
    ConfigRegistry internal config;
    address internal owner = makeAddr("owner");
    address internal guardian = makeAddr("guardian");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        ConfigRegistry impl = new ConfigRegistry();
        bytes memory data = abi.encodeCall(ConfigRegistry.initialize, (owner, guardian));
        config = ConfigRegistry(address(new ERC1967Proxy(address(impl), data)));
    }

    function test_initializeSetsOwnerAndGuardian() public view {
        assertEq(config.owner(), owner);
        assertEq(config.guardian(), guardian);
        assertFalse(config.paused());
    }

    function test_setParamRequiresBoundsFirst() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ConfigRegistry.UnboundedParam.selector, ConfigKeys.FEE_BPS));
        config.setParam(ConfigKeys.FEE_BPS, 100);
    }

    function test_setParamWithinBoundsSucceeds() public {
        vm.startPrank(owner);
        config.setBounds(ConfigKeys.FEE_BPS, 0, 300);
        config.setParam(ConfigKeys.FEE_BPS, 100);
        vm.stopPrank();
        assertEq(config.params(ConfigKeys.FEE_BPS), 100);
    }

    function test_setParamAboveHardCeilingReverts() public {
        vm.startPrank(owner);
        config.setBounds(ConfigKeys.FEE_BPS, 0, 300);
        vm.expectRevert(
            abi.encodeWithSelector(ConfigRegistry.ParamOutOfBounds.selector, ConfigKeys.FEE_BPS, 301, 0, 300)
        );
        config.setParam(ConfigKeys.FEE_BPS, 301);
        vm.stopPrank();
    }

    /// @dev The most important property of this contract: bounds cannot be loosened once set.
    ///      Without it a "hard bound" is merely advice, because the owner could raise it.
    function test_boundsAreLockedForever() public {
        vm.startPrank(owner);
        config.setBounds(ConfigKeys.FEE_BPS, 0, 300);
        vm.expectRevert(abi.encodeWithSelector(ConfigRegistry.BoundsLocked.selector, ConfigKeys.FEE_BPS));
        config.setBounds(ConfigKeys.FEE_BPS, 0, 10_000);
        vm.stopPrank();
    }

    function test_onlyOwnerCanSetParam() public {
        vm.prank(owner);
        config.setBounds(ConfigKeys.FEE_BPS, 0, 300);
        vm.prank(stranger);
        vm.expectRevert();
        config.setParam(ConfigKeys.FEE_BPS, 100);
    }

    function test_guardianCanPauseOwnerCanUnpause() public {
        vm.prank(guardian);
        config.pause();
        assertTrue(config.paused());

        vm.prank(guardian);
        vm.expectRevert();
        config.unpause();

        vm.prank(owner);
        config.unpause();
        assertFalse(config.paused());
    }

    function test_strangerCannotPause() public {
        vm.prank(stranger);
        vm.expectRevert(ConfigRegistry.NotGuardian.selector);
        config.pause();
    }

    function test_addressesAndCollateralAllowlist() public {
        address token = makeAddr("token");
        vm.startPrank(owner);
        config.setAddress(ConfigKeys.TREASURY, address(0xBEEF));
        config.setCollateralAllowed(token, true);
        vm.stopPrank();
        assertEq(config.addresses(ConfigKeys.TREASURY), address(0xBEEF));
        assertTrue(config.allowedCollateral(token));
    }
}
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd contracts && forge test --match-contract ConfigRegistryTest
```
Expected: FAIL — `src/core/ConfigRegistry.sol` is not found.

- [ ] **Step 3: Implement `contracts/src/core/ConfigKeys.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ConfigKeys
/// @notice Canonical keys for ConfigRegistry. No magic numbers in any other contract.
library ConfigKeys {
    // ── parameter (uint256) ──────────────────────────────────────────────────
    bytes32 internal constant FEE_BPS = keccak256("FEE_BPS");
    bytes32 internal constant CREATOR_FEE_SHARE_BPS = keccak256("CREATOR_FEE_SHARE_BPS");
    bytes32 internal constant RESOLVER_FEE_SHARE_BPS = keccak256("RESOLVER_FEE_SHARE_BPS");
    bytes32 internal constant MIN_SEED = keccak256("MIN_SEED");
    bytes32 internal constant MIN_SETTLEMENT_DEPOSIT = keccak256("MIN_SETTLEMENT_DEPOSIT");
    bytes32 internal constant MIN_TRADE_TOKENS = keccak256("MIN_TRADE_TOKENS");
    bytes32 internal constant SWEEP_UNCLAIMED_AFTER = keccak256("SWEEP_UNCLAIMED_AFTER");

    // ── alamat ───────────────────────────────────────────────────────────────
    bytes32 internal constant MARKET_FACTORY = keccak256("MARKET_FACTORY");
    bytes32 internal constant OUTCOME_SHARES = keccak256("OUTCOME_SHARES");
    bytes32 internal constant TREASURY = keccak256("TREASURY");
    bytes32 internal constant RESOLUTION_MODULE = keccak256("RESOLUTION_MODULE");
    bytes32 internal constant CURATOR_SIGNER = keccak256("CURATOR_SIGNER");
}
```

- [ ] **Step 4: Implement `contracts/src/core/ConfigRegistry.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title ConfigRegistry
/// @notice The single source of protocol parameters, addresses, and pause state.
/// @dev Parameter bounds are LOCKED the first time they are set and can never be loosened.
///      Without that lock, a "hard bound" would be merely advice to the owner.
contract ConfigRegistry is Initializable, Ownable2StepUpgradeable, UUPSUpgradeable {
    struct Bounds {
        uint128 lo;
        uint128 hi;
        bool locked;
    }

    mapping(bytes32 => uint256) public params;
    mapping(bytes32 => Bounds) public bounds;
    mapping(bytes32 => address) public addresses;
    mapping(address => bool) public allowedCollateral;

    address public guardian;
    bool public paused;

    error UnboundedParam(bytes32 key);
    error BoundsLocked(bytes32 key);
    error ParamOutOfBounds(bytes32 key, uint256 value, uint256 lo, uint256 hi);
    error NotGuardian();

    event ParamSet(bytes32 indexed key, uint256 value);
    event BoundsSet(bytes32 indexed key, uint256 lo, uint256 hi);
    event AddressSet(bytes32 indexed key, address value);
    event CollateralAllowed(address indexed token, bool allowed);
    event GuardianSet(address indexed guardian);
    event PausedSet(bool paused);

    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address guardian_) external initializer {
        __Ownable_init(owner_);
        __Ownable2Step_init();
        __UUPSUpgradeable_init();
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    function setBounds(bytes32 key, uint128 lo, uint128 hi) external onlyOwner {
        if (bounds[key].locked) revert BoundsLocked(key);
        bounds[key] = Bounds({lo: lo, hi: hi, locked: true});
        emit BoundsSet(key, lo, hi);
    }

    function setParam(bytes32 key, uint256 value) external onlyOwner {
        Bounds memory b = bounds[key];
        if (!b.locked) revert UnboundedParam(key);
        if (value < b.lo || value > b.hi) revert ParamOutOfBounds(key, value, b.lo, b.hi);
        params[key] = value;
        emit ParamSet(key, value);
    }

    function setAddress(bytes32 key, address value) external onlyOwner {
        addresses[key] = value;
        emit AddressSet(key, value);
    }

    function setCollateralAllowed(address token, bool allowed) external onlyOwner {
        allowedCollateral[token] = allowed;
        emit CollateralAllowed(token, allowed);
    }

    function setGuardian(address guardian_) external onlyOwner {
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    /// @notice The guardian may halt quickly; only the owner may switch it back on.
    function pause() external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        paused = true;
        emit PausedSet(true);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit PausedSet(false);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
```

- [ ] **Step 5: Run them and confirm they pass**

```bash
cd contracts && forge test --match-contract ConfigRegistryTest -vv
```
Expected: PASS — 9 lulus.

- [ ] **Step 6: Commit**

```bash
git add contracts/src/core/ConfigKeys.sol contracts/src/core/ConfigRegistry.sol contracts/test/unit/ConfigRegistry.t.sol
git commit -m "feat(contracts): ConfigRegistry with permanently locked parameter bounds"
```

---

## Task 5: The deploy script, the deployment manifest, and the local demo

**Files:**
- Create: `contracts/script/DeployLib.sol`, `contracts/script/Deploy.s.sol`
- Create: `packages/protocol/src/deployments.ts`, `scripts/demo-local.sh`
- Test: `contracts/test/unit/DeployDefaults.t.sol`, `packages/protocol/test/deployments.test.ts`
- Modify: `packages/protocol/src/index.ts`

**Interfaces:**
- Consumes: `ConfigRegistry`, `ConfigKeys`, `MockUSDC` (Task 3–4)
- Produces:
  - `DeployLib.applyDefaults(ConfigRegistry config, address collateral)` — sets the bounds and then the values for every §17 spec parameter
  - `deployments/<chainId>.json` in the shape `{ chainId, deploymentBlock, deployedAt, contracts, params }`
  - TS: `interface DeploymentManifest`, `parseDeployment(raw: unknown, expectedChainId?: number): DeploymentManifest`, `loadDeployment(chainId: number, dir?: string): DeploymentManifest`, `requireContracts(m: DeploymentManifest, names: string[]): void`

- [ ] **Step 1: Write the failing tests for parameter bawaan**

Buat `contracts/test/unit/DeployDefaults.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ConfigRegistry} from "../../src/core/ConfigRegistry.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";
import {MockUSDC} from "../../src/mocks/MockUSDC.sol";
import {DeployLib} from "../../script/DeployLib.sol";

contract DeployDefaultsTest is Test {
    ConfigRegistry internal config;
    MockUSDC internal usdc;

    function setUp() public {
        usdc = new MockUSDC();
        ConfigRegistry impl = new ConfigRegistry();
        config = ConfigRegistry(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(ConfigRegistry.initialize, (address(this), address(this)))))
        );
        DeployLib.applyDefaults(config, address(usdc));
    }

    function test_defaultsMatchSpecTable() public view {
        assertEq(config.params(ConfigKeys.FEE_BPS), 100);
        assertEq(config.params(ConfigKeys.CREATOR_FEE_SHARE_BPS), 4000);
        assertEq(config.params(ConfigKeys.RESOLVER_FEE_SHARE_BPS), 3000);
        assertEq(config.params(ConfigKeys.MIN_SEED), 100e6);
        assertEq(config.params(ConfigKeys.MIN_SETTLEMENT_DEPOSIT), 20e6);
        assertEq(config.params(ConfigKeys.MIN_TRADE_TOKENS), 1e6);
        assertEq(config.params(ConfigKeys.SWEEP_UNCLAIMED_AFTER), 365 days);
    }

    function test_collateralIsAllowlisted() public view {
        assertTrue(config.allowedCollateral(address(usdc)));
    }

    /// @dev The fee ceiling is a promise to users, not a preference. The lock proves it.
    function test_feeCeilingIsThreePercentAndLocked() public {
        vm.expectRevert(abi.encodeWithSelector(ConfigRegistry.ParamOutOfBounds.selector, ConfigKeys.FEE_BPS, 301, 0, 300));
        config.setParam(ConfigKeys.FEE_BPS, 301);
        vm.expectRevert(abi.encodeWithSelector(ConfigRegistry.BoundsLocked.selector, ConfigKeys.FEE_BPS));
        config.setBounds(ConfigKeys.FEE_BPS, 0, 10_000);
    }

    function test_feeSharesSumToOneHundredPercent() public view {
        uint256 creator = config.params(ConfigKeys.CREATOR_FEE_SHARE_BPS);
        uint256 resolver = config.params(ConfigKeys.RESOLVER_FEE_SHARE_BPS);
        assertLe(creator + resolver, 10_000);
    }
}
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd contracts && forge test --match-contract DeployDefaultsTest
```
Expected: FAIL — `script/DeployLib.sol` is not found.

- [ ] **Step 3: Implement `contracts/script/DeployLib.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ConfigRegistry} from "../src/core/ConfigRegistry.sol";
import {ConfigKeys} from "../src/core/ConfigKeys.sol";

/// @title DeployLib
/// @notice Protocol defaults from spec §17. Kept separate from the broadcast script so
///         they can be tested directly without broadcasting a transaction.
library DeployLib {
    uint128 internal constant UNBOUNDED = type(uint128).max;

    function applyDefaults(ConfigRegistry config, address collateral) internal {
        // Bounds are set first and locked forever; the values follow.
        config.setBounds(ConfigKeys.FEE_BPS, 0, 300); // plafon 3.00%
        config.setBounds(ConfigKeys.CREATOR_FEE_SHARE_BPS, 0, 10_000);
        config.setBounds(ConfigKeys.RESOLVER_FEE_SHARE_BPS, 0, 10_000);
        config.setBounds(ConfigKeys.MIN_SEED, 1e6, UNBOUNDED);
        config.setBounds(ConfigKeys.MIN_SETTLEMENT_DEPOSIT, 1e6, UNBOUNDED);
        config.setBounds(ConfigKeys.MIN_TRADE_TOKENS, 1, UNBOUNDED);
        config.setBounds(ConfigKeys.SWEEP_UNCLAIMED_AFTER, 180 days, 3650 days);

        config.setParam(ConfigKeys.FEE_BPS, 100);
        config.setParam(ConfigKeys.CREATOR_FEE_SHARE_BPS, 4000);
        config.setParam(ConfigKeys.RESOLVER_FEE_SHARE_BPS, 3000);
        config.setParam(ConfigKeys.MIN_SEED, 100e6);
        config.setParam(ConfigKeys.MIN_SETTLEMENT_DEPOSIT, 20e6);
        config.setParam(ConfigKeys.MIN_TRADE_TOKENS, 1e6);
        config.setParam(ConfigKeys.SWEEP_UNCLAIMED_AFTER, 365 days);

        config.setCollateralAllowed(collateral, true);
    }
}
```

- [ ] **Step 4: Run them and confirm they pass**

```bash
cd contracts && forge test --match-contract DeployDefaultsTest -vv
```
Expected: PASS — 4 lulus.

- [ ] **Step 5: Implement `contracts/script/Deploy.s.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ConfigRegistry} from "../src/core/ConfigRegistry.sol";
import {ConfigKeys} from "../src/core/ConfigKeys.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {DeployLib} from "./DeployLib.sol";

/// @notice Deploys P0: MockUSDC + ConfigRegistry (behind an ERC1967Proxy) + the default parameters.
///         Task 16 extends this script with OutcomeShares, the Market impl, and MarketFactory.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        MockUSDC usdc = new MockUSDC();

        ConfigRegistry impl = new ConfigRegistry();
        ConfigRegistry config = ConfigRegistry(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(ConfigRegistry.initialize, (deployer, deployer))))
        );
        DeployLib.applyDefaults(config, address(usdc));

        vm.stopBroadcast();

        _writeManifest(address(config), address(impl), address(usdc));

        console2.log("ConfigRegistry (proxy):", address(config));
        console2.log("MockUSDC:              ", address(usdc));
    }

    function _writeManifest(address configProxy, address configImpl, address usdc) internal {
        string memory contractsKey = "contracts";
        vm.serializeAddress(contractsKey, "ConfigRegistry", configProxy);
        vm.serializeAddress(contractsKey, "ConfigRegistryImpl", configImpl);
        string memory contractsJson = vm.serializeAddress(contractsKey, "MockUSDC", usdc);

        string memory root = "manifest";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "deploymentBlock", block.number);
        vm.serializeUint(root, "deployedAt", block.timestamp);
        string memory out = vm.serializeString(root, "contracts", contractsJson);

        vm.writeJson(out, string.concat("../deployments/", vm.toString(block.chainid), ".json"));
    }
}
```

- [ ] **Step 6: Write the failing tests for pembaca manifest**

Buat `packages/protocol/test/deployments.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseDeployment, requireContracts } from '../src/deployments.js';

const valid = {
  chainId: 16602,
  deploymentBlock: 1234,
  deployedAt: 1790000000,
  contracts: {
    ConfigRegistry: '0x1111111111111111111111111111111111111111',
    MockUSDC: '0x2222222222222222222222222222222222222222',
  },
};

describe('parseDeployment', () => {
  it('accepts a valid manifest', () => {
    const m = parseDeployment(valid);
    expect(m.chainId).toBe(16602);
    expect(m.contracts.ConfigRegistry).toBe('0x1111111111111111111111111111111111111111');
  });

  it('rejects a chainId mismatch', () => {
    expect(() => parseDeployment(valid, 16661)).toThrow(/16661/);
  });

  it('rejects an address that is not 0x + 40 hex', () => {
    const bad = { ...valid, contracts: { ConfigRegistry: '0xnope' } };
    expect(() => parseDeployment(bad)).toThrow(/ConfigRegistry/);
  });

  it('rejects a manifest with no contracts', () => {
    expect(() => parseDeployment({ chainId: 1, deploymentBlock: 0, deployedAt: 0 })).toThrow(/contracts/);
  });

  it('requireContracts names what is missing', () => {
    const m = parseDeployment(valid);
    expect(() => requireContracts(m, ['ConfigRegistry', 'MarketFactory'])).toThrow(/MarketFactory/);
    expect(() => requireContracts(m, ['ConfigRegistry'])).not.toThrow();
  });
});
```

- [ ] **Step 7: Implement `packages/protocol/src/deployments.ts`**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DeploymentManifest {
  chainId: number;
  deploymentBlock: number;
  deployedAt: number;
  contracts: Record<string, `0x${string}`>;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function asRecord(v: unknown, label: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Error(`invalid manifest: ${label} must be an object`);
  }
  return v as Record<string, unknown>;
}

function asNumber(v: unknown, label: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`invalid manifest: ${label} must be a number`);
  }
  return v;
}

export function parseDeployment(raw: unknown, expectedChainId?: number): DeploymentManifest {
  const obj = asRecord(raw, 'manifest');
  const chainId = asNumber(obj.chainId, 'chainId');
  if (expectedChainId !== undefined && chainId !== expectedChainId) {
    throw new Error(`manifest is for chainId ${chainId}, but ${expectedChainId} was requested`);
  }
  const rawContracts = asRecord(obj.contracts, 'contracts');
  const contracts: Record<string, `0x${string}`> = {};
  for (const [name, addr] of Object.entries(rawContracts)) {
    if (typeof addr !== 'string' || !ADDRESS_RE.test(addr)) {
      throw new Error(`invalid manifest: contracts.${name} is not an address: ${String(addr)}`);
    }
    contracts[name] = addr as `0x${string}`;
  }
  return {
    chainId,
    deploymentBlock: asNumber(obj.deploymentBlock, 'deploymentBlock'),
    deployedAt: asNumber(obj.deployedAt, 'deployedAt'),
    contracts,
  };
}

/** Fail fast at startup when a required contract is missing from the manifest. */
export function requireContracts(m: DeploymentManifest, names: readonly string[]): void {
  const missing = names.filter((n) => m.contracts[n] === undefined);
  if (missing.length > 0) {
    throw new Error(`manifest chainId ${m.chainId} is missing contracts: ${missing.join(', ')}`);
  }
}

export function loadDeployment(chainId: number, dir = join(process.cwd(), 'deployments')): DeploymentManifest {
  const path = join(dir, `${chainId}.json`);
  return parseDeployment(JSON.parse(readFileSync(path, 'utf8')), chainId);
}
```

Add to `packages/protocol/src/index.ts`:

```ts
export * from './deployments.js';
```

- [ ] **Step 8: Run the tests TS**

```bash
cd packages/protocol && npx vitest run test/deployments.test.ts
```
Expected: PASS — 5 lulus.

- [ ] **Step 9: Write `scripts/demo-local.sh`**

```bash
#!/usr/bin/env bash
# Brings up anvil, deploys the P0 stack, prints the manifest, then stays running.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${ANVIL_PORT:-8545}"
RPC="http://127.0.0.1:${PORT}"
# anvil account #0 — a public test key that never holds value
export DEPLOYER_KEY="${DEPLOYER_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"

ANVIL_PID=""
cleanup() { [[ -n "$ANVIL_PID" ]] && kill "$ANVIL_PID" 2>/dev/null || true; }
trap cleanup EXIT

echo "▶ bringing up anvil on port ${PORT}"
anvil --port "$PORT" --silent &
ANVIL_PID=$!

for _ in $(seq 1 60); do
  if cast block-number --rpc-url "$RPC" >/dev/null 2>&1; then break; fi
  sleep 0.2
done
cast block-number --rpc-url "$RPC" >/dev/null

echo "▶ men-deploy tumpukan P0"
cd "$ROOT/contracts"
forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC" --broadcast -vv

echo "▶ manifest:"
cat "$ROOT/deployments/31337.json"

echo ""
echo "anvil is running on $RPC (PID $ANVIL_PID) — Ctrl-C to stop"
wait "$ANVIL_PID"
```

Make it executable: `chmod +x scripts/demo-local.sh`

- [ ] **Step 10: Run the demo end to end**

```bash
timeout 90 bash scripts/demo-local.sh || true
cat deployments/31337.json
```
Expected: a manifest containing `chainId: 31337` and three addresses.

- [ ] **Step 11: Commit**

```bash
git add contracts/script packages/protocol/src/deployments.ts packages/protocol/src/index.ts \
        packages/protocol/test/deployments.test.ts contracts/test/unit/DeployDefaults.t.sol \
        scripts/demo-local.sh deployments/
git commit -m "feat: the deploy script, the deployment manifest, and the local anvil demo"
```

**✅ P0 done.** `make demo` brings up a local chain, deploys, and writes a manifest TypeScript can read.

---

# P1 — Inti Market DPM

---

## Task 6: `DPMMath` — cost and costUp

**Files:**
- Create: `contracts/src/math/DPMMath.sol`
- Test: `contracts/test/unit/DPMMath.t.sol`

**Interfaces:**
- Consumes: `Math` from OZ
- Produces:
  - `DPMMath.WAD = 1e18`, `DPMMath.MAX_Q = 1e33`
  - `cost(uint256[2] memory q) internal pure returns (uint256)` — `√(q₀²+q₁²)`, rounded down
  - `costUp(uint256[2] memory q) internal pure returns (uint256)` — rounded up
  - `error QOverflow()`

- [ ] **Step 1: Write the failing tests**

Buat `contracts/test/unit/DPMMath.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DPMMath} from "../../src/math/DPMMath.sol";

contract DPMMathTest is Test {
    function _q(uint256 a, uint256 b) internal pure returns (uint256[2] memory r) {
        r[0] = a;
        r[1] = b;
    }

    function test_costOfEmptyMarketIsZero() public pure {
        assertEq(DPMMath.cost(_q(0, 0)), 0);
        assertEq(DPMMath.costUp(_q(0, 0)), 0);
    }

    function test_costOfSingleSidedMarketIsThatSide() public pure {
        assertEq(DPMMath.cost(_q(1e18, 0)), 1e18);
        assertEq(DPMMath.costUp(_q(1e18, 0)), 1e18);
    }

    /// @dev The 3-4-5 triangle: the one case where √ is certainly exact, so
    ///      add 1. This is what catches a mistaken ceil.
    function test_exactSquareRootDoesNotRoundUp() public pure {
        assertEq(DPMMath.cost(_q(3e18, 4e18)), 5e18);
        assertEq(DPMMath.costUp(_q(3e18, 4e18)), 5e18);
    }

    function test_balancedMarketCostsQTimesSqrtTwo() public pure {
        assertEq(DPMMath.cost(_q(1e18, 1e18)), 1_414_213_562_373_095_048);
        assertEq(DPMMath.costUp(_q(1e18, 1e18)), 1_414_213_562_373_095_049);
    }

    function test_costUpIsNeverBelowCost() public pure {
        assertGe(DPMMath.costUp(_q(7e18, 11e18)), DPMMath.cost(_q(7e18, 11e18)));
        assertLe(DPMMath.costUp(_q(7e18, 11e18)) - DPMMath.cost(_q(7e18, 11e18)), 1);
    }

    function test_maxQDoesNotRevert() public pure {
        uint256 c = DPMMath.cost(_q(DPMMath.MAX_Q, DPMMath.MAX_Q));
        assertGt(c, DPMMath.MAX_Q);
    }

    function test_aboveMaxQReverts() public {
        uint256[2] memory over = _q(DPMMath.MAX_Q + 1, 0);
        vm.expectRevert(DPMMath.QOverflow.selector);
        this.callCost(over);
    }

    function callCost(uint256[2] memory q) external pure returns (uint256) {
        return DPMMath.cost(q);
    }

    /// @dev Homogeneity of degree 1: C(k·q) = k·C(q). This is the property that makes a
    ///      proportional liquidity addition probability-neutral (Task 13).
    function testFuzz_costIsHomogeneousDegreeOne(uint96 a, uint96 b, uint8 kSmall) public pure {
        uint256 k = uint256(kSmall) + 1;
        uint256[2] memory q = _q(uint256(a), uint256(b));
        uint256[2] memory kq = _q(uint256(a) * k, uint256(b) * k);
        uint256 lhs = DPMMath.cost(kq);
        uint256 rhs = DPMMath.cost(q) * k;
        // floor rounding accumulates at most k wei
        assertLe(lhs > rhs ? lhs - rhs : rhs - lhs, k);
    }

    /// @dev Monotonicity: adding shares never lowers the pool cost.
    function testFuzz_costIsMonotonic(uint96 a, uint96 b, uint96 delta) public pure {
        uint256[2] memory q = _q(uint256(a), uint256(b));
        uint256[2] memory qMore = _q(uint256(a) + uint256(delta), uint256(b));
        assertGe(DPMMath.cost(qMore), DPMMath.cost(q));
    }
}
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd contracts && forge test --match-contract DPMMathTest
```
Expected: FAIL — `src/math/DPMMath.sol` is not found.

- [ ] **Step 3: Implement `contracts/src/math/DPMMath.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title DPMMath
/// @notice Cost function pari-mutuel dinamis (Pennock): C(q) = √(q₀² + q₁²).
/// @dev All values are in wad (1e18). Because qᵢ is scaled by 1e18, qᵢ² is scaled by 1e36,
///      so the integer square root of their sum lands directly in wad —
///      no rescaling, and no place for a scale error to hide.
///
///      The properties this library guarantees:
///        • Σ pᵢ² = WAD           → pᵢ² is a valid probability distribution
///        • Σ pᵢ·qᵢ = C(q)        → liquidation exhausts the pool exactly (Euler)
///        • C(k·q) = k·C(q)       → proportional liquidity additions are price-neutral
library DPMMath {
    uint256 internal constant WAD = 1e18;

    /// @dev 2·(1e33)² = 2e66 < 2²⁵⁶ ≈ 1.16e77, so the sum of squares never overflows.
    uint256 internal constant MAX_Q = 1e33;

    error QOverflow();

    function _sumSq(uint256[2] memory q) private pure returns (uint256) {
        if (q[0] > MAX_Q || q[1] > MAX_Q) revert QOverflow();
        return q[0] * q[0] + q[1] * q[1];
    }

    /// @notice C(q) rounded DOWN. Used for reporting, not for pool state.
    function cost(uint256[2] memory q) internal pure returns (uint256) {
        return Math.sqrt(_sumSq(q), Math.Rounding.Floor);
    }

    /// @notice C(q) rounded UP. `Market.poolWad` always uses this value,
    ///         so every speck of rounding dust is left inside the pool, never outside it.
    function costUp(uint256[2] memory q) internal pure returns (uint256) {
        return Math.sqrt(_sumSq(q), Math.Rounding.Ceil);
    }
}
```

- [ ] **Step 4: Run them and confirm they pass**

```bash
cd contracts && forge test --match-contract DPMMathTest -vv
```
Expected: PASS — 9 passing (2 of them fuzz).

- [ ] **Step 5: Commit**

```bash
git add contracts/src/math/DPMMath.sol contracts/test/unit/DPMMath.t.sol
git commit -m "feat(math): the DPM cost function with rounding that favours the pool"
```

---

## Task 7: `DPMMath` — price and probability

**Files:**
- Modify: `contracts/src/math/DPMMath.sol`
- Modify: `contracts/test/unit/DPMMath.t.sol`

**Interfaces:**
- Consumes: `DPMMath.cost`, `DPMMath._sumSq` (Task 6)
- Produces:
  - `price(uint256[2] memory q, uint8 i) internal pure returns (uint256)` — `qᵢ·WAD/C(q)`
  - `probability(uint256[2] memory q, uint8 i) internal pure returns (uint256)` — `pᵢ² = qᵢ²·WAD/Σqⱼ²`
  - `error BadOutcome()`

- [ ] **Step 1: Add the failing tests to `DPMMathTest`**

```solidity
    function test_priceOfThreeFourFiveIsExact() public pure {
        assertEq(DPMMath.price(_q(3e18, 4e18), 0), 6e17);
        assertEq(DPMMath.price(_q(3e18, 4e18), 1), 8e17);
    }

    /// @dev The signature property of DPM: the marginal price is NOT the probability — its
    ///      square is, and the squares sum to one. A UI must display pᵢ².
    function test_sumOfSquaredPricesIsOne() public pure {
        uint256[2] memory q = _q(3e18, 4e18);
        uint256 p0 = DPMMath.price(q, 0);
        uint256 p1 = DPMMath.price(q, 1);
        assertEq(Math.mulDiv(p0, p0, DPMMath.WAD) + Math.mulDiv(p1, p1, DPMMath.WAD), DPMMath.WAD);
    }

    function test_probabilityOfThreeFourFiveIsExact() public pure {
        assertEq(DPMMath.probability(_q(3e18, 4e18), 0), 36e16);
        assertEq(DPMMath.probability(_q(3e18, 4e18), 1), 64e16);
    }

    function test_balancedMarketIsFiftyPercent() public pure {
        assertEq(DPMMath.probability(_q(1e18, 1e18), 0), 5e17);
        assertEq(DPMMath.probability(_q(7e30, 7e30), 1), 5e17);
    }

    /// @dev qᵢ² · WAD reaches 1e84 at MAX_Q — far beyond uint256. This test fails if the
    ///      implementation uses an ordinary multiplication instead of a 512-bit mulDiv.
    function test_probabilityDoesNotOverflowAtMaxQ() public pure {
        assertEq(DPMMath.probability(_q(DPMMath.MAX_Q, DPMMath.MAX_Q), 0), 5e17);
    }

    function test_emptyMarketHasZeroPriceAndProbability() public pure {
        assertEq(DPMMath.price(_q(0, 0), 0), 0);
        assertEq(DPMMath.probability(_q(0, 0), 0), 0);
    }

    function test_badOutcomeReverts() public {
        vm.expectRevert(DPMMath.BadOutcome.selector);
        this.callPrice(_q(1e18, 1e18), 2);
    }

    function callPrice(uint256[2] memory q, uint8 i) external pure returns (uint256) {
        return DPMMath.price(q, i);
    }

    function testFuzz_probabilitiesSumToOne(uint96 a, uint96 b) public pure {
        vm.assume(uint256(a) + uint256(b) > 0);
        uint256[2] memory q = _q(uint256(a), uint256(b));
        uint256 sum = DPMMath.probability(q, 0) + DPMMath.probability(q, 1);
        assertLe(DPMMath.WAD - sum, 2); // floor dust only
        assertLe(sum, DPMMath.WAD);
    }

    /// @dev Euler: Σ pᵢ·qᵢ = C(q). This is what makes liquidation exhaust the pool
    ///      exactly when a market fails (Task 15).
    function testFuzz_eulerIdentity(uint96 a, uint96 b) public pure {
        vm.assume(uint256(a) + uint256(b) > 0);
        uint256[2] memory q = _q(uint256(a), uint256(b));
        uint256 lhs = Math.mulDiv(DPMMath.price(q, 0), q[0], DPMMath.WAD)
            + Math.mulDiv(DPMMath.price(q, 1), q[1], DPMMath.WAD);
        assertLe(DPMMath.cost(q) - lhs, 3); // floor dust from three divisions
        assertLe(lhs, DPMMath.cost(q));
    }
```

Add the import at the top of the test file:

```solidity
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd contracts && forge test --match-contract DPMMathTest
```
Expected: FAIL — `price` and `probability` do not exist yet.

- [ ] **Step 3: Add to `DPMMath.sol`**

```solidity
    error BadOutcome();

    /// @notice Marginal price pᵢ = ∂C/∂qᵢ = qᵢ / C(q), in wad.
    /// @dev NOT the probability. The probability is pᵢ² — see `probability`.
    function price(uint256[2] memory q, uint8 i) internal pure returns (uint256) {
        if (i > 1) revert BadOutcome();
        uint256 c = cost(q);
        if (c == 0) return 0;
        return Math.mulDiv(q[i], WAD, c);
    }

    /// @notice Implied probability Pᵢ = pᵢ² = qᵢ² / Σqⱼ², in wad. Σ Pᵢ = WAD.
    /// @dev mulDiv is mandatory: qᵢ² reaches 1e66, and qᵢ²·WAD reaches 1e84 — beyond
    ///      uint256. mulDiv forms the 512-bit product before dividing.
    function probability(uint256[2] memory q, uint8 i) internal pure returns (uint256) {
        if (i > 1) revert BadOutcome();
        uint256 s = _sumSq(q);
        if (s == 0) return 0;
        return Math.mulDiv(q[i] * q[i], WAD, s);
    }
```

- [ ] **Step 4: Run them and confirm they pass**

```bash
cd contracts && forge test --match-contract DPMMathTest -vv
```
Expected: PASS — 18 lulus.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/math/DPMMath.sol contracts/test/unit/DPMMath.t.sol
git commit -m "feat(math): DPM marginal price and overflow-safe p_i^2 probability"
```

---

## Task 8: `DPMMath` — sharesForSpend (bentuk tertutup)

**Files:**
- Modify: `contracts/src/math/DPMMath.sol`
- Modify: `contracts/test/unit/DPMMath.t.sol`

**Interfaces:**
- Consumes: `DPMMath.costUp` (Task 6)
- Produces:
  - `sharesForSpend(uint256[2] memory q, uint8 i, uint256 spendWad) internal pure returns (uint256)`
  - `error InsufficientSpend()`

- [ ] **Step 1: Add the failing tests to `DPMMathTest`**

```solidity
    /// @dev The closed form: x = √(C₁² − q_j²) − qᵢ with C₁ = C(q) + spend.
    ///      Two Pythagorean triangles were chosen so the answers are whole and checkable by eye:
    ///      (0,3) costs 3 → C₁ = 5 → new q₀ = 4  ⇒ 4 shares.
    function test_sharesForSpendClosedFormExactCaseA() public pure {
        assertEq(DPMMath.sharesForSpend(_q(0, 3e18), 0, 2e18), 4e18);
    }

    /// @dev (5,12) costs 13 → C₁ = 15 → new q₀ = 9 ⇒ 4 shares.
    function test_sharesForSpendClosedFormExactCaseB() public pure {
        assertEq(DPMMath.sharesForSpend(_q(5e18, 12e18), 0, 2e18), 4e18);
    }

    function test_zeroSpendReverts() public {
        vm.expectRevert(DPMMath.InsufficientSpend.selector);
        this.callSharesForSpend(_q(3e18, 4e18), 0, 0);
    }

    function callSharesForSpend(uint256[2] memory q, uint8 i, uint256 s) external pure returns (uint256) {
        return DPMMath.sharesForSpend(q, i, s);
    }

    /// @dev The property that really matters: a quote must never promise more
    ///      shares than were paid for. The real cost of the quoted shares must be
    ///      ≤ spend (never above it).
    function testFuzz_sharesForSpendNeverOverpromises(uint96 a, uint96 b, uint96 spend) public pure {
        vm.assume(uint256(a) + uint256(b) > 0);
        vm.assume(spend > 1e12);
        uint256[2] memory q = _q(uint256(a), uint256(b));
        uint256 shares = DPMMath.sharesForSpend(q, 0, uint256(spend));
        uint256[2] memory qAfter = _q(uint256(a) + shares, uint256(b));
        uint256 realCost = DPMMath.costUp(qAfter) - DPMMath.costUp(q);
        assertLe(realCost, uint256(spend));
    }
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd contracts && forge test --match-contract DPMMathTest
```
Expected: FAIL — `sharesForSpend` does not exist yet.

- [ ] **Step 3: Add to `DPMMath.sol`**

```solidity
    error InsufficientSpend();

    /// @notice Shares of outcome `i` obtained when `spendWad` enters the pool.
    /// @param spendWad the portion that enters the pool — already net of fee.
    /// @dev For n = 2 no Newton iteration is needed. We are looking for x such that
    ///        √((qᵢ+x)² + q_j²) = C(q) + spend = C₁
    ///      which yields the closed form
    ///        x = √(C₁² − q_j²) − qᵢ
    ///      The base uses costUp (the same value as Market's poolWad) and the final
    ///      result is rounded down, so the quote never overstates.
    ///      This is a QUOTE, not the authority: `Market.buy` recomputes the real cost
    ///      and the caller protects itself with `maxTokensIn`.
    function sharesForSpend(uint256[2] memory q, uint8 i, uint256 spendWad) internal pure returns (uint256) {
        if (i > 1) revert BadOutcome();
        if (spendWad == 0) revert InsufficientSpend();

        uint256 j = i == 0 ? 1 : 0;
        uint256 c1 = costUp(q) + spendWad;
        if (c1 > MAX_Q) revert QOverflow();

        // c1 > C(q) ≥ q[j], so the subtraction below never underflows.
        uint256 inner = c1 * c1 - q[j] * q[j];
        uint256 newQi = Math.sqrt(inner, Math.Rounding.Floor);
        if (newQi <= q[i]) revert InsufficientSpend();
        return newQi - q[i];
    }
```

- [ ] **Step 4: Run them and confirm they pass**

```bash
cd contracts && forge test --match-contract DPMMathTest -vv
```
Expected: PASS — 22 lulus.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/math/DPMMath.sol contracts/test/unit/DPMMath.t.sol
git commit -m "feat(math): closed-form sharesForSpend for binary markets"
```

---

## Task 9: The DPM mirror in TypeScript + the differential test

**Files:**
- Create: `packages/protocol/src/dpm.ts`, `packages/protocol/scripts/gen-vectors.ts`
- Create: `contracts/test/differential/DPMDifferential.t.sol`, `contracts/test/vectors/dpm.json` (generated, committed)
- Test: `packages/protocol/test/dpm.test.ts`
- Modify: `packages/protocol/src/index.ts`

**Interfaces:**
- Consumes: `DPMMath` (Task 6–8), `WAD` (Task 2)
- Produces:
  - TS: `MAX_Q`, `isqrt(n)`, `isqrtCeil(n)`, `cost(q)`, `costUp(q)`, `price(q,i)`, `probability(q,i)`, `sharesForSpend(q,i,spendWad)`, `type Q = readonly [bigint, bigint]`
  - `contracts/test/vectors/dpm.json` berkolom `q0,q1,cost,costUp,price0,prob0` sebagai larik string heksadesimal

**Why both directions.** The vitest tests pin the TS mirror to hand-computed golden values, so the mirror itself cannot be quietly wrong. The Foundry test then pins Solidity to the mirror. Without the first layer, both sides could be wrong together and still "match".

- [ ] **Step 1: Write the failing tests for cermin TS**

Buat `packages/protocol/test/dpm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { WAD } from '../src/units.js';
import { cost, costUp, isqrt, isqrtCeil, price, probability, sharesForSpend, MAX_Q } from '../src/dpm.js';

const E18 = WAD;

describe('isqrt', () => {
  it('computes the floor and ceil root', () => {
    expect(isqrt(0n)).toBe(0n);
    expect(isqrt(1n)).toBe(1n);
    expect(isqrt(2n)).toBe(1n);
    expect(isqrtCeil(2n)).toBe(2n);
    expect(isqrt(4n)).toBe(2n);
    expect(isqrtCeil(4n)).toBe(2n);
    expect(isqrt(10n ** 66n)).toBe(10n ** 33n);
  });
});

describe('DPM mirror — golden values computed by hand', () => {
  it('the 3-4-5 triangle is exact, and ceil adds nothing', () => {
    expect(cost([3n * E18, 4n * E18])).toBe(5n * E18);
    expect(costUp([3n * E18, 4n * E18])).toBe(5n * E18);
  });

  it('market seimbang berbiaya q√2', () => {
    expect(cost([E18, E18])).toBe(1_414_213_562_373_095_048n);
    expect(costUp([E18, E18])).toBe(1_414_213_562_373_095_049n);
  });

  it('marginal prices on 3-4-5 are 0.6 and 0.8', () => {
    expect(price([3n * E18, 4n * E18], 0)).toBe(600_000_000_000_000_000n);
    expect(price([3n * E18, 4n * E18], 1)).toBe(800_000_000_000_000_000n);
  });

  it('probability is the square of price, and the two sum to one', () => {
    const q: readonly [bigint, bigint] = [3n * E18, 4n * E18];
    expect(probability(q, 0)).toBe(360_000_000_000_000_000n);
    expect(probability(q, 1)).toBe(640_000_000_000_000_000n);
    expect(probability(q, 0) + probability(q, 1)).toBe(WAD);
  });

  it('does not overflow at MAX_Q', () => {
    expect(probability([MAX_Q, MAX_Q], 0)).toBe(WAD / 2n);
  });

  it('sharesForSpend uses the closed form', () => {
    expect(sharesForSpend([0n, 3n * E18], 0, 2n * E18)).toBe(4n * E18);
    expect(sharesForSpend([5n * E18, 12n * E18], 0, 2n * E18)).toBe(4n * E18);
  });

  it('rejects q above MAX_Q', () => {
    expect(() => cost([MAX_Q + 1n, 0n])).toThrow(/MAX_Q/);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd packages/protocol && npx vitest run test/dpm.test.ts
```
Expected: FAIL — modul `../src/dpm.js` is not found.

- [ ] **Step 3: Implement `packages/protocol/src/dpm.ts`**

```ts
import { WAD } from './units.js';

/** Exact mirror of contracts/src/math/DPMMath.sol. Any change on one side
 *  must be followed on the other — the differential test in contracts/test/differential enforces it. */
export const MAX_Q = 10n ** 33n;

export type Q = readonly [bigint, bigint];
export type Outcome = 0 | 1;

/** Integer square root (floor). The initial guess 2^ceil(bits/2) is always ≥ √n,
 *  so the Newton iteration decreases monotonically and stops exactly. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError('isqrt: negative value');
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

export function isqrtCeil(n: bigint): bigint {
  const r = isqrt(n);
  return r * r === n ? r : r + 1n;
}

function sumSq(q: Q): bigint {
  if (q[0] > MAX_Q || q[1] > MAX_Q) {
    throw new RangeError(`q melampaui MAX_Q (${MAX_Q}): [${q[0]}, ${q[1]}]`);
  }
  return q[0] * q[0] + q[1] * q[1];
}

export function cost(q: Q): bigint {
  return isqrt(sumSq(q));
}

export function costUp(q: Q): bigint {
  return isqrtCeil(sumSq(q));
}

export function price(q: Q, i: Outcome): bigint {
  const c = cost(q);
  return c === 0n ? 0n : (q[i] * WAD) / c;
}

export function probability(q: Q, i: Outcome): bigint {
  const s = sumSq(q);
  return s === 0n ? 0n : (q[i] * q[i] * WAD) / s;
}

export function sharesForSpend(q: Q, i: Outcome, spendWad: bigint): bigint {
  if (spendWad <= 0n) throw new RangeError('sharesForSpend: spend must be > 0');
  const j: Outcome = i === 0 ? 1 : 0;
  const c1 = costUp(q) + spendWad;
  if (c1 > MAX_Q) throw new RangeError(`C1 melampaui MAX_Q: ${c1}`);
  const inner = c1 * c1 - q[j] * q[j];
  const newQi = isqrt(inner);
  if (newQi <= q[i]) throw new RangeError('sharesForSpend: spend too small for even one share');
  return newQi - q[i];
}
```

Add to `packages/protocol/src/index.ts`:

```ts
export * as dpm from './dpm.js';
```

- [ ] **Step 4: Run them and confirm they pass**

```bash
cd packages/protocol && npx vitest run test/dpm.test.ts
```
Expected: PASS — 7 lulus.

- [ ] **Step 5: Write the vector generator `packages/protocol/scripts/gen-vectors.ts`**

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cost, costUp, price, probability, MAX_Q, type Q } from '../src/dpm.js';

const OUT = join(process.cwd(), '../../contracts/test/vectors/dpm.json');
const COUNT = 512;

/** Deterministic xorshift64 — the vectors must be identical on every machine and every
 *  run, so that `gen:vectors` re-run in CI does not produce a diff. */
function makeRng(seed: bigint): () => bigint {
  const MASK = (1n << 64n) - 1n;
  let s = seed;
  return () => {
    s = (s ^ (s << 13n)) & MASK;
    s = s ^ (s >> 7n);
    s = (s ^ (s << 17n)) & MASK;
    return s;
  };
}

/** Spread across magnitudes: zero, dust, wad scale, large, and exactly at MAX_Q. */
function sample(rng: () => bigint, bucket: number): bigint {
  switch (bucket % 6) {
    case 0: return 0n;
    case 1: return rng() % 1_000_000n;
    case 2: return rng() % (10n ** 18n);
    case 3: return rng() % (10n ** 24n);
    case 4: return rng() % (10n ** 33n);
    default: return MAX_Q;
  }
}

const rng = makeRng(0x0de1_9105_eed0_1234n);
const q0: string[] = [];
const q1: string[] = [];
const cst: string[] = [];
const cstUp: string[] = [];
const price0: string[] = [];
const prob0: string[] = [];

const hex = (v: bigint) => `0x${v.toString(16)}`;

for (let k = 0; k < COUNT; k++) {
  const a = sample(rng, k);
  const b = sample(rng, k + 3);
  const q: Q = [a, b];
  q0.push(hex(a));
  q1.push(hex(b));
  cst.push(hex(cost(q)));
  cstUp.push(hex(costUp(q)));
  price0.push(hex(price(q, 0)));
  prob0.push(hex(probability(q, 0)));
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ q0, q1, cost: cst, costUp: cstUp, price0, prob0 }, null, 2)}\n`);
console.log(`wrote ${COUNT} vectors to ${OUT}`);
```

- [ ] **Step 6: Hasilkan vektor**

```bash
cd packages/protocol && npx tsx scripts/gen-vectors.ts
head -c 300 ../../contracts/test/vectors/dpm.json
```
Expected: a JSON file with six arrays of 512 hexadecimal strings.

- [ ] **Step 7: Write the tests diferensial Foundry**

Buat `contracts/test/differential/DPMDifferential.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DPMMath} from "../../src/math/DPMMath.sol";

/// @notice Pins DPMMath to the TypeScript mirror. That mirror is itself pinned to the
///         hand-computed golden values in packages/protocol/test/dpm.test.ts, so the two
///         sides cannot be wrong together.
contract DPMDifferentialTest is Test {
    function test_solidityMatchesTypeScriptMirror() public view {
        string memory json = vm.readFile("test/vectors/dpm.json");

        uint256[] memory q0 = vm.parseJsonUintArray(json, ".q0");
        uint256[] memory q1 = vm.parseJsonUintArray(json, ".q1");
        uint256[] memory expCost = vm.parseJsonUintArray(json, ".cost");
        uint256[] memory expCostUp = vm.parseJsonUintArray(json, ".costUp");
        uint256[] memory expPrice0 = vm.parseJsonUintArray(json, ".price0");
        uint256[] memory expProb0 = vm.parseJsonUintArray(json, ".prob0");

        assertGt(q0.length, 256, "vektor terlalu sedikit; jalankan npm run gen:vectors");
        assertEq(q1.length, q0.length);

        for (uint256 k = 0; k < q0.length; k++) {
            uint256[2] memory q;
            q[0] = q0[k];
            q[1] = q1[k];

            assertEq(DPMMath.cost(q), expCost[k], string.concat("cost mismatch at case ", vm.toString(k)));
            assertEq(DPMMath.costUp(q), expCostUp[k], string.concat("costUp mismatch at case ", vm.toString(k)));
            assertEq(DPMMath.price(q, 0), expPrice0[k], string.concat("price mismatch at case ", vm.toString(k)));
            assertEq(
                DPMMath.probability(q, 0), expProb0[k], string.concat("probability mismatch at case ", vm.toString(k))
            );
        }
    }
}
```

- [ ] **Step 8: Run them and confirm they pass**

```bash
cd contracts && forge test --match-contract DPMDifferentialTest -vv
```
Expected: PASS — 1 lulus, 512 kasus terverifikasi.

- [ ] **Step 9: Commit**

```bash
git add packages/protocol/src/dpm.ts packages/protocol/src/index.ts packages/protocol/scripts/gen-vectors.ts \
        packages/protocol/test/dpm.test.ts contracts/test/differential contracts/test/vectors
git commit -m "test: the DPM mirror in TypeScript and a 512-vector differential test"
```

---

## Task 10: `OutcomeShares` — ERC-1155 with arithmetic authorization

**Files:**
- Create: `contracts/src/interfaces/IMarketRegistry.sol`, `contracts/src/core/OutcomeShares.sol`
- Test: `contracts/test/unit/OutcomeShares.t.sol`

**Interfaces:**
- Consumes: —
- Produces:
  - `IMarketRegistry` — `isMarket(address) external view returns (bool)`
  - `OutcomeShares` — `setRegistry(address)`, `idFor(address market, uint8 outcome) → uint256`, `marketOf(uint256 id) → address`, `mint(address to, uint8 outcome, uint256 amount)`, `burn(address from, uint8 outcome, uint256 amount)`, `balanceOfOutcome(address account, address market, uint8 outcome) → uint256`
  - Error: `NotMarket()`, `RegistryAlreadySet()`, `NotDeployer()`, `BadOutcome()`

**The core idea.** `id = uint160(market) << 8 | outcome`, and `mint`/`burn` derive the id from `msg.sender`. A market can therefore **arithmetically** only touch its own ids — there is no per-market permission list to misconfigure. The registry only filters so that an arbitrary address cannot mint junk tokens that confuse the indexer.

- [ ] **Step 1: Write the failing tests**

Buat `contracts/test/unit/OutcomeShares.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {OutcomeShares} from "../../src/core/OutcomeShares.sol";
import {IMarketRegistry} from "../../src/interfaces/IMarketRegistry.sol";

contract StubRegistry is IMarketRegistry {
    mapping(address => bool) public markets;

    function set(address m, bool v) external {
        markets[m] = v;
    }

    function isMarket(address m) external view returns (bool) {
        return markets[m];
    }
}

/// @dev Pretends to be a Market: calls mint/burn under its own name.
contract FakeMarket {
    OutcomeShares public immutable shares;

    constructor(OutcomeShares s) {
        shares = s;
    }

    function mint(address to, uint8 outcome, uint256 amount) external {
        shares.mint(to, outcome, amount);
    }

    function burn(address from, uint8 outcome, uint256 amount) external {
        shares.burn(from, outcome, amount);
    }
}

contract OutcomeSharesTest is Test {
    OutcomeShares internal shares;
    StubRegistry internal registry;
    FakeMarket internal marketA;
    FakeMarket internal marketB;
    address internal alice = makeAddr("alice");

    function setUp() public {
        shares = new OutcomeShares("https://brier.0g/{id}.json");
        registry = new StubRegistry();
        shares.setRegistry(address(registry));
        marketA = new FakeMarket(shares);
        marketB = new FakeMarket(shares);
        registry.set(address(marketA), true);
        registry.set(address(marketB), true);
    }

    function test_idEncodesMarketAndOutcome() public view {
        uint256 id = shares.idFor(address(marketA), 1);
        assertEq(shares.marketOf(id), address(marketA));
        assertEq(id & 0xff, 1);
    }

    function test_marketMintsAndBurnsItsOwnIds() public {
        marketA.mint(alice, 1, 100e18);
        assertEq(shares.balanceOfOutcome(alice, address(marketA), 1), 100e18);
        marketA.burn(alice, 1, 40e18);
        assertEq(shares.balanceOfOutcome(alice, address(marketA), 1), 60e18);
    }

    /// @dev The key property: market A's and market B's ids never collide, and market B has
    ///      no way to touch market A's balances.
    function test_marketsCannotTouchEachOthersIds() public {
        marketA.mint(alice, 1, 100e18);
        assertEq(shares.balanceOfOutcome(alice, address(marketB), 1), 0);

        vm.expectRevert();
        marketB.burn(alice, 1, 1e18); // burns ITS OWN id, whose balance is zero
    }

    function test_nonMarketCannotMint() public {
        vm.prank(alice);
        vm.expectRevert(OutcomeShares.NotMarket.selector);
        shares.mint(alice, 0, 1e18);
    }

    function test_outcomeAboveOneReverts() public {
        vm.expectRevert(OutcomeShares.BadOutcome.selector);
        shares.idFor(address(marketA), 2);
    }

    function test_registryCanOnlyBeSetOnce() public {
        vm.expectRevert(OutcomeShares.RegistryAlreadySet.selector);
        shares.setRegistry(address(0xBEEF));
    }

    function test_onlyDeployerCanSetRegistry() public {
        OutcomeShares fresh = new OutcomeShares("");
        vm.prank(alice);
        vm.expectRevert(OutcomeShares.NotDeployer.selector);
        fresh.setRegistry(address(registry));
    }

    function test_holdersCanTransferPositions() public {
        address bob = makeAddr("bob");
        marketA.mint(alice, 0, 10e18);
        vm.prank(alice);
        shares.safeTransferFrom(alice, bob, shares.idFor(address(marketA), 0), 4e18, "");
        assertEq(shares.balanceOfOutcome(bob, address(marketA), 0), 4e18);
        assertEq(shares.balanceOfOutcome(alice, address(marketA), 0), 6e18);
    }
}
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd contracts && forge test --match-contract OutcomeSharesTest
```
Expected: FAIL — `src/core/OutcomeShares.sol` is not found.

- [ ] **Step 3: Implement `contracts/src/interfaces/IMarketRegistry.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The part of MarketFactory that OutcomeShares needs to know about.
///         This narrow interface breaks the circular dependency between the two.
interface IMarketRegistry {
    function isMarket(address candidate) external view returns (bool);
}
```

- [ ] **Step 4: Implement `contracts/src/core/OutcomeShares.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";

/// @title OutcomeShares
/// @notice Tradable outcome positions for every Brier market.
/// @dev Authorization here is arithmetic, not administrative: `id` is derived from
///      the market address, and mint/burn derive it from `msg.sender`. A market
///      therefore has no way to name another market's id — there is no per-market
///      permission list that could be misconfigured.
///
///      Seed shares do NOT live here. Seed shares are non-transferable and are
///      recorded inside each Market (see spec §6.3).
contract OutcomeShares is ERC1155 {
    address public immutable deployer;
    IMarketRegistry public registry;

    error NotMarket();
    error RegistryAlreadySet();
    error NotDeployer();
    error BadOutcome();

    event RegistrySet(address indexed registry);

    constructor(string memory uri_) ERC1155(uri_) {
        deployer = msg.sender;
    }

    /// @dev Set once after MarketFactory is deployed, and immutable thereafter.
    function setRegistry(address registry_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (address(registry) != address(0)) revert RegistryAlreadySet();
        registry = IMarketRegistry(registry_);
        emit RegistrySet(registry_);
    }

    function idFor(address market, uint8 outcome) public pure returns (uint256) {
        if (outcome > 1) revert BadOutcome();
        return (uint256(uint160(market)) << 8) | uint256(outcome);
    }

    function marketOf(uint256 id) public pure returns (address) {
        return address(uint160(id >> 8));
    }

    function balanceOfOutcome(address account, address market, uint8 outcome) external view returns (uint256) {
        return balanceOf(account, idFor(market, outcome));
    }

    function mint(address to, uint8 outcome, uint256 amount) external onlyMarket {
        _mint(to, idFor(msg.sender, outcome), amount, "");
    }

    function burn(address from, uint8 outcome, uint256 amount) external onlyMarket {
        _burn(from, idFor(msg.sender, outcome), amount);
    }

    modifier onlyMarket() {
        if (address(registry) == address(0) || !registry.isMarket(msg.sender)) revert NotMarket();
        _;
    }
}
```

- [ ] **Step 5: Run them and confirm they pass**

```bash
cd contracts && forge test --match-contract OutcomeSharesTest -vv
```
Expected: PASS — 8 lulus.

- [ ] **Step 6: Commit**

```bash
git add contracts/src/interfaces/IMarketRegistry.sol contracts/src/core/OutcomeShares.sol contracts/test/unit/OutcomeShares.t.sol
git commit -m "feat(contracts): OutcomeShares ERC-1155 with address-derived authorization"
```

---

## Task 11: `DPMMath.seedShares` + antarmuka `IMarket` + `Market` (storage & initialize)

**Files:**
- Modify: `contracts/src/math/DPMMath.sol`, `contracts/test/unit/DPMMath.t.sol`
- Modify: `packages/protocol/src/dpm.ts`, `packages/protocol/test/dpm.test.ts`
- Create: `contracts/src/interfaces/IMarket.sol`, `contracts/src/core/Market.sol`
- Create: `contracts/test/helpers/Fixtures.sol`
- Test: `contracts/test/unit/MarketInit.t.sol`

**Interfaces:**
- Consumes: `DPMMath` (Task 6–8), `ConfigRegistry`/`ConfigKeys` (Task 4), `OutcomeShares` (Task 10), `MockUSDC` (Task 3)
- Produces:
  - `DPMMath.seedShares(uint256 seedWad) internal pure returns (uint256)`
  - `IMarket` — `enum Status { Open, Closed, Proposed, Disputed, Settled, Failed, Voided }`, `struct Params { address collateral; address creator; uint256 creatorAgentId; uint64 tradingEnd; uint64 settlementDeadline; uint8 tier; bytes32 specRoot; bytes32 category; }`, event `Trade`, `LiquidityChanged`, `StatusChanged`, `Settled`, `Redeemed`, `Liquidated`, `FeesDistributed`, `MarketVoided`
  - `Market.initialize(address config_, address shares_, Params calldata p, uint256 seedTokens, uint256 depositTokens)`
  - View: `qArray()`, `seedSupply()`, `creatorSeed()`, `seedSharesOf(address)`, `poolWad()`, `feeAccrued()`, `settlementDeposit()`, `scale()`, `feeBps()`, `minTradeTokens()`, `status()`, `probability(uint8)`, `marginalPrice(uint8)`, `collateralOwed()`
  - `Fixtures` — `_deployBase()`, `_newMarket(uint256 seedTokens) returns (Market)`, `_fund(address who, uint256 amount, address spender)`

- [ ] **Step 1: Write the failing tests for `seedShares`**

Add to `contracts/test/unit/DPMMath.t.sol`:

```solidity
    function test_seedSharesOfZeroIsZero() public pure {
        assertEq(DPMMath.seedShares(0), 0);
    }

    /// @dev The property that must be guaranteed: the pool cost of the seed shares NEVER exceeds
    ///      the collateral deposited. Deriving q₀ by dividing by a ⌊√2·1e18⌋ constant would
    ///      BREAK this — a divisor rounded down yields a quotient that is too large. Hence the
    ///      formula goes through squares instead.
    function testFuzz_seedNeverCostsMoreThanDeposited(uint96 seed) public pure {
        uint256 seedWad = uint256(seed);
        uint256 s = DPMMath.seedShares(seedWad);
        assertLe(DPMMath.costUp(_q(s, s)), seedWad);
    }

    /// @dev ...and still maximal: one more share on each side already exceeds the deposit.
    function testFuzz_seedIsMaximal(uint96 seed) public pure {
        vm.assume(seed > 0);
        uint256 seedWad = uint256(seed);
        uint256 s = DPMMath.seedShares(seedWad);
        assertGt(DPMMath.costUp(_q(s + 1, s + 1)), seedWad);
    }

    function test_seedIsBalancedSoMarketStartsAtFiftyPercent() public pure {
        uint256 s = DPMMath.seedShares(1000e18);
        assertEq(DPMMath.probability(_q(s, s), 0), 5e17);
    }
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd contracts && forge test --match-contract DPMMathTest
```
Expected: FAIL — `seedShares` does not exist yet.

- [ ] **Step 3: Add `seedShares` to `DPMMath.sol`**

```solidity
    /// @notice The largest symmetric share count (q₀ = q₁) whose cost does not exceed `seedWad`.
    /// @dev q₀ = ⌊√(⌊seedWad²/2⌋)⌋. From that, 2q₀² ≤ seedWad², which is equivalent to
    ///      costUp([q₀,q₀]) ≤ seedWad because ⌈√x⌉ ≤ S ⟺ x ≤ S².
    ///
    ///      Do not be tempted to write q₀ = seedWad·WAD/SQRT2_WAD: a √2 constant
    ///      rounded down makes the quotient slightly TOO LARGE, so the pool required
    ///      exceeds the collateral that was actually deposited.
    function seedShares(uint256 seedWad) internal pure returns (uint256) {
        if (seedWad > MAX_Q) revert QOverflow();
        return Math.sqrt((seedWad * seedWad) / 2, Math.Rounding.Floor);
    }
```

- [ ] **Step 4: Mirror it in TypeScript and extend the vectors**

Add to `packages/protocol/src/dpm.ts`:

```ts
export function seedShares(seedWad: bigint): bigint {
  if (seedWad > MAX_Q) throw new RangeError(`seedWad melampaui MAX_Q: ${seedWad}`);
  return isqrt((seedWad * seedWad) / 2n);
}
```

Add to `packages/protocol/test/dpm.test.ts`:

```ts
import { seedShares } from '../src/dpm.js';

describe('seedShares', () => {
  it('never costs more than was deposited, and is maximal', () => {
    for (const w of [1n, 1000n, E18, 1000n * E18, 10n ** 30n]) {
      const s = seedShares(w);
      expect(costUp([s, s])).toBeLessThanOrEqual(w);
      expect(costUp([s + 1n, s + 1n])).toBeGreaterThan(w);
    }
  });

  it('a market starts at exactly 50%', () => {
    const s = seedShares(1000n * E18);
    expect(probability([s, s], 0)).toBe(E18 / 2n);
  });
});
```

In `packages/protocol/scripts/gen-vectors.ts`, add the `seed` column:

```ts
import { seedShares } from '../src/dpm.js';
// ...inside the loop, after prob0.push(...):
seed.push(hex(seedShares(a)));
// ...and declare `const seed: string[] = [];` alongside the other arrays,
//    then include `seed` in the JSON object being written.
```

In `contracts/test/differential/DPMDifferential.t.sol`, add inside the loop:

```solidity
        uint256[] memory expSeed = vm.parseJsonUintArray(json, ".seed"); // outside the loop, with the other arrays
        // inside the loop:
        assertEq(DPMMath.seedShares(q0[k]), expSeed[k], string.concat("seedShares mismatch at case ", vm.toString(k)));
```

- [ ] **Step 5: Re-run the whole maths suite**

```bash
cd packages/protocol && npx vitest run && npx tsx scripts/gen-vectors.ts
cd ../../contracts && forge test --match-contract 'DPMMathTest|DPMDifferentialTest' -vv
```
Expected: PASS — everything green, and the vectors now have seven columns.

- [ ] **Step 6: Implement `contracts/src/interfaces/IMarket.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IMarket {
    /// @dev Closed/Proposed/Disputed are non-trading states: `q` is frozen so the
    ///      payout cannot be shifted while the committee is still deliberating.
    enum Status {
        Open,
        Closed,
        Proposed,
        Disputed,
        Settled,
        Failed,
        Voided
    }

    struct Params {
        address collateral;
        address creator;
        uint256 creatorAgentId;
        uint64 tradingEnd;
        uint64 settlementDeadline;
        uint8 tier; // 0=FAST 1=VERIFIED 2=DETERMINISTIC
        bytes32 specRoot; // 0G Storage Merkle root for the MarketSpec
        bytes32 category;
    }

    /// @dev qAfter and probAfter are included so that an indexer can reconstruct the
    ///      probability curve without a single historical eth_call.
    event Trade(
        address indexed trader,
        address indexed recipient,
        uint8 indexed outcome,
        int256 sharesDelta,
        uint256 tokens,
        uint256 fee,
        uint256[2] qAfter,
        uint256 probAfter
    );

    event LiquidityChanged(address indexed provider, int256 lambdaWad, uint256 tokens, uint256[2] qAfter);
    event StatusChanged(Status indexed from, Status indexed to);
    event Settled(uint8 indexed outcome, uint256 payoutPerShareWad);
    event Redeemed(address indexed account, uint256 shares, uint256 tokensOut);
    event Liquidated(address indexed account, uint256[2] shares, uint256 tokensOut);
    event FeesDistributed(uint256 toCreator, uint256 toResolvers, uint256 toTreasury);
    event MarketVoided(bytes32 reason);
}
```

- [ ] **Step 7: Write the failing tests for inisialisasi market**

Buat `contracts/test/helpers/Fixtures.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ConfigRegistry} from "../../src/core/ConfigRegistry.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";
import {OutcomeShares} from "../../src/core/OutcomeShares.sol";
import {IMarketRegistry} from "../../src/interfaces/IMarketRegistry.sol";
import {IMarket} from "../../src/interfaces/IMarket.sol";
import {Market} from "../../src/core/Market.sol";
import {MockUSDC} from "../../src/mocks/MockUSDC.sol";
import {DeployLib} from "../../script/DeployLib.sol";

contract StubMarketRegistry is IMarketRegistry {
    mapping(address => bool) internal _markets;

    function set(address m, bool v) external {
        _markets[m] = v;
    }

    function isMarket(address m) external view returns (bool) {
        return _markets[m];
    }
}

abstract contract Fixtures is Test {
    ConfigRegistry internal config;
    MockUSDC internal usdc;
    OutcomeShares internal shares;
    StubMarketRegistry internal registry;
    Market internal marketImpl;

    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal treasury = makeAddr("treasury");
    address internal resolutionModule = makeAddr("resolutionModule");
    address internal guardian = makeAddr("guardian");

    uint256 internal constant SEED = 1_000e6;
    uint256 internal constant DEPOSIT = 20e6;
    uint64 internal constant TRADING_WINDOW = 7 days;

    function _deployBase() internal {
        usdc = new MockUSDC();
        shares = new OutcomeShares("");
        registry = new StubMarketRegistry();
        shares.setRegistry(address(registry));

        ConfigRegistry impl = new ConfigRegistry();
        config = ConfigRegistry(
            address(
                new ERC1967Proxy(address(impl), abi.encodeCall(ConfigRegistry.initialize, (address(this), guardian)))
            )
        );
        DeployLib.applyDefaults(config, address(usdc));
        config.setAddress(ConfigKeys.TREASURY, treasury);
        config.setAddress(ConfigKeys.RESOLUTION_MODULE, resolutionModule);
        config.setAddress(ConfigKeys.OUTCOME_SHARES, address(shares));

        marketImpl = new Market();
        vm.warp(1_800_000_000); // a stable timestamp, far away from zero
    }

    function _params() internal view returns (IMarket.Params memory p) {
        p.collateral = address(usdc);
        p.creator = creator;
        p.creatorAgentId = 1;
        p.tradingEnd = uint64(block.timestamp) + TRADING_WINDOW;
        p.settlementDeadline = uint64(block.timestamp) + TRADING_WINDOW + 1 days;
        p.tier = 1;
        p.specRoot = keccak256("spec");
        p.category = bytes32("crypto");
    }

    /// @dev Mirrors exactly what MarketFactory does in Task 17:
    ///      clone → transfer collateral MASUK → initialize.
    function _newMarket(uint256 seedTokens) internal returns (Market m) {
        m = Market(Clones.clone(address(marketImpl)));
        registry.set(address(m), true);
        usdc.mintTo(address(this), seedTokens + DEPOSIT);
        usdc.transfer(address(m), seedTokens + DEPOSIT);
        m.initialize(address(config), address(shares), _params(), seedTokens, DEPOSIT);
    }

    function _fund(address who, uint256 amount, address spender) internal {
        usdc.mintTo(who, amount);
        vm.prank(who);
        usdc.approve(spender, type(uint256).max);
    }
}
```

Buat `contracts/test/unit/MarketInit.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "../helpers/Fixtures.sol";
import {Market} from "../../src/core/Market.sol";
import {IMarket} from "../../src/interfaces/IMarket.sol";
import {DPMMath} from "../../src/math/DPMMath.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

contract MarketInitTest is Fixtures {
    function setUp() public {
        _deployBase();
    }

    function test_marketOpensAtFiftyPercent() public {
        Market m = _newMarket(SEED);
        assertEq(uint8(m.status()), uint8(IMarket.Status.Open));
        assertEq(m.probability(0), 5e17);
        assertEq(m.probability(1), 5e17);
    }

    function test_creatorHoldsSeedOnBothSides() public {
        Market m = _newMarket(SEED);
        uint256[2] memory q = m.qArray();
        uint256[2] memory held = m.seedSharesOf(creator);
        assertEq(q[0], q[1]);
        assertEq(held[0], q[0]);
        assertEq(held[1], q[1]);
        assertEq(m.creatorSeed()[0], q[0]);
    }

    /// @dev The system's central invariant, checked from second zero.
    function test_poolEqualsCostUpAtInit() public {
        Market m = _newMarket(SEED);
        assertEq(m.poolWad(), DPMMath.costUp(m.qArray()));
    }

    /// @dev The pool must never claim more collateral than actually exists.
    function test_collateralCoversPoolAndDeposit() public {
        Market m = _newMarket(SEED);
        assertGe(usdc.balanceOf(address(m)), m.collateralOwed());
        assertLe(Math.ceilDiv(m.poolWad(), m.scale()), SEED);
    }

    function test_scaleMatchesSixDecimalCollateral() public {
        Market m = _newMarket(SEED);
        assertEq(m.scale(), 1e12);
    }

    /// @dev A live market is IMMUNE to parameter changes. The fee and the minimum trade size
    ///      are snapshotted at initialization, not read on every trade.
    function test_liveMarketIsImmuneToLaterConfigChanges() public {
        Market m = _newMarket(SEED);
        assertEq(m.feeBps(), 100);
        config.setParam(ConfigKeys.FEE_BPS, 300);
        assertEq(m.feeBps(), 100);
    }

    function test_seedBelowMinimumReverts() public {
        vm.expectRevert(Market.SeedTooSmall.selector);
        _newMarket(1e6); // MIN_SEED is 100e6
    }

    function test_disallowedCollateralReverts() public {
        config.setCollateralAllowed(address(usdc), false);
        vm.expectRevert(Market.CollateralNotAllowed.selector);
        _newMarket(SEED);
    }

    function test_deadlinesMustBeOrdered() public {
        Market m = Market(Clones.clone(address(marketImpl)));
        registry.set(address(m), true);
        IMarket.Params memory p = _params();
        p.settlementDeadline = p.tradingEnd - 1;
        usdc.mintTo(address(this), SEED + DEPOSIT);
        usdc.transfer(address(m), SEED + DEPOSIT);
        vm.expectRevert(Market.BadDeadlines.selector);
        m.initialize(address(config), address(shares), p, SEED, DEPOSIT);
    }

    function test_cannotInitializeTwice() public {
        Market m = _newMarket(SEED);
        vm.expectRevert();
        m.initialize(address(config), address(shares), _params(), SEED, DEPOSIT);
    }

    function test_implementationCannotBeInitialized() public {
        vm.expectRevert();
        marketImpl.initialize(address(config), address(shares), _params(), SEED, DEPOSIT);
    }
}
```

- [ ] **Step 8: Run them and confirm they fail**

```bash
cd contracts && forge test --match-contract MarketInitTest
```
Expected: FAIL — `src/core/Market.sol` is not found.

- [ ] **Step 9: Implement `contracts/src/core/Market.sol` (storage + initialize + view)**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {DPMMath} from "../math/DPMMath.sol";
import {ConfigRegistry} from "./ConfigRegistry.sol";
import {ConfigKeys} from "./ConfigKeys.sol";
import {OutcomeShares} from "./OutcomeShares.sol";
import {IMarket} from "../interfaces/IMarket.sol";

/// @title Market
/// @notice Satu market prediksi biner bermesin DPM. Clone EIP-1167, IMMUTABLE:
///         this contract holds user funds and is therefore never upgradeable.
/// @dev The central invariant: `poolWad == DPMMath.costUp(_q)` at every transaction boundary.
///      Enforced by construction — the pool is SET to a target, never accumulated:
///
///        target      = costUp(qBaru)
///        buy cost   = target - poolWad
///        sell take  = poolWad - target
///        poolWad     = target
///
///      Every speck of rounding dust is therefore left INSIDE the pool.
contract Market is IMarket, Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── configuration, snapshotted at initialize ─────────────────────────────
    ConfigRegistry public config;
    OutcomeShares public shares;
    IERC20 public collateral;
    uint256 public scale; // 10 ** (18 - desimal collateral)
    address public creator;
    uint256 public creatorAgentId;
    uint64 public tradingEnd;
    uint64 public settlementDeadline;
    uint8 public tier;
    bytes32 public specRoot;
    bytes32 public category;

    /// @dev Snapshotted, not re-read: a market that is already live must not have its rules
    ///      change mid-flight just because governance reset a parameter.
    uint16 public feeBps;
    uint256 public minTradeTokens;

    // ── state ────────────────────────────────────────────────────────────────
    uint256[2] internal _q;
    uint256[2] internal _seedSupply;
    uint256[2] internal _creatorSeed;
    mapping(address => uint256[2]) internal _seedShares;

    uint256 public poolWad;
    uint256 public feeAccrued; // satuan token
    uint256 public settlementDeposit; // satuan token

    Status public status;
    uint8 public winningOutcome;
    uint64 public resolvedAt;
    uint256 public payoutPerShareWad;
    uint256[2] internal _liqPerShareWad;

    error CollateralNotAllowed();
    error UnsupportedDecimals();
    error SeedTooSmall();
    error DepositTooSmall();
    error BadDeadlines();
    error CollateralNotReceived();
    error BadOutcome();
    error ZeroAmount();
    error NotOpen();
    error TradingEnded();
    error ProtocolPaused();
    error TradeTooSmall();
    error SlippageExceeded(uint256 actual, uint256 limit);
    error SeedFloorBreached();

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address config_,
        address shares_,
        Params calldata p,
        uint256 seedTokens,
        uint256 depositTokens
    ) external initializer {
        config = ConfigRegistry(config_);
        shares = OutcomeShares(shares_);

        if (!config.allowedCollateral(p.collateral)) revert CollateralNotAllowed();
        if (p.tradingEnd <= block.timestamp || p.settlementDeadline <= p.tradingEnd) revert BadDeadlines();
        if (seedTokens < config.params(ConfigKeys.MIN_SEED)) revert SeedTooSmall();
        if (depositTokens < config.params(ConfigKeys.MIN_SETTLEMENT_DEPOSIT)) revert DepositTooSmall();

        uint8 dec = IERC20Metadata(p.collateral).decimals();
        if (dec > 18) revert UnsupportedDecimals();

        collateral = IERC20(p.collateral);
        scale = 10 ** (18 - dec);
        creator = p.creator;
        creatorAgentId = p.creatorAgentId;
        tradingEnd = p.tradingEnd;
        settlementDeadline = p.settlementDeadline;
        tier = p.tier;
        specRoot = p.specRoot;
        category = p.category;

        feeBps = uint16(config.params(ConfigKeys.FEE_BPS));
        minTradeTokens = config.params(ConfigKeys.MIN_TRADE_TOKENS);
        settlementDeposit = depositTokens;

        // Factory mentransfer collateral MASUK sebelum memanggil initialize.
        if (collateral.balanceOf(address(this)) < seedTokens + depositTokens) revert CollateralNotReceived();

        uint256 seedWad = seedTokens * scale;
        uint256 s = DPMMath.seedShares(seedWad);
        if (s == 0) revert SeedTooSmall();

        _q[0] = s;
        _q[1] = s;
        _seedSupply[0] = s;
        _seedSupply[1] = s;
        _creatorSeed[0] = s;
        _creatorSeed[1] = s;
        _seedShares[p.creator][0] = s;
        _seedShares[p.creator][1] = s;

        poolWad = DPMMath.costUp(_q); // ≤ seedWad menurut konstruksi seedShares
        status = Status.Open;

        emit StatusChanged(Status.Open, Status.Open);
        emit LiquidityChanged(p.creator, int256(DPMMath.WAD), seedTokens, _q);
    }

    // ── view ─────────────────────────────────────────────────────────────────

    function qArray() external view returns (uint256[2] memory) {
        return _q;
    }

    function seedSupply() external view returns (uint256[2] memory) {
        return _seedSupply;
    }

    function creatorSeed() external view returns (uint256[2] memory) {
        return _creatorSeed;
    }

    function seedSharesOf(address account) external view returns (uint256[2] memory) {
        return _seedShares[account];
    }

    function liqPerShare() external view returns (uint256[2] memory) {
        return _liqPerShareWad;
    }

    function probability(uint8 outcome) external view returns (uint256) {
        return DPMMath.probability(_q, outcome);
    }

    function marginalPrice(uint8 outcome) external view returns (uint256) {
        return DPMMath.price(_q, outcome);
    }

    /// @notice The minimum collateral this contract must hold to stay solvent.
    function collateralOwed() public view returns (uint256) {
        return Math.ceilDiv(poolWad, scale) + feeAccrued + settlementDeposit;
    }

    // ── penjaga bersama ──────────────────────────────────────────────────────

    /// @dev Jalur MASUK: dihentikan oleh pause global.
    function _requireTradable() internal view {
        if (status != Status.Open) revert NotOpen();
        if (block.timestamp >= tradingEnd) revert TradingEnded();
        if (config.paused()) revert ProtocolPaused();
    }

    /// @dev EXIT path: deliberately does NOT check the pause. A user must always be able to exit.
    function _requireExitable() internal view {
        if (status != Status.Open) revert NotOpen();
        if (block.timestamp >= tradingEnd) revert TradingEnded();
    }
}
```

- [ ] **Step 10: Run them and confirm they pass**

```bash
cd contracts && forge test --match-contract MarketInitTest -vv
```
Expected: PASS — 11 lulus.

- [ ] **Step 11: Commit**

```bash
git add contracts/src/math/DPMMath.sol contracts/src/interfaces/IMarket.sol contracts/src/core/Market.sol \
        contracts/test/helpers/Fixtures.sol contracts/test/unit/MarketInit.t.sol contracts/test/unit/DPMMath.t.sol \
        contracts/test/differential contracts/test/vectors packages/protocol
git commit -m "feat(contracts): Market storage and initialization with solvency-safe seeding"
```

---

## Task 12: `Market.buy`

**Files:**
- Modify: `contracts/src/core/Market.sol`
- Test: `contracts/test/unit/MarketBuy.t.sol`

**Interfaces:**
- Consumes: `Market` (Task 11), `DPMMath` (Task 6–8), `OutcomeShares` (Task 10)
- Produces:
  - `quoteBuy(uint8 outcome, uint256 sharesOut) external view returns (uint256 tokensIn, uint256 fee)`
  - `quoteBuySpend(uint8 outcome, uint256 tokensIn) external view returns (uint256 sharesOut, uint256 fee)`
  - `buy(uint8 outcome, uint256 sharesOut, uint256 maxTokensIn, address to) external returns (uint256 tokensIn)`

- [ ] **Step 1: Write the failing tests**

Buat `contracts/test/unit/MarketBuy.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "../helpers/Fixtures.sol";
import {Market} from "../../src/core/Market.sol";
import {DPMMath} from "../../src/math/DPMMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract MarketBuyTest is Fixtures {
    Market internal m;

    function setUp() public {
        _deployBase();
        m = _newMarket(SEED);
        _fund(alice, 1_000_000e6, address(m));
        _fund(bob, 1_000_000e6, address(m));
    }

    function test_buyMovesProbabilityTowardBoughtSide() public {
        uint256 before = m.probability(1);
        vm.prank(alice);
        m.buy(1, 100e18, type(uint256).max, alice);
        assertGt(m.probability(1), before);
        assertEq(m.probability(0) + m.probability(1), 1e18);
    }

    function test_buyMintsSharesAndChargesQuote() public {
        (uint256 quoted, uint256 fee) = m.quoteBuy(1, 100e18);
        uint256 balBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        uint256 paid = m.buy(1, 100e18, type(uint256).max, alice);

        assertEq(paid, quoted);
        assertEq(balBefore - usdc.balanceOf(alice), quoted);
        assertEq(shares.balanceOfOutcome(alice, address(m), 1), 100e18);
        assertEq(m.feeAccrued(), fee);
    }

    /// @dev The central invariant, checked after a real operation.
    function test_poolStillEqualsCostUpAfterBuy() public {
        vm.prank(alice);
        m.buy(0, 250e18, type(uint256).max, alice);
        assertEq(m.poolWad(), DPMMath.costUp(m.qArray()));
        assertGe(usdc.balanceOf(address(m)), m.collateralOwed());
    }

    function test_buyRespectsSlippageBound() public {
        (uint256 quoted,) = m.quoteBuy(1, 100e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Market.SlippageExceeded.selector, quoted, quoted - 1));
        m.buy(1, 100e18, quoted - 1, alice);
    }

    function test_buyToAnotherRecipient() public {
        vm.prank(alice);
        m.buy(1, 10e18, type(uint256).max, bob);
        assertEq(shares.balanceOfOutcome(bob, address(m), 1), 10e18);
        assertEq(shares.balanceOfOutcome(alice, address(m), 1), 0);
    }

    /// @dev Dust trades are rejected: with rounding up, a very small purchase could come to a
    ///      cost of zero tokens and hand out free shares.
    function test_dustBuyReverts() public {
        vm.prank(alice);
        vm.expectRevert(Market.TradeTooSmall.selector);
        m.buy(1, 1, type(uint256).max, alice);
    }

    function test_buyRevertsWhenPaused() public {
        vm.prank(guardian);
        config.pause();
        vm.prank(alice);
        vm.expectRevert(Market.ProtocolPaused.selector);
        m.buy(1, 100e18, type(uint256).max, alice);
    }

    function test_buyRevertsAfterTradingEnd() public {
        vm.warp(m.tradingEnd());
        vm.prank(alice);
        vm.expectRevert(Market.TradingEnded.selector);
        m.buy(1, 100e18, type(uint256).max, alice);
    }

    function test_badOutcomeReverts() public {
        vm.prank(alice);
        vm.expectRevert(Market.BadOutcome.selector);
        m.buy(2, 100e18, type(uint256).max, alice);
    }

    /// @dev quoteBuySpend is an estimate: the real cost must not exceed the notional the user
    ///      asked for.
    function testFuzz_quoteBuySpendNeverOverpromises(uint96 spend) public {
        vm.assume(spend >= 1e6 && spend <= 100_000e6);
        (uint256 sharesOut,) = m.quoteBuySpend(1, uint256(spend));
        vm.assume(sharesOut > 0);
        (uint256 realCost,) = m.quoteBuy(1, sharesOut);
        assertLe(realCost, uint256(spend));
    }

    /// @dev Buying in two steps must not be cheaper than buying in one (path independence,
    ///      within the bounds of rounding dust).
    function testFuzz_buyIsPathIndependent(uint64 partA, uint64 partB) public {
        vm.assume(partA > 1e15 && partB > 1e15);
        uint256 total = uint256(partA) + uint256(partB);
        (uint256 oneShot,) = m.quoteBuy(1, total);

        vm.startPrank(alice);
        uint256 first = m.buy(1, uint256(partA), type(uint256).max, alice);
        uint256 second = m.buy(1, uint256(partB), type(uint256).max, alice);
        vm.stopPrank();

        assertGe(first + second, oneShot);
        assertLe(first + second - oneShot, 4); // ceil dust from two steps
    }
}
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd contracts && forge test --match-contract MarketBuyTest
```
Expected: FAIL — `quoteBuy`/`buy` does not exist yet.

- [ ] **Step 3: Add to `Market.sol`**

```solidity
    function quoteBuy(uint8 outcome, uint256 sharesOut) public view returns (uint256 tokensIn, uint256 fee) {
        if (outcome > 1) revert BadOutcome();
        if (sharesOut == 0) revert ZeroAmount();
        uint256[2] memory qNew = _q;
        qNew[outcome] += sharesOut;
        uint256 costTokens = Math.ceilDiv(DPMMath.costUp(qNew) - poolWad, scale);
        fee = (costTokens * feeBps) / 10_000;
        tokensIn = costTokens + fee;
    }

    /// @notice An estimate of the shares obtained for `tokensIn` (agents think in notional).
    /// @dev Rounded down and not authoritative — `buy` recomputes the real cost, and the
    ///      caller protects itself with `maxTokensIn`.
    function quoteBuySpend(uint8 outcome, uint256 tokensIn) public view returns (uint256 sharesOut, uint256 fee) {
        if (outcome > 1) revert BadOutcome();
        fee = (tokensIn * feeBps) / (10_000 + feeBps);
        uint256 spendWad = (tokensIn - fee) * scale;
        if (spendWad == 0) return (0, fee);
        sharesOut = DPMMath.sharesForSpend(_q, outcome, spendWad);
    }

    function buy(uint8 outcome, uint256 sharesOut, uint256 maxTokensIn, address to)
        external
        nonReentrant
        returns (uint256 tokensIn)
    {
        _requireTradable();
        if (outcome > 1) revert BadOutcome();
        if (sharesOut == 0) revert ZeroAmount();

        uint256[2] memory qNew = _q;
        qNew[outcome] += sharesOut;

        uint256 target = DPMMath.costUp(qNew); // revert bila melampaui MAX_Q
        uint256 costTokens = Math.ceilDiv(target - poolWad, scale);
        if (costTokens < minTradeTokens) revert TradeTooSmall();

        uint256 fee = (costTokens * feeBps) / 10_000;
        tokensIn = costTokens + fee;
        if (tokensIn > maxTokensIn) revert SlippageExceeded(tokensIn, maxTokensIn);

        // Efek sebelum interaksi: mint ERC-1155 memanggil balik `to`.
        _q = qNew;
        poolWad = target;
        feeAccrued += fee;

        collateral.safeTransferFrom(msg.sender, address(this), tokensIn);
        shares.mint(to, outcome, sharesOut);

        emit Trade(
            msg.sender, to, outcome, int256(sharesOut), tokensIn, fee, qNew, DPMMath.probability(qNew, outcome)
        );
    }
```

**A note on the fee in `quoteBuySpend`:** `buy` charges `fee = cost·feeBps/10000` **on top of** the pool cost, so the total is `cost·(1 + feeBps/10000)`. Inverting that gives `cost = tokensIn·10000/(10000+feeBps)`, hence `fee = tokensIn·feeBps/(10000+feeBps)`.

- [ ] **Step 4: Run them and confirm they pass**

```bash
cd contracts && forge test --match-contract MarketBuyTest -vv
```
Expected: PASS — 11 lulus.

- [ ] **Step 5: Write the tests reentrancy**

`shares.mint` calls back into the recipient through `onERC1155Received`. That is the only
point in `buy` that hands control to foreign code, so that is what must be tested.

Buat `contracts/test/unit/MarketReentrancy.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "../helpers/Fixtures.sol";
import {Market} from "../../src/core/Market.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

contract ReentrantBuyer is IERC1155Receiver {
    Market public immutable market;
    bool public armed;

    constructor(Market m) {
        market = m;
    }

    function setArmed(bool v) external {
        armed = v;
    }

    function attack(uint256 amount) external {
        market.buy(1, amount, type(uint256).max, address(this));
    }

    /// @dev Called in the middle of `buy`. The second inbound call must be rejected by the guard.
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4) {
        if (armed) market.buy(1, 1e18, type(uint256).max, address(this));
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC1155Receiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}

contract MarketReentrancyTest is Fixtures {
    Market internal m;
    ReentrantBuyer internal attacker;

    function setUp() public {
        _deployBase();
        m = _newMarket(SEED);
        attacker = new ReentrantBuyer(m);
        usdc.mintTo(address(attacker), 10_000_000e6);
        vm.prank(address(attacker));
        usdc.approve(address(m), type(uint256).max);
    }

    function test_reentrantReceiverCannotReenterBuy() public {
        attacker.setArmed(true);
        vm.expectRevert(); // ReentrancyGuardReentrantCall bubbles up from the inner call
        attacker.attack(50e18);

        // Control: the same receiver, without the attack, succeeds. This proves the revert above
        // really was reentrancy and not something else.
        attacker.setArmed(false);
        attacker.attack(50e18);
        assertEq(shares.balanceOfOutcome(address(attacker), address(m), 1), 50e18);
    }

    function test_stateUnchangedAfterFailedReentrancy() public {
        uint256[2] memory qBefore = m.qArray();
        uint256 poolBefore = m.poolWad();

        attacker.setArmed(true);
        vm.expectRevert();
        attacker.attack(50e18);

        assertEq(m.qArray()[1], qBefore[1]);
        assertEq(m.poolWad(), poolBefore);
    }
}
```

Jalankan:

```bash
cd contracts && forge test --match-contract MarketReentrancyTest -vv
```
Expected: PASS — 2 lulus.

- [ ] **Step 6: Commit**

```bash
git add contracts/src/core/Market.sol contracts/test/unit/MarketBuy.t.sol contracts/test/unit/MarketReentrancy.t.sol
git commit -m "feat(contracts): Market.buy with the pool set to costUp, slippage, and a reentrancy guard"
```

---

## Task 13: `Market.sell`

**Files:**
- Modify: `contracts/src/core/Market.sol`
- Test: `contracts/test/unit/MarketSell.t.sol`

**Interfaces:**
- Consumes: `Market.buy` (Task 12)
- Produces:
  - `quoteSell(uint8 outcome, uint256 sharesIn) external view returns (uint256 tokensOut, uint256 fee)`
  - `sell(uint8 outcome, uint256 sharesIn, uint256 minTokensOut, address to) external returns (uint256 tokensOut)`

- [ ] **Step 1: Write the failing tests**

Buat `contracts/test/unit/MarketSell.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "../helpers/Fixtures.sol";
import {Market} from "../../src/core/Market.sol";
import {DPMMath} from "../../src/math/DPMMath.sol";

contract MarketSellTest is Fixtures {
    Market internal m;

    function setUp() public {
        _deployBase();
        m = _newMarket(SEED);
        _fund(alice, 1_000_000e6, address(m));
        vm.prank(alice);
        m.buy(1, 500e18, type(uint256).max, alice);
    }

    function test_sellBurnsSharesAndPaysQuote() public {
        (uint256 quoted,) = m.quoteSell(1, 200e18);
        uint256 balBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        uint256 got = m.sell(1, 200e18, 0, alice);

        assertEq(got, quoted);
        assertEq(usdc.balanceOf(alice) - balBefore, quoted);
        assertEq(shares.balanceOfOutcome(alice, address(m), 1), 300e18);
    }

    function test_poolStillEqualsCostUpAfterSell() public {
        vm.prank(alice);
        m.sell(1, 200e18, 0, alice);
        assertEq(m.poolWad(), DPMMath.costUp(m.qArray()));
        assertGe(usdc.balanceOf(address(m)), m.collateralOwed());
    }

    function test_sellMovesProbabilityBack() public {
        uint256 before = m.probability(1);
        vm.prank(alice);
        m.sell(1, 500e18, 0, alice);
        assertLt(m.probability(1), before);
        assertEq(m.probability(1), 5e17); // exactly back to the seed
    }

    function test_sellRespectsMinTokensOut() public {
        (uint256 quoted,) = m.quoteSell(1, 200e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Market.SlippageExceeded.selector, quoted, quoted + 1));
        m.sell(1, 200e18, quoted + 1, alice);
    }

    /// @dev A non-negotiable property: the pause NEVER blocks the way out.
    function test_sellSucceedsWhilePaused() public {
        vm.prank(guardian);
        config.pause();
        vm.prank(alice);
        uint256 got = m.sell(1, 100e18, 0, alice);
        assertGt(got, 0);
    }

    function test_cannotSellMoreThanOwned() public {
        vm.prank(alice);
        vm.expectRevert();
        m.sell(1, 600e18, 0, alice);
    }

    /// @dev Seed shares are NOT ERC-1155, so the creator has no tradable balance to sell at
    ///      all — the seed floor is held structurally.
    function test_creatorCannotSellSeedShares() public {
        assertEq(shares.balanceOfOutcome(creator, address(m), 0), 0);
        vm.prank(creator);
        vm.expectRevert();
        m.sell(0, 1e18, 0, creator);
    }

    /// @dev Buying and then immediately selling MUST NOT be profitable. This is the principal
    ///      guard against a sign or rounding error in the cost function.
    function testFuzz_buyThenSellNeverProfits(uint64 amount) public {
        vm.assume(amount > 1e15 && amount < 1e21);
        _fund(bob, 1_000_000e6, address(m));
        uint256 before = usdc.balanceOf(bob);

        vm.startPrank(bob);
        uint256 paid = m.buy(0, uint256(amount), type(uint256).max, bob);
        uint256 got = m.sell(0, uint256(amount), 0, bob);
        vm.stopPrank();

        assertLe(got, paid);
        assertLe(usdc.balanceOf(bob), before);
    }
}
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd contracts && forge test --match-contract MarketSellTest
```
Expected: FAIL — `quoteSell`/`sell` does not exist yet.

- [ ] **Step 3: Add to `Market.sol`**

```solidity
    function quoteSell(uint8 outcome, uint256 sharesIn) public view returns (uint256 tokensOut, uint256 fee) {
        if (outcome > 1) revert BadOutcome();
        if (sharesIn == 0) revert ZeroAmount();
        uint256[2] memory qNew = _q;
        qNew[outcome] -= sharesIn;
        uint256 grossTokens = (poolWad - DPMMath.costUp(qNew)) / scale; // floor
        fee = (grossTokens * feeBps) / 10_000;
        tokensOut = grossTokens - fee;
    }

    function sell(uint8 outcome, uint256 sharesIn, uint256 minTokensOut, address to)
        external
        nonReentrant
        returns (uint256 tokensOut)
    {
        _requireExitable(); // sengaja tanpa pemeriksaan pause
        if (outcome > 1) revert BadOutcome();
        if (sharesIn == 0) revert ZeroAmount();

        uint256[2] memory qNew = _q;
        qNew[outcome] -= sharesIn; // underflow revert bila melampaui pasokan

        // Should be unreachable: seed shares are not ERC-1155, so the burn below
        // already limits a sale to the tradable supply. Kept as an explicit
        // statement — should seed shares one day also be minted as ERC-1155,
        // this is the path that catches it.
        if (qNew[outcome] < _seedSupply[outcome]) revert SeedFloorBreached();

        uint256 target = DPMMath.costUp(qNew);
        uint256 grossTokens = (poolWad - target) / scale; // floor: the leftover dust stays in the pool
        if (grossTokens < minTradeTokens) revert TradeTooSmall();

        uint256 fee = (grossTokens * feeBps) / 10_000;
        tokensOut = grossTokens - fee;
        if (tokensOut < minTokensOut) revert SlippageExceeded(tokensOut, minTokensOut);

        _q = qNew;
        poolWad = target;
        feeAccrued += fee;

        shares.burn(msg.sender, outcome, sharesIn);
        collateral.safeTransfer(to, tokensOut);

        emit Trade(
            msg.sender, to, outcome, -int256(sharesIn), tokensOut, fee, qNew, DPMMath.probability(qNew, outcome)
        );
    }
```

- [ ] **Step 4: Run them and confirm they pass**

```bash
cd contracts && forge test --match-contract MarketSellTest -vv
```
Expected: PASS — 8 lulus.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/core/Market.sol contracts/test/unit/MarketSell.t.sol
git commit -m "feat(contracts): Market.sell — the exit stays open while the protocol is paused"
```

---

## Task 14: `Market.addLiquidity` / `removeLiquidity` (proporsional)

**Files:**
- Modify: `contracts/src/core/Market.sol`
- Test: `contracts/test/unit/MarketLiquidity.t.sol`

**Interfaces:**
- Consumes: `Market` (Task 11–13)
- Produces:
  - `addLiquidity(uint256 tokensIn, uint256 minSharesOut, address to) external returns (uint256[2] memory minted)`
  - `removeLiquidity(uint256 lambdaWad, uint256 minTokensOut, address to) external returns (uint256 tokensOut)`
  - Error: `BadLambda()`, `InsufficientSeedShares()`, `CreatorSeedFloor()`

**Why proportional, and why that is provably safe.** `C` is homogeneous of degree 1, so scaling the whole of `q` by `(1+λ)` raises the pool by the same factor without moving `Pᵢ = qᵢ²/Σqⱼ²`. A non-proportional withdrawal would be a directional trade with no fee — which is why it is forbidden.

That a deposit is never underpaid is also proven, not merely hoped for:

```
qBaru[i] = q[i] + ⌊q[i]·λ/WAD⌋ ≤ q[i]·(1+λ/WAD)
⇒ C(qNew) ≤ (1+λ/WAD)·C(q) ≤ (1+λ/WAD)·poolWad          [because poolWad ≥ C(q)]
             = poolWad + poolWad·λ/WAD ≤ poolWad + amountWad  [λ = ⌊amountWad·WAD/poolWad⌋]
⇒ costUp(qBaru) ≤ poolWad + amountWad                      [kedua ruas bilangan bulat]
⇒ needTokens ≤ tokensIn
```

- [ ] **Step 1: Write the failing tests**

Buat `contracts/test/unit/MarketLiquidity.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "../helpers/Fixtures.sol";
import {Market} from "../../src/core/Market.sol";
import {DPMMath} from "../../src/math/DPMMath.sol";

contract MarketLiquidityTest is Fixtures {
    Market internal m;

    function setUp() public {
        _deployBase();
        m = _newMarket(SEED);
        _fund(alice, 1_000_000e6, address(m));
        _fund(bob, 1_000_000e6, address(m));
    }

    /// @dev The property that makes this an LP primitive rather than just a trade: the
    ///      probability does not move at all.
    function test_addLiquidityIsProbabilityNeutral() public {
        vm.prank(alice);
        m.buy(1, 300e18, type(uint256).max, alice); // put the market off balance first
        uint256 before = m.probability(1);

        vm.prank(bob);
        m.addLiquidity(500e6, 0, bob);

        uint256 diff = m.probability(1) > before ? m.probability(1) - before : before - m.probability(1);
        assertLe(diff, 1e9, "probability moved by more than rounding dust");
    }

    function test_addLiquidityDeepensTheMarket() public {
        uint256 poolBefore = m.poolWad();
        vm.prank(bob);
        m.addLiquidity(500e6, 0, bob);
        assertGt(m.poolWad(), poolBefore);
        assertEq(m.poolWad(), DPMMath.costUp(m.qArray()));
    }

    function test_addLiquidityNeverChargesMoreThanOffered() public {
        uint256 balBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        m.addLiquidity(500e6, 0, bob);
        assertLe(balBefore - usdc.balanceOf(bob), 500e6);
    }

    function test_addLiquidityMintsNonTransferableSeedShares() public {
        vm.prank(bob);
        uint256[2] memory minted = m.addLiquidity(500e6, 0, bob);
        assertGt(minted[0], 0);
        assertEq(m.seedSharesOf(bob)[0], minted[0]);
        assertEq(shares.balanceOfOutcome(bob, address(m), 0), 0, "seed shares must not become ERC-1155");
    }

    function test_removeLiquidityReturnsCollateral() public {
        vm.prank(bob);
        m.addLiquidity(500e6, 0, bob);
        uint256 balBefore = usdc.balanceOf(bob);

        vm.prank(bob);
        uint256 got = m.removeLiquidity(1e17, 0, bob); // 10% of the current q
        assertGt(got, 0);
        assertEq(usdc.balanceOf(bob) - balBefore, got);
        assertEq(m.poolWad(), DPMMath.costUp(m.qArray()));
    }

    /// @dev A hard floor. This is what keeps qᵢ > 0 forever; without it C(q)/q_winning could
    ///      divide by zero at settle.
    function test_creatorCannotWithdrawItsSeed() public {
        vm.prank(creator);
        vm.expectRevert(Market.CreatorSeedFloor.selector);
        m.removeLiquidity(1e16, 0, creator);
    }

    function test_removeLiquidityCannotExceedOwnPosition() public {
        vm.prank(bob);
        vm.expectRevert(Market.InsufficientSeedShares.selector);
        m.removeLiquidity(1e17, 0, bob);
    }

    function test_lambdaAboveOneReverts() public {
        vm.prank(bob);
        vm.expectRevert(Market.BadLambda.selector);
        m.removeLiquidity(1e18 + 1, 0, bob);
    }

    /// @dev An exit path again: withdrawing liquidity must not be blocked by the pause.
    function test_removeLiquiditySucceedsWhilePaused() public {
        vm.prank(bob);
        m.addLiquidity(500e6, 0, bob);
        vm.prank(guardian);
        config.pause();
        vm.prank(bob);
        assertGt(m.removeLiquidity(5e16, 0, bob), 0);
    }

    function testFuzz_addThenRemoveNeverProfits(uint64 amount) public {
        vm.assume(amount >= 10e6 && amount <= 100_000e6);
        uint256 balBefore = usdc.balanceOf(bob);
        vm.startPrank(bob);
        m.addLiquidity(uint256(amount), 0, bob);
        uint256[2] memory q = m.qArray();
        uint256[2] memory held = m.seedSharesOf(bob);
        // withdraw the largest fraction still covered by one's own position
        uint256 lambda = Math.min((held[0] * 1e18) / q[0], (held[1] * 1e18) / q[1]);
        if (lambda > 0) m.removeLiquidity(lambda, 0, bob);
        vm.stopPrank();
        assertLe(usdc.balanceOf(bob), balBefore);
    }
}
```

Add the `Math` import to the test file:

```solidity
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd contracts && forge test --match-contract MarketLiquidityTest
```
Expected: FAIL — `addLiquidity` does not exist yet.

- [ ] **Step 3: Add to `Market.sol`**

```solidity
    error BadLambda();
    error InsufficientSeedShares();
    error CreatorSeedFloor();

    /// @notice Adds liquidity proportionally. No fee: this is not a directional trade but a
    ///         scaling of the whole market.
    function addLiquidity(uint256 tokensIn, uint256 minSharesOut, address to)
        external
        nonReentrant
        returns (uint256[2] memory minted)
    {
        _requireTradable();
        if (tokensIn == 0) revert ZeroAmount();

        uint256 amountWad = tokensIn * scale;
        uint256 lambdaWad = Math.mulDiv(amountWad, DPMMath.WAD, poolWad);
        if (lambdaWad == 0) revert TradeTooSmall();

        minted[0] = Math.mulDiv(_q[0], lambdaWad, DPMMath.WAD);
        minted[1] = Math.mulDiv(_q[1], lambdaWad, DPMMath.WAD);
        if (minted[0] == 0 || minted[1] == 0) revert TradeTooSmall();

        uint256 smaller = Math.min(minted[0], minted[1]);
        if (smaller < minSharesOut) revert SlippageExceeded(smaller, minSharesOut);

        uint256[2] memory qNew;
        qNew[0] = _q[0] + minted[0];
        qNew[1] = _q[1] + minted[1];

        uint256 target = DPMMath.costUp(qNew);
        uint256 needTokens = Math.ceilDiv(target - poolWad, scale);
        // Terbukti ≤ tokensIn (lihat rencana Task 14); dipertahankan sebagai penjaga eksplisit.
        if (needTokens > tokensIn) revert TradeTooSmall();

        _q = qNew;
        _seedSupply[0] += minted[0];
        _seedSupply[1] += minted[1];
        _seedShares[to][0] += minted[0];
        _seedShares[to][1] += minted[1];
        poolWad = target;

        collateral.safeTransferFrom(msg.sender, address(this), needTokens);
        emit LiquidityChanged(to, int256(lambdaWad), needTokens, qNew);
    }

    /// @notice Withdraws liquidity proportionally to the CURRENT `q`.
    /// @param lambdaWad the wad fraction of q being withdrawn (0 < λ ≤ WAD).
    /// @dev Non-proportional withdrawal is forbidden: it would amount to a directional trade
    ///      with no fee. The creator's seed can never be withdrawn — that floor is what
    ///      menjamin qᵢ > 0 sampai settlement.
    function removeLiquidity(uint256 lambdaWad, uint256 minTokensOut, address to)
        external
        nonReentrant
        returns (uint256 tokensOut)
    {
        _requireExitable(); // sengaja tanpa pemeriksaan pause
        if (lambdaWad == 0 || lambdaWad > DPMMath.WAD) revert BadLambda();

        uint256[2] memory take;
        take[0] = Math.mulDiv(_q[0], lambdaWad, DPMMath.WAD);
        take[1] = Math.mulDiv(_q[1], lambdaWad, DPMMath.WAD);
        if (take[0] == 0 || take[1] == 0) revert TradeTooSmall();

        uint256[2] memory held = _seedShares[msg.sender];
        if (held[0] < take[0] || held[1] < take[1]) revert InsufficientSeedShares();
        if (_seedSupply[0] - take[0] < _creatorSeed[0] || _seedSupply[1] - take[1] < _creatorSeed[1]) {
            revert CreatorSeedFloor();
        }

        uint256[2] memory qNew;
        qNew[0] = _q[0] - take[0];
        qNew[1] = _q[1] - take[1];

        uint256 target = DPMMath.costUp(qNew);
        tokensOut = (poolWad - target) / scale;
        if (tokensOut < minTokensOut) revert SlippageExceeded(tokensOut, minTokensOut);

        _q = qNew;
        _seedSupply[0] -= take[0];
        _seedSupply[1] -= take[1];
        _seedShares[msg.sender][0] -= take[0];
        _seedShares[msg.sender][1] -= take[1];
        poolWad = target;

        collateral.safeTransfer(to, tokensOut);
        emit LiquidityChanged(msg.sender, -int256(lambdaWad), tokensOut, qNew);
    }
```

- [ ] **Step 4: Run them and confirm they pass**

```bash
cd contracts && forge test --match-contract MarketLiquidityTest -vv
```
Expected: PASS — 10 lulus.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/core/Market.sol contracts/test/unit/MarketLiquidity.t.sol
git commit -m "feat(contracts): probability-neutral proportional liquidity with a creator seed floor"
```

---

## Task 15: Siklus hidup `Market` — close, settle, fail, void, distribusi fee

**Files:**
- Modify: `contracts/src/core/Market.sol`
- Test: `contracts/test/unit/MarketLifecycle.t.sol`

**Interfaces:**
- Consumes: `Market` (Task 11–14), `ConfigKeys.RESOLUTION_MODULE`, `ConfigRegistry.guardian`
- Produces:
  - `close()`, `markProposed()`, `markDisputed()`, `settle(uint8 outcome)`, `fail()`, `void(bytes32 reason)` (memancarkan `MarketVoided`)
  - `payoutPerShareWad()`, `liqPerShare()`, `winningOutcome()`, `resolvedAt()`
  - Error: `TradingNotEnded()`, `BadTransition()`, `NotResolutionModule()`, `NotGuardian()`

- [ ] **Step 1: Write the failing tests**

Buat `contracts/test/unit/MarketLifecycle.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "../helpers/Fixtures.sol";
import {Market} from "../../src/core/Market.sol";
import {IMarket} from "../../src/interfaces/IMarket.sol";
import {DPMMath} from "../../src/math/DPMMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract MarketLifecycleTest is Fixtures {
    Market internal m;

    function setUp() public {
        _deployBase();
        m = _newMarket(SEED);
        _fund(alice, 1_000_000e6, address(m));
        vm.prank(alice);
        m.buy(1, 400e18, type(uint256).max, alice);
    }

    function test_closeOnlyAfterTradingEnd() public {
        vm.expectRevert(Market.TradingNotEnded.selector);
        m.close();
        vm.warp(m.tradingEnd());
        m.close();
        assertEq(uint8(m.status()), uint8(IMarket.Status.Closed));
    }

    function test_closedMarketRejectsAllTrading() public {
        vm.warp(m.tradingEnd());
        m.close();
        vm.startPrank(alice);
        vm.expectRevert(Market.NotOpen.selector);
        m.buy(1, 1e18, type(uint256).max, alice);
        vm.expectRevert(Market.NotOpen.selector);
        m.sell(1, 1e18, 0, alice);
        vm.stopPrank();
    }

    function test_onlyResolutionModuleCanSettle() public {
        vm.warp(m.tradingEnd());
        m.close();
        vm.prank(alice);
        vm.expectRevert(Market.NotResolutionModule.selector);
        m.settle(1);
    }

    /// @dev The payout is snapshotted once at settle. Otherwise the first and the last
    ///      redeemer would receive different rates.
    function test_settleSnapshotsPayoutRate() public {
        vm.warp(m.tradingEnd());
        m.close();
        uint256 pool = m.poolWad();
        uint256[2] memory q = m.qArray();

        vm.prank(resolutionModule);
        m.settle(1);

        assertEq(uint8(m.status()), uint8(IMarket.Status.Settled));
        assertEq(m.winningOutcome(), 1);
        assertEq(m.payoutPerShareWad(), Math.mulDiv(DPMMath.WAD, pool, q[1]));
    }

    /// @dev A consequence of the seed floor: the divisor is never zero.
    function test_winningSupplyIsNeverZero() public {
        vm.warp(m.tradingEnd());
        m.close();
        vm.prank(resolutionModule);
        m.settle(0);
        assertGt(m.qArray()[0], 0);
        assertGt(m.payoutPerShareWad(), 0);
    }

    function test_failSnapshotsLiquidationRates() public {
        vm.warp(m.settlementDeadline());
        m.fail();
        assertEq(uint8(m.status()), uint8(IMarket.Status.Failed));
        uint256[2] memory rates = m.liqPerShare();
        assertGt(rates[0], 0);
        assertGt(rates[1], 0);
    }

    function test_anyoneCanFailAfterSettlementDeadline() public {
        vm.expectRevert(Market.BadTransition.selector);
        m.fail(); // still Open, and the deadline has not passed
        vm.warp(m.settlementDeadline());
        vm.prank(bob);
        m.fail();
        assertEq(uint8(m.status()), uint8(IMarket.Status.Failed));
    }

    function test_onlyGuardianCanVoidAndOnlyWhileOpen() public {
        vm.prank(alice);
        vm.expectRevert(Market.NotGuardian.selector);
        m.void("abuse");

        vm.warp(m.tradingEnd());
        m.close();
        vm.prank(guardian);
        vm.expectRevert(Market.BadTransition.selector);
        m.void("abuse");
    }

    function test_voidSlashesSettlementDepositToTreasury() public {
        uint256 deposit = m.settlementDeposit();
        uint256 before = usdc.balanceOf(treasury);
        vm.prank(guardian);
        m.void("abuse");
        assertEq(uint8(m.status()), uint8(IMarket.Status.Voided));
        assertGe(usdc.balanceOf(treasury) - before, deposit);
    }

    function test_settleDistributesFeesAndDeposit() public {
        uint256 fees = m.feeAccrued();
        assertGt(fees, 0);
        uint256 creatorBefore = usdc.balanceOf(creator);
        uint256 resolverBefore = usdc.balanceOf(resolutionModule);

        vm.warp(m.tradingEnd());
        m.close();
        vm.prank(resolutionModule);
        m.settle(1);

        assertEq(m.feeAccrued(), 0);
        assertEq(m.settlementDeposit(), 0);
        assertEq(usdc.balanceOf(creator) - creatorBefore, (fees * 4000) / 10_000);
        assertEq(usdc.balanceOf(resolutionModule) - resolverBefore, (fees * 3000) / 10_000 + DEPOSIT);
    }

    function test_cannotSettleTwice() public {
        vm.warp(m.tradingEnd());
        m.close();
        vm.startPrank(resolutionModule);
        m.settle(1);
        vm.expectRevert(Market.BadTransition.selector);
        m.settle(0);
        vm.stopPrank();
    }
}
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd contracts && forge test --match-contract MarketLifecycleTest
```
Expected: FAIL — `close`/`settle`/`fail`/`void` does not exist yet.

- [ ] **Step 3: Add to `Market.sol`**

```solidity
    error TradingNotEnded();
    error BadTransition();
    error NotResolutionModule();
    error NotGuardian();

    modifier onlyResolutionModule() {
        if (msg.sender != config.addresses(ConfigKeys.RESOLUTION_MODULE)) revert NotResolutionModule();
        _;
    }

    function close() external {
        if (status != Status.Open) revert BadTransition();
        if (block.timestamp < tradingEnd) revert TradingNotEnded();
        _setStatus(Status.Closed);
    }

    function markProposed() external onlyResolutionModule {
        if (status != Status.Closed && status != Status.Disputed) revert BadTransition();
        _setStatus(Status.Proposed);
    }

    function markDisputed() external onlyResolutionModule {
        if (status != Status.Proposed) revert BadTransition();
        _setStatus(Status.Disputed);
    }

    /// @dev The payout rate is SNAPSHOTTED here so that the first and the last redeemer
    ///      receive the same rate. `_q[outcome]` is guaranteed > 0 by the creator seed floor.
    function settle(uint8 outcome) external onlyResolutionModule {
        if (status != Status.Closed && status != Status.Proposed && status != Status.Disputed) revert BadTransition();
        if (outcome > 1) revert BadOutcome();

        winningOutcome = outcome;
        resolvedAt = uint64(block.timestamp);
        payoutPerShareWad = Math.mulDiv(DPMMath.WAD, poolWad, _q[outcome]);

        _setStatus(Status.Settled);
        _distributeFees(false);
        emit Settled(outcome, payoutPerShareWad);
    }

    /// @notice No outcome could be established → every party is liquidated at pᵢ.
    function fail() external {
        bool byModule = msg.sender == config.addresses(ConfigKeys.RESOLUTION_MODULE);
        bool pastDeadline = block.timestamp >= settlementDeadline;
        if (!byModule && !pastDeadline) revert BadTransition();
        if (status == Status.Settled || status == Status.Failed || status == Status.Voided) revert BadTransition();

        _snapshotLiquidation();
        _setStatus(Status.Failed);
        _distributeFees(false);
    }

    /// @notice Emergency cancellation by the guardian, only before the market closes.
    ///         The settlement deposit is SLASHED — that is what makes an abusive market expensive.
    function void(bytes32 reason) external {
        if (msg.sender != config.guardian()) revert NotGuardian();
        if (status != Status.Open) revert BadTransition();

        _snapshotLiquidation();
        _setStatus(Status.Voided);
        _distributeFees(true);
        emit MarketVoided(reason);
    }

    function _snapshotLiquidation() internal {
        resolvedAt = uint64(block.timestamp);
        _liqPerShareWad[0] = DPMMath.price(_q, 0);
        _liqPerShareWad[1] = DPMMath.price(_q, 1);
    }

    function _setStatus(Status next) internal {
        Status prev = status;
        status = next;
        emit StatusChanged(prev, next);
    }

    /// @param slashDeposit true on void — the deposit goes to the Treasury, not the resolver pool.
    function _distributeFees(bool slashDeposit) internal {
        uint256 fees = feeAccrued;
        uint256 deposit = settlementDeposit;
        feeAccrued = 0;
        settlementDeposit = 0;
        if (fees == 0 && deposit == 0) return;

        address treasuryAddr = config.addresses(ConfigKeys.TREASURY);
        address resolverPool = config.addresses(ConfigKeys.RESOLUTION_MODULE);
        if (resolverPool == address(0)) resolverPool = treasuryAddr;

        uint256 toCreator = (fees * config.params(ConfigKeys.CREATOR_FEE_SHARE_BPS)) / 10_000;
        uint256 resolverFee = (fees * config.params(ConfigKeys.RESOLVER_FEE_SHARE_BPS)) / 10_000;
        uint256 toResolvers = slashDeposit ? resolverFee : resolverFee + deposit;
        uint256 toTreasury = fees - toCreator - resolverFee + (slashDeposit ? deposit : 0);

        if (toCreator > 0) collateral.safeTransfer(creator, toCreator);
        if (toResolvers > 0) collateral.safeTransfer(resolverPool, toResolvers);
        if (toTreasury > 0) collateral.safeTransfer(treasuryAddr, toTreasury);
        emit FeesDistributed(toCreator, toResolvers, toTreasury);
    }
```

- [ ] **Step 4: Run them and confirm they pass**

```bash
cd contracts && forge test --match-contract MarketLifecycleTest -vv
```
Expected: PASS — 11 lulus.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/core/Market.sol contracts/test/unit/MarketLifecycle.t.sol
git commit -m "feat(contracts): the Market lifecycle with snapshotted payout and liquidation rates"
```

---

## Task 16: `Market.redeem` / `liquidate` / `sweepUnclaimed`

**Files:**
- Modify: `contracts/src/core/Market.sol`
- Test: `contracts/test/unit/MarketExit.t.sol`

**Interfaces:**
- Consumes: `Market` (Task 11–15)
- Produces:
  - `redeem(address to) external returns (uint256 tokensOut)`
  - `liquidate(address to) external returns (uint256 tokensOut)`
  - `sweepUnclaimed() external`
  - Error: `NotSettled()`, `NotLiquidatable()`, `NothingToClaim()`, `TooEarly()`

**What `poolWad` means after resolution changes.** While `Open/Closed/Proposed/Disputed`, `poolWad == costUp(q)`. From `settle`/`fail`/`void` onward, `q` is frozen and `poolWad` changes meaning to **the unclaimed liability that remains**, shrinking with every claim. The Task 18 invariants separate these two regimes.

That claims never exceed the pool is also proven:
- Settled: `Σᵢ ⌊aᵢ·r/WAD⌋ ≤ ⌊(Σaᵢ)·r/WAD⌋ = ⌊q_win·r/WAD⌋ ≤ poolWad` with `r = ⌊WAD·poolWad/q_win⌋`.
- Failed/Voided: `Σᵢ ⌊qᵢ·pᵢ/WAD⌋ ≤ Σᵢ qᵢ·pᵢ = C(q) ≤ poolWad` (identitas Euler).

- [ ] **Step 1: Write the failing tests**

Buat `contracts/test/unit/MarketExit.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "../helpers/Fixtures.sol";
import {Market} from "../../src/core/Market.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";

contract MarketExitTest is Fixtures {
    Market internal m;

    function setUp() public {
        _deployBase();
        m = _newMarket(SEED);
        _fund(alice, 1_000_000e6, address(m));
        _fund(bob, 1_000_000e6, address(m));
        vm.prank(alice);
        m.buy(1, 400e18, type(uint256).max, alice);
        vm.prank(bob);
        m.buy(0, 150e18, type(uint256).max, bob);
    }

    function _settleAs(uint8 outcome) internal {
        vm.warp(m.tradingEnd());
        m.close();
        vm.prank(resolutionModule);
        m.settle(outcome);
    }

    function test_winnerRedeemsAndLoserGetsNothing() public {
        _settleAs(1);
        vm.prank(alice);
        uint256 won = m.redeem(alice);
        assertGt(won, 0);

        vm.prank(bob);
        vm.expectRevert(Market.NothingToClaim.selector);
        m.redeem(bob);
    }

    function test_creatorRedeemsWinningSeedOnly() public {
        _settleAs(1);
        vm.prank(creator);
        uint256 got = m.redeem(creator);
        assertGt(got, 0);
        assertEq(m.seedSharesOf(creator)[0], 0, "the losing side must be forfeited");
        assertEq(m.seedSharesOf(creator)[1], 0);
    }

    /// @dev The conservation equation: total redemptions must not exceed the pool.
    function test_totalRedemptionsNeverExceedPool() public {
        _settleAs(1);
        uint256 poolTokens = usdc.balanceOf(address(m));

        vm.prank(alice);
        uint256 a = m.redeem(alice);
        vm.prank(creator);
        uint256 c = m.redeem(creator);

        assertLe(a + c, poolTokens);
        assertGe(usdc.balanceOf(address(m)), 0);
    }

    /// @dev Redeem must succeed even while the protocol is paused.
    function test_redeemSucceedsWhilePaused() public {
        _settleAs(1);
        vm.prank(guardian);
        config.pause();
        vm.prank(alice);
        assertGt(m.redeem(alice), 0);
    }

    /// @dev The Euler identity: liquidation pays pᵢ per share and exhausts the pool.
    function test_liquidationPaysEverySideAndDrainsPool() public {
        vm.warp(m.settlementDeadline());
        m.fail();

        vm.prank(alice);
        uint256 a = m.liquidate(alice);
        vm.prank(bob);
        uint256 b = m.liquidate(bob);
        vm.prank(creator);
        uint256 c = m.liquidate(creator);

        assertGt(a, 0);
        assertGt(b, 0, "a losing-side holder still gets a refund when the market fails");
        assertGt(c, 0);
        assertLe(m.poolWad(), 3); // only dust left
    }

    function test_cannotRedeemOnFailedMarket() public {
        vm.warp(m.settlementDeadline());
        m.fail();
        vm.prank(alice);
        vm.expectRevert(Market.NotSettled.selector);
        m.redeem(alice);
    }

    function test_cannotLiquidateOnSettledMarket() public {
        _settleAs(1);
        vm.prank(alice);
        vm.expectRevert(Market.NotLiquidatable.selector);
        m.liquidate(alice);
    }

    function test_cannotClaimTwice() public {
        _settleAs(1);
        vm.startPrank(alice);
        m.redeem(alice);
        vm.expectRevert(Market.NothingToClaim.selector);
        m.redeem(alice);
        vm.stopPrank();
    }

    function test_sweepOnlyAfterWindowAndGoesToTreasury() public {
        _settleAs(1);
        vm.expectRevert(Market.TooEarly.selector);
        m.sweepUnclaimed();

        vm.warp(block.timestamp + config.params(ConfigKeys.SWEEP_UNCLAIMED_AFTER));
        uint256 before = usdc.balanceOf(treasury);
        m.sweepUnclaimed();
        assertGt(usdc.balanceOf(treasury) - before, 0);
        assertEq(usdc.balanceOf(address(m)), 0);
    }
}
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd contracts && forge test --match-contract MarketExitTest
```
Expected: FAIL — `redeem`/`liquidate`/`sweepUnclaimed` does not exist yet.

- [ ] **Step 3: Add to `Market.sol`**

```solidity
    error NotSettled();
    error NotLiquidatable();
    error NothingToClaim();
    error TooEarly();

    /// @notice Redeems winning-side shares at the rate snapshotted at settle.
    /// @dev Losing-side shares — tradable and seed alike — are worth nothing and are cleared.
    function redeem(address to) external nonReentrant returns (uint256 tokensOut) {
        if (status != Status.Settled) revert NotSettled();

        uint8 w = winningOutcome;
        uint8 l = w == 0 ? 1 : 0;

        uint256 tradable = shares.balanceOfOutcome(msg.sender, address(this), w);
        uint256 seed = _seedShares[msg.sender][w];
        uint256 amount = tradable + seed;
        if (amount == 0) revert NothingToClaim();

        uint256 payoutWad = Math.mulDiv(amount, payoutPerShareWad, DPMMath.WAD);
        tokensOut = payoutWad / scale;

        _seedShares[msg.sender][w] = 0;
        _seedShares[msg.sender][l] = 0;
        poolWad -= payoutWad;

        if (tradable > 0) shares.burn(msg.sender, w, tradable);
        if (tokensOut > 0) collateral.safeTransfer(to, tokensOut);
        emit Redeemed(msg.sender, amount, tokensOut);
    }

    /// @notice The market failed or was voided: every side is paid pᵢ per share.
    /// @dev By the Euler identity Σ pᵢ·qᵢ = C(q), these payouts exhaust the pool exactly.
    function liquidate(address to) external nonReentrant returns (uint256 tokensOut) {
        if (status != Status.Failed && status != Status.Voided) revert NotLiquidatable();

        uint256[2] memory amounts;
        uint256 payoutWad;
        for (uint8 i = 0; i < 2; ++i) {
            uint256 tradable = shares.balanceOfOutcome(msg.sender, address(this), i);
            uint256 seed = _seedShares[msg.sender][i];
            amounts[i] = tradable + seed;
            if (amounts[i] == 0) continue;

            payoutWad += Math.mulDiv(amounts[i], _liqPerShareWad[i], DPMMath.WAD);
            if (seed > 0) _seedShares[msg.sender][i] = 0;
            if (tradable > 0) shares.burn(msg.sender, i, tradable);
        }
        if (amounts[0] == 0 && amounts[1] == 0) revert NothingToClaim();

        tokensOut = payoutWad / scale;
        poolWad -= payoutWad;
        if (tokensOut > 0) collateral.safeTransfer(to, tokensOut);
        emit Liquidated(msg.sender, amounts, tokensOut);
    }

    /// @notice Sweeps whatever was never claimed to the Treasury after a long window.
    function sweepUnclaimed() external {
        if (status != Status.Settled && status != Status.Failed && status != Status.Voided) revert BadTransition();
        if (block.timestamp < resolvedAt + config.params(ConfigKeys.SWEEP_UNCLAIMED_AFTER)) revert TooEarly();

        uint256 bal = collateral.balanceOf(address(this));
        if (bal == 0) revert ZeroAmount();
        poolWad = 0;
        collateral.safeTransfer(config.addresses(ConfigKeys.TREASURY), bal);
    }
```

- [ ] **Step 4: Run them and confirm they pass**

```bash
cd contracts && forge test --match-contract MarketExitTest -vv
```
Expected: PASS — 10 lulus.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/core/Market.sol contracts/test/unit/MarketExit.t.sol
git commit -m "feat(contracts): redeem, Euler liquidation, and the unclaimed-funds sweep"
```

---

## Task 17: `MarketFactory` — clone, registry, approval kurator EIP-712

**Files:**
- Create: `contracts/src/core/MarketFactory.sol`
- Modify: `contracts/script/Deploy.s.sol`, `contracts/test/helpers/Fixtures.sol`
- Test: `contracts/test/unit/MarketFactory.t.sol`

**Interfaces:**
- Consumes: `Market` (Task 11–16), `OutcomeShares` (Task 10), `ConfigRegistry` (Task 4)
- Produces:
  - `MarketFactory.initialize(address owner_, address config_, address shares_, address marketImpl_)`
  - `createMarket(IMarket.Params calldata p, uint256 seedTokens, uint256 depositTokens, uint256 nonce, bytes calldata curatorSig) external returns (address market)`
  - `isMarket(address) external view returns (bool)` (memenuhi `IMarketRegistry`)
  - `setMarketImplementation(address)`, `marketCount()`, `marketAt(uint256)`
  - `MARKET_APPROVAL_TYPEHASH`, event `MarketCreated(address indexed market, address indexed creator, uint256 indexed creatorAgentId, bytes32 specRoot, uint256 seed, uint8 tier)`
  - Error: `BadCuratorSignature()`, `ApprovalAlreadyUsed()`, `ProtocolPaused()`

- [ ] **Step 1: Write the failing tests**

Buat `contracts/test/unit/MarketFactory.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "../helpers/Fixtures.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {MarketFactory} from "../../src/core/MarketFactory.sol";
import {Market} from "../../src/core/Market.sol";
import {IMarket} from "../../src/interfaces/IMarket.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";

contract MarketFactoryTest is Fixtures {
    MarketFactory internal factory;
    uint256 internal curatorPk = 0xC0FFEE;
    address internal curator;

    function setUp() public {
        _deployBase();
        curator = vm.addr(curatorPk);

        MarketFactory impl = new MarketFactory();
        factory = MarketFactory(
            address(
                new ERC1967Proxy(
                    address(impl),
                    abi.encodeCall(
                        MarketFactory.initialize,
                        (address(this), address(config), address(shares), address(marketImpl))
                    )
                )
            )
        );
        config.setAddress(ConfigKeys.MARKET_FACTORY, address(factory));
        config.setAddress(ConfigKeys.CURATOR_SIGNER, curator);
        _useFactoryAsRegistry(address(factory));

        _fund(creator, 1_000_000e6, address(factory));
    }

    function _sign(IMarket.Params memory p, uint256 nonce) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                factory.MARKET_APPROVAL_TYPEHASH(),
                p.specRoot,
                p.tradingEnd,
                p.settlementDeadline,
                p.tier,
                p.creatorAgentId,
                p.category,
                p.creator,
                nonce
            )
        );
        bytes32 digest = factory.hashTypedData(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(curatorPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_createMarketDeploysCloneAndSeedsIt() public {
        IMarket.Params memory p = _params();
        vm.prank(creator);
        address addr = factory.createMarket(p, SEED, DEPOSIT, 1, _sign(p, 1));

        Market m = Market(addr);
        assertTrue(factory.isMarket(addr));
        assertEq(factory.marketCount(), 1);
        assertEq(uint8(m.status()), uint8(IMarket.Status.Open));
        assertEq(m.probability(0), 5e17);
        assertEq(usdc.balanceOf(addr), SEED + DEPOSIT);
    }

    function test_marketCanMintSharesOnlyAfterRegistration() public {
        IMarket.Params memory p = _params();
        vm.prank(creator);
        Market m = Market(factory.createMarket(p, SEED, DEPOSIT, 1, _sign(p, 1)));

        _fund(alice, 100_000e6, address(m));
        vm.prank(alice);
        m.buy(1, 50e18, type(uint256).max, alice);
        assertEq(shares.balanceOfOutcome(alice, address(m), 1), 50e18);
    }

    function test_wrongSignerRejected() public {
        IMarket.Params memory p = _params();
        bytes32 structHash = keccak256(
            abi.encode(
                factory.MARKET_APPROVAL_TYPEHASH(),
                p.specRoot, p.tradingEnd, p.settlementDeadline, p.tier,
                p.creatorAgentId, p.category, p.creator, uint256(1)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBADBAD, factory.hashTypedData(structHash));
        vm.prank(creator);
        vm.expectRevert(MarketFactory.BadCuratorSignature.selector);
        factory.createMarket(p, SEED, DEPOSIT, 1, abi.encodePacked(r, s, v));
    }

    /// @dev A signature that has been used must not be usable again.
    function test_approvalCannotBeReplayed() public {
        IMarket.Params memory p = _params();
        bytes memory sig = _sign(p, 1);
        vm.startPrank(creator);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        vm.expectRevert(MarketFactory.ApprovalAlreadyUsed.selector);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        vm.stopPrank();
    }

    /// @dev Changing a single field invalidates the signature — the curator approves a
    ///      PARTICULAR market, not a general permission.
    function test_tamperedParamsRejected() public {
        IMarket.Params memory p = _params();
        bytes memory sig = _sign(p, 1);
        p.tier = 0;
        vm.prank(creator);
        vm.expectRevert(MarketFactory.BadCuratorSignature.selector);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);
    }

    function test_createMarketBlockedWhilePaused() public {
        vm.prank(guardian);
        config.pause();
        IMarket.Params memory p = _params();
        vm.prank(creator);
        vm.expectRevert(MarketFactory.ProtocolPaused.selector);
        factory.createMarket(p, SEED, DEPOSIT, 1, _sign(p, 1));
    }

    function test_onlyOwnerCanSwapImplementation() public {
        Market next = new Market();
        vm.prank(alice);
        vm.expectRevert();
        factory.setMarketImplementation(address(next));
        factory.setMarketImplementation(address(next));
        assertEq(factory.marketImplementation(), address(next));
    }
}
```

Add a helper to `contracts/test/helpers/Fixtures.sol` so `OutcomeShares` can use the real factory as its registry:

```solidity
    /// @dev OutcomeShares.setRegistry is a one-shot key, so a test that uses the real
    ///      MarketFactory deploys a clean OutcomeShares instance.
    function _useFactoryAsRegistry(address factory_) internal {
        shares = new OutcomeShares("");
        shares.setRegistry(factory_);
        config.setAddress(ConfigKeys.OUTCOME_SHARES, address(shares));
    }
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd contracts && forge test --match-contract MarketFactoryTest
```
Expected: FAIL — `src/core/MarketFactory.sol` is not found.

- [ ] **Step 3: Implement `contracts/src/core/MarketFactory.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ConfigRegistry} from "./ConfigRegistry.sol";
import {ConfigKeys} from "./ConfigKeys.sol";
import {OutcomeShares} from "./OutcomeShares.sol";
import {Market} from "./Market.sol";
import {IMarket} from "../interfaces/IMarket.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";

/// @title MarketFactory
/// @notice Mints Market clones and acts as the registry OutcomeShares trusts.
/// @dev Creating a market requires an EIP-712 approval from the Curator agent. In P1 the
///      signer is a single address held in ConfigRegistry; P2 replaces it with an
///      AgentRegistry lookup without changing the shape of the signature.
contract MarketFactory is Initializable, Ownable2StepUpgradeable, UUPSUpgradeable, EIP712Upgradeable, IMarketRegistry {
    using SafeERC20 for IERC20;

    bytes32 public constant MARKET_APPROVAL_TYPEHASH = keccak256(
        "MarketApproval(bytes32 specRoot,uint64 tradingEnd,uint64 settlementDeadline,uint8 tier,uint256 creatorAgentId,bytes32 category,address creator,uint256 nonce)"
    );

    ConfigRegistry public config;
    OutcomeShares public shares;
    address public marketImplementation;

    mapping(address => bool) public isMarket;
    mapping(bytes32 => bool) public usedApprovals;
    address[] internal _markets;

    error BadCuratorSignature();
    error ApprovalAlreadyUsed();
    error ProtocolPaused();
    error ZeroAddress();

    event MarketCreated(
        address indexed market,
        address indexed creator,
        uint256 indexed creatorAgentId,
        bytes32 specRoot,
        uint256 seed,
        uint8 tier
    );
    event MarketImplementationSet(address indexed implementation);

    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address config_, address shares_, address marketImpl_) external initializer {
        __Ownable_init(owner_);
        __Ownable2Step_init();
        __UUPSUpgradeable_init();
        __EIP712_init("Brier", "1");
        if (config_ == address(0) || shares_ == address(0) || marketImpl_ == address(0)) revert ZeroAddress();
        config = ConfigRegistry(config_);
        shares = OutcomeShares(shares_);
        marketImplementation = marketImpl_;
        emit MarketImplementationSet(marketImpl_);
    }

    function setMarketImplementation(address impl) external onlyOwner {
        if (impl == address(0)) revert ZeroAddress();
        marketImplementation = impl;
        emit MarketImplementationSet(impl);
    }

    /// @notice Exposed so that an off-chain signer (the Curator agent) can compute exactly the
    ///         same digest without having to guess the domain separator.
    function hashTypedData(bytes32 structHash) external view returns (bytes32) {
        return _hashTypedDataV4(structHash);
    }

    function createMarket(
        IMarket.Params calldata p,
        uint256 seedTokens,
        uint256 depositTokens,
        uint256 nonce,
        bytes calldata curatorSig
    ) external returns (address market) {
        if (config.paused()) revert ProtocolPaused();

        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    MARKET_APPROVAL_TYPEHASH,
                    p.specRoot,
                    p.tradingEnd,
                    p.settlementDeadline,
                    p.tier,
                    p.creatorAgentId,
                    p.category,
                    p.creator,
                    nonce
                )
            )
        );
        if (usedApprovals[digest]) revert ApprovalAlreadyUsed();
        if (ECDSA.recover(digest, curatorSig) != config.addresses(ConfigKeys.CURATOR_SIGNER)) {
            revert BadCuratorSignature();
        }
        usedApprovals[digest] = true;

        market = Clones.clone(marketImplementation);
        // Registration MUST precede initialize: Market emits events and, from the
        // first trade onward, calls into the OutcomeShares that consults this registry.
        isMarket[market] = true;
        _markets.push(market);

        IERC20(p.collateral).safeTransferFrom(msg.sender, market, seedTokens + depositTokens);
        Market(market).initialize(address(config), address(shares), p, seedTokens, depositTokens);

        emit MarketCreated(market, p.creator, p.creatorAgentId, p.specRoot, seedTokens, p.tier);
    }

    function marketCount() external view returns (uint256) {
        return _markets.length;
    }

    function marketAt(uint256 index) external view returns (address) {
        return _markets[index];
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
```

- [ ] **Step 4: Perluas `contracts/script/Deploy.s.sol`**

Inside `run()`, after `DeployLib.applyDefaults(...)` and before `vm.stopBroadcast()`:

```solidity
        OutcomeShares sharesContract = new OutcomeShares("https://brier.0g/{id}.json");
        Market marketImpl = new Market();

        MarketFactory factoryImpl = new MarketFactory();
        MarketFactory factory = MarketFactory(
            address(
                new ERC1967Proxy(
                    address(factoryImpl),
                    abi.encodeCall(
                        MarketFactory.initialize,
                        (deployer, address(config), address(sharesContract), address(marketImpl))
                    )
                )
            )
        );
        sharesContract.setRegistry(address(factory));
        config.setAddress(ConfigKeys.MARKET_FACTORY, address(factory));
        config.setAddress(ConfigKeys.OUTCOME_SHARES, address(sharesContract));
        config.setAddress(ConfigKeys.TREASURY, deployer);
        config.setAddress(ConfigKeys.CURATOR_SIGNER, deployer);
```

And in `_writeManifest`, add before the `MockUSDC` line (which stays the last `vm.serializeAddress`):

```solidity
        vm.serializeAddress(contractsKey, "OutcomeShares", address(sharesContract));
        vm.serializeAddress(contractsKey, "MarketImplementation", address(marketImpl));
        vm.serializeAddress(contractsKey, "MarketFactory", address(factory));
```

Change the `_writeManifest` signature to take all six addresses.

- [ ] **Step 5: Run them and confirm they pass**

```bash
cd contracts && forge test --match-contract MarketFactoryTest -vv
cd .. && timeout 90 bash scripts/demo-local.sh || true
cat deployments/31337.json
```
Expected: PASS — 7 lulus; manifest kini memuat enam alamat.

- [ ] **Step 6: Commit**

```bash
git add contracts/src/core/MarketFactory.sol contracts/script/Deploy.s.sol \
        contracts/test/helpers/Fixtures.sol contracts/test/unit/MarketFactory.t.sol deployments/
git commit -m "feat(contracts): MarketFactory with clones and EIP-712 curator approval"
```

---

## Task 18: The INV-1..10 invariant suite

**Files:**
- Create: `contracts/test/invariant/MarketHandler.sol`, `contracts/test/invariant/MarketInvariants.t.sol`
- Test: the files above

**Interfaces:**
- Consumes: all of `Market` (Task 11–16)
- Produces: the ten named invariants INV-1..10 from spec §14.1

**Two regimes.** `poolWad == costUp(q)` holds **only before resolution**. From `settle`/`fail`/`void` onward, `q` is frozen and `poolWad` shrinks as claims arrive. The invariants below separate the two regimes explicitly; conflating them would produce a wrong invariant.

- [ ] **Step 1: Write the handler**

Buat `contracts/test/invariant/MarketHandler.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {Market} from "../../src/core/Market.sol";
import {MockUSDC} from "../../src/mocks/MockUSDC.sol";
import {OutcomeShares} from "../../src/core/OutcomeShares.sol";

/// @notice Runs bounded random actions against a single Market and records ghost
///         variables for the conservation checks. Every call is wrapped in try/catch
///         so a legitimate revert (slippage, insufficient balance) does not stop the run.
contract MarketHandler is CommonBase, StdCheats, StdUtils {
    Market public immutable market;
    MockUSDC public immutable usdc;
    OutcomeShares public immutable shares;

    address[3] public actors;
    address internal currentActor;

    uint256 public ghostTokensIn;
    uint256 public ghostTokensOut;
    uint256 public callsBuy;
    uint256 public callsSell;
    uint256 public callsAddLiq;
    uint256 public callsRemoveLiq;

    constructor(Market m, MockUSDC u, OutcomeShares s, address[3] memory a) {
        market = m;
        usdc = u;
        shares = s;
        actors = a;
        for (uint256 i = 0; i < 3; ++i) {
            usdc.mintTo(a[i], 100_000_000e6);
            vm.prank(a[i]);
            usdc.approve(address(m), type(uint256).max);
        }
    }

    modifier useActor(uint256 seed) {
        currentActor = actors[seed % 3];
        vm.startPrank(currentActor);
        _;
        vm.stopPrank();
    }

    function buy(uint256 actorSeed, uint256 outcomeSeed, uint256 amount) external useActor(actorSeed) {
        uint8 o = uint8(outcomeSeed % 2);
        amount = bound(amount, 1e15, 20_000e18);
        try market.buy(o, amount, type(uint256).max, currentActor) returns (uint256 paid) {
            ghostTokensIn += paid;
            ++callsBuy;
        } catch {}
    }

    function sell(uint256 actorSeed, uint256 outcomeSeed, uint256 amount) external useActor(actorSeed) {
        uint8 o = uint8(outcomeSeed % 2);
        uint256 held = shares.balanceOfOutcome(currentActor, address(market), o);
        if (held == 0) return;
        amount = bound(amount, 1, held);
        try market.sell(o, amount, 0, currentActor) returns (uint256 got) {
            ghostTokensOut += got;
            ++callsSell;
        } catch {}
    }

    function addLiquidity(uint256 actorSeed, uint256 amount) external useActor(actorSeed) {
        amount = bound(amount, 1e6, 500_000e6);
        try market.addLiquidity(amount, 0, currentActor) {
            ++callsAddLiq;
        } catch {}
    }

    function removeLiquidity(uint256 actorSeed, uint256 lambda) external useActor(actorSeed) {
        lambda = bound(lambda, 1e14, 5e17);
        try market.removeLiquidity(lambda, 0, currentActor) returns (uint256 got) {
            ghostTokensOut += got;
            ++callsRemoveLiq;
        } catch {}
    }

    function warpForward(uint256 secondsAhead) external {
        vm.warp(block.timestamp + bound(secondsAhead, 1, 6 hours));
    }
}
```

- [ ] **Step 2: Write the invariant tests**

Buat `contracts/test/invariant/MarketInvariants.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "../helpers/Fixtures.sol";
import {MarketHandler} from "./MarketHandler.sol";
import {Market} from "../../src/core/Market.sol";
import {IMarket} from "../../src/interfaces/IMarket.sol";
import {DPMMath} from "../../src/math/DPMMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract MarketInvariantsTest is Fixtures {
    Market internal m;
    MarketHandler internal handler;
    address internal carol = makeAddr("carol");

    function setUp() public {
        _deployBase();
        m = _newMarket(SEED);
        handler = new MarketHandler(m, usdc, shares, [alice, bob, carol]);
        targetContract(address(handler));
    }

    /// INV-1 — pool selalu persis costUp(q) sebelum resolusi.
    function invariant_INV1_poolEqualsCostUp() public view {
        if (m.status() != IMarket.Status.Open && m.status() != IMarket.Status.Closed) return;
        assertEq(m.poolWad(), DPMMath.costUp(m.qArray()));
    }

    /// INV-2 — the collateral held always covers the pool, the fees, and the deposit.
    function invariant_INV2_collateralCoversObligations() public view {
        assertGe(usdc.balanceOf(address(m)), m.collateralOwed());
    }

    /// INV-6 — the seed floor is never breached, so qᵢ is never zero.
    function invariant_INV6_seedFloorHolds() public view {
        uint256[2] memory q = m.qArray();
        uint256[2] memory seedSup = m.seedSupply();
        uint256[2] memory creatorS = m.creatorSeed();
        for (uint256 i = 0; i < 2; ++i) {
            assertGe(q[i], seedSup[i]);
            assertGe(seedSup[i], creatorS[i]);
            assertGt(creatorS[i], 0);
        }
    }

    /// INV-8 — the probabilities sum to one within dust.
    function invariant_INV8_probabilitiesSumToOne() public view {
        uint256 sum = m.probability(0) + m.probability(1);
        assertLe(sum, 1e18);
        assertLe(1e18 - sum, 2);
    }

    /// INV-3 & INV-4 — claims never exceed the pool; liquidation exhausts it.
    function test_INV3_INV4_claimsNeverExceedPool() public {
        _fund(alice, 1_000_000e6, address(m));
        vm.prank(alice);
        m.buy(1, 800e18, type(uint256).max, alice);

        uint256 poolTokens = usdc.balanceOf(address(m)) - m.feeAccrued() - m.settlementDeposit();
        vm.warp(m.settlementDeadline());
        m.fail();

        vm.prank(alice);
        uint256 a = m.liquidate(alice);
        vm.prank(creator);
        uint256 c = m.liquidate(creator);

        assertLe(a + c, poolTokens);
        assertLe(m.poolWad(), 4); // only Euler dust left
    }

    /// INV-5 — buying then immediately selling never profits.
    function testFuzz_INV5_roundTripNeverProfits(uint64 amount, uint256 outcomeSeed) public {
        vm.assume(amount > 1e15 && amount < 1e22);
        uint8 o = uint8(outcomeSeed % 2);
        _fund(alice, 100_000_000e6, address(m));
        uint256 before = usdc.balanceOf(alice);

        vm.startPrank(alice);
        m.buy(o, uint256(amount), type(uint256).max, alice);
        m.sell(o, uint256(amount), 0, alice);
        vm.stopPrank();

        assertLe(usdc.balanceOf(alice), before);
    }

    /// INV-7 — the creator's loss never exceeds 1 − 1/√2 ≈ 29.29% of the seed.
    ///         Worst case: the entire order flow onto one side, and then that side wins.
    function testFuzz_INV7_creatorLossBounded(uint96 flow) public {
        vm.assume(flow > 1e18 && flow < 1e24);
        _fund(alice, 100_000_000e6, address(m));
        vm.prank(alice);
        try m.buy(1, uint256(flow), type(uint256).max, alice) {} catch { return; }

        vm.warp(m.tradingEnd());
        m.close();
        vm.prank(resolutionModule);
        m.settle(1); // the side bought into so heavily is the one that wins

        vm.prank(creator);
        uint256 back = m.redeem(creator);
        assertGe(back, (SEED * 7070) / 10_000);
    }

    /// INV-9 — a proportional liquidity addition does not move the probability.
    function testFuzz_INV9_addLiquidityIsNeutral(uint64 tradeSize, uint64 lpSize) public {
        vm.assume(tradeSize > 1e18 && tradeSize < 1e22);
        vm.assume(lpSize >= 10e6 && lpSize <= 1_000_000e6);
        _fund(alice, 100_000_000e6, address(m));
        _fund(bob, 100_000_000e6, address(m));

        vm.prank(alice);
        m.buy(1, uint256(tradeSize), type(uint256).max, alice);
        uint256 before = m.probability(1);

        vm.prank(bob);
        m.addLiquidity(uint256(lpSize), 0, bob);

        uint256 nowProb = m.probability(1);
        uint256 diff = nowProb > before ? nowProb - before : before - nowProb;
        assertLe(diff, 1e9);
    }

    /// INV-10 — the pause never closes any exit.
    function test_INV10_exitsAlwaysWorkWhilePaused() public {
        _fund(alice, 1_000_000e6, address(m));
        _fund(bob, 1_000_000e6, address(m));
        vm.prank(alice);
        m.buy(1, 300e18, type(uint256).max, alice);
        vm.prank(bob);
        m.addLiquidity(500e6, 0, bob);

        vm.prank(guardian);
        config.pause();

        vm.prank(alice);
        assertGt(m.sell(1, 100e18, 0, alice), 0);
        vm.prank(bob);
        assertGt(m.removeLiquidity(1e16, 0, bob), 0);

        vm.warp(m.tradingEnd());
        m.close();
        vm.prank(resolutionModule);
        m.settle(1);
        vm.prank(alice);
        assertGt(m.redeem(alice), 0);
    }
}
```

- [ ] **Step 3: Run the invariant suite**

```bash
cd contracts && forge test --match-path 'test/invariant/*' -vv
```
Expected: PASS — 4 invariants + 5 directed tests.

- [ ] **Step 4: Run it at CI intensity**

```bash
cd contracts && FOUNDRY_PROFILE=ci forge test --match-path 'test/invariant/*' -vv
```
Expected: PASS — 512 runs × depth 128. If anything fails, Foundry prints a reproducing call sequence; **do not loosen the invariant — fix the contract.**

- [ ] **Step 5: Commit**

```bash
git add contracts/test/invariant
git commit -m "test: the INV-1..10 invariant suite for the DPM market engine"
```

---

## Task 19: Tightening CI and the coverage gate

**Files:**
- Modify: `.github/workflows/ci.yml`, `Makefile`

**Interfaces:**
- Consumes: all of the preceding tasks
- Produces: a CI that rejects non-deterministic vectors and falling coverage

- [ ] **Step 1: Update `.github/workflows/ci.yml`**

```yaml
name: ci
on: [push, pull_request]

jobs:
  contracts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: foundry-rs/foundry-toolchain@v1
        with: { version: stable }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci

      - name: format
        run: cd contracts && forge fmt --check

      - name: build (default)
        run: cd contracts && forge build

      - name: build (prod, via_ir)
        run: cd contracts && FOUNDRY_PROFILE=prod forge build

      # The vectors must be deterministic: re-running the generator must not
      # produce a diff. If it changes, one side of the mirror has shifted.
      - name: vektor DPM deterministik
        run: |
          npm run gen:vectors
          git diff --exit-code contracts/test/vectors/dpm.json

      - name: test (profil ci)
        run: cd contracts && FOUNDRY_PROFILE=ci forge test -vvv

      - name: coverage gate on core
        run: |
          cd contracts
          forge coverage --report lcov --no-match-coverage 'test|script|mocks'
          npx --yes lcov-summary lcov.info || true
          awk -F: '/^SF:.*src\/(core|math)\//{f=1} f&&/^LF:/{lf+=$2} f&&/^LH:/{lh+=$2; f=0} END{
            pct = (lf>0) ? lh*100/lf : 0;
            printf "core+math line coverage: %.2f%% (%d/%d)\n", pct, lh, lf;
            if (pct < 90) { print "FAIL: coverage below 90%"; exit 1 }
          }' lcov.info

  typescript:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm test --workspaces --if-present
      - run: npm run build --workspaces --if-present
```

- [ ] **Step 2: Add target `Makefile`**

```makefile
coverage:
	cd contracts && forge coverage --report summary --no-match-coverage 'test|script|mocks'

ci:
	cd contracts && forge fmt --check && forge build && FOUNDRY_PROFILE=prod forge build
	npm run gen:vectors && git diff --exit-code contracts/test/vectors/dpm.json
	cd contracts && FOUNDRY_PROFILE=ci forge test -vvv
	npm test --workspaces --if-present
```

Add `coverage ci` to the `.PHONY` line.

- [ ] **Step 3: Run the full gate locally**

```bash
make ci
make coverage
```
Expected: all green; line coverage of `src/core` + `src/math` ≥ 90%.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml Makefile
git commit -m "chore(ci): the via_ir gate, vector determinism, and 90% coverage on core"
```

**✅ P1 done.** One binary market can be created through the factory, traded in both directions, deepened with liquidity, closed, settled or failed, and redeemed in full — with ten invariants guarding it under stateful fuzz.

---

## Appendix A — The spec coverage map

Every part of the spec that falls within P0/P1 scope is mapped to the task implementing it.

| Spec section | Contents | Task |
|---|---|---|
| §2 D1, D2 | DPM sebagai mekanisme harga; mUSDC 6 desimal + wad internal | 3, 6–8, 11 |
| §3.1 | Fakta chain Galileo/mainnet | 2 (`networks.ts`), 1 (`foundry.toml`) |
| §4.1–4.2 | Cost function, harga, probabilitas, Euler, homogenitas | 6, 7 |
| §4.3 | Contoh angka & relasi `L ↔ q` | 11 (`seedShares`) |
| §4.4 | The rounding policy, the pool set to `costUp`, dust rejected | 6, 12, 13 |
| §5.1 | The status enum and the per-status operation table | 15 |
| §6.1 | Contract map & the upgradeable / fund-holding split | 4, 10, 11, 17 |
| §6.2 | `DPMMath` lengkap termasuk `sharesForSpend` bentuk tertutup | 6, 7, 8 |
| §6.3 | `IMarket`, seed vs tradable shares, fees outside the invariant, the guardian | 11–16 |
| §6.4 | `MarketFactory.createMarket` + tanda tangan kurator | 17 |
| §12.1 | Tiga saklar mode + pemeriksaan silang | 2 |
| §12.2–12.3 | Env and the deployment manifest | 5 |
| §12.4 | Repo structure | 1 |
| §13.1 | Contract risk table: reentrancy, collateral allowlist, precision, overflow, `q=0`, front-running, `close()`, sweep, pause | 4, 12 (Step 5), 13–16, 18 |
| §13.3 | Immutable vs UUPS, kewenangan guardian sempit | 4, 11, 17 |
| §14.1 | INV-1..10 | 18 |
| §14.2 L1–L2 | Unit tests, invariants, the differential test, the coverage gate | 6–18, 19 |
| §17 | The default parameter table and the hard bounds | 5 |

**Parts of the spec deliberately OUT of scope here** (and the phase that owns them):
§7 resolution module → P2 · §8 agent layer, `AgentAccount`, ERC-7857 → P4 · §9 indexer → P3 ·
§10 SDK → P3 · §11 frontend → P5 · §13.2 keamanan ekonomi resolusi → P2 · §14.2 L3–L6 → P3–P6.

Seam points already prepared for the next phases:
`ConfigKeys.RESOLUTION_MODULE` (P2 replaces the test EOA with a real contract) ·
`ConfigKeys.CURATOR_SIGNER` (P2 replaces the single address with an `AgentRegistry` lookup) ·
`ConfigKeys.TREASURY` (P4) · the `Trade` event deliberately carries no `agentId`, because agent
attribution is emitted by `AgentAccount`, not by the market.

---

## Lampiran B — Ringkasan gerbang

| Command | When | Must |
|---|---|---|
| `make fmt-check` | tiap commit | bersih |
| `make build` | tiap commit | sukses |
| `make prod` | every commit | succeeds (catches code that only works without `via_ir`) |
| `make test` | every commit | all green |
| `make vectors && git diff --exit-code` | every commit touching the DPM maths | no diff |
| `make invariant` | after Task 18 | INV-1..10 green at 512×128 |
| `make coverage` | setelah Task 19 | `src/core` + `src/math` ≥ 90% baris |
| `make demo` | after Task 5 and Task 17 | the manifest is written, the addresses printed |
