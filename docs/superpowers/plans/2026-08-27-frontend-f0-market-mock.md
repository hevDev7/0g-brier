# Frontend F0 + The Market Page (mock mode) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run dev -w frontend` comes up and `/market/0x…` renders a complete, clickable market detail page — the probability panel, the running payout panel, the order ticket, the trade tape — entirely from fixtures, with no anvil and no deployed market needed.

**Architecture:** A Next.js 16 (App Router) application as a third npm workspace. All data flows through a single `DataSource` interface; F0 implements only `MockSource`, and components never know which mode is active. The probability and payout maths comes from `@0g-delphi/protocol` — the TypeScript mirror already pinned to `DPMMath.sol` by a 512-vector differential test — so the numbers on screen come from the same source as the numbers on chain.

**Tech Stack:** Next.js 16.3.3 (App Router) · React 19.2.8 · TypeScript ^5 · Tailwind CSS v4 (CSS-first, `@theme inline`) · TanStack Query 5 · Vitest 4 + Testing Library · `@0g-delphi/protocol` (workspace)

**Spec:** `docs/superpowers/specs/2026-08-27-0g-delphi-frontend-design.md`

---

## Global Constraints

- **Next.js 16.3.3**, React **19.2.8**, TypeScript **^5** — the versions `create-next-app@16.3.3` actually produces, verified with a real scaffold. The parent spec says "Next.js 15"; that is one major behind and has been superseded (see the Ruling in §Deviations).
- **Tailwind v4 does not use a `tailwind.config.js`.** Theme tokens are defined in CSS through `@theme inline`, and dark mode through `@custom-variant`. Do not create a Tailwind JS config file.
- **Probability is `pᵢ²`.** Every value labelled `%` comes from `dpm.probability`. No `dpm.price` may be labelled as a percentage.
- **Payout per share is `1/pᵢ`, not `1/Pᵢ`.** Every value labelled `×` comes from `1/dpm.price`. **There must be no `1/probability` anywhere in the codebase.**
- **Decimal conversion imports `@0g-delphi/protocol`** (`WAD`, `scaleFor`, `toWad`, `toTokensFloor`, `toTokensCeil`). The frontend must not have its own `1e12` or `1e18` constants outside `lib/format.ts`.
- **Every number is held as a `bigint`.** No `Number()` on a monetary value, no `parseFloat` on a wad value. Formatting goes from `bigint` to string directly.
- **`unavailable` is a member of the `Query<T>` union.** A component that does not handle it must not compile. Never render `0` or `—` for data the current mode cannot know.
- All tests green before committing; `npx tsc --noEmit` clean; Conventional Commits; one commit per task.

### Deviations from the spec, deliberate

| Spec | Rencana | Alasan |
|---|---|---|
| §3 "Next.js 15 (App Router)" | **Next.js 16.3.3** | Next 15 is no longer the current major. Starting a new project on a major already behind means owing a migration from day one. Verified with a real scaffold. |
| §3 "Tailwind" (implicitly v3, with a config file) | **Tailwind v4**, CSS-first | v4 is what `create-next-app` installs and it no longer uses `tailwind.config.js`. Theme tokens move into `@theme inline` in `globals.css`. |
| §3 "Radix for dialog/select/tooltip" | **absent in F0** | F0 plus the market page needs none of the three. YAGNI; add it when something genuinely needs it. |

---

## File Structure

```
frontend/
├─ package.json                    workspace ketiga: @0g-delphi/frontend
├─ next.config.ts                  transpilePackages for the TS workspace package
├─ postcss.config.mjs              @tailwindcss/postcss
├─ tsconfig.json                   alias @/*
├─ vitest.config.ts                jsdom + plugin react
├─ vitest.setup.ts                 jest-dom matchers
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx                shell + QueryProvider + kelas tema
│  │  ├─ globals.css               token warna, @theme inline, @custom-variant dark
│  │  ├─ page.tsx                  a placeholder linking to the fixture markets
│  │  └─ market/[address]/page.tsx the detail page
│  ├─ lib/
│  │  ├─ format.ts                 ALL the number-formatting rules, in one place
│  │  ├─ dpm-view.ts               display derivations: probability, payout per share
│  │  └─ data/
│  │     ├─ types.ts               Capability, Query, DataSource, model domain
│  │     ├─ mock.ts                MockSource + fixture
│  │     └─ index.ts               mode selector from env
│  ├─ hooks/
│  │  ├─ provider.tsx              DataSourceProvider + QueryClientProvider
│  │  ├─ useMarket.ts              Query<MarketDetail>
│  │  ├─ useTrades.ts              Query<Trade[]>
│  │  └─ useQuote.ts               a direct local quote, with no RPC
│  └─ components/
│     ├─ primitives/               Unavailable, Badge, CopyAddress, Countdown, Stat
│     └─ market/                   ProbabilityPanel, PayoutPanel, OrderTicket, TradeTape
└─ test/                           vitest tests, mirroring the src structure
```

`lib/format.ts` is the only place the formatting rules live. Components must not format numbers themselves — differing formats between screens is the fastest way for a numbers UI to lose its credibility.

---

## Task 1: The Next.js workspace and monorepo integration

**Files:**
- Create: all of `frontend/` through `create-next-app`, then `frontend/vitest.config.ts`, `frontend/vitest.setup.ts`, `frontend/test/smoke.test.ts`
- Modify: `package.json` (root), `frontend/package.json`, `frontend/next.config.ts`, `.github/workflows/ci.yml`, `Makefile`

**Interfaces:**
- Consumes: `@0g-delphi/protocol` (`WAD`, `toWad`, `toTokensFloor`, `toTokensCeil`, `dpm`)
- Produces: the `@0g-delphi/frontend` workspace with `dev`/`build`/`test`/`typecheck`; a cross-workspace import proven to work

- [ ] **Step 1: Scaffold aplikasi**

From the repo root:

```bash
npx --yes create-next-app@16.3.3 frontend \
  --ts --tailwind --eslint --app --src-dir --import-alias "@/*" \
  --use-npm --no-turbopack --yes
```

This produces Next 16.3.3, React 19.2.8, Tailwind v4 through `@tailwindcss/postcss`, and **no** `tailwind.config.js` — which is correct for v4; do not add one.

Delete the unused example files:

```bash
rm -f frontend/public/*.svg frontend/README.md frontend/AGENTS.md frontend/CLAUDE.md
rm -rf frontend/.git
```

`create-next-app` initializes its own git repo inside `frontend/`; that must be removed or it becomes an accidental submodule.

- [ ] **Step 2: Daftarkan sebagai workspace**

In the root `package.json`, change:

```json
  "workspaces": ["packages/*"],
```

to:

```json
  "workspaces": ["packages/*", "frontend"],
```

- [ ] **Step 3: Name the package and add the scripts**

In `frontend/package.json`, change `"name"` to `"@0g-delphi/frontend"` and replace the `"scripts"` block with:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
```

Add `@0g-delphi/protocol` to `"dependencies"`:

```json
    "@0g-delphi/protocol": "*",
```

and add to `"devDependencies"`:

```json
    "@testing-library/dom": "^10.4.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.3.2",
    "@vitejs/plugin-react": "^6.1.0",
    "jsdom": "^30.0.1",
    "vitest": "^4.1.11",
```

- [ ] **Step 4: Ajarkan Next mentranspilasi paket workspace**

`@0g-delphi/protocol` publishes raw TypeScript (`"main": "./src/index.ts"`), so Next must transpile it. Change `frontend/next.config.ts` to:

```ts
import type {NextConfig} from "next";

const nextConfig: NextConfig = {
  // @0g-delphi/protocol exports raw .ts, not compiled JS. Without this, the
  // build fails when importing the DPM mirror.
  transpilePackages: ["@0g-delphi/protocol"],
};

export default nextConfig;
```

- [ ] **Step 5: Konfigurasi Vitest**

`frontend/vitest.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import {resolve} from "node:path";
import {defineConfig} from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {"@": resolve(__dirname, "./src")},
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
```

`frontend/vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 6: Write the smoke test that proves the cross-workspace import works**

This is not a formality test. It proves the thing most likely to break in a monorepo setup: whether the frontend can genuinely call the DPM mirror.

`frontend/test/smoke.test.ts`:

```ts
import {describe, expect, it} from "vitest";
import {WAD, dpm} from "@0g-delphi/protocol";

describe("integrasi workspace", () => {
  it("imports WAD from @0g-delphi/protocol", () => {
    expect(WAD).toBe(1_000_000_000_000_000_000n);
  });

  it("the DPM mirror computes the correct 3-4-5 probabilities", () => {
    // P_i = q_i^2 / (q_0^2 + q_1^2); for (3,4): 9/25 and 16/25
    expect(dpm.probability([3n * WAD, 4n * WAD], 0)).toBe(360_000_000_000_000_000n);
    expect(dpm.probability([3n * WAD, 4n * WAD], 1)).toBe(640_000_000_000_000_000n);
  });

  it("the marginal price is NOT the probability — the two differ", () => {
    const q: readonly [bigint, bigint] = [3n * WAD, 4n * WAD];
    expect(dpm.price(q, 1)).toBe(800_000_000_000_000_000n);   // 0.8
    expect(dpm.probability(q, 1)).toBe(640_000_000_000_000_000n); // 0.64
    expect(dpm.price(q, 1)).not.toBe(dpm.probability(q, 1));
  });
});
```

- [ ] **Step 7: Install and run**

```bash
npm install
npm test -w @0g-delphi/frontend
npx tsc --noEmit -p frontend
```
Expected: 3 tests pass, tsc clean.

- [ ] **Step 8: Verify server dev menyala**

```bash
cd frontend && timeout 60 npx next dev --port 3100 &
sleep 25 && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3100/
```
Expected: `200`. Hentikan server setelahnya.

- [ ] **Step 9: Add it to CI and the Makefile**

In `.github/workflows/ci.yml`, inside the `typescript` job, after the `npm test --workspaces --if-present` step, add:

```yaml
      - name: typecheck frontend
        run: npx tsc --noEmit -p frontend
      - name: build frontend
        run: npm run build -w @0g-delphi/frontend
```

In the `Makefile`, add the targets and include `fe fe-build` on the `.PHONY` line:

```makefile
fe:       ; npm run dev -w @0g-delphi/frontend
fe-build: ; npm run build -w @0g-delphi/frontend && npx tsc --noEmit -p frontend
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(frontend): Next.js 16 workspace with a proven cross-workspace import"
```

---

## Task 2: Visual tokens and `lib/format.ts`

**Files:**
- Modify: `frontend/src/app/globals.css`, `frontend/src/app/layout.tsx`
- Create: `frontend/src/lib/format.ts`
- Test: `frontend/test/format.test.ts`

**Interfaces:**
- Consumes: `WAD` from `@0g-delphi/protocol`
- Produces: `formatProbability(probWad)`, `formatProbabilityDelta(fromWad, toWad)`, `formatPayout(payoutWad)`, `formatCollateral(amount, decimals)`, `formatShares(sharesWad)`, `formatPricePerShare(priceWad)`, `shortAddress(address)`, `formatCountdown(secondsRemaining)`; token CSS `--bg --bg-sunken --border --text --text-muted --text-faint --accent --pos --neg --warn --verified`

- [ ] **Step 1: Write the failing tests**

`frontend/test/format.test.ts`:

```ts
import {describe, expect, it} from "vitest";
import {
  formatCollateral, formatCountdown, formatPayout, formatPricePerShare,
  formatProbability, formatProbabilityDelta, formatShares, shortAddress,
} from "@/lib/format";

const WAD = 10n ** 18n;

describe("formatProbability", () => {
  it("formats a wad probability as a percentage with 1 decimal", () => {
    expect(formatProbability(590_000_000_000_000_000n)).toBe("59.0%");
    expect(formatProbability(410_000_000_000_000_000n)).toBe("41.0%");
    expect(formatProbability(WAD / 2n)).toBe("50.0%");
  });

  it("rounds half up rather than truncating", () => {
    // 0.6385 -> 63.85% -> 63.9%
    expect(formatProbability(638_500_000_000_000_000n)).toBe("63.9%");
  });

  it("menangani ekstrem", () => {
    expect(formatProbability(0n)).toBe("0.0%");
    expect(formatProbability(WAD)).toBe("100.0%");
  });
});

describe("formatProbabilityDelta", () => {
  it("is always signed, in points", () => {
    expect(formatProbabilityDelta(590_000_000_000_000_000n, 638_000_000_000_000_000n)).toBe("+4.8 pt");
    expect(formatProbabilityDelta(638_000_000_000_000_000n, 590_000_000_000_000_000n)).toBe("-4.8 pt");
    expect(formatProbabilityDelta(WAD / 2n, WAD / 2n)).toBe("+0.0 pt");
  });
});

describe("formatPayout", () => {
  it("uses 2 decimals with a multiplication sign", () => {
    expect(formatPayout(1_301_700_000_000_000_000n)).toBe("1.30×");
    expect(formatPayout(1_562_000_000_000_000_000n)).toBe("1.56×");
  });
});

describe("formatCollateral", () => {
  it("respects the token decimals and groups thousands", () => {
    expect(formatCollateral(1_234_560_000n, 6)).toBe("1,234.56");
    expect(formatCollateral(100_000_000n, 6)).toBe("100.00");
    expect(formatCollateral(990_000n, 6)).toBe("0.99");
  });

  it("mengelompokkan angka besar", () => {
    expect(formatCollateral(1_234_567_890_123n, 6)).toBe("1,234,567.89");
  });
});

describe("formatShares and formatPricePerShare", () => {
  it("shows shares to 2 decimals and prices to 4", () => {
    expect(formatShares(126_320_000_000_000_000_000n)).toBe("126.32");
    expect(formatPricePerShare(783_800_000_000_000_000n)).toBe("0.7838");
  });
});

describe("shortAddress", () => {
  it("elides the middle", () => {
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });
});

describe("formatCountdown", () => {
  it("picks the two largest units", () => {
    expect(formatCountdown(2 * 3600 + 14 * 60)).toBe("2j 14m");
    expect(formatCountdown(3 * 86400 + 5 * 3600)).toBe("3h 5j");
    expect(formatCountdown(45 * 60)).toBe("45m");
  });

  it("says closed once time is up", () => {
    expect(formatCountdown(0)).toBe("tutup");
    expect(formatCountdown(-10)).toBe("tutup");
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
npm test -w @0g-delphi/frontend
```
Expected: FAIL — the `@/lib/format` module is not found.

- [ ] **Step 3: Implementasikan `frontend/src/lib/format.ts`**

```ts
/**
 * Satu-satunya tempat aturan pemformatan angka hidup (spec §7.2).
 * Components must not format numbers themselves: differing formats between
 * screens is the fastest way for a numbers UI to lose its credibility.
 *
 * Every function goes from bigint to string directly. No Number() and no
 * parseFloat on monetary values — double precision cannot represent a wad
 * value, and silent rounding on money is unacceptable.
 */

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Rounds half-up to `places` decimals, purely in bigint. */
function formatFixed(value: bigint, decimals: number, places: number): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const factor = 10n ** BigInt(places);
  const scaled = (magnitude * factor + scale / 2n) / scale;
  const whole = groupThousands((scaled / factor).toString());
  const body = places > 0 ? `${whole}.${(scaled % factor).toString().padStart(places, "0")}` : whole;
  return negative ? `-${body}` : body;
}

/** Implied probability (p_i^2) in wad → "59.0%". */
export function formatProbability(probWad: bigint): string {
  return `${formatFixed(probWad * 100n, 18, 1)}%`;
}

/** Probability shift in percentage points, always signed. */
export function formatProbabilityDelta(fromWad: bigint, toWad: bigint): string {
  const delta = (toWad - fromWad) * 100n;
  const body = formatFixed(delta, 18, 1);
  return delta < 0n ? `${body} pt` : `+${body} pt`;
}

/** Payout per share (1/p_i) in wad → "1.30×". */
export function formatPayout(payoutWad: bigint): string {
  return `${formatFixed(payoutWad, 18, 2)}×`;
}

/** A collateral amount in the smallest token unit → "1,234.56". */
export function formatCollateral(amount: bigint, decimals: number): string {
  return formatFixed(amount, decimals, 2);
}

/** Outcome shares (18 decimals) → "126.32". */
export function formatShares(sharesWad: bigint): string {
  return formatFixed(sharesWad, 18, 2);
}

/** Price per share in wad → "0.7838". Four decimals: over the 0..1 range, two are not enough. */
export function formatPricePerShare(priceWad: bigint): string {
  return formatFixed(priceWad, 18, 4);
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** The two largest units; no seconds — second precision implies an accuracy blocks do not have. */
export function formatCountdown(secondsRemaining: number): string {
  if (secondsRemaining <= 0) return "tutup";
  const days = Math.floor(secondsRemaining / 86_400);
  const hours = Math.floor((secondsRemaining % 86_400) / 3_600);
  const minutes = Math.floor((secondsRemaining % 3_600) / 60);
  if (days > 0) return `${days}h ${hours}j`;
  if (hours > 0) return `${hours}j ${minutes}m`;
  return `${minutes}m`;
}
```

- [ ] **Step 4: Run them and confirm they pass**

```bash
npm test -w @0g-delphi/frontend
```
Expected: PASS — 14 lulus (3 asap + 11 format).

- [ ] **Step 5: Write the visual tokens**

Replace the entire contents of `frontend/src/app/globals.css` with:

```css
@import "tailwindcss";

/* Tailwind v4 has no JS config file. The class-based dark mode is declared
   here, and the theme tokens are exported through @theme inline. */
@custom-variant dark (&:is(.dark *));

:root {
  /* One neutral ramp carries every surface and every piece of text. */
  --n-0:#ffffff; --n-1:#fafafa; --n-2:#f4f4f5; --n-3:#e4e4e7;
  --n-4:#d4d4d8; --n-6:#a1a1aa; --n-8:#52525b; --n-10:#27272a; --n-12:#09090b;

  --bg:var(--n-0);
  --bg-sunken:var(--n-1);
  --border:var(--n-3);
  --text:var(--n-12);
  --text-muted:var(--n-8);
  --text-faint:var(--n-6);

  /* One accent. Used for the primary action and the focus ring, never for decoration. */
  --accent:#2563eb;

  /* Semantic: an element may be coloured ONLY when its colour carries
     information that exists nowhere else. */
  --pos:#15803d;
  --neg:#b91c1c;
  --warn:#a16207;
  --verified:#15803d;
}

.dark {
  --bg:var(--n-12);
  --bg-sunken:#050507;
  --border:#27272a;
  --text:var(--n-1);
  --text-muted:var(--n-6);
  --text-faint:var(--n-8);
  --accent:#3b82f6;
  --pos:#4ade80;
  --neg:#f87171;
  --warn:#fbbf24;
  --verified:#4ade80;
}

@theme inline {
  --color-bg:var(--bg);
  --color-bg-sunken:var(--bg-sunken);
  --color-border:var(--border);
  --color-text:var(--text);
  --color-text-muted:var(--text-muted);
  --color-text-faint:var(--text-faint);
  --color-accent:var(--accent);
  --color-pos:var(--pos);
  --color-neg:var(--neg);
  --color-warn:var(--warn);
  --color-verified:var(--verified);
}

body {
  background: var(--bg);
  color: var(--text);
  /* Numbers line up on nearly every screen in this product. Without
     tabular-nums, columns jitter as they update and tables become hard to
     scan — this is a functional requirement, not an aesthetic preference. */
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 6: Sederhanakan layout**

Replace `frontend/src/app/layout.tsx` with:

```tsx
import type {Metadata} from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "0G-Delphi",
  description: "Binary prediction markets on 0G Chain",
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="id">
      <body className="min-h-dvh bg-bg text-text antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 7: Verify build masih bersih**

```bash
npm run build -w @0g-delphi/frontend && npx tsc --noEmit -p frontend
```
Expected: the build succeeds, tsc clean. If Tailwind complains about `@custom-variant`, check that the `tailwindcss` version really is v4 — that syntax does not exist in v3.

- [ ] **Step 8: Commit**

```bash
git add frontend package.json package-lock.json
git commit -m "feat(frontend): visual tokens and bigint-based number formatting"
```

---

