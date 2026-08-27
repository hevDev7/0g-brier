# 0G-Delphi P0 + P1 — Fondasi & Inti Market DPM

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun monorepo 0G-Delphi beserta mesin pasar DPM on-chain yang terbukti solven — sampai satu market biner bisa dibuat, diperdagangkan, ditutup, diselesaikan, dan ditebus sepenuhnya di anvil lokal, dijaga oleh sepuluh invarian stateful-fuzz.

**Architecture:** Kontrak Foundry di `contracts/` dengan `Market` sebagai clone EIP-1167 immutable yang memegang dana, dan `ConfigRegistry`/`MarketFactory` sebagai UUPS di belakangnya. Harga dibentuk cost function pari-mutuel dinamis `C(q) = √(q₀² + q₁²)`; kas pool **disetel** ke `costUp(q)` di setiap operasi, bukan diakumulasi, sehingga solvabilitas berlaku by construction. Paket TypeScript `packages/protocol` menyimpan cermin DPM, konversi satuan, dan saklar mode; cermin itu menghasilkan vektor uji yang diverifikasi ulang oleh Solidity (uji diferensial).

**Tech Stack:** Foundry (forge 1.5.1-stable) · Solidity 0.8.28 · OpenZeppelin Contracts 5.4.0 + Contracts-Upgradeable 5.4.0 · Node 22 + npm workspaces · TypeScript 5 + vitest · anvil · GitHub Actions

**Spec:** `docs/superpowers/specs/2026-08-27-0g-delphi-design.md`

---

## Global Constraints

Setiap tugas di bawah tunduk pada seluruh butir ini.

- **Solidity 0.8.28**, `evm_version = "cancun"` (terbukti deploy ke Galileo 16602 di proyek `0g-Umbra`).
- **Semua matematika DPM dalam wad (1e18).** Collateral 6 desimal; konversi hanya terjadi di batas token.
- **`WAD = 1e18`, `MAX_Q = 1e33`.** Setiap mutasi `q` wajib menegakkan `qᵢ ≤ MAX_Q` (`2·(1e33)² = 2e66 < 2²⁵⁶`).
- **Lembar seed diturunkan lewat kuadrat, bukan lewat konstanta √2:** `q₀ = ⌊√(⌊seedWad²/2⌋)⌋`. Membagi dengan `⌊√2·1e18⌋` menghasilkan `q₀` yang terlalu besar dan membuat pool menuntut lebih banyak collateral daripada yang disetor (Task 11).
- **Pembulatan selalu berpihak pada pool:** dana masuk `ceilDiv`, dana keluar pembagian floor, `poolWad` selalu `costUp` (sqrt dibulatkan ke atas).
- **Kontrak pemegang dana tidak pernah upgradeable:** `Market`, `OutcomeShares`. Yang UUPS hanya `ConfigRegistry` dan `MarketFactory`.
- **Pause tidak pernah memblokir jalan keluar.** `sell`, `redeem`, `liquidate` wajib tetap berhasil saat `paused == true`. Ini diuji, bukan diasumsikan.
- **Tidak ada `unchecked`** di jalur aritmetika DPM. Gas bukan prioritas P1; kebenaran adalah.
- **Tidak ada angka ajaib di kontrak.** Semua parameter dibaca dari `ConfigRegistry`.
- **Setiap tugas berakhir dengan commit.** Pesan commit memakai awalan Conventional Commits (`feat:`, `test:`, `chore:`, `fix:`).
- **Semua uji harus hijau sebelum commit.** `forge test` untuk Solidity, `npm test -ws` untuk TypeScript.

### Dua penyimpangan dari spec (disengaja, sudah diverifikasi)

| Spec | Rencana | Alasan |
|---|---|---|
| §6.3 `removeLiquidity(uint256[2] seedShares, ...)` | `removeLiquidity(uint256 lambdaWad, ...)`, penarikan **proporsional terhadap `q` saat ini** | Penarikan tak-proporsional adalah perdagangan berarah **tanpa fee** — lubang arbitrase. Penarikan proporsional netral terhadap probabilitas, cerminan persis `addLiquidity`. |
| §6.3 `id = marketId<<8 \| outcome` | `id = uint256(uint160(market))<<8 \| outcome` | ID diturunkan dari `msg.sender` ⇒ sebuah market **secara struktural** hanya bisa mencetak/membakar id miliknya sendiri. Otorisasi jadi sifat aritmetika, bukan daftar izin. |

Spec dimutakhirkan agar cocok sebelum tugas mana pun dieksekusi (Task 0).

---

## Struktur Berkas

```
0g-delphi/
├─ package.json                              npm workspaces akar
├─ Makefile                                  jalan pintas: build, test, fmt, deploy, demo
├─ .github/workflows/ci.yml                  gerbang CI
├─ contracts/
│  ├─ foundry.toml
│  ├─ remappings.txt
│  ├─ src/
│  │  ├─ math/DPMMath.sol                    cost/costUp/price/probability/sharesForSpend  (murni)
│  │  ├─ core/ConfigKeys.sol                 kunci bytes32 untuk parameter & alamat
│  │  ├─ core/ConfigRegistry.sol             parameter + alamat + guardian + pause (UUPS)
│  │  ├─ core/OutcomeShares.sol              ERC-1155 posisi tradable
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
│  └─ script/Deploy.s.sol                    deploy + tulis deployments/<chainId>.json
├─ packages/protocol/
│  ├─ src/{units,modes,networks,deployments,dpm,index}.ts
│  ├─ test/{units,modes,dpm,deployments}.test.ts
│  └─ scripts/gen-vectors.ts                 menulis contracts/test/vectors/dpm.json
├─ scripts/demo-local.sh                     anvil → deploy → seed → cetak alamat
└─ deployments/<chainId>.json
```

**Batas tanggung jawab.** `DPMMath` murni dan tidak tahu apa pun soal token, status, atau fee. `Market` tahu satu market dan tidak tahu apa pun soal market lain. `OutcomeShares` hanya tahu kepemilikan. `ConfigRegistry` hanya menyimpan angka dan alamat. Tidak ada berkas yang melintasi dua tanggung jawab ini.

---

## Task 0: Selaraskan spec dengan dua penyimpangan

**Files:**
- Modify: `docs/superpowers/specs/2026-08-27-0g-delphi-design.md`

**Interfaces:**
- Consumes: —
- Produces: spec yang cocok dengan kode yang akan ditulis Task 10 dan Task 13.

- [ ] **Step 1: Perbaiki tanda tangan `removeLiquidity` di §6.3**

Ganti baris pada blok `interface IMarket`:

```solidity
    function removeLiquidity(uint256[2] calldata seedShares, uint256 minTokensOut, address to)
        external returns (uint256 tokensOut);   // hanya bila Status == Open
```

menjadi:

```solidity
    /// @param lambdaWad fraksi wad dari q saat ini yang ditarik; penarikan[i] = q[i]*lambdaWad/WAD.
    ///        Proporsional ⇒ netral terhadap probabilitas. Penarikan tak-proporsional dilarang
    ///        karena setara perdagangan berarah tanpa fee.
    function removeLiquidity(uint256 lambdaWad, uint256 minTokensOut, address to)
        external returns (uint256 tokensOut);   // hanya bila Status == Open
```

- [ ] **Step 2: Perbaiki skema id ERC-1155 di §6.1**

Ganti sel tabel `OutcomeShares`:

```
| `OutcomeShares` | ERC-1155 posisi tradable, `id = marketId<<8 \| outcome` | singleton | Tidak |
```

menjadi:

```
| `OutcomeShares` | ERC-1155 posisi tradable, `id = uint160(market)<<8 \| outcome` — market hanya bisa menyentuh id miliknya sendiri | singleton | Tidak |
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-27-0g-delphi-design.md
git commit -m "docs: removeLiquidity proporsional + id ERC-1155 diturunkan dari alamat market"
```

---

## Task 1: Kerangka monorepo, Foundry, dan CI

**Files:**
- Create: `package.json`, `Makefile`, `.github/workflows/ci.yml`
- Create: `contracts/foundry.toml`, `contracts/remappings.txt`, `contracts/test/helpers/Sanity.t.sol`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: —
- Produces: `forge test` dan `npm test -ws` yang bisa dijalankan; remapping `forge-std/`, `@openzeppelin/contracts/`, `@openzeppelin/contracts-upgradeable/`.

- [ ] **Step 1: Tulis uji kewarasan yang gagal**

Buat `contracts/test/helpers/Sanity.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev Membuktikan toolchain terpasang benar: forge-std terhubung, dan OZ Math
///      menyediakan sqrt dengan mode pembulatan — dasar seluruh DPMMath.
contract SanityTest is Test {
    function test_ozSqrtSupportsRounding() public pure {
        assertEq(Math.sqrt(2, Math.Rounding.Floor), 1);
        assertEq(Math.sqrt(2, Math.Rounding.Ceil), 2);
        assertEq(Math.sqrt(4, Math.Rounding.Ceil), 2);
    }

    function test_ozMulDivHandles512Bit() public pure {
        // 1e66 * 1e18 melebihi uint256 bila dikalikan langsung; mulDiv harus tetap benar.
        uint256 big = 1e33 * 1e33;
        assertEq(Math.mulDiv(big, 1e18, big), 1e18);
    }
}
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
cd contracts && forge test
```
Expected: FAIL — `forge-std/Test.sol` tidak ditemukan (belum ada `lib/`, belum ada `foundry.toml`).

- [ ] **Step 3: Tulis `contracts/foundry.toml`**

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

# Profil rilis: via_ir menyala. CI wajib membangun profil ini agar
# "kompilasi hanya berhasil tanpa via_ir" tidak pernah lolos diam-diam.
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

- [ ] **Step 4: Tulis `contracts/remappings.txt`**

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

Bila jaringan tidak tersedia, salin dari proyek tetangga yang sudah punya:
```bash
cp -r /home/mdlog/Project-MDlabs/Akindo/0g-Umbra/contracts/lib/forge-std contracts/lib/
cp -r /home/mdlog/Project-MDlabs/Akindo/0g-Umbra/contracts/lib/openzeppelin-contracts contracts/lib/
```

- [ ] **Step 6: Jalankan uji dan pastikan lulus**

```bash
cd contracts && forge test -vv
```
Expected: PASS — 2 lulus.

- [ ] **Step 7: Tulis `package.json` akar**

```json
{
  "name": "0g-delphi",
  "version": "0.1.0",
  "private": true,
  "description": "Agent-native binary prediction market di 0G Chain — DPM pricing, komite resolver ber-TEE.",
  "workspaces": ["packages/*"],
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "gen:vectors": "npm run gen:vectors -w @0g-delphi/protocol"
  }
}
```

- [ ] **Step 8: Tulis `Makefile`**

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

- [ ] **Step 9: Tulis `.github/workflows/ci.yml`**

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

- [ ] **Step 10: Perbarui `.gitignore`**

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

- [ ] **Step 11: Jalankan seluruh gerbang**

```bash
make fmt && make build && make prod && make test
```
Expected: semuanya lulus; `forge test` melaporkan 2 lulus, npm melaporkan tidak ada workspace (belum ada).

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: kerangka monorepo, Foundry, dan CI"
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

- [ ] **Step 1: Tulis uji yang gagal untuk konversi satuan**