## Task 3: The data layer — types, `dpm-view`, and `MockSource`

**Files:**
- Create: `frontend/src/lib/dpm-view.ts`, `frontend/src/lib/data/types.ts`, `frontend/src/lib/data/mock.ts`, `frontend/src/lib/data/index.ts`
- Test: `frontend/test/dpm-view.test.ts`, `frontend/test/mock-source.test.ts`

**Interfaces:**
- Consumes: `WAD`, `dpm` from `@0g-delphi/protocol`
- Produces:
  - `probabilityWad(q, outcome)`, `payoutPerShareWad(q, outcome)`, `qAfterBuy(q, outcome, shares)`
  - `type Outcome = 0 | 1`, `DataMode`, `Capability`, `CapabilityUnavailableError`, `Query<T>`, `MarketStatus`, `Tier`, `CollateralInfo`, `MarketSummary`, `MarketDetail`, `Trade`, `Candle`, `DataSource`
  - `MockSource` (menerima `{omit?: Capability[]}`), `FIXTURE_MARKETS`, `getDataSource()`

**A note on scope.** Spec §3.1 lists ten capabilities and seven read methods. F0 implements the four the market page needs — `listMarkets`, `getMarket`, `getTrades`, `getCandles`. Positions, the MarketSpec blob, and the settlement receipt arrive alongside the routes that use them (F3/F4). Adding a method now means writing types for a data shape that has no consumer yet.

- [ ] **Step 1: Write the failing `dpm-view` tests**

These are the tests that guard the `1/P` versus `1/p` trap from spec §5.1.

`frontend/test/dpm-view.test.ts`:

```ts
import {describe, expect, it} from "vitest";
import {WAD, dpm} from "@0g-delphi/protocol";
import {payoutPerShareWad, probabilityWad, qAfterBuy} from "@/lib/dpm-view";

const q: readonly [bigint, bigint] = [1000n * WAD, 1200n * WAD];

describe("probabilityWad", () => {
  it("returns p_i^2, not p_i", () => {
    expect(probabilityWad(q, 0)).toBe(409_836_065_573_770_491n);
    expect(probabilityWad(q, 1)).toBe(590_163_934_426_229_508n);
  });

  it("sums to one within floor dust", () => {
    const sum = probabilityWad(q, 0) + probabilityWad(q, 1);
    expect(WAD - sum).toBeLessThanOrEqual(2n);
    expect(sum).toBeLessThanOrEqual(WAD);
  });
});

describe("payoutPerShareWad", () => {
  it("is 1/p_i", () => {
    expect(payoutPerShareWad(q, 1)).toBe(1_301_708_279_317_775_732n);
    expect(payoutPerShareWad(q, 0)).toBe(1_562_049_935_181_330_879n);
  });

  it("is NOT 1/P_i — the trap that overstates payout by ~30%", () => {
    const wrong = (WAD * WAD) / probabilityWad(q, 1);
    expect(wrong).toBe(1_694_444_444_444_444_445n);
    expect(payoutPerShareWad(q, 1)).not.toBe(wrong);
  });

  it("payout times marginal price lands within dust of one", () => {
    const product = (payoutPerShareWad(q, 1) * dpm.price(q, 1)) / WAD;
    expect(WAD - product).toBeLessThanOrEqual(2n);
  });

  it("is safe on an empty market", () => {
    expect(payoutPerShareWad([0n, 0n], 0)).toBe(0n);
  });
});

describe("qAfterBuy", () => {
  it("adds only to the leg that was bought", () => {
    expect(qAfterBuy(q, 1, 100n * WAD)).toEqual([1000n * WAD, 1300n * WAD]);
    expect(qAfterBuy(q, 0, 100n * WAD)).toEqual([1100n * WAD, 1200n * WAD]);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
npm test -w @0g-delphi/frontend
```
Expected: FAIL — the `@/lib/dpm-view` module is not found.

- [ ] **Step 3: Implementasikan `frontend/src/lib/data/types.ts` LEBIH DULU**

`dpm-view.ts` in the next step imports `Outcome` from this file, so it has to exist first.
Its contents are in Step 6 below — write that file now, then carry on.

- [ ] **Step 4: Implementasikan `frontend/src/lib/dpm-view.ts`**

```ts
import {WAD, dpm} from "@0g-delphi/protocol";
import type {Outcome} from "@/lib/data/types";

type Q = readonly [bigint, bigint];

/**
 * Display-side derivations of market state. Every value here comes from the
 * TypeScript mirror already pinned to DPMMath.sol by the 512-vector
 * differential test — so the numbers on screen come from the same source as
 * the numbers on chain, not from a reimplementation.
 */

/** Implied probability P_i = p_i^2. This is the only source for any value labelled %. */
export function probabilityWad(q: Q, outcome: Outcome): bigint {
  return dpm.probability(q, outcome);
}

/**
 * Payout per winning share = 1/p_i, in wad.
 *
 * NOT 1/P_i. Both produce numbers that look plausible, and using the wrong
 * one overstates the payout by around 30% at ordinary skew — exactly the
 * direction that hurts anyone who trusts it. This spec's own first draft made
 * that mistake.
 */
export function payoutPerShareWad(q: Q, outcome: Outcome): bigint {
  const price = dpm.price(q, outcome);
  if (price === 0n) return 0n;
  return (WAD * WAD) / price;
}

/** The state of q after `shares` shares of `outcome` are minted. */
export function qAfterBuy(q: Q, outcome: Outcome, shares: bigint): Q {
  return outcome === 0 ? [q[0] + shares, q[1]] : [q[0], q[1] + shares];
}
```

- [ ] **Step 5: Write the failing `MockSource` tests**

`frontend/test/mock-source.test.ts`:

```ts
import {beforeEach, describe, expect, it} from "vitest";
import {dpm} from "@0g-delphi/protocol";
import {MockSource} from "@/lib/data/mock";
import {CapabilityUnavailableError} from "@/lib/data/types";

describe("MockSource", () => {
  let source: MockSource;
  beforeEach(() => {
    source = new MockSource();
  });

  it("reports its mode and every capability by default", () => {
    expect(source.mode).toBe("mock");
    expect(source.capabilities.has("PRICE_HISTORY")).toBe(true);
    expect(source.capabilities.has("TRADE_TAPE")).toBe(true);
  });

  it("returns the fixture markets", async () => {
    const markets = await source.listMarkets();
    expect(markets.length).toBeGreaterThanOrEqual(2);
    expect(markets[0]!.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("fetches a single market by address", async () => {
    const [first] = await source.listMarkets();
    const detail = await source.getMarket(first!.address);
    expect(detail.address).toBe(first!.address);
    expect(detail.question).toBe(first!.question);
  });

  it("throws for an unknown address", async () => {
    await expect(source.getMarket("0x0000000000000000000000000000000000000009")).rejects.toThrow(
      /not found/,
    );
  });

  /**
   * An inconsistent fixture renders a state that could not exist on chain.
   * poolWad is DERIVED from q, never typed by hand.
   */
  it("every fixture satisfies the protocol pool invariant", async () => {
    for (const m of await source.listMarkets()) {
      expect(m.poolWad).toBe(dpm.costUp(m.q));
    }
  });

  it("returns the trade tape", async () => {
    const [first] = await source.listMarkets();
    const trades = await source.getTrades(first!.address, 50);
    expect(trades.length).toBeGreaterThan(0);
    expect(trades[0]!.timestamp).toBeGreaterThan(trades[trades.length - 1]!.timestamp);
  });

  /**
   * The spec's central mechanism: an absent capability THROWS rather than
   * returning an empty array. An empty array means "there is no data" — a
   * different claim from "I cannot know". MockSource can simulate a limited
   * mode so this behaviour is tested without waiting for ChainSource to exist.
   */
  it("throws CapabilityUnavailableError for an omitted capability", async () => {
    const limited = new MockSource({omit: ["PRICE_HISTORY", "TRADE_TAPE"]});
    const [first] = await limited.listMarkets();

    expect(limited.capabilities.has("PRICE_HISTORY")).toBe(false);
    await expect(limited.getCandles(first!.address, "1h")).rejects.toBeInstanceOf(
      CapabilityUnavailableError,
    );
    await expect(limited.getTrades(first!.address, 50)).rejects.toBeInstanceOf(
      CapabilityUnavailableError,
    );
  });

  it("the error carries the capability and the mode that failed", async () => {
    const limited = new MockSource({omit: ["TRADE_TAPE"]});
    const [first] = await limited.listMarkets();
    await limited.getTrades(first!.address, 10).catch((error: unknown) => {
      const e = error as CapabilityUnavailableError;
      expect(e.capability).toBe("TRADE_TAPE");
      expect(e.mode).toBe("mock");
    });
    expect.assertions(2);
  });
});
```

- [ ] **Step 6: Fill in `frontend/src/lib/data/types.ts` (created in Step 3)**

```ts
export type Outcome = 0 | 1;
export type DataMode = "mock" | "chain" | "indexer";

export type Capability =
  | "LIST_MARKETS"
  | "MARKET_STATE"
  | "QUOTE"
  | "EXECUTE"
  | "PRICE_HISTORY"
  | "TRADE_TAPE";

export class CapabilityUnavailableError extends Error {
  constructor(
    readonly capability: Capability,
    readonly mode: DataMode,
  ) {
    super(`${capability} is not available in ${mode} mode`);
    this.name = "CapabilityUnavailableError";
  }
}

/**
 * `unavailable` is a member of the union, not a special case. Because it
 * lives here, TypeScript forces every consumer to handle it — a component
 * that forgets will not compile. The UI's honesty is enforced by the compiler,
 */
export type Query<T> =
  | {status: "loading"}
  | {status: "ready"; data: T}
  | {status: "unavailable"; capability: Capability; mode: DataMode}
  | {status: "error"; error: Error};

export type MarketStatus =
  | "Open" | "Closed" | "Proposed" | "Disputed" | "Settled" | "Failed" | "Voided";

export type Tier = "FAST" | "VERIFIED" | "DETERMINISTIC";
export type Interval = "1m" | "5m" | "1h" | "1d";

export interface CollateralInfo {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
}

export interface MarketSummary {
  address: `0x${string}`;
  question: string;
  category: string;
  tier: Tier;
  status: MarketStatus;
  /** Share supply per outcome, wad. Index 0 = NO, 1 = YES. */
  q: readonly [bigint, bigint];
  /** Always equal to dpm.costUp(q). Never typed by hand. */
  poolWad: bigint;
  tradingEnd: number;
  collateral: CollateralInfo;
}

export interface MarketDetail extends MarketSummary {
  feeBps: number;
  settlementDeadline: number;
  creator: `0x${string}`;
  specRoot: `0x${string}`;
  rules: string;
}

export interface Trade {
  id: string;
  timestamp: number;
  trader: `0x${string}`;
  outcome: Outcome;
  /** Positive for a buy, negative for a sell. */
  sharesDelta: bigint;
  tokens: bigint;
  fee: bigint;
  probAfterWad: bigint;
}

export interface Candle {
  bucketStart: number;
  open: bigint;
  high: bigint;
  low: bigint;
  close: bigint;
  volume: bigint;
}

export interface DataSource {
  readonly mode: DataMode;
  readonly capabilities: ReadonlySet<Capability>;
  listMarkets(): Promise<MarketSummary[]>;
  getMarket(address: `0x${string}`): Promise<MarketDetail>;
  getTrades(address: `0x${string}`, limit: number): Promise<Trade[]>;
  getCandles(address: `0x${string}`, interval: Interval): Promise<Candle[]>;
}
```