Buat `packages/protocol/test/units.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { WAD, scaleFor, toWad, toTokensFloor, toTokensCeil } from '../src/units.js';

describe('units', () => {
  it('WAD adalah 1e18', () => {
    expect(WAD).toBe(1_000_000_000_000_000_000n);
  });

  it('scaleFor memetakan desimal ke pengali wad', () => {
    expect(scaleFor(6)).toBe(10n ** 12n);
    expect(scaleFor(18)).toBe(1n);
    expect(scaleFor(0)).toBe(10n ** 18n);
  });

  it('scaleFor menolak desimal di luar jangkauan', () => {
    expect(() => scaleFor(19)).toThrow(RangeError);
    expect(() => scaleFor(-1)).toThrow(RangeError);
  });

  it('toWad menaikkan skala token 6 desimal', () => {
    expect(toWad(1_000_000n, 6)).toBe(WAD);
  });

  it('toTokensFloor membulatkan ke bawah, toTokensCeil ke atas', () => {
    const almostOne = WAD - 1n;
    expect(toTokensFloor(almostOne, 6)).toBe(999_999n);
    expect(toTokensCeil(almostOne, 6)).toBe(1_000_000n);
    expect(toTokensFloor(WAD, 6)).toBe(1_000_000n);
    expect(toTokensCeil(WAD, 6)).toBe(1_000_000n);
  });

  it('toTokensCeil(0) adalah 0, bukan 1', () => {
    expect(toTokensCeil(0n, 6)).toBe(0n);
  });

  it('menolak nilai negatif', () => {
    expect(() => toWad(-1n, 6)).toThrow(RangeError);
    expect(() => toTokensFloor(-1n, 6)).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
cd packages/protocol && npx vitest run
```
Expected: FAIL — modul `../src/units.js` tidak ditemukan.

- [ ] **Step 3: Buat konfigurasi paket**

`packages/protocol/package.json`:

```json
{
  "name": "@0g-delphi/protocol",
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

Lalu pasang: `npm install` dari akar repo.

- [ ] **Step 4: Implementasikan `src/units.ts`**

```ts
/** Semua matematika DPM memakai wad (1e18). Collateral memakai desimalnya sendiri (6 untuk mUSDC).
 *  Konversi HANYA terjadi di batas token — tidak pernah di tengah perhitungan. */
export const WAD = 10n ** 18n;

const MAX_DECIMALS = 18;

function assertNonNegative(v: bigint, label: string): void {
  if (v < 0n) throw new RangeError(`${label} tidak boleh negatif: ${v}`);
}

/** Pengali dari satuan token ke wad. 6 desimal → 1e12. */
export function scaleFor(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new RangeError(`desimal tidak didukung: ${decimals} (harus bilangan bulat 0..18)`);
  }
  return 10n ** BigInt(MAX_DECIMALS - decimals);
}

export function toWad(tokens: bigint, decimals: number): bigint {
  assertNonNegative(tokens, 'tokens');
  return tokens * scaleFor(decimals);
}

/** Dana KELUAR: selalu dibulatkan ke bawah agar pool tidak pernah kekurangan. */
export function toTokensFloor(wad: bigint, decimals: number): bigint {
  assertNonNegative(wad, 'wad');
  return wad / scaleFor(decimals);
}

/** Dana MASUK: selalu dibulatkan ke atas agar pool tidak pernah kekurangan. */
export function toTokensCeil(wad: bigint, decimals: number): bigint {
  assertNonNegative(wad, 'wad');
  const s = scaleFor(decimals);
  return (wad + s - 1n) / s;
}
```

- [ ] **Step 5: Jalankan dan pastikan lulus**

```bash
cd packages/protocol && npx vitest run test/units.test.ts
```
Expected: PASS — 7 lulus.

- [ ] **Step 6: Tulis uji yang gagal untuk saklar mode**

Buat `packages/protocol/test/modes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadModes } from '../src/modes.js';

describe('loadModes', () => {
  it('default aman: anvil + memory + stub', () => {
    expect(loadModes({})).toEqual({ chain: 'anvil', storage: 'memory', inference: 'stub' });
  });

  it('membaca ketiga saklar dari env', () => {
    expect(loadModes({ CHAIN_MODE: 'galileo', STORAGE_MODE: 'real', INFERENCE_MODE: 'compute' }))
      .toEqual({ chain: 'galileo', storage: 'real', inference: 'compute' });
  });

  it('menolak nilai tak dikenal dan menyebutkan yang diizinkan', () => {
    expect(() => loadModes({ CHAIN_MODE: 'sepolia' })).toThrow(/anvil, galileo, mainnet/);
  });

  it('menolak inferensi stub di mainnet', () => {
    expect(() => loadModes({ CHAIN_MODE: 'mainnet', STORAGE_MODE: 'real', INFERENCE_MODE: 'stub' }))
      .toThrow(/INFERENCE_MODE=stub/);
  });

  it('menolak penyimpanan memory di luar anvil', () => {
    expect(() => loadModes({ CHAIN_MODE: 'galileo', STORAGE_MODE: 'memory' }))
      .toThrow(/STORAGE_MODE=memory/);
  });

  it('mengizinkan router di galileo', () => {
    expect(loadModes({ CHAIN_MODE: 'galileo', STORAGE_MODE: 'file', INFERENCE_MODE: 'router' }))
      .toEqual({ chain: 'galileo', storage: 'file', inference: 'router' });
  });
});
```

- [ ] **Step 7: Jalankan dan pastikan gagal**

```bash
cd packages/protocol && npx vitest run test/modes.test.ts
```
Expected: FAIL — modul `../src/modes.js` tidak ditemukan.

- [ ] **Step 8: Implementasikan `src/modes.ts`**

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
  throw new Error(`${key}="${raw}" tidak dikenal; yang diizinkan: ${allowed.join(', ')}`);
}

/** Membaca ketiga saklar mode dan menegakkan kombinasi yang tidak boleh terjadi.
 *  Pemeriksaan silang di bawah ada supaya konfigurasi berbahaya gagal saat start,
 *  bukan saat sudah menyentuh dana sungguhan. */
export function loadModes(env: Env = process.env): Modes {
  const chain = pick(env, 'CHAIN_MODE', CHAIN_MODES, 'anvil');
  const storage = pick(env, 'STORAGE_MODE', STORAGE_MODES, 'memory');
  const inference = pick(env, 'INFERENCE_MODE', INFERENCE_MODES, 'stub');

  if (chain === 'mainnet' && inference === 'stub') {
    throw new Error('INFERENCE_MODE=stub dilarang saat CHAIN_MODE=mainnet: settlement tersimulasi tidak boleh menyentuh dana nyata');
  }
  if (chain !== 'anvil' && storage === 'memory') {
    throw new Error(`STORAGE_MODE=memory hanya untuk CHAIN_MODE=anvil; specRoot/receiptRoot harus dapat diambil ulang di ${chain}`);
  }
  return { chain, storage, inference };
}
```

- [ ] **Step 9: Jalankan dan pastikan lulus**

```bash
cd packages/protocol && npx vitest run test/modes.test.ts
```
Expected: PASS — 6 lulus.

- [ ] **Step 10: Tulis uji yang gagal untuk konfigurasi jaringan**

Buat `packages/protocol/test/networks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { networkFor } from '../src/networks.js';

describe('networkFor', () => {
  it('anvil memakai chain id 31337 dan RPC lokal', () => {
    const n = networkFor('anvil', {});
    expect(n.chainId).toBe(31337);
    expect(n.rpcUrl).toBe('http://127.0.0.1:8545');
    expect(n.explorer).toBeNull();
  });

  it('galileo memakai chain id 16602 dan explorer chainscan', () => {
    const n = networkFor('galileo', {});
    expect(n.chainId).toBe(16602);
    expect(n.rpcUrl).toBe('https://evmrpc-testnet.0g.ai');
    expect(n.explorer).toBe('https://chainscan-galileo.0g.ai');
  });

  it('mainnet memakai chain id 16661', () => {
    expect(networkFor('mainnet', {}).chainId).toBe(16661);
  });

  it('env menimpa RPC bawaan', () => {
    const n = networkFor('galileo', { ZERO_G_TESTNET_RPC: 'https://rpc.example' });
    expect(n.rpcUrl).toBe('https://rpc.example');
  });
});
```

- [ ] **Step 11: Implementasikan `src/networks.ts` dan `src/index.ts`**

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

- [ ] **Step 12: Jalankan seluruh uji paket**

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

## Task 3: `MockUSDC` — collateral 6 desimal dengan faucet

**Files:**
- Create: `contracts/src/mocks/MockUSDC.sol`
- Test: `contracts/test/unit/MockUSDC.t.sol`

**Interfaces:**
- Consumes: —
- Produces: `MockUSDC` — `decimals() → 6`, `claim()`, `mintTo(address,uint256)`, konstanta `FAUCET_AMOUNT = 10_000e6`, `FAUCET_COOLDOWN = 1 days`, error `FaucetCooldown(uint256 availableAt)`.

- [ ] **Step 1: Tulis uji yang gagal**

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

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
cd contracts && forge test --match-contract MockUSDCTest
```
Expected: FAIL — `src/mocks/MockUSDC.sol` tidak ditemukan.

- [ ] **Step 3: Implementasikan `contracts/src/mocks/MockUSDC.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC
/// @notice Collateral uji 6 desimal untuk 0G-Delphi. HANYA testnet/lokal.
/// @dev Sengaja 6 desimal, bukan 18: lapisan normalisasi desimal harus dilewati
///      setiap uji sejak hari pertama, agar bug penskalaan tidak muncul pertama kali
///      saat berpindah ke stablecoin sungguhan di mainnet.
contract MockUSDC is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 10_000e6;
    uint256 public constant FAUCET_COOLDOWN = 1 days;

    mapping(address => uint256) public lastClaim;

    error FaucetCooldown(uint256 availableAt);

    constructor() ERC20("0G-Delphi Mock USD", "mUSDC") {}

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

    /// @notice Cetak tanpa batas — hanya untuk penyiapan uji dan seeding demo.
    function mintTo(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

- [ ] **Step 4: Jalankan dan pastikan lulus**

```bash
cd contracts && forge test --match-contract MockUSDCTest -vv
```
Expected: PASS — 5 lulus.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/mocks/MockUSDC.sol contracts/test/unit/MockUSDC.t.sol
git commit -m "feat(contracts): MockUSDC 6 desimal dengan faucet ber-cooldown"
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

- [ ] **Step 1: Tulis uji yang gagal**

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

    /// @dev Sifat terpenting kontrak ini: batas tidak bisa dilonggarkan setelah dipasang.
    ///      Tanpa ini "batas keras" hanyalah saran, karena pemilik bisa menaikkannya.
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

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
cd contracts && forge test --match-contract ConfigRegistryTest
```
Expected: FAIL — `src/core/ConfigRegistry.sol` tidak ditemukan.

- [ ] **Step 3: Implementasikan `contracts/src/core/ConfigKeys.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ConfigKeys
/// @notice Kunci kanonik untuk ConfigRegistry. Tidak ada angka ajaib di kontrak lain.
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

- [ ] **Step 4: Implementasikan `contracts/src/core/ConfigRegistry.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title ConfigRegistry
/// @notice Satu-satunya sumber parameter, alamat, dan status pause protokol.
/// @dev Batas parameter DIKUNCI saat pertama dipasang dan tidak pernah bisa dilonggarkan.
///      Tanpa penguncian itu, "batas keras" hanya akan menjadi saran bagi pemilik.
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

    /// @notice Guardian boleh menghentikan cepat; hanya pemilik yang boleh menyalakan kembali.
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

- [ ] **Step 5: Jalankan dan pastikan lulus**

```bash
cd contracts && forge test --match-contract ConfigRegistryTest -vv
```
Expected: PASS — 9 lulus.

- [ ] **Step 6: Commit**

```bash
git add contracts/src/core/ConfigKeys.sol contracts/src/core/ConfigRegistry.sol contracts/test/unit/ConfigRegistry.t.sol
git commit -m "feat(contracts): ConfigRegistry dengan batas parameter terkunci permanen"
```

---

## Task 5: Skrip deploy, manifest deployment, dan demo lokal

**Files:**
- Create: `contracts/script/DeployLib.sol`, `contracts/script/Deploy.s.sol`
- Create: `packages/protocol/src/deployments.ts`, `scripts/demo-local.sh`
- Test: `contracts/test/unit/DeployDefaults.t.sol`, `packages/protocol/test/deployments.test.ts`
- Modify: `packages/protocol/src/index.ts`

**Interfaces:**
- Consumes: `ConfigRegistry`, `ConfigKeys`, `MockUSDC` (Task 3–4)
- Produces:
  - `DeployLib.applyDefaults(ConfigRegistry config, address collateral)` — memasang batas lalu nilai untuk seluruh parameter §17 spec
  - `deployments/<chainId>.json` dengan bentuk `{ chainId, deploymentBlock, deployedAt, contracts, params }`
  - TS: `interface DeploymentManifest`, `parseDeployment(raw: unknown, expectedChainId?: number): DeploymentManifest`, `loadDeployment(chainId: number, dir?: string): DeploymentManifest`, `requireContracts(m: DeploymentManifest, names: string[]): void`

- [ ] **Step 1: Tulis uji yang gagal untuk parameter bawaan**

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

    /// @dev Plafon fee adalah janji ke pengguna, bukan preferensi. Kunci membuktikannya.
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

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
cd contracts && forge test --match-contract DeployDefaultsTest
```
Expected: FAIL — `script/DeployLib.sol` tidak ditemukan.

- [ ] **Step 3: Implementasikan `contracts/script/DeployLib.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ConfigRegistry} from "../src/core/ConfigRegistry.sol";
import {ConfigKeys} from "../src/core/ConfigKeys.sol";

/// @title DeployLib
/// @notice Nilai bawaan protokol dari §17 spec. Dipisahkan dari skrip broadcast agar
///         bisa diuji langsung tanpa menyiarkan transaksi.
library DeployLib {
    uint128 internal constant UNBOUNDED = type(uint128).max;

    function applyDefaults(ConfigRegistry config, address collateral) internal {
        // Batas dipasang lebih dulu dan terkunci selamanya; nilai menyusul.
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

- [ ] **Step 4: Jalankan dan pastikan lulus**

```bash
cd contracts && forge test --match-contract DeployDefaultsTest -vv
```
Expected: PASS — 4 lulus.

- [ ] **Step 5: Implementasikan `contracts/script/Deploy.s.sol`**

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

/// @notice Deploy P0: MockUSDC + ConfigRegistry (di balik ERC1967Proxy) + parameter bawaan.
///         Task 16 memperluas skrip ini dengan OutcomeShares, Market impl, dan MarketFactory.
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

- [ ] **Step 6: Tulis uji yang gagal untuk pembaca manifest**

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
  it('menerima manifest yang sah', () => {
    const m = parseDeployment(valid);
    expect(m.chainId).toBe(16602);
    expect(m.contracts.ConfigRegistry).toBe('0x1111111111111111111111111111111111111111');
  });

  it('menolak ketidakcocokan chainId', () => {
    expect(() => parseDeployment(valid, 16661)).toThrow(/16661/);
  });

  it('menolak alamat yang tidak berbentuk 0x + 40 hex', () => {
    const bad = { ...valid, contracts: { ConfigRegistry: '0xnope' } };
    expect(() => parseDeployment(bad)).toThrow(/ConfigRegistry/);
  });

  it('menolak manifest tanpa contracts', () => {
    expect(() => parseDeployment({ chainId: 1, deploymentBlock: 0, deployedAt: 0 })).toThrow(/contracts/);
  });

  it('requireContracts menyebutkan yang hilang', () => {
    const m = parseDeployment(valid);
    expect(() => requireContracts(m, ['ConfigRegistry', 'MarketFactory'])).toThrow(/MarketFactory/);
    expect(() => requireContracts(m, ['ConfigRegistry'])).not.toThrow();
  });
});
```

- [ ] **Step 7: Implementasikan `packages/protocol/src/deployments.ts`**

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
    throw new Error(`manifest tidak sah: ${label} harus berupa objek`);
  }
  return v as Record<string, unknown>;
}

function asNumber(v: unknown, label: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`manifest tidak sah: ${label} harus berupa angka`);
  }
  return v;
}