- [ ] **Step 7: Implementasikan `frontend/src/lib/data/mock.ts`**

```ts
import {WAD, dpm} from "@0g-delphi/protocol";
import {
  CapabilityUnavailableError,
  type Candle,
  type Capability,
  type CollateralInfo,
  type DataMode,
  type DataSource,
  type Interval,
  type MarketDetail,
  type MarketSummary,
  type Trade,
} from "./types";

const ALL_CAPABILITIES: Capability[] = [
  "LIST_MARKETS", "MARKET_STATE", "QUOTE", "EXECUTE", "PRICE_HISTORY", "TRADE_TAPE",
];

const MUSDC: CollateralInfo = {
  address: "0x9AA0C7DDC6D72BEEb77E4e497b6fbfa4D81A0153",
  symbol: "mUSDC",
  decimals: 6,
};

const HOUR = 3_600;
const NOW = 1_790_000_000;

/** poolWad is derived, never typed — a fixture must not break a chain invariant. */
function market(
  partial: Omit<MarketDetail, "poolWad" | "collateral">,
): MarketDetail {
  return {...partial, poolWad: dpm.costUp(partial.q), collateral: MUSDC};
}

export const FIXTURE_MARKETS: MarketDetail[] = [
  market({
    address: "0x1111111111111111111111111111111111111111",
    question: "Will the ETH/USD closing price on 30 September 2026 be above $4,000?",
    rules:
      "Resolves YES if the daily ETH/USD closing price at 2026-09-30 23:59 UTC, per the listed " +
      "sources, is above $4,000.00. Resolves NO if it is at or below that. If no source " +
      "publishes a closing price on that day, the market is deemed UNRESOLVABLE and is wound " +
      "down.",
    category: "crypto",
    tier: "VERIFIED",
    status: "Open",
    q: [1000n * WAD, 1200n * WAD],
    tradingEnd: NOW + 52 * HOUR,
    settlementDeadline: NOW + 76 * HOUR,
    feeBps: 100,
    creator: "0xAaAaAaAa00000000000000000000000000000001",
    specRoot: "0xa1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
  }),
  market({
    address: "0x2222222222222222222222222222222222222222",
    question: "Will 0G Chain announce mainnet v2 before 1 December 2026?",
    rules:
      "Resolves YES if an official announcement is published on an official 0G Labs channel " +
      "before 2026-12-01 00:00 UTC. Third-party announcements do not count.",
    category: "crypto",
    tier: "FAST",
    status: "Open",
    q: [707_106_781_186_547_524_400n, 707_106_781_186_547_524_400n],
    tradingEnd: NOW + 9 * 24 * HOUR,
    settlementDeadline: NOW + 10 * 24 * HOUR,
    feeBps: 100,
    creator: "0xAaAaAaAa00000000000000000000000000000002",
    specRoot: "0xb2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1",
  }),
  market({
    address: "0x3333333333333333333333333333333333333333",
    question: "Will euro-area annual inflation fall below 2.0% in the October 2026 release?",
    rules: "Resolves according to the Eurostat HICP release for October 2026, the flash figure.",
    category: "economics",
    tier: "DETERMINISTIC",
    status: "Closed",
    q: [1800n * WAD, 600n * WAD],
    tradingEnd: NOW - 2 * HOUR,
    settlementDeadline: NOW + 22 * HOUR,
    feeBps: 100,
    creator: "0xAaAaAaAa00000000000000000000000000000003",
    specRoot: "0xc3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2",
  }),
];

function fixtureTrades(m: MarketDetail): Trade[] {
  const trades: Trade[] = [];
  let q: readonly [bigint, bigint] = [m.q[0] / 2n, m.q[1] / 2n];
  for (let i = 0; i < 24; i++) {
    const outcome = (i % 3 === 0 ? 0 : 1) as 0 | 1;
    const shares = BigInt(12 + ((i * 37) % 90)) * WAD;
    const before = dpm.costUp(q);
    q = outcome === 0 ? [q[0] + shares, q[1]] : [q[0], q[1] + shares];
    const tokens = (dpm.costUp(q) - before) / 10n ** 12n;
    trades.push({
      id: `${m.address}-${i}`,
      timestamp: NOW - (24 - i) * HOUR,
      trader: `0xbb${i.toString(16).padStart(2, "0")}${"0".repeat(34)}` as `0x${string}`,
      outcome,
      sharesDelta: shares,
      tokens,
      fee: (tokens * BigInt(m.feeBps)) / 10_000n,
      probAfterWad: dpm.probability(q, 1),
    });
  }
  return trades.reverse(); // terbaru dulu
}

export class MockSource implements DataSource {
  readonly mode: DataMode = "mock";
  readonly capabilities: ReadonlySet<Capability>;

  constructor(options: {omit?: Capability[]} = {}) {
    const omitted = new Set(options.omit ?? []);
    this.capabilities = new Set(ALL_CAPABILITIES.filter((c) => !omitted.has(c)));
  }

  private require(capability: Capability): void {
    if (!this.capabilities.has(capability)) {
      throw new CapabilityUnavailableError(capability, this.mode);
    }
  }

  private find(address: string): MarketDetail {
    const found = FIXTURE_MARKETS.find(
      (m) => m.address.toLowerCase() === address.toLowerCase(),
    );
    if (!found) throw new Error(`Market ${address} not found`);
    return found;
  }

  async listMarkets(): Promise<MarketSummary[]> {
    this.require("LIST_MARKETS");
    return FIXTURE_MARKETS;
  }

  async getMarket(address: `0x${string}`): Promise<MarketDetail> {
    this.require("MARKET_STATE");
    return this.find(address);
  }

  async getTrades(address: `0x${string}`, limit: number): Promise<Trade[]> {
    this.require("TRADE_TAPE");
    return fixtureTrades(this.find(address)).slice(0, limit);
  }

  async getCandles(address: `0x${string}`, interval: Interval): Promise<Candle[]> {
    this.require("PRICE_HISTORY");
    const trades = [...fixtureTrades(this.find(address))].reverse();
    const step = interval === "1d" ? 24 * HOUR : interval === "1h" ? HOUR : 5 * 60;
    return trades.map((t, i) => ({
      bucketStart: t.timestamp - (t.timestamp % step),
      open: i === 0 ? t.probAfterWad : trades[i - 1]!.probAfterWad,
      high: t.probAfterWad,
      low: t.probAfterWad,
      close: t.probAfterWad,
      volume: t.tokens,
    }));
  }
}
```

- [ ] **Step 8: Implementasikan `frontend/src/lib/data/index.ts`**

```ts
import {MockSource} from "./mock";
import type {DataMode, DataSource} from "./types";

/**
 * F0 has only MockSource. ChainSource (F1) and IndexerSource (F4) plug in
 * here; IndexerSource will WRAP ChainSource rather than duplicate it, which
 * makes "quotes always come from the chain" a structural property.
 */
export function getDataSource(): DataSource {
  const mode = (process.env.NEXT_PUBLIC_DATA_MODE ?? "mock") as DataMode;
  if (mode !== "mock") {
    throw new Error(`DATA_MODE=${mode} is not implemented yet; F0 supports only "mock"`);
  }
  return new MockSource();
}

export * from "./types";
```

- [ ] **Step 9: Run them and confirm they pass**

```bash
npm test -w @0g-delphi/frontend && npx tsc --noEmit -p frontend
```
Expected: PASS — 29 lulus (3 asap + 11 format + 7 dpm-view + 8 mock).

- [ ] **Step 10: Commit**

```bash
git add frontend
git commit -m "feat(frontend): the data layer with explicit capabilities and MockSource"
```

---

## Task 4: Primitif — `Unavailable`, `Badge`, `CopyAddress`, `Countdown`, `Stat`

**Files:**
- Create: `frontend/src/components/primitives/{Unavailable,Badge,CopyAddress,Countdown,Stat}.tsx`
- Test: `frontend/test/primitives.test.tsx`

**Interfaces:**
- Consumes: `Capability`, `DataMode` from `@/lib/data/types`; `shortAddress`, `formatCountdown` from `@/lib/format`
- Produces: `<Unavailable capability mode />`, `<Badge tone label />`, `<CopyAddress address />`, `<Countdown until />`, `<Stat label value hint />`

`Unavailable` is the most important primitive in this file. It is the visual form of the rule that the UI never renders a number the current mode cannot know.

- [ ] **Step 1: Write the failing tests**

`frontend/test/primitives.test.tsx`:

```tsx
import {render, screen} from "@testing-library/react";
import {describe, expect, it} from "vitest";
import {Badge} from "@/components/primitives/Badge";
import {Countdown} from "@/components/primitives/Countdown";
import {CopyAddress} from "@/components/primitives/CopyAddress";
import {Stat} from "@/components/primitives/Stat";
import {Unavailable} from "@/components/primitives/Unavailable";

describe("Unavailable", () => {
  it("names the missing capability and the mode that provides it", () => {
    render(<Unavailable capability="PRICE_HISTORY" mode="chain" />);
    expect(screen.getByText(/riwayat harga/i)).toBeInTheDocument();
    expect(screen.getByText(/indexer/i)).toBeInTheDocument();
  });

  /** The heart of the rule: not knowing must not disguise itself as a number. */
  it("never renders a zero or a bare dash", () => {
    const {container} = render(<Unavailable capability="TRADE_TAPE" mode="chain" />);
    const text = container.textContent ?? "";
    expect(text.trim()).not.toBe("0");
    expect(text.trim()).not.toBe("—");
    expect(text.length).toBeGreaterThan(10);
  });
});

describe("Badge", () => {
  it("renders its label", () => {
    render(<Badge tone="neutral" label="VERIFIED" />);
    expect(screen.getByText("VERIFIED")).toBeInTheDocument();
  });
});

describe("CopyAddress", () => {
  it("shows the elided form but keeps the full address in the title", () => {
    const full = "0x1234567890abcdef1234567890abcdef12345678";
    render(<CopyAddress address={full} />);
    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("0x1234…5678");
    expect(button).toHaveAttribute("title", full);
  });
});

describe("Countdown", () => {
  it("formats the time remaining from an absolute timestamp", () => {
    const now = 1_790_000_000;
    render(<Countdown until={now + 2 * 3600 + 14 * 60} nowSeconds={now} />);
    expect(screen.getByText("2j 14m")).toBeInTheDocument();
  });

  it("says closed once it has passed", () => {
    const now = 1_790_000_000;
    render(<Countdown until={now - 60} nowSeconds={now} />);
    expect(screen.getByText("tutup")).toBeInTheDocument();
  });
});

describe("Stat", () => {
  it("pairs a label with a value", () => {
    render(<Stat label="P(YES)" value="59.0%" />);
    expect(screen.getByText("P(YES)")).toBeInTheDocument();
    expect(screen.getByText("59.0%")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
npm test -w @0g-delphi/frontend
```
Expected: FAIL — the component modules are not found.

- [ ] **Step 3: Implementasikan `Unavailable.tsx`**

```tsx
import type {Capability, DataMode} from "@/lib/data/types";

const LABELS: Record<Capability, string> = {
  LIST_MARKETS: "Daftar market",
  MARKET_STATE: "Keadaan market",
  QUOTE: "Quote",
  EXECUTE: "Eksekusi",
  PRICE_HISTORY: "Riwayat harga",
  TRADE_TAPE: "Riwayat transaksi",
};

/** The lightest mode that provides this capability. */
const PROVIDED_BY: Record<Capability, DataMode> = {
  LIST_MARKETS: "chain",
  MARKET_STATE: "chain",
  QUOTE: "chain",
  EXECUTE: "chain",
  PRICE_HISTORY: "indexer",
  TRADE_TAPE: "indexer",
};

/**
 * The visual form of the rule that the UI never renders a number the current
 * mode cannot know. Not a spinner (no data is on its way), not a zero (that is
 * a false claim), not a bare dash (that explains nothing).
 */
export function Unavailable({capability, mode}: {capability: Capability; mode: DataMode}) {
  return (
    <div className="rounded-md border border-dashed border-border px-3 py-2 text-[13px] text-text-muted">
      <span className="text-text">{LABELS[capability]}</span> not available in{" "}
      <span className="font-mono">{mode}</span> mode — this source keeps no history. Available in
      mode <span className="font-mono">{PROVIDED_BY[capability]}</span>.
    </div>
  );
}
```

- [ ] **Step 4: Implementasikan empat primitif sisanya**

`Badge.tsx`:

```tsx
type Tone = "neutral" | "positive" | "negative" | "warning" | "verified";

const TONES: Record<Tone, string> = {
  neutral: "border-border text-text-muted",
  positive: "border-pos/40 text-pos",
  negative: "border-neg/40 text-neg",
  warning: "border-warn/40 text-warn",
  verified: "border-verified/40 text-verified",
};

export function Badge({tone, label}: {tone: Tone; label: string}) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${TONES[tone]}`}
    >
      {label}
    </span>
  );
}
```

`CopyAddress.tsx`:

```tsx
"use client";

import {useState} from "react";
import {shortAddress} from "@/lib/format";

export function CopyAddress({address}: {address: string}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={address}
      onClick={() => {
        void navigator.clipboard?.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="font-mono text-[13px] text-text-muted hover:text-text"
    >
      {copied ? "tersalin" : shortAddress(address)}
    </button>
  );
}
```

`Countdown.tsx`:

```tsx
import {formatCountdown} from "@/lib/format";

/**
 * `nowSeconds` is injected so this can be tested deterministically. Without it,
 * a countdown test depends on the wall clock and will be flaky.
 */
export function Countdown({until, nowSeconds}: {until: number; nowSeconds?: number}) {
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  return <span>{formatCountdown(until - now)}</span>;
}
```

`Stat.tsx`:

```tsx
import type {ReactNode} from "react";

export function Stat({label, value, hint}: {label: string; value: ReactNode; hint?: string}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-text-faint">{label}</span>
      <span className="text-[15px] text-text">{value}</span>
      {hint ? <span className="text-[11px] text-text-muted">{hint}</span> : null}
    </div>
  );
}
```

- [ ] **Step 5: Run them and confirm they pass**

```bash
npm test -w @0g-delphi/frontend && npx tsc --noEmit -p frontend
```
Expected: PASS — 36 lulus.

- [ ] **Step 6: Commit**

```bash
git add frontend
git commit -m "feat(frontend): UI primitives with Unavailable as a first-class status"
```

---

## Task 5: The provider and the hooks

**Files:**
- Create: `frontend/src/hooks/provider.tsx`, `frontend/src/hooks/toQuery.ts`, `frontend/src/hooks/useMarket.ts`, `frontend/src/hooks/useTrades.ts`, `frontend/src/hooks/useQuote.ts`
- Modify: `frontend/package.json` (tambah `@tanstack/react-query`), `frontend/src/app/layout.tsx`
- Test: `frontend/test/hooks.test.tsx`

**Interfaces:**
- Consumes: `DataSource`, `Query<T>`, `CapabilityUnavailableError`, `MockSource`
- Produces: `<AppProviders source>`, `useDataSource()`, `useMarket(address): Query<MarketDetail>`, `useTrades(address, limit): Query<Trade[]>`, `useQuote({q, outcome, spendWad, feeBps})`

- [ ] **Step 1: Add dependensi**

In `frontend/package.json`, add to `"dependencies"`:

```json
    "@tanstack/react-query": "^5.102.6",
```

then `npm install` from the repo root.

- [ ] **Step 2: Write the failing tests**

`frontend/test/hooks.test.tsx`:

```tsx
import {renderHook, waitFor} from "@testing-library/react";
import type {ReactNode} from "react";
import {describe, expect, it} from "vitest";
import {WAD} from "@0g-delphi/protocol";
import {AppProviders} from "@/hooks/provider";
import {useMarket} from "@/hooks/useMarket";
import {useQuote} from "@/hooks/useQuote";
import {useTrades} from "@/hooks/useTrades";
import {FIXTURE_MARKETS, MockSource} from "@/lib/data/mock";

const ADDRESS = FIXTURE_MARKETS[0]!.address;

function wrapper(source: MockSource) {
  return function Wrapper({children}: {children: ReactNode}) {
    return <AppProviders source={source}>{children}</AppProviders>;
  };
}

describe("useMarket", () => {
  it("moves from loading to ready", async () => {
    const {result} = renderHook(() => useMarket(ADDRESS), {wrapper: wrapper(new MockSource())});
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("diharapkan ready");
    expect(result.current.data.address).toBe(ADDRESS);
  });
});

describe("useTrades", () => {
  it("returns the tape when the capability is present", async () => {
    const {result} = renderHook(() => useTrades(ADDRESS, 10), {wrapper: wrapper(new MockSource())});
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });

  /** The core contract: an absent capability becomes status `unavailable`, not `error`. */
  it("maps a missing capability to unavailable, not to error", async () => {
    const limited = new MockSource({omit: ["TRADE_TAPE"]});
    const {result} = renderHook(() => useTrades(ADDRESS, 10), {wrapper: wrapper(limited)});
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    if (result.current.status !== "unavailable") throw new Error("diharapkan unavailable");
    expect(result.current.capability).toBe("TRADE_TAPE");
    expect(result.current.mode).toBe("mock");
  });
});

describe("useQuote", () => {
  const q: readonly [bigint, bigint] = [1000n * WAD, 1200n * WAD];

  it("computes shares and probability in step, with no RPC", () => {
    const {result} = renderHook(
      () => useQuote({q, outcome: 1, spendWad: 100n * WAD, feeBps: 100}),
      {wrapper: wrapper(new MockSource())},
    );
    expect(result.current.sharesOut).toBeGreaterThan(0n);
    expect(result.current.probBeforeWad).toBe(590_163_934_426_229_508n);
    expect(result.current.probAfterWad).toBeGreaterThan(result.current.probBeforeWad);
  });

  /** A purchase raises the price, so the average MUST be above the opening marginal price. */
  it("the average price is above the marginal price before the trade", () => {
    const {result} = renderHook(
      () => useQuote({q, outcome: 1, spendWad: 100n * WAD, feeBps: 100}),
      {wrapper: wrapper(new MockSource())},
    );
    expect(result.current.avgPriceWad).toBeGreaterThan(768_221_279_597_375_842n);
  });

  /** Buying this side lowers this side's payout — dilution, visible as a number. */
  it("the payout on the side bought falls after the trade", () => {
    const {result} = renderHook(
      () => useQuote({q, outcome: 1, spendWad: 100n * WAD, feeBps: 100}),
      {wrapper: wrapper(new MockSource())},
    );
    expect(result.current.payoutAfterWad).toBeLessThan(result.current.payoutBeforeWad);
  });

  it("returns zero for zero spend without throwing", () => {
    const {result} = renderHook(
      () => useQuote({q, outcome: 1, spendWad: 0n, feeBps: 100}),
      {wrapper: wrapper(new MockSource())},
    );
    expect(result.current.sharesOut).toBe(0n);
  });
});
```

- [ ] **Step 3: Implementasikan `provider.tsx`**

```tsx
"use client";

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createContext, useContext, useState, type ReactNode} from "react";
import {CapabilityUnavailableError, type DataSource} from "@/lib/data/types";