export function parseDeployment(raw: unknown, expectedChainId?: number): DeploymentManifest {
  const obj = asRecord(raw, 'manifest');
  const chainId = asNumber(obj.chainId, 'chainId');
  if (expectedChainId !== undefined && chainId !== expectedChainId) {
    throw new Error(`manifest untuk chainId ${chainId}, tetapi ${expectedChainId} yang diminta`);
  }
  const rawContracts = asRecord(obj.contracts, 'contracts');
  const contracts: Record<string, `0x${string}`> = {};
  for (const [name, addr] of Object.entries(rawContracts)) {
    if (typeof addr !== 'string' || !ADDRESS_RE.test(addr)) {
      throw new Error(`manifest tidak sah: contracts.${name} bukan alamat: ${String(addr)}`);
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

/** Gagal cepat saat start bila kontrak yang dibutuhkan belum ada di manifest. */
export function requireContracts(m: DeploymentManifest, names: readonly string[]): void {
  const missing = names.filter((n) => m.contracts[n] === undefined);
  if (missing.length > 0) {
    throw new Error(`manifest chainId ${m.chainId} kekurangan kontrak: ${missing.join(', ')}`);
  }
}

export function loadDeployment(chainId: number, dir = join(process.cwd(), 'deployments')): DeploymentManifest {
  const path = join(dir, `${chainId}.json`);
  return parseDeployment(JSON.parse(readFileSync(path, 'utf8')), chainId);
}
```

Tambahkan ke `packages/protocol/src/index.ts`:

```ts
export * from './deployments.js';
```

- [ ] **Step 8: Jalankan uji TS**

```bash
cd packages/protocol && npx vitest run test/deployments.test.ts
```
Expected: PASS — 5 lulus.

- [ ] **Step 9: Tulis `scripts/demo-local.sh`**

```bash
#!/usr/bin/env bash
# Menaikkan anvil, men-deploy tumpukan P0, mencetak manifest, lalu tetap berjalan.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${ANVIL_PORT:-8545}"
RPC="http://127.0.0.1:${PORT}"
# akun anvil #0 — kunci uji publik, tidak pernah memegang nilai
export DEPLOYER_KEY="${DEPLOYER_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"

ANVIL_PID=""
cleanup() { [[ -n "$ANVIL_PID" ]] && kill "$ANVIL_PID" 2>/dev/null || true; }
trap cleanup EXIT

echo "▶ menaikkan anvil di port ${PORT}"
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
echo "anvil berjalan pada $RPC (PID $ANVIL_PID) — Ctrl-C untuk berhenti"
wait "$ANVIL_PID"
```

Jadikan dapat dieksekusi: `chmod +x scripts/demo-local.sh`

- [ ] **Step 10: Jalankan demo ujung-ke-ujung**

```bash
timeout 90 bash scripts/demo-local.sh || true
cat deployments/31337.json
```
Expected: manifest berisi `chainId: 31337` dan tiga alamat.

- [ ] **Step 11: Commit**

```bash
git add contracts/script packages/protocol/src/deployments.ts packages/protocol/src/index.ts \
        packages/protocol/test/deployments.test.ts contracts/test/unit/DeployDefaults.t.sol \
        scripts/demo-local.sh deployments/
git commit -m "feat: skrip deploy, manifest deployment, dan demo anvil lokal"
```

**✅ P0 selesai.** `make demo` menaikkan rantai lokal, men-deploy, dan menulis manifest yang bisa dibaca TypeScript.

---

# P1 — Inti Market DPM

---

## Task 6: `DPMMath` — cost dan costUp

**Files:**
- Create: `contracts/src/math/DPMMath.sol`
- Test: `contracts/test/unit/DPMMath.t.sol`

**Interfaces:**
- Consumes: `Math` dari OZ
- Produces:
  - `DPMMath.WAD = 1e18`, `DPMMath.MAX_Q = 1e33`
  - `cost(uint256[2] memory q) internal pure returns (uint256)` — `√(q₀²+q₁²)`, dibulatkan ke bawah
  - `costUp(uint256[2] memory q) internal pure returns (uint256)` — dibulatkan ke atas
  - `error QOverflow()`

- [ ] **Step 1: Tulis uji yang gagal**

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

    /// @dev Segitiga 3-4-5: satu-satunya kasus di mana √ pasti eksak, sehingga
    ///      costUp TIDAK boleh menambah 1. Ini yang menangkap ceil yang keliru.
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

    /// @dev Homogenitas derajat 1: C(k·q) = k·C(q). Sifat inilah yang membuat
    ///      penambahan likuiditas proporsional netral terhadap probabilitas (Task 13).
    function testFuzz_costIsHomogeneousDegreeOne(uint96 a, uint96 b, uint8 kSmall) public pure {
        uint256 k = uint256(kSmall) + 1;
        uint256[2] memory q = _q(uint256(a), uint256(b));
        uint256[2] memory kq = _q(uint256(a) * k, uint256(b) * k);
        uint256 lhs = DPMMath.cost(kq);
        uint256 rhs = DPMMath.cost(q) * k;
        // pembulatan floor menumpuk paling banyak k wei
        assertLe(lhs > rhs ? lhs - rhs : rhs - lhs, k);
    }

    /// @dev Monotonisitas: menambah lembar tidak pernah menurunkan biaya pool.
    function testFuzz_costIsMonotonic(uint96 a, uint96 b, uint96 delta) public pure {
        uint256[2] memory q = _q(uint256(a), uint256(b));
        uint256[2] memory qMore = _q(uint256(a) + uint256(delta), uint256(b));
        assertGe(DPMMath.cost(qMore), DPMMath.cost(q));
    }
}
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
cd contracts && forge test --match-contract DPMMathTest
```
Expected: FAIL — `src/math/DPMMath.sol` tidak ditemukan.

- [ ] **Step 3: Implementasikan `contracts/src/math/DPMMath.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title DPMMath
/// @notice Cost function pari-mutuel dinamis (Pennock): C(q) = √(q₀² + q₁²).
/// @dev Seluruh nilai dalam wad (1e18). Karena qᵢ berskala 1e18, qᵢ² berskala 1e36,
///      sehingga akar kuadrat integer dari jumlahnya langsung menghasilkan wad —
///      tidak ada penskalaan ulang, tidak ada tempat bagi kesalahan skala.
///
///      Sifat yang dijamin pustaka ini:
///        • Σ pᵢ² = WAD           → pᵢ² adalah distribusi probabilitas yang sah
///        • Σ pᵢ·qᵢ = C(q)        → likuidasi menghabiskan pool secara persis (Euler)
///        • C(k·q) = k·C(q)       → penambahan likuiditas proporsional netral terhadap harga
library DPMMath {
    uint256 internal constant WAD = 1e18;

    /// @dev 2·(1e33)² = 2e66 < 2²⁵⁶ ≈ 1.16e77, jadi jumlah kuadrat tidak pernah meluap.
    uint256 internal constant MAX_Q = 1e33;

    error QOverflow();

    function _sumSq(uint256[2] memory q) private pure returns (uint256) {
        if (q[0] > MAX_Q || q[1] > MAX_Q) revert QOverflow();
        return q[0] * q[0] + q[1] * q[1];
    }

    /// @notice C(q) dibulatkan KE BAWAH. Dipakai untuk pelaporan, bukan untuk state pool.
    function cost(uint256[2] memory q) internal pure returns (uint256) {
        return Math.sqrt(_sumSq(q), Math.Rounding.Floor);
    }

    /// @notice C(q) dibulatkan KE ATAS. `Market.poolWad` selalu memakai nilai ini,
    ///         sehingga setiap debu pembulatan tertinggal di dalam pool, bukan di luar.
    function costUp(uint256[2] memory q) internal pure returns (uint256) {
        return Math.sqrt(_sumSq(q), Math.Rounding.Ceil);
    }
}
```

- [ ] **Step 4: Jalankan dan pastikan lulus**

```bash
cd contracts && forge test --match-contract DPMMathTest -vv
```
Expected: PASS — 9 lulus (2 di antaranya fuzz).

- [ ] **Step 5: Commit**

```bash
git add contracts/src/math/DPMMath.sol contracts/test/unit/DPMMath.t.sol
git commit -m "feat(math): cost function DPM dengan pembulatan berpihak pada pool"
```

---

## Task 7: `DPMMath` — price dan probability

**Files:**
- Modify: `contracts/src/math/DPMMath.sol`
- Modify: `contracts/test/unit/DPMMath.t.sol`

**Interfaces:**
- Consumes: `DPMMath.cost`, `DPMMath._sumSq` (Task 6)
- Produces:
  - `price(uint256[2] memory q, uint8 i) internal pure returns (uint256)` — `qᵢ·WAD/C(q)`
  - `probability(uint256[2] memory q, uint8 i) internal pure returns (uint256)` — `pᵢ² = qᵢ²·WAD/Σqⱼ²`
  - `error BadOutcome()`

- [ ] **Step 1: Tambahkan uji yang gagal ke `DPMMathTest`**

```solidity
    function test_priceOfThreeFourFiveIsExact() public pure {
        assertEq(DPMMath.price(_q(3e18, 4e18), 0), 6e17);
        assertEq(DPMMath.price(_q(3e18, 4e18), 1), 8e17);
    }

    /// @dev Sifat penanda DPM: harga marginal BUKAN probabilitas — kuadratnya yang
    ///      probabilitas, dan kuadratnya berjumlah satu. UI wajib menampilkan pᵢ².
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

    /// @dev qᵢ² · WAD mencapai 1e84 pada MAX_Q — jauh melampaui uint256. Uji ini gagal
    ///      bila implementasi memakai perkalian biasa alih-alih mulDiv 512-bit.
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
        assertLe(DPMMath.WAD - sum, 2); // hanya debu floor
        assertLe(sum, DPMMath.WAD);
    }

    /// @dev Euler: Σ pᵢ·qᵢ = C(q). Inilah yang membuat likuidasi menghabiskan pool
    ///      secara persis saat market gagal (Task 15).
    function testFuzz_eulerIdentity(uint96 a, uint96 b) public pure {
        vm.assume(uint256(a) + uint256(b) > 0);
        uint256[2] memory q = _q(uint256(a), uint256(b));
        uint256 lhs = Math.mulDiv(DPMMath.price(q, 0), q[0], DPMMath.WAD)
            + Math.mulDiv(DPMMath.price(q, 1), q[1], DPMMath.WAD);
        assertLe(DPMMath.cost(q) - lhs, 3); // debu floor dari tiga pembagian
        assertLe(lhs, DPMMath.cost(q));
    }
```

Tambahkan import di bagian atas berkas uji:

```solidity
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
cd contracts && forge test --match-contract DPMMathTest
```
Expected: FAIL — `price` dan `probability` belum ada.

- [ ] **Step 3: Tambahkan ke `DPMMath.sol`**

```solidity
    error BadOutcome();

    /// @notice Harga marginal pᵢ = ∂C/∂qᵢ = qᵢ / C(q), dalam wad.
    /// @dev BUKAN probabilitas. Probabilitas adalah pᵢ² — lihat `probability`.
    function price(uint256[2] memory q, uint8 i) internal pure returns (uint256) {
        if (i > 1) revert BadOutcome();
        uint256 c = cost(q);
        if (c == 0) return 0;
        return Math.mulDiv(q[i], WAD, c);
    }

    /// @notice Probabilitas implisit Pᵢ = pᵢ² = qᵢ² / Σqⱼ², dalam wad. Σ Pᵢ = WAD.
    /// @dev mulDiv wajib: qᵢ² mencapai 1e66, dan qᵢ²·WAD mencapai 1e84 — melampaui
    ///      uint256. mulDiv menghitung hasil kali 512-bit sebelum membagi.
    function probability(uint256[2] memory q, uint8 i) internal pure returns (uint256) {
        if (i > 1) revert BadOutcome();
        uint256 s = _sumSq(q);
        if (s == 0) return 0;
        return Math.mulDiv(q[i] * q[i], WAD, s);
    }
```

- [ ] **Step 4: Jalankan dan pastikan lulus**

```bash
cd contracts && forge test --match-contract DPMMathTest -vv
```
Expected: PASS — 18 lulus.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/math/DPMMath.sol contracts/test/unit/DPMMath.t.sol
git commit -m "feat(math): harga marginal DPM dan probabilitas p_i^2 aman-luapan"
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

- [ ] **Step 1: Tambahkan uji yang gagal ke `DPMMathTest`**

```solidity
    /// @dev Bentuk tertutup: x = √(C₁² − q_j²) − qᵢ dengan C₁ = C(q) + spend.
    ///      Dipilih dua segitiga Pythagoras agar jawabannya bulat dan bisa diperiksa mata:
    ///      (0,3) biaya 3 → C₁ = 5 → q₀ baru = 4  ⇒ 4 lembar.
    function test_sharesForSpendClosedFormExactCaseA() public pure {
        assertEq(DPMMath.sharesForSpend(_q(0, 3e18), 0, 2e18), 4e18);
    }

    /// @dev (5,12) biaya 13 → C₁ = 15 → q₀ baru = 9 ⇒ 4 lembar.
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

    /// @dev Sifat yang benar-benar penting: kuotasi tidak boleh pernah menjanjikan
    ///      lebih banyak lembar daripada yang dibayar. Biaya sesungguhnya untuk lembar
    ///      yang dikuotasi harus ≤ spend (tidak pernah melebihi).
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

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
cd contracts && forge test --match-contract DPMMathTest
```
Expected: FAIL — `sharesForSpend` belum ada.

- [ ] **Step 3: Tambahkan ke `DPMMath.sol`**

```solidity
    error InsufficientSpend();

    /// @notice Lembar outcome `i` yang diperoleh bila `spendWad` masuk ke pool.
    /// @param spendWad bagian yang masuk pool — sudah bersih dari fee.
    /// @dev Untuk n = 2 tidak perlu iterasi Newton. Kita mencari x sehingga
    ///        √((qᵢ+x)² + q_j²) = C(q) + spend = C₁
    ///      yang menghasilkan bentuk tertutup
    ///        x = √(C₁² − q_j²) − qᵢ
    ///      Basis memakai costUp (sama dengan poolWad milik Market) dan hasil akhir
    ///      dibulatkan ke bawah, sehingga kuotasi tidak pernah melebih-lebihkan.
    ///      Ini KUOTASI, bukan otoritas: `Market.buy` menghitung ulang biaya sebenarnya
    ///      dan pemanggil melindungi diri lewat `maxTokensIn`.
    function sharesForSpend(uint256[2] memory q, uint8 i, uint256 spendWad) internal pure returns (uint256) {
        if (i > 1) revert BadOutcome();
        if (spendWad == 0) revert InsufficientSpend();

        uint256 j = i == 0 ? 1 : 0;
        uint256 c1 = costUp(q) + spendWad;
        if (c1 > MAX_Q) revert QOverflow();

        // c1 > C(q) ≥ q[j], jadi pengurangan di bawah tidak pernah underflow.
        uint256 inner = c1 * c1 - q[j] * q[j];
        uint256 newQi = Math.sqrt(inner, Math.Rounding.Floor);
        if (newQi <= q[i]) revert InsufficientSpend();
        return newQi - q[i];
    }
```

- [ ] **Step 4: Jalankan dan pastikan lulus**

```bash
cd contracts && forge test --match-contract DPMMathTest -vv
```
Expected: PASS — 22 lulus.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/math/DPMMath.sol contracts/test/unit/DPMMath.t.sol
git commit -m "feat(math): sharesForSpend bentuk tertutup untuk market biner"
```

---

## Task 9: Cermin DPM di TypeScript + uji diferensial

**Files:**
- Create: `packages/protocol/src/dpm.ts`, `packages/protocol/scripts/gen-vectors.ts`
- Create: `contracts/test/differential/DPMDifferential.t.sol`, `contracts/test/vectors/dpm.json` (dihasilkan, di-commit)
- Test: `packages/protocol/test/dpm.test.ts`
- Modify: `packages/protocol/src/index.ts`

**Interfaces:**
- Consumes: `DPMMath` (Task 6–8), `WAD` (Task 2)
- Produces:
  - TS: `MAX_Q`, `isqrt(n)`, `isqrtCeil(n)`, `cost(q)`, `costUp(q)`, `price(q,i)`, `probability(q,i)`, `sharesForSpend(q,i,spendWad)`, `type Q = readonly [bigint, bigint]`
  - `contracts/test/vectors/dpm.json` berkolom `q0,q1,cost,costUp,price0,prob0` sebagai larik string heksadesimal

**Kenapa dua arah.** Uji vitest menyematkan cermin TS pada nilai emas yang dihitung tangan, sehingga cermin itu sendiri tidak bisa diam-diam salah. Uji Foundry lalu menyematkan Solidity pada cermin. Tanpa lapis pertama, kedua sisi bisa sama-sama keliru dan tetap "cocok".

- [ ] **Step 1: Tulis uji yang gagal untuk cermin TS**

Buat `packages/protocol/test/dpm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { WAD } from '../src/units.js';
import { cost, costUp, isqrt, isqrtCeil, price, probability, sharesForSpend, MAX_Q } from '../src/dpm.js';

const E18 = WAD;

describe('isqrt', () => {
  it('menghitung akar floor dan ceil', () => {
    expect(isqrt(0n)).toBe(0n);
    expect(isqrt(1n)).toBe(1n);
    expect(isqrt(2n)).toBe(1n);
    expect(isqrtCeil(2n)).toBe(2n);
    expect(isqrt(4n)).toBe(2n);
    expect(isqrtCeil(4n)).toBe(2n);
    expect(isqrt(10n ** 66n)).toBe(10n ** 33n);
  });
});

describe('cermin DPM — nilai emas dihitung tangan', () => {
  it('segitiga 3-4-5 eksak, ceil tidak menambah', () => {
    expect(cost([3n * E18, 4n * E18])).toBe(5n * E18);
    expect(costUp([3n * E18, 4n * E18])).toBe(5n * E18);
  });

  it('market seimbang berbiaya q√2', () => {
    expect(cost([E18, E18])).toBe(1_414_213_562_373_095_048n);
    expect(costUp([E18, E18])).toBe(1_414_213_562_373_095_049n);
  });

  it('harga marginal 3-4-5 adalah 0.6 dan 0.8', () => {
    expect(price([3n * E18, 4n * E18], 0)).toBe(600_000_000_000_000_000n);
    expect(price([3n * E18, 4n * E18], 1)).toBe(800_000_000_000_000_000n);
  });

  it('probabilitas adalah kuadrat harga dan berjumlah satu', () => {
    const q: readonly [bigint, bigint] = [3n * E18, 4n * E18];
    expect(probability(q, 0)).toBe(360_000_000_000_000_000n);
    expect(probability(q, 1)).toBe(640_000_000_000_000_000n);
    expect(probability(q, 0) + probability(q, 1)).toBe(WAD);
  });

  it('tidak meluap pada MAX_Q', () => {
    expect(probability([MAX_Q, MAX_Q], 0)).toBe(WAD / 2n);
  });

  it('sharesForSpend memakai bentuk tertutup', () => {
    expect(sharesForSpend([0n, 3n * E18], 0, 2n * E18)).toBe(4n * E18);
    expect(sharesForSpend([5n * E18, 12n * E18], 0, 2n * E18)).toBe(4n * E18);
  });

  it('menolak q di atas MAX_Q', () => {
    expect(() => cost([MAX_Q + 1n, 0n])).toThrow(/MAX_Q/);
  });
});
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
cd packages/protocol && npx vitest run test/dpm.test.ts
```
Expected: FAIL — modul `../src/dpm.js` tidak ditemukan.

- [ ] **Step 3: Implementasikan `packages/protocol/src/dpm.ts`**

```ts
import { WAD } from './units.js';

/** Cermin persis dari contracts/src/math/DPMMath.sol. Setiap perubahan di satu sisi
 *  harus diikuti sisi lain — uji diferensial di contracts/test/differential menegakkannya. */
export const MAX_Q = 10n ** 33n;

export type Q = readonly [bigint, bigint];
export type Outcome = 0 | 1;

/** Akar kuadrat integer (floor). Tebakan awal 2^ceil(bits/2) selalu ≥ √n,
 *  sehingga iterasi Newton turun secara monoton dan berhenti tepat. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError('isqrt: nilai negatif');
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
  if (spendWad <= 0n) throw new RangeError('sharesForSpend: spend harus > 0');
  const j: Outcome = i === 0 ? 1 : 0;
  const c1 = costUp(q) + spendWad;
  if (c1 > MAX_Q) throw new RangeError(`C1 melampaui MAX_Q: ${c1}`);
  const inner = c1 * c1 - q[j] * q[j];
  const newQi = isqrt(inner);
  if (newQi <= q[i]) throw new RangeError('sharesForSpend: spend terlalu kecil untuk satu lembar pun');
  return newQi - q[i];
}
```

Tambahkan ke `packages/protocol/src/index.ts`:

```ts
export * as dpm from './dpm.js';
```

- [ ] **Step 4: Jalankan dan pastikan lulus**

```bash
cd packages/protocol && npx vitest run test/dpm.test.ts
```
Expected: PASS — 7 lulus.

- [ ] **Step 5: Tulis generator vektor `packages/protocol/scripts/gen-vectors.ts`**

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cost, costUp, price, probability, MAX_Q, type Q } from '../src/dpm.js';

const OUT = join(process.cwd(), '../../contracts/test/vectors/dpm.json');
const COUNT = 512;

/** xorshift64 deterministik — vektor harus identik di setiap mesin dan setiap kali,
 *  supaya `gen:vectors` yang dijalankan ulang di CI tidak menghasilkan diff. */
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

/** Sebaran lintas magnitudo: nol, debu, skala wad, besar, dan tepat di MAX_Q. */
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
console.log(`menulis ${COUNT} vektor ke ${OUT}`);
```

- [ ] **Step 6: Hasilkan vektor**

```bash
cd packages/protocol && npx tsx scripts/gen-vectors.ts
head -c 300 ../../contracts/test/vectors/dpm.json
```
Expected: berkas JSON dengan enam larik berisi 512 string heksadesimal.

- [ ] **Step 7: Tulis uji diferensial Foundry**

Buat `contracts/test/differential/DPMDifferential.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DPMMath} from "../../src/math/DPMMath.sol";

/// @notice Menyematkan DPMMath pada cermin TypeScript. Cermin itu sendiri disematkan
///         pada nilai emas hitung-tangan di packages/protocol/test/dpm.test.ts, sehingga
///         kedua sisi tidak bisa salah bersama-sama.
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

            assertEq(DPMMath.cost(q), expCost[k], string.concat("cost tidak cocok pada kasus ", vm.toString(k)));
            assertEq(DPMMath.costUp(q), expCostUp[k], string.concat("costUp tidak cocok pada kasus ", vm.toString(k)));
            assertEq(DPMMath.price(q, 0), expPrice0[k], string.concat("price tidak cocok pada kasus ", vm.toString(k)));
            assertEq(
                DPMMath.probability(q, 0), expProb0[k], string.concat("probability tidak cocok pada kasus ", vm.toString(k))
            );
        }
    }
}
```

- [ ] **Step 8: Jalankan dan pastikan lulus**

```bash
cd contracts && forge test --match-contract DPMDifferentialTest -vv
```
Expected: PASS — 1 lulus, 512 kasus terverifikasi.

- [ ] **Step 9: Commit**

```bash
git add packages/protocol/src/dpm.ts packages/protocol/src/index.ts packages/protocol/scripts/gen-vectors.ts \
        packages/protocol/test/dpm.test.ts contracts/test/differential contracts/test/vectors
git commit -m "test: cermin DPM di TypeScript dan uji diferensial 512 vektor"
```

---

## Task 10: `OutcomeShares` — ERC-1155 dengan otorisasi aritmetika

**Files:**
- Create: `contracts/src/interfaces/IMarketRegistry.sol`, `contracts/src/core/OutcomeShares.sol`
- Test: `contracts/test/unit/OutcomeShares.t.sol`

**Interfaces:**
- Consumes: —
- Produces:
  - `IMarketRegistry` — `isMarket(address) external view returns (bool)`
  - `OutcomeShares` — `setRegistry(address)`, `idFor(address market, uint8 outcome) → uint256`, `marketOf(uint256 id) → address`, `mint(address to, uint8 outcome, uint256 amount)`, `burn(address from, uint8 outcome, uint256 amount)`, `balanceOfOutcome(address account, address market, uint8 outcome) → uint256`
  - Error: `NotMarket()`, `RegistryAlreadySet()`, `NotDeployer()`, `BadOutcome()`

**Ide inti.** `id = uint160(market) << 8 | outcome`, dan `mint`/`burn` menurunkan id dari `msg.sender`. Sebuah market karenanya **secara aritmetika** hanya bisa menyentuh id miliknya sendiri — tidak ada daftar izin per-market yang bisa salah dikonfigurasi. Registry hanya menyaring supaya alamat sembarang tidak mencetak token sampah yang membingungkan indexer.

- [ ] **Step 1: Tulis uji yang gagal**

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

/// @dev Berpura-pura menjadi Market: memanggil mint/burn atas namanya sendiri.
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
        shares = new OutcomeShares("https://delphi.0g/{id}.json");
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

    /// @dev Sifat kunci: id market A dan market B tidak pernah bertabrakan, dan
    ///      market B tidak punya cara menyentuh saldo market A.
    function test_marketsCannotTouchEachOthersIds() public {
        marketA.mint(alice, 1, 100e18);
        assertEq(shares.balanceOfOutcome(alice, address(marketB), 1), 0);

        vm.expectRevert();
        marketB.burn(alice, 1, 1e18); // membakar id MILIKNYA sendiri, yang saldonya nol
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

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
cd contracts && forge test --match-contract OutcomeSharesTest
```
Expected: FAIL — `src/core/OutcomeShares.sol` tidak ditemukan.

- [ ] **Step 3: Implementasikan `contracts/src/interfaces/IMarketRegistry.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Bagian dari MarketFactory yang perlu diketahui OutcomeShares.
///         Antarmuka sempit ini memutus ketergantungan melingkar antara keduanya.
interface IMarketRegistry {
    function isMarket(address candidate) external view returns (bool);
}
```

- [ ] **Step 4: Implementasikan `contracts/src/core/OutcomeShares.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";

/// @title OutcomeShares
/// @notice Posisi outcome tradable untuk seluruh market 0G-Delphi.
/// @dev Otorisasi bersifat aritmetika, bukan administratif: `id` diturunkan dari
///      alamat market, dan mint/burn menurunkannya dari `msg.sender`. Sebuah market
///      karena itu tidak punya representasi untuk id market lain — tidak ada daftar
///      izin per-market yang bisa salah konfigurasi.
///
///      Lembar seed TIDAK ada di sini. Lembar seed tidak transferable dan dicatat
///      di dalam Market masing-masing (lihat §6.3 spec).
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

    /// @dev Dipasang sekali setelah MarketFactory di-deploy, lalu tidak bisa diubah.
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

- [ ] **Step 5: Jalankan dan pastikan lulus**

```bash
cd contracts && forge test --match-contract OutcomeSharesTest -vv
```
Expected: PASS — 8 lulus.

- [ ] **Step 6: Commit**

```bash
git add contracts/src/interfaces/IMarketRegistry.sol contracts/src/core/OutcomeShares.sol contracts/test/unit/OutcomeShares.t.sol
git commit -m "feat(contracts): OutcomeShares ERC-1155 dengan otorisasi turunan-alamat"
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

- [ ] **Step 1: Tulis uji yang gagal untuk `seedShares`**

Tambahkan ke `contracts/test/unit/DPMMath.t.sol`:

```solidity
    function test_seedSharesOfZeroIsZero() public pure {
        assertEq(DPMMath.seedShares(0), 0);
    }

    /// @dev Sifat yang harus dijamin: biaya pool untuk lembar seed TIDAK PERNAH
    ///      melebihi collateral yang disetor. Menurunkan q₀ dengan membagi konstanta
    ///      ⌊√2·1e18⌋ akan MELANGGAR ini — pembagi yang dibulatkan ke bawah menghasilkan
    ///      hasil bagi yang terlalu besar. Karena itu rumusnya lewat kuadrat.
    function testFuzz_seedNeverCostsMoreThanDeposited(uint96 seed) public pure {
        uint256 seedWad = uint256(seed);
        uint256 s = DPMMath.seedShares(seedWad);
        assertLe(DPMMath.costUp(_q(s, s)), seedWad);
    }

    /// @dev ...dan tetap maksimal: satu lembar lagi di kedua sisi sudah melampaui setoran.
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

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
cd contracts && forge test --match-contract DPMMathTest
```
Expected: FAIL — `seedShares` belum ada.

- [ ] **Step 3: Tambahkan `seedShares` ke `DPMMath.sol`**

```solidity
    /// @notice Lembar simetris terbesar (q₀ = q₁) yang biayanya tidak melebihi `seedWad`.
    /// @dev q₀ = ⌊√(⌊seedWad²/2⌋)⌋. Dari situ 2q₀² ≤ seedWad², yang setara dengan
    ///      costUp([q₀,q₀]) ≤ seedWad karena ⌈√x⌉ ≤ S ⟺ x ≤ S².
    ///
    ///      Jangan tergoda menulis q₀ = seedWad·WAD/SQRT2_WAD: konstanta √2 yang
    ///      dibulatkan ke bawah membuat hasil baginya sedikit TERLALU BESAR, sehingga
    ///      pool yang dibutuhkan melebihi collateral yang benar-benar disetor.
    function seedShares(uint256 seedWad) internal pure returns (uint256) {
        if (seedWad > MAX_Q) revert QOverflow();
        return Math.sqrt((seedWad * seedWad) / 2, Math.Rounding.Floor);
    }
```

- [ ] **Step 4: Cerminkan di TypeScript dan perluas vektor**

Tambahkan ke `packages/protocol/src/dpm.ts`:

```ts
export function seedShares(seedWad: bigint): bigint {
  if (seedWad > MAX_Q) throw new RangeError(`seedWad melampaui MAX_Q: ${seedWad}`);
  return isqrt((seedWad * seedWad) / 2n);
}
```

Tambahkan ke `packages/protocol/test/dpm.test.ts`:

```ts
import { seedShares } from '../src/dpm.js';

describe('seedShares', () => {
  it('tidak pernah berbiaya lebih dari yang disetor, dan maksimal', () => {
    for (const w of [1n, 1000n, E18, 1000n * E18, 10n ** 30n]) {
      const s = seedShares(w);
      expect(costUp([s, s])).toBeLessThanOrEqual(w);
      expect(costUp([s + 1n, s + 1n])).toBeGreaterThan(w);
    }
  });

  it('market mulai tepat di 50%', () => {
    const s = seedShares(1000n * E18);
    expect(probability([s, s], 0)).toBe(E18 / 2n);
  });
});
```

Di `packages/protocol/scripts/gen-vectors.ts`, tambahkan kolom `seed`:

```ts
import { seedShares } from '../src/dpm.js';
// ...di dalam loop, setelah prob0.push(...):
seed.push(hex(seedShares(a)));
// ...dan deklarasikan `const seed: string[] = [];` bersama larik lain,
//    lalu sertakan `seed` dalam objek JSON yang ditulis.
```

Di `contracts/test/differential/DPMDifferential.t.sol`, tambahkan di dalam loop:

```solidity
        uint256[] memory expSeed = vm.parseJsonUintArray(json, ".seed"); // di luar loop, bersama larik lain
        // di dalam loop:
        assertEq(DPMMath.seedShares(q0[k]), expSeed[k], string.concat("seedShares tidak cocok pada kasus ", vm.toString(k)));
```

- [ ] **Step 5: Jalankan ulang seluruh uji matematika**

```bash
cd packages/protocol && npx vitest run && npx tsx scripts/gen-vectors.ts
cd ../../contracts && forge test --match-contract 'DPMMathTest|DPMDifferentialTest' -vv
```
Expected: PASS — semua lulus, vektor kini punya tujuh kolom.

- [ ] **Step 6: Implementasikan `contracts/src/interfaces/IMarket.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IMarket {
    /// @dev Closed/Proposed/Disputed adalah keadaan tanpa perdagangan: `q` dibekukan
    ///      agar payout tidak bisa digeser saat komite sedang menilai.
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
        bytes32 specRoot; // root Merkle 0G Storage untuk MarketSpec
        bytes32 category;
    }

    /// @dev qAfter dan probAfter disertakan supaya indexer bisa merekonstruksi kurva
    ///      probabilitas tanpa satu pun eth_call historis.
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

- [ ] **Step 7: Tulis uji yang gagal untuk inisialisasi market**

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
        vm.warp(1_800_000_000); // stempel waktu yang stabil dan jauh dari nol
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

    /// @dev Mencerminkan persis apa yang akan dilakukan MarketFactory di Task 17:
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

    /// @dev Invarian pusat sistem, diperiksa sejak detik nol.
    function test_poolEqualsCostUpAtInit() public {
        Market m = _newMarket(SEED);
        assertEq(m.poolWad(), DPMMath.costUp(m.qArray()));
    }

    /// @dev Pool tidak pernah boleh menuntut lebih banyak collateral daripada yang ada.
    function test_collateralCoversPoolAndDeposit() public {
        Market m = _newMarket(SEED);
        assertGe(usdc.balanceOf(address(m)), m.collateralOwed());
        assertLe(Math.ceilDiv(m.poolWad(), m.scale()), SEED);
    }

    function test_scaleMatchesSixDecimalCollateral() public {
        Market m = _newMarket(SEED);
        assertEq(m.scale(), 1e12);
    }

    /// @dev Market yang sudah hidup KEBAL terhadap perubahan parameter. Fee dan
    ///      ukuran trade minimum dipotret saat inisialisasi, bukan dibaca tiap trade.
    function test_liveMarketIsImmuneToLaterConfigChanges() public {
        Market m = _newMarket(SEED);
        assertEq(m.feeBps(), 100);
        config.setParam(ConfigKeys.FEE_BPS, 300);
        assertEq(m.feeBps(), 100);
    }

    function test_seedBelowMinimumReverts() public {
        vm.expectRevert(Market.SeedTooSmall.selector);
        _newMarket(1e6); // MIN_SEED adalah 100e6
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

- [ ] **Step 8: Jalankan dan pastikan gagal**

```bash
cd contracts && forge test --match-contract MarketInitTest
```
Expected: FAIL — `src/core/Market.sol` tidak ditemukan.

- [ ] **Step 9: Implementasikan `contracts/src/core/Market.sol` (storage + initialize + view)**

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
///         kontrak ini memegang dana pengguna dan karena itu tidak pernah upgradeable.
/// @dev Invarian pusat: `poolWad == DPMMath.costUp(_q)` pada setiap batas transaksi.
///      Ditegakkan by construction — pool DISETEL ke target, tidak pernah diakumulasi:
///
///        target      = costUp(qBaru)
///        biaya beli  = target - poolWad
///        hasil jual  = poolWad - target
///        poolWad     = target
///
///      Setiap debu pembulatan karenanya tertinggal DI DALAM pool.
contract Market is IMarket, Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── konfigurasi, dipotret saat initialize ────────────────────────────────
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

    /// @dev Dipotret, bukan dibaca ulang: market yang sudah hidup tidak boleh berubah
    ///      aturannya di tengah jalan hanya karena tata kelola menyetel ulang parameter.
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

    /// @notice Collateral minimum yang harus dipegang kontrak agar tetap solven.
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

    /// @dev Jalur KELUAR: sengaja TIDAK memeriksa pause. Pengguna harus selalu bisa keluar.
    function _requireExitable() internal view {
        if (status != Status.Open) revert NotOpen();
        if (block.timestamp >= tradingEnd) revert TradingEnded();
    }
}
```

- [ ] **Step 10: Jalankan dan pastikan lulus**

```bash
cd contracts && forge test --match-contract MarketInitTest -vv
```
Expected: PASS — 11 lulus.

- [ ] **Step 11: Commit**

```bash
git add contracts/src/math/DPMMath.sol contracts/src/interfaces/IMarket.sol contracts/src/core/Market.sol \
        contracts/test/helpers/Fixtures.sol contracts/test/unit/MarketInit.t.sol contracts/test/unit/DPMMath.t.sol \
        contracts/test/differential contracts/test/vectors packages/protocol
git commit -m "feat(contracts): storage dan inisialisasi Market dengan seeding aman-solvabilitas"
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

- [ ] **Step 1: Tulis uji yang gagal**

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

    /// @dev Invarian pusat, diperiksa setelah operasi nyata.
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

    /// @dev Perdagangan debu ditolak: dengan pembulatan ke atas, pembelian sangat kecil
    ///      bisa menghasilkan biaya nol token dan memberi lembar gratis.
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

    /// @dev quoteBuySpend adalah taksiran: biaya sebenarnya tidak boleh melebihi nominal
    ///      yang diminta pengguna.
    function testFuzz_quoteBuySpendNeverOverpromises(uint96 spend) public {
        vm.assume(spend >= 1e6 && spend <= 100_000e6);
        (uint256 sharesOut,) = m.quoteBuySpend(1, uint256(spend));
        vm.assume(sharesOut > 0);
        (uint256 realCost,) = m.quoteBuy(1, sharesOut);
        assertLe(realCost, uint256(spend));
    }

    /// @dev Membeli dalam dua langkah tidak boleh lebih murah daripada sekali jalan
    ///      (path independence, dalam batas debu pembulatan).
    function testFuzz_buyIsPathIndependent(uint64 partA, uint64 partB) public {
        vm.assume(partA > 1e15 && partB > 1e15);
        uint256 total = uint256(partA) + uint256(partB);
        (uint256 oneShot,) = m.quoteBuy(1, total);

        vm.startPrank(alice);
        uint256 first = m.buy(1, uint256(partA), type(uint256).max, alice);
        uint256 second = m.buy(1, uint256(partB), type(uint256).max, alice);
        vm.stopPrank();

        assertGe(first + second, oneShot);
        assertLe(first + second - oneShot, 4); // debu ceil dari dua langkah
    }
}
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
cd contracts && forge test --match-contract MarketBuyTest
```
Expected: FAIL — `quoteBuy`/`buy` belum ada.

- [ ] **Step 3: Tambahkan ke `Market.sol`**

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

    /// @notice Taksiran lembar yang didapat untuk `tokensIn` (agent berpikir dalam nominal).
    /// @dev Dibulatkan ke bawah dan tidak otoritatif — `buy` menghitung ulang biaya
    ///      sebenarnya, dan pemanggil melindungi diri lewat `maxTokensIn`.
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

**Catatan fee pada `quoteBuySpend`:** `buy` mengenakan `fee = cost·feeBps/10000` **di atas** biaya pool, jadi total = `cost·(1 + feeBps/10000)`. Membalikkannya memberi `cost = tokensIn·10000/(10000+feeBps)`, karena itu `fee = tokensIn·feeBps/(10000+feeBps)`.

- [ ] **Step 4: Jalankan dan pastikan lulus**

```bash
cd contracts && forge test --match-contract MarketBuyTest -vv
```
Expected: PASS — 11 lulus.

- [ ] **Step 5: Tulis uji reentrancy**

`shares.mint` memanggil balik penerima lewat `onERC1155Received`. Itulah satu-satunya
titik di `buy` yang menyerahkan kendali ke kode asing, jadi itulah yang harus diuji.

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

    /// @dev Dipanggil di tengah `buy`. Panggilan masuk kedua harus ditolak guard.
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
        vm.expectRevert(); // ReentrancyGuardReentrantCall menggelembung dari panggilan dalam
        attacker.attack(50e18);

        // Kontrol: penerima yang sama, tanpa serangan, berhasil. Ini membuktikan
        // revert di atas memang karena reentrancy, bukan sebab lain.
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
git commit -m "feat(contracts): Market.buy dengan pool disetel ke costUp, slippage, dan guard reentrancy"
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

- [ ] **Step 1: Tulis uji yang gagal**

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
        assertEq(m.probability(1), 5e17); // kembali persis ke seed
    }

    function test_sellRespectsMinTokensOut() public {
        (uint256 quoted,) = m.quoteSell(1, 200e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Market.SlippageExceeded.selector, quoted, quoted + 1));
        m.sell(1, 200e18, quoted + 1, alice);
    }

    /// @dev Sifat non-negosiasi: pause TIDAK PERNAH menghalangi jalan keluar.
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

    /// @dev Lembar seed BUKAN ERC-1155, jadi creator tidak punya saldo tradable
    ///      untuk dijual sama sekali — lantai seed terjaga secara struktural.
    function test_creatorCannotSellSeedShares() public {
        assertEq(shares.balanceOfOutcome(creator, address(m), 0), 0);
        vm.prank(creator);
        vm.expectRevert();
        m.sell(0, 1e18, 0, creator);
    }

    /// @dev Beli lalu jual seketika TIDAK BOLEH menguntungkan. Ini penjaga utama
    ///      terhadap kesalahan tanda atau pembulatan pada cost function.
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

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
cd contracts && forge test --match-contract MarketSellTest
```
Expected: FAIL — `quoteSell`/`sell` belum ada.

- [ ] **Step 3: Tambahkan ke `Market.sol`**

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

        // Seharusnya tak terjangkau: lembar seed bukan ERC-1155, jadi burn di bawah
        // sudah membatasi penjualan pada pasokan tradable. Dipertahankan sebagai
        // pernyataan eksplisit — bila suatu saat lembar seed ikut dicetak sebagai
        // ERC-1155, jalur inilah yang menangkapnya.
        if (qNew[outcome] < _seedSupply[outcome]) revert SeedFloorBreached();

        uint256 target = DPMMath.costUp(qNew);
        uint256 grossTokens = (poolWad - target) / scale; // floor: sisa debu tinggal di pool
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

- [ ] **Step 4: Jalankan dan pastikan lulus**

```bash
cd contracts && forge test --match-contract MarketSellTest -vv
```
Expected: PASS — 8 lulus.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/core/Market.sol contracts/test/unit/MarketSell.t.sol
git commit -m "feat(contracts): Market.sell — jalan keluar tetap terbuka saat protokol dipause"
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

**Kenapa proporsional, dan kenapa itu terbukti aman.** `C` homogen derajat 1, jadi menskalakan seluruh `q` dengan `(1+λ)` menaikkan pool dengan faktor yang sama tanpa menggeser `Pᵢ = qᵢ²/Σqⱼ²`. Penarikan tak-proporsional akan menjadi perdagangan berarah tanpa fee — karena itu dilarang.

Bahwa setoran tidak pernah kurang bayar juga terbukti, bukan sekadar diharapkan:

```
qBaru[i] = q[i] + ⌊q[i]·λ/WAD⌋ ≤ q[i]·(1+λ/WAD)
⇒ C(qBaru) ≤ (1+λ/WAD)·C(q) ≤ (1+λ/WAD)·poolWad          [karena poolWad ≥ C(q)]
             = poolWad + poolWad·λ/WAD ≤ poolWad + amountWad  [λ = ⌊amountWad·WAD/poolWad⌋]