const DataSourceContext = createContext<DataSource | null>(null);

export function useDataSource(): DataSource {
  const source = useContext(DataSourceContext);
  if (!source) throw new Error("useDataSource was used outside AppProviders");
  return source;
}

export function AppProviders({source, children}: {source: DataSource; children: ReactNode}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // An absent capability is not a transient failure — retrying only
            // delays an `unavailable` status that is already certain.
            retry: (count, error) =>
              !(error instanceof CapabilityUnavailableError) && count < 2,
            staleTime: 5_000,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <DataSourceContext.Provider value={source}>{children}</DataSourceContext.Provider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 4: Implement `toQuery.ts`, `useMarket.ts`, and `useTrades.ts`**

`toQuery` is used by every hook, so it lives in a file of its own — importing it from
`useMarket` would make `useTrades` depend on an unrelated hook.

`frontend/src/hooks/toQuery.ts`:

```ts
import type {UseQueryResult} from "@tanstack/react-query";
import {CapabilityUnavailableError, type DataMode, type Query} from "@/lib/data/types";

/** Translates TanStack's states into our union, with `unavailable` as a branch of its own. */
export function toQuery<T>(result: UseQueryResult<T>, mode: DataMode): Query<T> {
  if (result.isPending) return {status: "loading"};
  if (result.error) {
    const error = result.error;
    if (error instanceof CapabilityUnavailableError) {
      return {status: "unavailable", capability: error.capability, mode: error.mode};
    }
    return {status: "error", error: error as Error};
  }
  return {status: "ready", data: result.data as T};
}
```

`frontend/src/hooks/useMarket.ts`:

```ts
"use client";

import {useQuery} from "@tanstack/react-query";
import {toQuery} from "./toQuery";
import {useDataSource} from "./provider";
import type {MarketDetail, Query} from "@/lib/data/types";

export function useMarket(address: `0x${string}`): Query<MarketDetail> {
  const source = useDataSource();
  const result = useQuery({
    queryKey: ["market", source.mode, address],
    queryFn: () => source.getMarket(address),
  });
  return toQuery(result, source.mode);
}
```

`useTrades.ts`:

```ts
"use client";

import {useQuery} from "@tanstack/react-query";
import {toQuery} from "./toQuery";
import {useDataSource} from "./provider";
import type {Query, Trade} from "@/lib/data/types";

export function useTrades(address: `0x${string}`, limit: number): Query<Trade[]> {
  const source = useDataSource();
  const result = useQuery({
    queryKey: ["trades", source.mode, address, limit],
    queryFn: () => source.getTrades(address, limit),
  });
  return toQuery(result, source.mode);
}
```

- [ ] **Step 5: Implementasikan `useQuote.ts`**

```ts
"use client";

import {WAD, dpm} from "@0g-delphi/protocol";
import {useMemo} from "react";
import {payoutPerShareWad, probabilityWad, qAfterBuy} from "@/lib/dpm-view";
import type {Outcome} from "@/lib/data/types";

export interface QuotePreview {
  sharesOut: bigint;
  poolInWad: bigint;
  feeWad: bigint;
  totalWad: bigint;
  avgPriceWad: bigint;
  probBeforeWad: bigint;
  probAfterWad: bigint;
  payoutBeforeWad: bigint;
  payoutAfterWad: bigint;
}

/**
 * A LOCAL preview, computed from the TypeScript mirror — synchronous, no RPC,
 * so typing triggers no network call at all. This is an ESTIMATE: before
 * sending a transaction, F1 calls `quoteBuy` on chain and that is the number
 * ditandatangani pengguna.
 */
export function useQuote(input: {
  q: readonly [bigint, bigint];
  outcome: Outcome;
  spendWad: bigint;
  feeBps: number;
}): QuotePreview {
  const {q, outcome, spendWad, feeBps} = input;
  return useMemo(() => {
    const empty: QuotePreview = {
      sharesOut: 0n, poolInWad: 0n, feeWad: 0n, totalWad: 0n, avgPriceWad: 0n,
      probBeforeWad: probabilityWad(q, outcome),
      probAfterWad: probabilityWad(q, outcome),
      payoutBeforeWad: payoutPerShareWad(q, outcome),
      payoutAfterWad: payoutPerShareWad(q, outcome),
    };
    if (spendWad <= 0n) return empty;

    // The contract charges the fee ON TOP OF the pool cost, so inverting it for
    // a gross budget uses the denominator 10000 + feeBps, not 10000.
    const bps = BigInt(feeBps);
    const feeWad = (spendWad * bps) / (10_000n + bps);
    const poolInWad = spendWad - feeWad;
    if (poolInWad <= 0n) return empty;

    let sharesOut: bigint;
    try {
      sharesOut = dpm.sharesForSpend(q, outcome, poolInWad);
    } catch {
      return empty;
    }
    const qAfter = qAfterBuy(q, outcome, sharesOut);
    return {
      sharesOut,
      poolInWad,
      feeWad,
      totalWad: spendWad,
      avgPriceWad: sharesOut === 0n ? 0n : (poolInWad * WAD) / sharesOut,
      probBeforeWad: probabilityWad(q, outcome),
      probAfterWad: probabilityWad(qAfter, outcome),
      payoutBeforeWad: payoutPerShareWad(q, outcome),
      payoutAfterWad: payoutPerShareWad(qAfter, outcome),
    };
  }, [q, outcome, spendWad, feeBps]);
}
```

- [ ] **Step 6: Run them and confirm they pass**

```bash
npm test -w @0g-delphi/frontend && npx tsc --noEmit -p frontend
```
Expected: PASS — 43 lulus.

- [ ] **Step 7: Commit**

```bash
git add frontend package.json package-lock.json
git commit -m "feat(frontend): the provider, the data hooks, and local quoting with no RPC"
```

---

## Task 6: The probability panel and the payout panel

**Files:**
- Create: `frontend/src/components/market/ProbabilityPanel.tsx`, `frontend/src/components/market/PayoutPanel.tsx`
- Test: `frontend/test/market-panels.test.tsx`

**Interfaces:**
- Consumes: `probabilityWad`, `payoutPerShareWad`; `formatProbability`, `formatPayout`
- Produces: `<ProbabilityPanel q />`, `<PayoutPanel q />`

`PayoutPanel` carries the dilution disclosure the spec calls mandatory. It is not a legal disclaimer — it explains a property of the instrument this page is selling.

- [ ] **Step 1: Write the failing tests**

`frontend/test/market-panels.test.tsx`:

```tsx
import {render, screen} from "@testing-library/react";
import {describe, expect, it} from "vitest";
import {WAD} from "@0g-delphi/protocol";
import {PayoutPanel} from "@/components/market/PayoutPanel";
import {ProbabilityPanel} from "@/components/market/ProbabilityPanel";

const q: readonly [bigint, bigint] = [1000n * WAD, 1200n * WAD];

describe("ProbabilityPanel", () => {
  it("shows both sides as p^2", () => {
    render(<ProbabilityPanel q={q} />);
    expect(screen.getByText("59.0%")).toBeInTheDocument();
    expect(screen.getByText("41.0%")).toBeInTheDocument();
  });

  /** The marginal prices for this q are 76.8% and 64.0% — neither may appear as a percentage. */
  it("does not show the marginal price as a probability", () => {
    const {container} = render(<ProbabilityPanel q={q} />);
    expect(container.textContent).not.toContain("76.8%");
    expect(container.textContent).not.toContain("64.0%");
  });
});

describe("PayoutPanel", () => {
  it("shows the 1/p payout, not 1/P", () => {
    render(<PayoutPanel q={q} />);
    expect(screen.getByText("1.30×")).toBeInTheDocument();
    expect(screen.getByText("1.56×")).toBeInTheDocument();
  });

  it("does not show the mistaken 1/P numbers", () => {
    const {container} = render(<PayoutPanel q={q} />);
    expect(container.textContent).not.toContain("1.69×");
    expect(container.textContent).not.toContain("2.44×");
  });

  /** Pengungkapan wajib: payout mengambang sampai market tutup. */
  it("discloses dilution in terms a reader can act on", () => {
    render(<PayoutPanel q={q} />);
    expect(screen.getByText(/mengambang/i)).toBeInTheDocument();
    expect(screen.getByText(/sell at any time/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
npm test -w @0g-delphi/frontend
```
Expected: FAIL — the panel modules are not found.

- [ ] **Step 3: Implementasikan `ProbabilityPanel.tsx`**

```tsx
import {probabilityWad} from "@/lib/dpm-view";
import {formatProbability} from "@/lib/format";

/**
 * Shows P_i = p_i^2. The marginal price p_i NEVER appears here — it is only valid
 * it is only valid as an execution price per share, not as a percentage.
 */
export function ProbabilityPanel({q}: {q: readonly [bigint, bigint]}) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border">
      {([1, 0] as const).map((outcome) => (
        <div key={outcome} className="bg-bg px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide text-text-faint">
            {outcome === 1 ? "YES" : "NO"}
          </div>
          <div className="mt-1 text-[28px] leading-none text-text">
            {formatProbability(probabilityWad(q, outcome))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Implementasikan `PayoutPanel.tsx`**

```tsx
import {payoutPerShareWad} from "@/lib/dpm-view";
import {formatPayout} from "@/lib/format";

/**
 * A DPM payout is funded entirely by the pool, and the consequence is that an
 * early buyer's payout is diluted by later buyers. Hiding that makes this page
 * lie about the instrument it is selling — which is why the disclosure lives
 * here and is repeated on the order ticket before confirmation.
 */
export function PayoutPanel({q}: {q: readonly [bigint, bigint]}) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <div className="flex flex-col gap-1.5">
        {([1, 0] as const).map((outcome) => (
          <div key={outcome} className="flex items-baseline justify-between">
            <span className="text-[13px] text-text-muted">
              Payout jika {outcome === 1 ? "YES" : "NO"} menang
            </span>
            <span className="text-[15px] text-text">
              {formatPayout(payoutPerShareWad(q, outcome))} per share
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 border-t border-border pt-3 text-[12px] leading-relaxed text-warn">
        Payout floats until the market closes. The more that is bought on the side you are on,
        the smaller your payout per share. Sell at any time to lock in the current price.
      </p>
    </div>
  );
}
```

- [ ] **Step 5: Run them and confirm they pass**

```bash
npm test -w @0g-delphi/frontend && npx tsc --noEmit -p frontend
```
Expected: PASS — 48 lulus.

- [ ] **Step 6: Commit**

```bash
git add frontend
git commit -m "feat(frontend): probability and payout panels with the dilution disclosure"
```

---

## Task 7: Tiket order

**Files:**
- Create: `frontend/src/components/market/OrderTicket.tsx`
- Test: `frontend/test/order-ticket.test.tsx`

**Interfaces:**
- Consumes: `useQuote`, `formatShares`, `formatPricePerShare`, `formatCollateral`, `formatProbability`, `formatProbabilityDelta`, `formatPayout`, `toWad`, `toTokensCeil`
- Produces: `<OrderTicket market />`

The hardest part to design correctly: carrying the quote, the price impact, the slippage bound, the payout, and the dilution warning without becoming frightening or misleading. F0 renders and computes; the execution button is disabled with a clear reason, because mock mode sends no transaction.

- [ ] **Step 1: Write the failing tests**

`frontend/test/order-ticket.test.tsx`:

```tsx
import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe, expect, it} from "vitest";
import {AppProviders} from "@/hooks/provider";
import {OrderTicket} from "@/components/market/OrderTicket";
import {FIXTURE_MARKETS, MockSource} from "@/lib/data/mock";

const market = FIXTURE_MARKETS[0]!;

function renderTicket() {
  return render(
    <AppProviders source={new MockSource()}>
      <OrderTicket market={market} />
    </AppProviders>,
  );
}

describe("OrderTicket", () => {
  it("starts empty rather than showing a fake quote", () => {
    renderTicket();
    expect(screen.queryByTestId("quote-shares")).toBeNull();
  });

  it("computes a quote as you type", async () => {
    const user = userEvent.setup();
    renderTicket();
    await user.type(screen.getByLabelText(/belanjakan/i), "100");
    expect(screen.getByTestId("quote-shares").textContent).toMatch(/^\d/);
  });

  /** Price impact is shown as a transition, not as a single number. */
  it("shows the probability before and after", async () => {
    const user = userEvent.setup();
    renderTicket();
    await user.type(screen.getByLabelText(/belanjakan/i), "100");
    expect(screen.getByTestId("prob-before").textContent).toBe("59.0%");
    expect(screen.getByTestId("prob-after").textContent).not.toBe("59.0%");
    expect(screen.getByTestId("prob-delta").textContent).toMatch(/^\+/);
  });

  /** Dilusi terlihat konkret: pembelianmu sendiri menurunkan payout-mu. */
  it("shows the payout falling because of your own purchase", async () => {
    const user = userEvent.setup();
    renderTicket();
    await user.type(screen.getByLabelText(/belanjakan/i), "100");
    const before = screen.getByTestId("payout-before").textContent!;
    const after = screen.getByTestId("payout-after").textContent!;
    expect(parseFloat(after)).toBeLessThan(parseFloat(before));
  });

  it("shows the maximum that will be paid, not only the quote", async () => {
    const user = userEvent.setup();
    renderTicket();
    await user.type(screen.getByLabelText(/belanjakan/i), "100");
    expect(screen.getByTestId("max-paid").textContent).toBeTruthy();
    expect(screen.getByText(/0\.5%/)).toBeInTheDocument();
  });

  it("can switch sides", async () => {
    const user = userEvent.setup();
    renderTicket();
    await user.type(screen.getByLabelText(/belanjakan/i), "100");
    const yesProb = screen.getByTestId("prob-before").textContent;
    await user.click(screen.getByRole("button", {name: /^NO/}));
    expect(screen.getByTestId("prob-before").textContent).not.toBe(yesProb);
  });

  /** Mock mode sends no transaction — and must say so rather than stay silent. */
  it("disables execution in mock mode with a visible reason", async () => {
    const user = userEvent.setup();
    renderTicket();
    await user.type(screen.getByLabelText(/belanjakan/i), "100");
    expect(screen.getByRole("button", {name: /buy/i})).toBeDisabled();
    expect(screen.getByText(/mode mock/i)).toBeInTheDocument();
  });
});
```

Add `@testing-library/user-event` to the frontend's `devDependencies`:

```json
    "@testing-library/user-event": "^14.6.1",
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
npm install && npm test -w @0g-delphi/frontend
```
Expected: FAIL — the `OrderTicket` module is not found.

- [ ] **Step 3: Implementasikan `OrderTicket.tsx`**

```tsx
"use client";

import {useState} from "react";
import {toTokensCeil, toWad} from "@0g-delphi/protocol";
import {useDataSource} from "@/hooks/provider";
import {useQuote} from "@/hooks/useQuote";
import {
  formatCollateral, formatPayout, formatPricePerShare,
  formatProbability, formatProbabilityDelta, formatShares,
} from "@/lib/format";
import type {MarketDetail, Outcome} from "@/lib/data/types";

const SLIPPAGE_BPS = 50n; // 0,5%

/** Parses the user's decimal input into the smallest token unit, without floats. */
function parseAmount(text: string, decimals: number): bigint {
  const trimmed = text.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") return 0n;
  const [whole = "0", frac = ""] = trimmed.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

export function OrderTicket({market}: {market: MarketDetail}) {
  const source = useDataSource();
  const [outcome, setOutcome] = useState<Outcome>(1);
  const [amountText, setAmountText] = useState("");

  const decimals = market.collateral.decimals;
  const amountTokens = parseAmount(amountText, decimals);
  const quote = useQuote({
    q: market.q,
    outcome,
    spendWad: toWad(amountTokens, decimals),
    feeBps: market.feeBps,
  });

  const hasQuote = quote.sharesOut > 0n;
  const maxPaidTokens = toTokensCeil(
    (quote.totalWad * (10_000n + SLIPPAGE_BPS)) / 10_000n,
    decimals,
  );

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="grid grid-cols-2 gap-2">
        {([1, 0] as const).map((side) => (
          <button
            key={side}
            type="button"
            onClick={() => setOutcome(side)}
            className={`rounded-md border px-3 py-2 text-left ${
              outcome === side ? "border-accent text-text" : "border-border text-text-muted"
            }`}
          >
            <div className="text-[12px] font-medium">{side === 1 ? "YES" : "NO"}</div>
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-[12px] text-text-muted">
        Belanjakan
        <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
          <input
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            placeholder="0.00"
            className="w-full bg-transparent text-[15px] text-text outline-none"
          />
          <span className="text-[12px] text-text-faint">{market.collateral.symbol}</span>
        </div>
      </label>

      {hasQuote ? (
        <div className="flex flex-col gap-1.5 border-t border-border pt-3 text-[13px]">
          <Row label="Terima">
            <span data-testid="quote-shares">
              {formatShares(quote.sharesOut)} {outcome === 1 ? "YES" : "NO"} shares
            </span>
          </Row>
          <Row label="Harga rata-rata">{formatPricePerShare(quote.avgPriceWad)}</Row>
          <Row label={`Fee (${(market.feeBps / 100).toFixed(2)}%)`}>
            {formatCollateral(toTokensCeil(quote.feeWad, decimals), decimals)}
          </Row>

          <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2">
            <span className="text-text-muted">P({outcome === 1 ? "YES" : "NO"})</span>
            <span>
              <span data-testid="prob-before">{formatProbability(quote.probBeforeWad)}</span>
              <span className="mx-1.5 text-text-faint">→</span>
              <span data-testid="prob-after">{formatProbability(quote.probAfterWad)}</span>
              <span data-testid="prob-delta" className="ml-2 text-text-muted">
                {formatProbabilityDelta(quote.probBeforeWad, quote.probAfterWad)}
              </span>
            </span>
          </div>

          <Row label="Payout jika menang">
            <span>
              <span data-testid="payout-before">{formatPayout(quote.payoutBeforeWad)}</span>
              <span className="mx-1.5 text-text-faint">→</span>
              <span data-testid="payout-after">{formatPayout(quote.payoutAfterWad)}</span>
            </span>
          </Row>

          <Row label="Maks dibayar (slippage 0.5%)">
            <span data-testid="max-paid">{formatCollateral(maxPaidTokens, decimals)}</span>
          </Row>

          <p className="mt-2 text-[12px] leading-relaxed text-warn">
            This purchase itself lowers your payout. The next buyer on this side
            menurunkannya lagi.
          </p>
        </div>
      ) : null}

      <button
        type="button"
        disabled
        className="rounded-md bg-accent px-3 py-2 text-[13px] font-medium text-white disabled:opacity-40"
      >
        Buy {outcome === 1 ? "YES" : "NO"}
      </button>
      <p className="text-[11px] text-text-faint">
        Mock mode — the quote is computed from the DPM mirror, but no transaction is sent.
        Execution is enabled in <span className="font-mono">chain</span> mode ({source.mode} active).
      </p>
    </div>
  );
}

function Row({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-text-muted">{label}</span>
      <span className="text-text">{children}</span>
    </div>
  );
}
```

- [ ] **Step 4: Run them and confirm they pass**

```bash
npm test -w @0g-delphi/frontend && npx tsc --noEmit -p frontend
```
Expected: PASS — 55 lulus.

- [ ] **Step 5: Commit**

```bash
git add frontend package.json package-lock.json
git commit -m "feat(frontend): order ticket with price impact and dilution as a numeric transition"
```

---

## Task 8: Assemble the page and verify end to end

**Files:**
- Create: `frontend/src/components/market/TradeTape.tsx`, `frontend/src/app/market/[address]/page.tsx`, `frontend/src/app/market/[address]/MarketView.tsx`
- Modify: `frontend/src/app/page.tsx`, `frontend/src/app/layout.tsx`
- Test: `frontend/test/market-page.test.tsx`

**Interfaces:**
- Consumes: all of Tasks 1–7
- Produces: a working `/market/[address]` route and a `/` that links to the fixtures

- [ ] **Step 1: Write the failing tests**

`frontend/test/market-page.test.tsx`:

```tsx
import {render, screen, waitFor} from "@testing-library/react";
import {describe, expect, it} from "vitest";
import {MarketView} from "@/app/market/[address]/MarketView";
import {AppProviders} from "@/hooks/provider";
import {FIXTURE_MARKETS, MockSource} from "@/lib/data/mock";

const address = FIXTURE_MARKETS[0]!.address;

function renderView(source = new MockSource()) {
  return render(
    <AppProviders source={source}>
      <MarketView address={address} />
    </AppProviders>,
  );
}

describe("MarketView", () => {
  it("renders the question, the probability, the payout, and the ticket", async () => {
    renderView();
    await waitFor(() => expect(screen.getByText(/ETH\/USD/)).toBeInTheDocument());
    expect(screen.getByText("59.0%")).toBeInTheDocument();
    expect(screen.getByText("1.30×")).toBeInTheDocument();
    expect(screen.getByLabelText(/belanjakan/i)).toBeInTheDocument();
  });

  it("renders the trade tape when the capability is present", async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId("trade-tape")).toBeInTheDocument());
  });

  /**
   * The easiest test to forget and the most important one: in a limited mode,
   * the history column shows an explanation, NOT a zero.
   */
  it("shows Unavailable rather than zero when the tape is unavailable", async () => {
    renderView(new MockSource({omit: ["TRADE_TAPE"]}));
    await waitFor(() =>
      expect(screen.getByText(/trade history.*not available/i)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("trade-tape")).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
npm test -w @0g-delphi/frontend
```
Expected: FAIL — the `MarketView` module is not found.

- [ ] **Step 3: Implementasikan `TradeTape.tsx`**

```tsx
import {formatCollateral, formatProbability, formatShares, shortAddress} from "@/lib/format";
import type {CollateralInfo, Trade} from "@/lib/data/types";

export function TradeTape({trades, collateral}: {trades: Trade[]; collateral: CollateralInfo}) {
  return (
    <div data-testid="trade-tape" className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-[13px]">
        <thead className="bg-bg-sunken text-[11px] uppercase tracking-wide text-text-faint">
          <tr>
            {["Time", "Side", "Shares", collateral.symbol, "P(YES)"].map((h) => (
              <th key={h} className="px-3 py-2 text-left font-medium last:text-right">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.id} className="border-t border-border">
              <td className="px-3 py-2 text-text-muted">
                {new Date(t.timestamp * 1000).toISOString().slice(11, 16)}
              </td>
              <td className={`px-3 py-2 ${t.outcome === 1 ? "text-pos" : "text-neg"}`}>
                {t.outcome === 1 ? "YES" : "NO"}
              </td>
              <td className="px-3 py-2">{formatShares(t.sharesDelta)}</td>
              <td className="px-3 py-2">{formatCollateral(t.tokens, collateral.decimals)}</td>
              <td className="px-3 py-2 text-right text-text-muted">
                {formatProbability(t.probAfterWad)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-border px-3 py-1.5 text-[11px] text-text-faint">
        {trades.length} transaksi terakhir · trader {shortAddress(trades[0]?.trader ?? "0x")}…
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implementasikan `MarketView.tsx`**

```tsx
"use client";

import {Badge} from "@/components/primitives/Badge";
import {CopyAddress} from "@/components/primitives/CopyAddress";
import {Countdown} from "@/components/primitives/Countdown";
import {Unavailable} from "@/components/primitives/Unavailable";
import {OrderTicket} from "@/components/market/OrderTicket";
import {PayoutPanel} from "@/components/market/PayoutPanel";
import {ProbabilityPanel} from "@/components/market/ProbabilityPanel";
import {TradeTape} from "@/components/market/TradeTape";
import {useMarket} from "@/hooks/useMarket";
import {useTrades} from "@/hooks/useTrades";

export function MarketView({address}: {address: `0x${string}`}) {
  const market = useMarket(address);
  const trades = useTrades(address, 24);

  if (market.status === "loading") return <Shell>Memuat…</Shell>;
  if (market.status === "error") return <Shell>Gagal memuat: {market.error.message}</Shell>;
  if (market.status === "unavailable") {
    return (
      <Shell>
        <Unavailable capability={market.capability} mode={market.mode} />
      </Shell>
    );
  }

  const m = market.data;
  return (
    <Shell>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral" label={m.tier} />
          <Badge tone={m.status === "Open" ? "positive" : "neutral"} label={m.status} />
          <span className="text-[12px] text-text-muted">{m.category}</span>
          <span className="text-[12px] text-text-muted">
            closes in <Countdown until={m.tradingEnd} />
          </span>
          <CopyAddress address={m.address} />
        </div>
        <h1 className="max-w-3xl text-[20px] leading-snug text-text">{m.question}</h1>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4">
          <ProbabilityPanel q={m.q} />
          <PayoutPanel q={m.q} />
          {trades.status === "ready" ? (
            <TradeTape trades={trades.data} collateral={m.collateral} />
          ) : trades.status === "unavailable" ? (
            <Unavailable capability={trades.capability} mode={trades.mode} />
          ) : trades.status === "error" ? (
            <div className="text-[13px] text-neg">Gagal memuat transaksi.</div>
          ) : (
            <div className="text-[13px] text-text-muted">Memuat transaksi…</div>
          )}
          <section className="rounded-lg border border-border p-4">
            <h2 className="mb-2 text-[12px] uppercase tracking-wide text-text-faint">
              Aturan penyelesaian
            </h2>
            <p className="text-[13px] leading-relaxed text-text-muted">{m.rules}</p>
          </section>
        </div>
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <OrderTicket market={m} />
        </aside>
      </div>
    </Shell>
  );
}

function Shell({children}: {children: React.ReactNode}) {
  return <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">{children}</main>;
}
```

- [ ] **Step 5: Implement the route and the home page**

`frontend/src/app/market/[address]/page.tsx`:

```tsx
import {MarketView} from "./MarketView";

export default async function Page({params}: {params: Promise<{address: string}>}) {
  const {address} = await params;
  return <MarketView address={address as `0x${string}`} />;
}
```

`frontend/src/app/page.tsx`:

```tsx
import Link from "next/link";
import {FIXTURE_MARKETS} from "@/lib/data/mock";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8">
      <h1 className="text-[20px] text-text">0G-Delphi</h1>
      <p className="text-[13px] text-text-muted">
        Mock mode. The full market list follows in F2, once MarketFactory lands.
      </p>
      <ul className="flex flex-col gap-2">
        {FIXTURE_MARKETS.map((m) => (
          <li key={m.address}>
            <Link
              href={`/market/${m.address}`}
              className="block rounded-lg border border-border px-4 py-3 text-[14px] text-text hover:border-accent"
            >
              {m.question}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

Replace `frontend/src/app/layout.tsx` to wrap everything in the provider:

```tsx
import type {Metadata} from "next";
import {AppShell} from "./AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "0G-Delphi",
  description: "Binary prediction markets on 0G Chain",
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="id">
      <body className="min-h-dvh bg-bg text-text antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
```

`frontend/src/app/AppShell.tsx`:

```tsx
"use client";

import {useState} from "react";
import {AppProviders} from "@/hooks/provider";
import {getDataSource} from "@/lib/data";

export function AppShell({children}: {children: React.ReactNode}) {
  const [source] = useState(getDataSource);
  return <AppProviders source={source}>{children}</AppProviders>;
}
```

- [ ] **Step 6: Run them and confirm they pass**

```bash
npm test -w @0g-delphi/frontend && npx tsc --noEmit -p frontend
```
Expected: PASS — 58 lulus.

- [ ] **Step 7: Verify end to end on a real server**

```bash
npm run build -w @0g-delphi/frontend
cd frontend && timeout 90 npx next start --port 3100 &
sleep 20
curl -s http://127.0.0.1:3100/market/0x1111111111111111111111111111111111111111 > /tmp/market.html
grep -c "59.0%" /tmp/market.html
grep -c "1.30×" /tmp/market.html
grep -c "mengambang" /tmp/market.html
```
Expected: the build succeeds; all three `grep`s return ≥ 1. Stop the server afterwards.

This is not a formality — it proves the page is genuinely rendered by Next and not only by jsdom, and that `bigint` values survive the server/client boundary.

- [ ] **Step 8: Commit**

```bash
git add frontend
git commit -m "feat(frontend): the complete market page in mock mode"
```

---

## Appendix A — The spec coverage map

| Spec section | Task |
|---|---|
| §2 capabilities per mode | 3 (`Capability`, `MockSource({omit})`) |
| §3.1 the `DataSource` contract | 3 — the F0 subset, see the scope note in Task 3 |
| §3.2 decorator composition | not yet — `ChainSource`/`IndexerSource` land in F1/F4; the seam is in `lib/data/index.ts` |
| §3.3 `Query<T>` + `unavailable` | 3 (types), 5 (`toQuery`), 4 (`<Unavailable>`), 8 (used on the page) |
| §3.4 maths on the client | 3 (`dpm-view`), 5 (`useQuote`) |
| §4.2 the market detail page | 6, 7, 8 |
| §5.1 probability `pᵢ²`, payout `1/pᵢ` | 3 (the trap tests), 6 (the negative tests in the panels) |
| §5.2 estimated quotes, binding slippage | 7 (`max-paid`, 0.5%) |
| §5.3 decimals through `@0g-delphi/protocol` | 1 (the import test), 2, 7 |
| §6 the anatomy of the order ticket | 7 |
| §7 sistem visual | 2 |
| §8 file structure | 1–8 |
| §9 tests | every task; the "no zero when unavailable" test lives in Task 8 |
| §10 phase F0 and part of F1 | this whole plan |

**Out of scope, by plan:** the SVG probability chart (needs a meaningful `PRICE_HISTORY` — F4), the full market list at `/` (F2, needs the factory), `/portfolio` (F3), transaction execution (F1 with `ChainSource`), the MarketSpec viewer from 0G Storage and the TEE badge (need 0G Storage — F4).

## Lampiran B — Gerbang

| Command | Must |
|---|---|
| `npm test -w @0g-delphi/frontend` | 58 lulus |
| `npx tsc --noEmit -p frontend` | bersih |
| `npm run build -w @0g-delphi/frontend` | sukses |
| `make fe` | the dev server comes up on :3000 |