⇒ costUp(qBaru) ≤ poolWad + amountWad                      [kedua ruas bilangan bulat]
⇒ needTokens ≤ tokensIn
```

- [ ] **Step 1: Tulis uji yang gagal**

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

    /// @dev Sifat yang menjadikan ini primitif LP, bukan sekadar perdagangan:
    ///      probabilitas tidak bergerak sama sekali.
    function test_addLiquidityIsProbabilityNeutral() public {
        vm.prank(alice);
        m.buy(1, 300e18, type(uint256).max, alice); // buat market tidak seimbang dulu
        uint256 before = m.probability(1);

        vm.prank(bob);
        m.addLiquidity(500e6, 0, bob);

        uint256 diff = m.probability(1) > before ? m.probability(1) - before : before - m.probability(1);
        assertLe(diff, 1e9, "probabilitas bergeser lebih dari debu pembulatan");
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
        assertEq(shares.balanceOfOutcome(bob, address(m), 0), 0, "lembar seed tidak boleh jadi ERC-1155");
    }

    function test_removeLiquidityReturnsCollateral() public {
        vm.prank(bob);
        m.addLiquidity(500e6, 0, bob);
        uint256 balBefore = usdc.balanceOf(bob);

        vm.prank(bob);
        uint256 got = m.removeLiquidity(1e17, 0, bob); // 10% dari q saat ini
        assertGt(got, 0);
        assertEq(usdc.balanceOf(bob) - balBefore, got);
        assertEq(m.poolWad(), DPMMath.costUp(m.qArray()));
    }

    /// @dev Lantai keras. Ini yang menjaga qᵢ > 0 selamanya, dan tanpanya
    ///      C(q)/q_menang bisa membagi nol saat settle.
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

    /// @dev Jalur keluar lagi: penarikan likuiditas tidak boleh diblokir pause.
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
        // tarik fraksi terbesar yang masih tercakup posisi sendiri
        uint256 lambda = Math.min((held[0] * 1e18) / q[0], (held[1] * 1e18) / q[1]);
        if (lambda > 0) m.removeLiquidity(lambda, 0, bob);
        vm.stopPrank();
        assertLe(usdc.balanceOf(bob), balBefore);
    }
}
```

Tambahkan import `Math` di berkas uji:

```solidity
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
cd contracts && forge test --match-contract MarketLiquidityTest
```
Expected: FAIL — `addLiquidity` belum ada.

- [ ] **Step 3: Tambahkan ke `Market.sol`**

```solidity
    error BadLambda();
    error InsufficientSeedShares();
    error CreatorSeedFloor();

    /// @notice Menambah likuiditas secara proporsional. Tanpa fee: ini bukan
    ///         perdagangan berarah, melainkan penskalaan seluruh market.
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

    /// @notice Menarik likuiditas secara proporsional terhadap `q` SAAT INI.
    /// @param lambdaWad fraksi wad dari q yang ditarik (0 < λ ≤ WAD).
    /// @dev Penarikan tak-proporsional dilarang: itu akan menjadi perdagangan berarah
    ///      tanpa fee. Seed creator tidak pernah bisa ditarik — lantai inilah yang
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

- [ ] **Step 4: Jalankan dan pastikan lulus**

```bash
cd contracts && forge test --match-contract MarketLiquidityTest -vv
```
Expected: PASS — 10 lulus.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/core/Market.sol contracts/test/unit/MarketLiquidity.t.sol
git commit -m "feat(contracts): likuiditas proporsional netral-probabilitas dengan lantai seed creator"
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

- [ ] **Step 1: Tulis uji yang gagal**

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

    /// @dev Payout dipotret sekali saat settle. Kalau tidak, penebus pertama dan
    ///      terakhir akan menerima kurs berbeda.
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

    /// @dev Konsekuensi lantai seed: pembagi tidak pernah nol.
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
        m.fail(); // masih Open dan belum lewat deadline
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

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
cd contracts && forge test --match-contract MarketLifecycleTest
```
Expected: FAIL — `close`/`settle`/`fail`/`void` belum ada.

- [ ] **Step 3: Tambahkan ke `Market.sol`**

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

    /// @dev Kurs payout DIPOTRET di sini sehingga penebus pertama dan terakhir
    ///      menerima kurs yang sama. `_q[outcome]` dijamin > 0 oleh lantai seed creator.
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

    /// @notice Tidak ada outcome yang bisa ditetapkan → semua pihak dilikuidasi pada pᵢ.
    function fail() external {
        bool byModule = msg.sender == config.addresses(ConfigKeys.RESOLUTION_MODULE);
        bool pastDeadline = block.timestamp >= settlementDeadline;
        if (!byModule && !pastDeadline) revert BadTransition();
        if (status == Status.Settled || status == Status.Failed || status == Status.Voided) revert BadTransition();

        _snapshotLiquidation();
        _setStatus(Status.Failed);
        _distributeFees(false);
    }

    /// @notice Pembatalan darurat oleh guardian, hanya sebelum market ditutup.
    ///         Setoran settlement DISITA — inilah yang membuat market abusif mahal.
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

    /// @param slashDeposit true saat void — setoran ke Treasury, bukan ke kas resolver.
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

- [ ] **Step 4: Jalankan dan pastikan lulus**

```bash
cd contracts && forge test --match-contract MarketLifecycleTest -vv
```
Expected: PASS — 11 lulus.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/core/Market.sol contracts/test/unit/MarketLifecycle.t.sol
git commit -m "feat(contracts): siklus hidup Market dengan kurs payout dan likuidasi dipotret"
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

**Perubahan makna `poolWad` setelah resolusi.** Selama `Open/Closed/Proposed/Disputed`, `poolWad == costUp(q)`. Sejak `settle`/`fail`/`void`, `q` beku dan `poolWad` berubah makna menjadi **sisa kewajiban yang belum diklaim**, berkurang setiap klaim. Invarian Task 18 memisahkan dua rezim ini.

Bahwa klaim tidak pernah melebihi pool juga terbukti:
- Settled: `Σᵢ ⌊aᵢ·r/WAD⌋ ≤ ⌊(Σaᵢ)·r/WAD⌋ = ⌊q_menang·r/WAD⌋ ≤ poolWad` dengan `r = ⌊WAD·poolWad/q_menang⌋`.
- Failed/Voided: `Σᵢ ⌊qᵢ·pᵢ/WAD⌋ ≤ Σᵢ qᵢ·pᵢ = C(q) ≤ poolWad` (identitas Euler).

- [ ] **Step 1: Tulis uji yang gagal**

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
        assertEq(m.seedSharesOf(creator)[0], 0, "sisi kalah harus hangus");
        assertEq(m.seedSharesOf(creator)[1], 0);
    }

    /// @dev Persamaan konservasi: total yang ditebus tidak boleh melebihi pool.
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

    /// @dev Redeem harus berhasil walau protokol dipause.
    function test_redeemSucceedsWhilePaused() public {
        _settleAs(1);
        vm.prank(guardian);
        config.pause();
        vm.prank(alice);
        assertGt(m.redeem(alice), 0);
    }

    /// @dev Identitas Euler: likuidasi membayar pᵢ per lembar dan menghabiskan pool.
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
        assertGt(b, 0, "pemegang sisi kalah tetap dapat pengembalian saat market gagal");
        assertGt(c, 0);
        assertLe(m.poolWad(), 3); // hanya debu tersisa
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

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
cd contracts && forge test --match-contract MarketExitTest
```
Expected: FAIL — `redeem`/`liquidate`/`sweepUnclaimed` belum ada.

- [ ] **Step 3: Tambahkan ke `Market.sol`**

```solidity
    error NotSettled();
    error NotLiquidatable();
    error NothingToClaim();
    error TooEarly();

    /// @notice Menebus lembar sisi menang pada kurs yang dipotret saat settle.
    /// @dev Lembar sisi kalah — tradable maupun seed — bernilai nol dan dihapus.
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

    /// @notice Market gagal atau dibatalkan: setiap sisi dibayar pᵢ per lembar.
    /// @dev Menurut identitas Euler Σ pᵢ·qᵢ = C(q), pembayaran ini persis menghabiskan pool.
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

    /// @notice Menyapu sisa yang tak pernah diklaim ke Treasury setelah jendela panjang.
    function sweepUnclaimed() external {
        if (status != Status.Settled && status != Status.Failed && status != Status.Voided) revert BadTransition();
        if (block.timestamp < resolvedAt + config.params(ConfigKeys.SWEEP_UNCLAIMED_AFTER)) revert TooEarly();

        uint256 bal = collateral.balanceOf(address(this));
        if (bal == 0) revert ZeroAmount();
        poolWad = 0;
        collateral.safeTransfer(config.addresses(ConfigKeys.TREASURY), bal);
    }
```

- [ ] **Step 4: Jalankan dan pastikan lulus**

```bash
cd contracts && forge test --match-contract MarketExitTest -vv
```
Expected: PASS — 10 lulus.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/core/Market.sol contracts/test/unit/MarketExit.t.sol
git commit -m "feat(contracts): redeem, likuidasi Euler, dan sapu dana tak diklaim"
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

- [ ] **Step 1: Tulis uji yang gagal**

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

    /// @dev Tanda tangan yang sudah dipakai tidak boleh bisa dipakai ulang.
    function test_approvalCannotBeReplayed() public {
        IMarket.Params memory p = _params();
        bytes memory sig = _sign(p, 1);
        vm.startPrank(creator);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        vm.expectRevert(MarketFactory.ApprovalAlreadyUsed.selector);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        vm.stopPrank();
    }

    /// @dev Mengubah satu bidang saja membuat tanda tangan tidak sah — kurator
    ///      menyetujui market TERTENTU, bukan memberi izin umum.
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

Tambahkan pembantu ke `contracts/test/helpers/Fixtures.sol` supaya `OutcomeShares` bisa memakai factory sungguhan sebagai registry:

```solidity
    /// @dev OutcomeShares.setRegistry hanya sekali seumur hidup, jadi uji yang memakai
    ///      MarketFactory sungguhan men-deploy instance OutcomeShares yang bersih.
    function _useFactoryAsRegistry(address factory_) internal {
        shares = new OutcomeShares("");
        shares.setRegistry(factory_);
        config.setAddress(ConfigKeys.OUTCOME_SHARES, address(shares));
    }
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
cd contracts && forge test --match-contract MarketFactoryTest
```
Expected: FAIL — `src/core/MarketFactory.sol` tidak ditemukan.

- [ ] **Step 3: Implementasikan `contracts/src/core/MarketFactory.sol`**

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
/// @notice Mencetak clone Market dan menjadi registry yang dipercaya OutcomeShares.
/// @dev Pembuatan market menuntut approval EIP-712 dari agent Kurator. Di P1
///      penanda tangan adalah satu alamat di ConfigRegistry; P2 menggantinya dengan
///      pencarian di AgentRegistry tanpa mengubah bentuk tanda tangan.
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
        __EIP712_init("0G-Delphi", "1");
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

    /// @notice Diekspos agar penanda tangan off-chain (agent Kurator) dapat menghitung
    ///         digest yang sama persis tanpa menebak domain separator.
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
        // Registrasi HARUS mendahului initialize: Market memancarkan event dan,
        // sejak trade pertama, memanggil OutcomeShares yang menanyakan registry ini.
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

Di dalam `run()`, setelah `DeployLib.applyDefaults(...)` dan sebelum `vm.stopBroadcast()`:

```solidity
        OutcomeShares sharesContract = new OutcomeShares("https://delphi.0g/{id}.json");
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

Dan di `_writeManifest`, tambahkan sebelum baris `MockUSDC` (yang tetap jadi `vm.serializeAddress` terakhir):

```solidity
        vm.serializeAddress(contractsKey, "OutcomeShares", address(sharesContract));
        vm.serializeAddress(contractsKey, "MarketImplementation", address(marketImpl));
        vm.serializeAddress(contractsKey, "MarketFactory", address(factory));
```

Ubah tanda tangan `_writeManifest` menjadi menerima keenam alamat itu.

- [ ] **Step 5: Jalankan dan pastikan lulus**

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
git commit -m "feat(contracts): MarketFactory dengan clone dan approval kurator EIP-712"
```

---

## Task 18: Suite invarian INV-1..10

**Files:**
- Create: `contracts/test/invariant/MarketHandler.sol`, `contracts/test/invariant/MarketInvariants.t.sol`
- Test: berkas di atas

**Interfaces:**
- Consumes: seluruh `Market` (Task 11–16)
- Produces: sepuluh invarian bernama INV-1..10 dari §14.1 spec

**Dua rezim.** `poolWad == costUp(q)` berlaku **hanya sebelum resolusi**. Sejak `settle`/`fail`/`void`, `q` beku dan `poolWad` menyusut seiring klaim. Invarian di bawah memisahkan kedua rezim ini secara eksplisit; menggabungkannya akan menghasilkan invarian yang salah.

- [ ] **Step 1: Tulis handler**

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

/// @notice Menjalankan aksi acak terbatas terhadap satu Market dan mencatat variabel
///         hantu untuk pemeriksaan konservasi. Semua panggilan dibungkus try/catch
///         supaya revert yang wajar (slippage, saldo kurang) tidak menghentikan run.
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

- [ ] **Step 2: Tulis uji invarian**

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

    /// INV-2 — collateral yang dipegang selalu menutup pool, fee, dan setoran.
    function invariant_INV2_collateralCoversObligations() public view {
        assertGe(usdc.balanceOf(address(m)), m.collateralOwed());
    }

    /// INV-6 — lantai seed tidak pernah tertembus, jadi qᵢ tidak pernah nol.
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

    /// INV-8 — probabilitas berjumlah satu dalam batas debu.
    function invariant_INV8_probabilitiesSumToOne() public view {
        uint256 sum = m.probability(0) + m.probability(1);
        assertLe(sum, 1e18);
        assertLe(1e18 - sum, 2);
    }

    /// INV-3 & INV-4 — klaim tidak pernah melebihi pool; likuidasi menghabiskannya.
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
        assertLe(m.poolWad(), 4); // hanya debu Euler yang tersisa
    }

    /// INV-5 — beli lalu jual seketika tidak pernah menguntungkan.
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

    /// INV-7 — kerugian creator tidak pernah melampaui 1 − 1/√2 ≈ 29.29% dari seed.
    ///         Kasus terburuk: seluruh aliran order ke satu sisi, lalu sisi itu menang.
    function testFuzz_INV7_creatorLossBounded(uint96 flow) public {
        vm.assume(flow > 1e18 && flow < 1e24);
        _fund(alice, 100_000_000e6, address(m));
        vm.prank(alice);
        try m.buy(1, uint256(flow), type(uint256).max, alice) {} catch { return; }

        vm.warp(m.tradingEnd());
        m.close();
        vm.prank(resolutionModule);
        m.settle(1); // sisi yang dibeli habis-habisan itulah yang menang

        vm.prank(creator);
        uint256 back = m.redeem(creator);
        assertGe(back, (SEED * 7070) / 10_000);
    }

    /// INV-9 — penambahan likuiditas proporsional tidak menggeser probabilitas.
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

    /// INV-10 — pause tidak pernah menutup jalan keluar mana pun.
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

- [ ] **Step 3: Jalankan suite invarian**

```bash
cd contracts && forge test --match-path 'test/invariant/*' -vv
```
Expected: PASS — 4 invarian + 5 uji terarah.

- [ ] **Step 4: Jalankan pada intensitas CI**

```bash
cd contracts && FOUNDRY_PROFILE=ci forge test --match-path 'test/invariant/*' -vv
```
Expected: PASS — 512 run × kedalaman 128. Bila ada yang gagal, Foundry mencetak sekuens panggilan pereproduksi; **jangan longgarkan invariannya — perbaiki kontraknya.**

- [ ] **Step 5: Commit**

```bash
git add contracts/test/invariant
git commit -m "test: suite invarian INV-1..10 untuk mesin market DPM"
```

---

## Task 19: Pengetatan CI dan gerbang cakupan

**Files:**
- Modify: `.github/workflows/ci.yml`, `Makefile`

**Interfaces:**
- Consumes: seluruh tugas sebelumnya
- Produces: CI yang menolak vektor yang tidak deterministik dan cakupan yang menurun

- [ ] **Step 1: Perbarui `.github/workflows/ci.yml`**

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

      # Vektor harus deterministik: menjalankan ulang generator tidak boleh
      # menghasilkan diff. Kalau berubah, salah satu sisi cermin sudah bergeser.
      - name: vektor DPM deterministik
        run: |
          npm run gen:vectors
          git diff --exit-code contracts/test/vectors/dpm.json

      - name: test (profil ci)
        run: cd contracts && FOUNDRY_PROFILE=ci forge test -vvv

      - name: gerbang cakupan pada core
        run: |
          cd contracts
          forge coverage --report lcov --no-match-coverage 'test|script|mocks'
          npx --yes lcov-summary lcov.info || true
          awk -F: '/^SF:.*src\/(core|math)\//{f=1} f&&/^LF:/{lf+=$2} f&&/^LH:/{lh+=$2; f=0} END{
            pct = (lf>0) ? lh*100/lf : 0;
            printf "cakupan baris core+math: %.2f%% (%d/%d)\n", pct, lh, lf;
            if (pct < 90) { print "GAGAL: cakupan di bawah 90%"; exit 1 }
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

- [ ] **Step 2: Tambahkan target `Makefile`**

```makefile
coverage:
	cd contracts && forge coverage --report summary --no-match-coverage 'test|script|mocks'

ci:
	cd contracts && forge fmt --check && forge build && FOUNDRY_PROFILE=prod forge build
	npm run gen:vectors && git diff --exit-code contracts/test/vectors/dpm.json
	cd contracts && FOUNDRY_PROFILE=ci forge test -vvv
	npm test --workspaces --if-present
```

Tambahkan `coverage ci` ke baris `.PHONY`.

- [ ] **Step 3: Jalankan gerbang lengkap secara lokal**

```bash
make ci
make coverage
```
Expected: semua hijau; cakupan baris `src/core` + `src/math` ≥ 90%.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml Makefile
git commit -m "chore(ci): gerbang via_ir, determinisme vektor, dan cakupan 90% pada core"
```

**✅ P1 selesai.** Satu market biner dapat dibuat lewat factory, diperdagangkan dua arah, didalamkan likuiditasnya, ditutup, diselesaikan atau digagalkan, dan ditebus sepenuhnya — dengan sepuluh invarian yang menjaganya di bawah fuzz stateful.

---

## Lampiran A — Peta cakupan spec

Setiap bagian spec yang masuk lingkup P0/P1 dipetakan ke tugas yang mengimplementasikannya.

| Bagian spec | Isi | Tugas |
|---|---|---|
| §2 D1, D2 | DPM sebagai mekanisme harga; mUSDC 6 desimal + wad internal | 3, 6–8, 11 |
| §3.1 | Fakta chain Galileo/mainnet | 2 (`networks.ts`), 1 (`foundry.toml`) |
| §4.1–4.2 | Cost function, harga, probabilitas, Euler, homogenitas | 6, 7 |
| §4.3 | Contoh angka & relasi `L ↔ q` | 11 (`seedShares`) |
| §4.4 | Kebijakan pembulatan, pool disetel ke `costUp`, tolak debu | 6, 12, 13 |
| §5.1 | Enum status dan tabel operasi per status | 15 |
| §6.1 | Peta kontrak & pemisahan upgradeable / pemegang dana | 4, 10, 11, 17 |
| §6.2 | `DPMMath` lengkap termasuk `sharesForSpend` bentuk tertutup | 6, 7, 8 |
| §6.3 | `IMarket`, lembar seed vs tradable, fee di luar invarian, guardian | 11–16 |
| §6.4 | `MarketFactory.createMarket` + tanda tangan kurator | 17 |
| §12.1 | Tiga saklar mode + pemeriksaan silang | 2 |
| §12.2–12.3 | Env dan manifest deployment | 5 |
| §12.4 | Struktur repo | 1 |
| §13.1 | Tabel risiko kontrak: reentrancy, allowlist collateral, presisi, luapan, `q=0`, front-running, `close()`, sapu, pause | 4, 12 (Step 5), 13–16, 18 |
| §13.3 | Immutable vs UUPS, kewenangan guardian sempit | 4, 11, 17 |
| §14.1 | INV-1..10 | 18 |
| §14.2 L1–L2 | Unit, invarian, uji diferensial, gerbang cakupan | 6–18, 19 |
| §17 | Tabel parameter bawaan dan batas keras | 5 |

**Bagian spec yang sengaja BUKAN lingkup di sini** (dan fase pemiliknya):
§7 modul resolusi → P2 · §8 lapisan agent, `AgentAccount`, ERC-7857 → P4 · §9 indexer → P3 ·
§10 SDK → P3 · §11 frontend → P5 · §13.2 keamanan ekonomi resolusi → P2 · §14.2 L3–L6 → P3–P6.

Titik jahitan yang sudah disiapkan untuk fase berikutnya:
`ConfigKeys.RESOLUTION_MODULE` (P2 mengganti EOA uji dengan kontrak sungguhan) ·
`ConfigKeys.CURATOR_SIGNER` (P2 mengganti alamat tunggal dengan pencarian `AgentRegistry`) ·
`ConfigKeys.TREASURY` (P4) · event `Trade` sengaja tanpa `agentId`, karena atribusi agent
dipancarkan oleh `AgentAccount`, bukan oleh market.

---

## Lampiran B — Ringkasan gerbang

| Perintah | Kapan | Harus |
|---|---|---|
| `make fmt-check` | tiap commit | bersih |
| `make build` | tiap commit | sukses |
| `make prod` | tiap commit | sukses (menangkap kode yang hanya jalan tanpa `via_ir`) |
| `make test` | tiap commit | semua hijau |
| `make vectors && git diff --exit-code` | tiap commit yang menyentuh matematika DPM | tanpa diff |
| `make invariant` | setelah Task 18 | INV-1..10 hijau pada 512×128 |
| `make coverage` | setelah Task 19 | `src/core` + `src/math` ≥ 90% baris |
| `make demo` | setelah Task 5 dan Task 17 | manifest tertulis, alamat tercetak |
