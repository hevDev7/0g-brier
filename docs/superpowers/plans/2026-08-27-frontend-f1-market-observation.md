# F1 — The Enriched Market Page (Observation Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/market/[address]` from a transaction page into an inspection page — a probability history chart, market statistics, the agent position table, the final outcome, and the resolution evidence — all in `mock` mode, with `OrderTicket` removed and the write boundary enforced structurally.

**Architecture:** The data layer gains three capabilities (`AGENT_POSITIONS`, `COST_BASIS`, `SETTLEMENT_RECEIPT`) and loses two that were never used (`QUOTE`, `EXECUTE`). Every new panel is a pure presentational component receiving already-resolved data; `MarketView` remains the only place a `Query<T>` is unwrapped. The chart is drawn as SVG with no third-party library.

**Tech Stack:** Next.js 16.3.3, React 19.2.8, TypeScript ^5, Tailwind v4 (CSS-first, no `tailwind.config.js`), TanStack Query 5, Vitest 4 + jsdom + Testing Library, `@brier/protocol` for DPM and decimal conversion.

**Spec:** `docs/superpowers/specs/2026-08-27-brier-frontend-design.md` (§1 F3, §2, §4.2, §4.3, §6)

## Global Constraints

Every task is subject to all of the following.

- **Humans execute nothing.** `DataSource` must not have a single method that writes to the chain, and the frontend must not hold a signer. This is tested, not assumed (Task 1 Step 6).
- **Probability is `pᵢ²`.** Every value labelled `%` comes from `dpm.probability`. No `dpm.price` may be labelled as a percentage — including on a chart axis.
- **Payout per share is `1/pᵢ`, not `1/Pᵢ`.** There must be no `1/probability` anywhere in the codebase.
- **Every monetary value is a `bigint`.** No `Number()` on a monetary value, no `parseFloat` on a wad value. One explicit exception: the SVG coordinates in `ProbabilityChart` (Task 2), converted from `bigint` exactly once at the render boundary and never used to compute a displayed value.
- **Components do not format numbers themselves.** Everything goes through `frontend/src/lib/format.ts`.
- **Decimal conversion imports `@brier/protocol`.** No `1e12`/`1e18` constant outside `lib/format.ts`.
- **`unavailable` is a member of the `Query<T>` union.** A component that does not handle it must not compile. Never render `0` or `—` for data the current mode cannot know.
- **Availability is evaluated per row, not per panel** (spec §2). A panel with one unknown row still renders the others.
- **Tailwind v4.** Theme tokens live in `@theme inline` inside `globals.css`. Do not create a `tailwind.config.js`.
- All tests green before committing; `npx tsc --noEmit -p frontend` clean; Conventional Commits; one commit per task.

### Lessons already paid for dearly — do not repeat them

- **`getByText` joins only an element's DIRECT text nodes.** A phrase split across elements (`<span>{value}</span> per share`) will never match. This bit the F0 plan three times. If an assertion looks for a phrase, make sure that phrase is whole inside a single element — or use `toHaveTextContent`, which reads `.textContent` recursively.
- **`afterEach(cleanup)` is mandatory.** Vitest in this project runs without `globals`, so Testing Library's auto-cleanup never installs itself. It is already in `vitest.setup.ts`; do not remove it.
- **An explicit return-type annotation is what carries the exhaustiveness guarantee.** A `switch` over `Query.status` with no `default` enforces completeness only when the function is annotated with a non-nullable type. Without the annotation, TypeScript infers `| undefined` and the guarantee evaporates.
- **Sign handling in `format.ts` has leaked twice already** (the "-0.0" bug, then a negative `formatFeeRate`). Any new format function that touches a sign must have negative and zero test cases.

---

## File structure

```
frontend/src/
├─ lib/
│  ├─ data/
│  │  ├─ types.ts          + Position, SettlementReceipt, ResolverVote
│  │  │                    + AGENT_POSITIONS/COST_BASIS/SETTLEMENT_RECEIPT
│  │  │                    − QUOTE/EXECUTE
│  │  │                    + getPositions(), getReceipt() on DataSource
│  │  └─ mock.ts           + position & receipt fixtures, a coherent generator
│  ├─ format.ts            + formatTimestamp, formatDuration
│  └─ chart.ts             BARU — geometri murni, tanpa JSX
├─ hooks/
│  ├─ usePositions.ts      BARU
│  ├─ useReceipt.ts        BARU
│  └─ useCandles.ts        BARU
├─ components/
│  ├─ market/
│  │  ├─ ProbabilityChart.tsx   BARU
│  │  ├─ MarketStats.tsx        BARU
│  │  └─ PositionsTable.tsx     BARU
│  └─ settlement/
│     ├─ FinalOutcome.tsx       BARU
│     └─ ResolutionEvidence.tsx BARU
└─ app/market/[address]/MarketView.tsx   dirakit ulang; OrderTicket dikeluarkan
```

`lib/chart.ts` is deliberately separated from its component: chart geometry is arithmetic that can be tested without a DOM, and mixing it into JSX makes the one part that can genuinely be wrong the hard part to test.

---

### Task 1: The data layer — observation capabilities, and an enforced write boundary

**Files:**
- Modify: `frontend/src/lib/data/types.ts`
- Modify: `frontend/src/lib/data/mock.ts`
- Modify: `frontend/src/components/primitives/Unavailable.tsx`
- Test: `frontend/test/mock-source.test.ts` (tambah), `frontend/test/write-boundary.test.ts` (baru)

**Interfaces:**
- Consumes: `MarketDetail`, `Trade`, `Candle`, `Query<T>`, `CapabilityUnavailableError` (F0)
- Produces:
  - `Capability` = `"LIST_MARKETS" | "MARKET_STATE" | "PRICE_HISTORY" | "TRADE_TAPE" | "AGENT_POSITIONS" | "COST_BASIS" | "SETTLEMENT_RECEIPT"`
  - `interface Position { agent: \`0x${string}\`; outcome: Outcome; shares: bigint; entryPriceWad: bigint | null }`
  - `interface ResolverVote { model: string; outcome: Outcome | null; teeVerified: boolean; simulated: boolean }`
  - `interface SettlementReceipt { outcome: Outcome | null; votes: ResolverVote[]; judgeModel: string | null; reasoning: string; criteria: string; sources: string[]; provider: \`0x${string}\`; chatId: string; simulated: boolean }`
  - `MarketDetail.createdAt: number`
  - `DataSource.getPositions(address): Promise<Position[]>`
  - `DataSource.getReceipt(address): Promise<SettlementReceipt>`

- [ ] **Step 1: Write the failing tests — an absent capability throws rather than returning empty**

Add to `frontend/test/mock-source.test.ts`:

```ts
import {describe, expect, it} from "vitest";
import {MockSource, FIXTURE_MARKETS} from "@/lib/data/mock";
import {CapabilityUnavailableError} from "@/lib/data/types";

describe("observation capabilities", () => {
  const addr = FIXTURE_MARKETS[0]!.address;

  it("getPositions melempar bila AGENT_POSITIONS diomit", async () => {
    const src = new MockSource({omit: ["AGENT_POSITIONS"]});
    await expect(src.getPositions(addr)).rejects.toBeInstanceOf(CapabilityUnavailableError);
  });

  it("getReceipt melempar bila SETTLEMENT_RECEIPT diomit", async () => {
    const src = new MockSource({omit: ["SETTLEMENT_RECEIPT"]});
    await expect(src.getReceipt(addr)).rejects.toBeInstanceOf(CapabilityUnavailableError);
  });

  it("positions sum to the market q, per outcome", async () => {
    const src = new MockSource();
    for (const m of FIXTURE_MARKETS) {
      const pos = await src.getPositions(m.address);
      for (const outcome of [0, 1] as const) {
        const held = pos
          .filter((p) => p.outcome === outcome)
          .reduce((a, p) => a + p.shares, 0n);
        expect(held).toBeLessThanOrEqual(m.q[outcome]);
      }
    }
  });

  it("every position's entry price lies between 0 and WAD", async () => {
    const src = new MockSource();
    const pos = await src.getPositions(FIXTURE_MARKETS[0]!.address);
    expect(pos.length).toBeGreaterThan(0);
    for (const p of pos) {
      expect(p.entryPriceWad).not.toBeNull();
      expect(p.entryPriceWad!).toBeGreaterThan(0n);
      expect(p.entryPriceWad!).toBeLessThan(10n ** 18n);
    }
  });

  it("COST_BASIS omitted -> the positions remain, their entry price is null", async () => {
    const src = new MockSource({omit: ["COST_BASIS"]});
    const pos = await src.getPositions(FIXTURE_MARKETS[0]!.address);
    expect(pos.length).toBeGreaterThan(0);
    for (const p of pos) expect(p.entryPriceWad).toBeNull();
  });

  it("a Settled market's receipt names an outcome, and an Open one's does not", async () => {
    const src = new MockSource();
    const settled = FIXTURE_MARKETS.find((m) => m.status === "Settled");
    expect(settled, "the fixtures must include one Settled market").toBeDefined();
    expect((await src.getReceipt(settled!.address)).outcome).not.toBeNull();

    const open = FIXTURE_MARKETS.find((m) => m.status === "Open")!;
    expect((await src.getReceipt(open.address)).outcome).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npm test -w @brier/frontend -- mock-source`
Expected: FAIL — `src.getPositions is not a function`.

- [ ] **Step 3: Perbarui `types.ts`**

Replace the `Capability` union, dropping `QUOTE` and `EXECUTE`:

```ts
export type Capability =
  | "LIST_MARKETS"
  | "MARKET_STATE"
  | "PRICE_HISTORY"
  | "TRADE_TAPE"
  | "AGENT_POSITIONS"
  | "COST_BASIS"
  | "SETTLEMENT_RECEIPT";
```

Add tipe baru:

```ts
export interface Position {
  agent: `0x${string}`;
  outcome: Outcome;
  shares: bigint;
  /**
   * Average entry price, wad. `null` means the current mode CANNOT know it —
   * not zero, and not "not loaded yet". Only events record what was paid, so
   * `chain` mode returns null here and the table renders
   * `<Unavailable capability="COST_BASIS">` in that cell. The type is
   * deliberately nullable so that a consumer which forgets will not compile.
   */
  entryPriceWad: bigint | null;
}

export interface ResolverVote {
  model: string;
  /** null = the resolver cast no vote (not yet revealed, or abstained). */
  outcome: Outcome | null;
  teeVerified: boolean;
  simulated: boolean;
}

export interface SettlementReceipt {
  /** null while the market has not been resolved. */
  outcome: Outcome | null;
  votes: ResolverVote[];
  judgeModel: string | null;
  /** The resolver's reasoning verbatim. NOT summarized — see spec §4.2. */
  reasoning: string;
  criteria: string;
  sources: string[];
  provider: `0x${string}`;
  chatId: string;
  /** true when the receipt came from stub mode. Must be conspicuous in the UI. */
  simulated: boolean;
}
```

Add `createdAt` to `MarketDetail`:

```ts
export interface MarketDetail extends MarketSummary {
  feeBps: number;
  createdAt: number;
  settlementDeadline: number;
  creator: `0x${string}`;
  specRoot: `0x${string}`;
  rules: string;
}
```

Add two methods to `DataSource`, **and the comment that explains why there is no write method**:

```ts
/**
 * The read contract. Note there is no `buy`, no `sell`, no `redeem`, and no
 * `liquidate` here, and that is not an oversight: the human UI only observes
 * (spec §1 F3). All execution lives in `@brier/agent-kit`. This boundary
 * is enforced by a test, not merely by convention — see test/write-boundary.test.ts.
 */
export interface DataSource {
  readonly mode: DataMode;
  readonly capabilities: ReadonlySet<Capability>;
  listMarkets(): Promise<MarketSummary[]>;
  getMarket(address: `0x${string}`): Promise<MarketDetail>;
  getTrades(address: `0x${string}`, limit: number): Promise<Trade[]>;
  getCandles(address: `0x${string}`, interval: Interval): Promise<Candle[]>;
  getPositions(address: `0x${string}`): Promise<Position[]>;
  getReceipt(address: `0x${string}`): Promise<SettlementReceipt>;
}
```

- [ ] **Step 4: Perbarui `mock.ts`**

Add `createdAt` to every `FIXTURE_MARKETS` entry, and make sure **at least one market has status `"Settled"`** (the Step 1 tests demand it; if all the current fixtures are `Open`, change the third market to `Settled`).

Positions are derived from the trades already generated rather than invented freely — otherwise the position table will contradict the tape exactly as the tape once contradicted the price:

```ts
/**
 * Positions are derived from the fixture trades, not written separately. Writing
 * them separately is the easiest way to make two panels on the same page
 * contradict each other — and that already happened in F0, when the tape ended at
 * 73,1% sementara market berharga 59,0%.
 */
function fixturePositions(m: MarketSummary, trades: Trade[]): Position[] {
  const acc = new Map<string, {shares: bigint; tokens: bigint}>();
  for (const t of trades) {
    if (t.sharesDelta <= 0n) continue; // only purchases form an entry price
    const key = `${t.trader}:${t.outcome}`;
    const cur = acc.get(key) ?? {shares: 0n, tokens: 0n};
    acc.set(key, {shares: cur.shares + t.sharesDelta, tokens: cur.tokens + t.tokens});
  }
  const out: Position[] = [];
  for (const [key, v] of acc) {
    const [agent, outcomeStr] = key.split(":");
    if (v.shares === 0n) continue;
    out.push({
      agent: agent as `0x${string}`,
      outcome: Number(outcomeStr) as Outcome,
      shares: v.shares,
      // tokens is already in token units; scale it up to wad before dividing so the
      // result is a price per share in wad, not a fraction truncated to zero.
      entryPriceWad: (toWad(v.tokens, m.collateral.decimals) * WAD) / v.shares,
    });
  }
  return out.sort((a, b) => (b.shares > a.shares ? 1 : -1));
}
```

The fixture receipt for the `Settled` market (the others return `outcome: null`):

```ts
const FIXTURE_RECEIPT: SettlementReceipt = {
  outcome: 1,
  votes: [
    {model: "claude-opus-5", outcome: 1, teeVerified: true, simulated: true},
    {model: "gpt-5.5", outcome: 1, teeVerified: true, simulated: true},
    {model: "qwen3-32b", outcome: 0, teeVerified: false, simulated: true},
  ],
  judgeModel: "claude-opus-5",
  reasoning:
    "Two of three resolvers concluded YES. The third read a release from a " +
    "different date and answered NO on that basis; the evidence it cited " +
    "falls outside the window the criteria set.",
  criteria:
    "YES if the ETH/USD closing price on 30 September 2026 is above $4,000 " +
    "per the daily CoinGecko release. Other sources are used only when " +
    "CoinGecko does not publish.",
  sources: ["https://www.coingecko.com/en/coins/ethereum/historical_data"],
  provider: "0x0000000000000000000000000000000000000000",
  chatId: "stub-0001",
  simulated: true,
};
```

Implement `getPositions` and `getReceipt` using the existing `require()` helper, so an omitted capability **throws** rather than returning empty.

- [ ] **Step 5: Perbarui `Unavailable.tsx`**

Remove the `QUOTE`/`EXECUTE` entries from `LABELS` and `PROVIDED_BY`, and add the three new ones:

```ts
const LABELS: Record<Capability, string> = {
  LIST_MARKETS: "Daftar market",
  MARKET_STATE: "Status market",
  PRICE_HISTORY: "Riwayat harga",
  TRADE_TAPE: "Riwayat transaksi",
  AGENT_POSITIONS: "Agent positions",
  COST_BASIS: "Harga masuk",
  SETTLEMENT_RECEIPT: "Bukti resolusi",
};
```

`PROVIDED_BY` for all three is `"indexer"` except `AGENT_POSITIONS`, which is available on `chain` too (read from `OutcomeShares`).

Because both are `Record<Capability, …>`, removing a union member makes the old entries fail to compile — which is the point.

- [ ] **Step 6: Write the write-boundary test**

Buat `frontend/test/write-boundary.test.ts`:

```ts
import {describe, expect, it} from "vitest";
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";

/**
 * This boundary is a product decision (spec §1 F3): humans only observe.
 * A rule written only in a document gets broken; one that fails CI does not.
 */
describe("the data layer does not write to the chain", () => {
  const dir = join(process.cwd(), "src/lib/data");

  it("no file in lib/data names a write operation", () => {
    const forbidden = /\b(buyShares|sellShares|redeem|liquidate|writeContract|sendTransaction|getSigner|privateKey)\b/;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(dir, file), "utf8");
      const hit = src.match(forbidden);
      expect(hit?.[0], `${file} names a write operation: ${hit?.[0]}`).toBeUndefined();
    }
  });

  it("DataSource exposes only read methods", async () => {
    const {MockSource} = await import("@/lib/data/mock");
    const src = new MockSource();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(src))
      .filter((n) => n !== "constructor" && typeof (src as never)[n] === "function");
    const allowed = new Set([
      "listMarkets", "getMarket", "getTrades", "getCandles",
      "getPositions", "getReceipt", "require", "find",
    ]);
    for (const m of methods) {
      expect(allowed.has(m), `unexpected method on MockSource: ${m}`).toBe(true);
    }
  });
});
```

- [ ] **Step 7: Run the whole suite**

Run: `npm test -w @brier/frontend && npx tsc --noEmit -p frontend`
Expected: all green. Older tests naming `QUOTE`/`EXECUTE` will fail to compile — fix them by deleting the references, not by restoring the union members.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/data frontend/src/components/primitives/Unavailable.tsx frontend/test
git commit -m "feat(frontend): observation capabilities in the data layer, write boundary enforced by test"
```

---

### Task 2: `lib/chart.ts` — geometri grafik sebagai aritmetika murni

**Files:**
- Create: `frontend/src/lib/chart.ts`
- Test: `frontend/test/chart.test.ts`

**Interfaces:**
- Consumes: `Candle` (Task 1)
- Produces:
  - `interface Extent { minT: number; maxT: number }`
  - `function seriesPath(candles: Candle[], box: Box, extent: Extent, pick: (c: Candle) => bigint): string`
  - `function yTicks(box: Box): {y: number; label: string}[]`
  - `function xTicks(candles: Candle[], box: Box, extent: Extent, count: number): {x: number; label: string}[]`
  - `interface Box { width: number; height: number; padLeft: number; padRight: number; padTop: number; padBottom: number }`

The Y axis is **always 0–100%**, never scaled to the data range. A probability chart with a floating axis makes a 2-point move look like a collapse.

- [ ] **Step 1: Write the failing tests**

Buat `frontend/test/chart.test.ts`:

```ts
import {describe, expect, it} from "vitest";
import {seriesPath, yTicks, xTicks, type Box} from "@/lib/chart";
import type {Candle} from "@/lib/data/types";

const WAD = 10n ** 18n;
const BOX: Box = {width: 600, height: 300, padLeft: 40, padRight: 8, padTop: 8, padBottom: 24};

function candle(t: number, closeWad: bigint): Candle {
  return {bucketStart: t, open: closeWad, high: closeWad, low: closeWad, close: closeWad, volume: 0n};
}

describe("seriesPath", () => {
  it("maps 0% to the bottom of the plot and 100% to its top", () => {
    const cs = [candle(0, 0n), candle(100, WAD)];
    const d = seriesPath(cs, BOX, {minT: 0, maxT: 100}, (c) => c.close);
    // y for 0% = height - padBottom = 276 ; y for 100% = padTop = 8
    expect(d).toBe("M40,276L592,8");
  });

  it("returns an empty string for empty data", () => {
    expect(seriesPath([], BOX, {minT: 0, maxT: 1}, (c) => c.close)).toBe("");
  });

  it("places a single point rather than a broken line", () => {
    const d = seriesPath([candle(5, WAD / 2n)], BOX, {minT: 5, maxT: 5}, (c) => c.close);
    expect(d.startsWith("M")).toBe(true);
    expect(d).not.toContain("NaN");
  });

  it("never produces NaN when the time span is zero", () => {
    const cs = [candle(7, 0n), candle(7, WAD)];
    const d = seriesPath(cs, BOX, {minT: 7, maxT: 7}, (c) => c.close);
    expect(d).not.toContain("NaN");
  });
});

describe("yTicks", () => {
  it("is always 0%..100%, and does not follow the data", () => {
    expect(yTicks(BOX).map((t) => t.label)).toEqual(["0%", "25%", "50%", "75%", "100%"]);
  });
});

describe("xTicks", () => {
  it("returns nothing for empty data", () => {
    expect(xTicks([], BOX, {minT: 0, maxT: 1}, 4)).toEqual([]);
  });

  it("never exceeds the requested count", () => {
    const cs = Array.from({length: 50}, (_, i) => candle(i * 60, WAD / 2n));
    expect(xTicks(cs, BOX, {minT: 0, maxT: 2940}, 4).length).toBeLessThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npm test -w @brier/frontend -- chart`
Expected: FAIL — the `@/lib/chart` module does not exist.

- [ ] **Step 3: Implementasikan `lib/chart.ts`**

```ts
import type {Candle} from "@/lib/data/types";

const WAD = 10n ** 18n;
/** Precision of the wad→number conversion for coordinates. Enough for 600px. */
const COORD_SCALE = 10_000n;

export interface Box {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
}

export interface Extent {
  minT: number;
  maxT: number;
}

const plotLeft = (b: Box) => b.padLeft;
const plotRight = (b: Box) => b.width - b.padRight;
const plotTop = (b: Box) => b.padTop;
const plotBottom = (b: Box) => b.height - b.padBottom;

/**
 * The only place a wad value crosses into `number` anywhere in the frontend, and
 * only for pixel coordinates — never for a number a user reads. The conversion
 * goes through bigint first so the division does not lose precision before being
 * presisi sebelum diskalakan.
 */
function wadToUnit(v: bigint): number {
  const clamped = v < 0n ? 0n : v > WAD ? WAD : v;
  return Number((clamped * COORD_SCALE) / WAD) / Number(COORD_SCALE);
}

export function seriesPath(
  candles: Candle[],
  box: Box,
  extent: Extent,
  pick: (c: Candle) => bigint,
): string {
  if (candles.length === 0) return "";
  const span = extent.maxT - extent.minT;
  const w = plotRight(box) - plotLeft(box);
  const h = plotBottom(box) - plotTop(box);
  return candles
    .map((c, i) => {
      // A zero time span happens with a single bucket; spread evenly instead of
      // dividing by zero, which would put NaN in the `d` attribute.
      const tx = span === 0
        ? (candles.length === 1 ? 0 : i / (candles.length - 1))
        : (c.bucketStart - extent.minT) / span;
      const x = plotLeft(box) + tx * w;
      const y = plotBottom(box) - wadToUnit(pick(c)) * h;
      return `${i === 0 ? "M" : "L"}${round(x)},${round(y)}`;
    })
    .join("");
}

const round = (n: number) => Math.round(n * 100) / 100;

export function yTicks(box: Box): {y: number; label: string}[] {
  const h = plotBottom(box) - plotTop(box);
  return [0, 25, 50, 75, 100].map((pct) => ({
    y: round(plotBottom(box) - (pct / 100) * h),
    label: `${pct}%`,
  }));
}

export function xTicks(
  candles: Candle[],
  box: Box,
  extent: Extent,
  count: number,
): {x: number; label: string}[] {
  if (candles.length === 0 || count <= 0) return [];
  const span = extent.maxT - extent.minT;
  const w = plotRight(box) - plotLeft(box);
  const step = Math.max(1, Math.floor(candles.length / count));
  const out: {x: number; label: string}[] = [];
  for (let i = 0; i < candles.length && out.length < count; i += step) {
    const c = candles[i]!;
    const tx = span === 0 ? 0 : (c.bucketStart - extent.minT) / span;
    out.push({
      x: round(plotLeft(box) + tx * w),
      label: new Date(c.bucketStart * 1000).toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
      }),
    });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npm test -w @brier/frontend -- chart`
Expected: PASS, 7/7.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/chart.ts frontend/test/chart.test.ts
git commit -m "feat(frontend): geometri grafik probabilitas sebagai aritmetika murni"
```

---

### Task 3: `ProbabilityChart` — two series, a fixed 0–100% axis

**Files:**
- Create: `frontend/src/components/market/ProbabilityChart.tsx`
- Create: `frontend/src/hooks/useCandles.ts`
- Test: `frontend/test/probability-chart.test.tsx`

**Interfaces:**
- Consumes: `seriesPath`, `yTicks`, `xTicks`, `Box` (Task 2); `Candle`, `Query<T>` (Task 1); `toQuery`, `useDataSource` (F0)
- Produces:
  - `function useCandles(address, interval): Query<Candle[]>`
  - `<ProbabilityChart candles={Candle[]} />`

`Candle.close` holds the **YES probability in wad** (not the marginal price). The NO series is `WAD − close`, guaranteed to sum to 100% by spec §5.1.

- [ ] **Step 1: Write the failing tests**

Buat `frontend/test/probability-chart.test.tsx`:

```tsx
import {describe, expect, it} from "vitest";
import {render, screen} from "@testing-library/react";
import {ProbabilityChart} from "@/components/market/ProbabilityChart";
import type {Candle} from "@/lib/data/types";

const WAD = 10n ** 18n;
const cs: Candle[] = [
  {bucketStart: 0, open: WAD / 2n, high: WAD / 2n, low: WAD / 2n, close: WAD / 2n, volume: 0n},
  {bucketStart: 3600, open: (WAD * 59n) / 100n, high: (WAD * 59n) / 100n,
   low: (WAD * 59n) / 100n, close: (WAD * 59n) / 100n, volume: 0n},
];

describe("ProbabilityChart", () => {
  it("draws two series", () => {
    const {container} = render(<ProbabilityChart candles={cs} />);
    expect(container.querySelectorAll("path[data-series]").length).toBe(2);
  });

  it("labels the Y axis 0% to 100%, not the data range", () => {
    render(<ProbabilityChart candles={cs} />);
    for (const label of ["0%", "25%", "50%", "75%", "100%"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("the NO series is the complement of the YES series", () => {
    const {container} = render(<ProbabilityChart candles={cs} />);
    const yes = container.querySelector('path[data-series="yes"]')!.getAttribute("d")!;
    const no = container.querySelector('path[data-series="no"]')!.getAttribute("d")!;
    expect(yes).not.toBe(no);
    expect(yes).not.toContain("NaN");
    expect(no).not.toContain("NaN");
  });

  it("names the axis as a probability, not a price", () => {
    render(<ProbabilityChart candles={cs} />);
    expect(screen.getByText(/P\(YES\)/)).toBeInTheDocument();
  });

  it("empty data renders a message, not a bare axis", () => {
    render(<ProbabilityChart candles={[]} />);
    expect(screen.getByText(/no history yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npm test -w @brier/frontend -- probability-chart`
Expected: FAIL — the component does not exist yet.

- [ ] **Step 3: Implementasikan `useCandles.ts`**

```ts
"use client";
import {useQuery} from "@tanstack/react-query";
import {useDataSource} from "@/hooks/provider";
import {toQuery} from "@/hooks/toQuery";
import type {Candle, Interval, Query} from "@/lib/data/types";

export function useCandles(address: `0x${string}`, interval: Interval): Query<Candle[]> {
  const src = useDataSource();
  return toQuery(
    useQuery({
      queryKey: ["candles", src.mode, address, interval],
      queryFn: () => src.getCandles(address, interval),
    }),
    src.mode,
  );
}
```

- [ ] **Step 4: Implementasikan `ProbabilityChart.tsx`**

```tsx
import {seriesPath, xTicks, yTicks, type Box} from "@/lib/chart";
import type {Candle} from "@/lib/data/types";

const WAD = 10n ** 18n;
const BOX: Box = {width: 600, height: 300, padLeft: 40, padRight: 8, padTop: 8, padBottom: 24};

export function ProbabilityChart({candles}: {candles: Candle[]}) {
  if (candles.length === 0) {
    return (
      <div className="rounded-lg border border-border px-4 py-8 text-center text-[13px] text-text-muted">
        No history yet for this market.
      </div>
    );
  }

  const extent = {
    minT: candles[0]!.bucketStart,
    maxT: candles[candles.length - 1]!.bucketStart,
  };
  const yes = seriesPath(candles, BOX, extent, (c) => c.close);
  const no = seriesPath(candles, BOX, extent, (c) => WAD - c.close);

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 text-[12px] uppercase tracking-wide text-text-muted">
        Riwayat P(YES)
      </div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${BOX.width} ${BOX.height}`}
          className="w-full"
          role="img"
          aria-label="Grafik riwayat probabilitas"
        >
          {yTicks(BOX).map((t) => (
            <g key={t.label}>
              <line x1={BOX.padLeft} x2={BOX.width - BOX.padRight} y1={t.y} y2={t.y}
                    className="stroke-border" strokeWidth={1} />
              <text x={0} y={t.y + 4} className="fill-text-faint text-[10px]">{t.label}</text>
            </g>
          ))}
          {xTicks(candles, BOX, extent, 5).map((t) => (
            <text key={t.x} x={t.x} y={BOX.height - 6}
                  textAnchor="middle" className="fill-text-faint text-[10px]">
              {t.label}
            </text>
          ))}
          <path data-series="no" d={no} fill="none" className="stroke-neg" strokeWidth={1.5} />
          <path data-series="yes" d={yes} fill="none" className="stroke-pos" strokeWidth={1.5} />
        </svg>
      </div>
      <div className="mt-1 flex gap-4 text-[11px] text-text-muted">
        <span className="text-pos">● YES</span>
        <span className="text-neg">● NO</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests, confirm they pass**

Run: `npm test -w @brier/frontend -- probability-chart`
Expected: PASS, 5/5.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/market/ProbabilityChart.tsx frontend/src/hooks/useCandles.ts frontend/test/probability-chart.test.tsx
git commit -m "feat(frontend): probability history chart with a fixed 0-100% axis"
```

---

### Task 4: `MarketStats` — per-row availability

**Files:**
- Create: `frontend/src/components/market/MarketStats.tsx`
- Modify: `frontend/src/lib/format.ts` (tambah `formatTimestamp`)
- Test: `frontend/test/market-stats.test.tsx`

**Interfaces:**
- Consumes: `MarketDetail`, `Trade`, `Query<T>` (Task 1); `formatCollateral`, `formatFeeRate` (F0)
- Produces:
  - `function formatTimestamp(unixSeconds: number): string`
  - `<MarketStats market={MarketDetail} trades={Query<Trade[]>} />`

Volume is computed from `trades`; when `trades` is unavailable, **only the volume row** renders `<Unavailable>` — the other six stay populated. That is the per-row rule of spec §2 applied directly.

- [ ] **Step 1: Write the failing tests**

Buat `frontend/test/market-stats.test.tsx`:

```tsx
import {describe, expect, it} from "vitest";
import {render, screen} from "@testing-library/react";
import {MarketStats} from "@/components/market/MarketStats";
import {FIXTURE_MARKETS} from "@/lib/data/mock";
import type {Trade} from "@/lib/data/types";

const m = FIXTURE_MARKETS[0]!;
const trades: Trade[] = [
  {id: "1", timestamp: 1, trader: "0x1111111111111111111111111111111111111111",
   outcome: 1, sharesDelta: 10n ** 18n, tokens: 500_000n, fee: 0n, probAfterWad: 10n ** 18n / 2n},
  {id: "2", timestamp: 2, trader: "0x2222222222222222222222222222222222222222",
   outcome: 0, sharesDelta: -(10n ** 18n), tokens: 300_000n, fee: 0n, probAfterWad: 10n ** 18n / 2n},
];

describe("MarketStats", () => {
  it("sums volume from absolute token values, buys and sells alike", () => {
    render(<MarketStats market={m} trades={{status: "ready", data: trades}} />);
    expect(screen.getByTestId("stat-volume")).toHaveTextContent("0.80");
  });

  it("only the volume row is unavailable; the other rows stay populated", () => {
    render(
      <MarketStats market={m} trades={{status: "unavailable", capability: "TRADE_TAPE", mode: "chain"}} />,
    );
    expect(screen.getByTestId("stat-volume")).toHaveTextContent(/not available/i);
    expect(screen.getByTestId("stat-fee")).not.toHaveTextContent(/not available/i);
    expect(screen.getByTestId("stat-liquidity")).not.toHaveTextContent(/not available/i);
  });

  it("shows the complete lifecycle timeline", () => {
    render(<MarketStats market={m} trades={{status: "loading"}} />);
    for (const id of ["stat-created", "stat-closes", "stat-settles-by"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it("shows the fee as a rate, not just as an amount", () => {
    render(<MarketStats market={m} trades={{status: "loading"}} />);
    expect(screen.getByTestId("stat-fee")).toHaveTextContent("%");
  });
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npm test -w @brier/frontend -- market-stats`
Expected: FAIL — the component does not exist yet.

- [ ] **Step 3: Add `formatTimestamp` to `format.ts`**

```ts
/** Absolute time, in the reader's local zone. Used for the lifecycle timeline. */
export function formatTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
```

- [ ] **Step 4: Implementasikan `MarketStats.tsx`**

Susun sebagai daftar baris `<Row>` lokal. Volume:

```tsx
function volumeRow(trades: Query<Trade[]>, m: MarketDetail) {
  switch (trades.status) {
    case "ready": {
      // Sells are volume too. Summing signed values would make a busy market look
      // quiet, because buys and sells would cancel each other out.
      const total = trades.data.reduce((a, t) => a + (t.tokens < 0n ? -t.tokens : t.tokens), 0n);
      return <span>{formatCollateral(total, m.collateral.decimals)}</span>;
    }
    case "unavailable":
      return <Unavailable capability={trades.capability} mode={trades.mode} />;
    case "error":
      return <span className="text-neg">Gagal memuat</span>;
    case "loading":
      return <span className="text-text-muted">Memuat…</span>;
  }
}
```

Note the return-type annotation on `volumeRow` — give it `: React.JSX.Element`, per the lesson in Global Constraints.

The other rows: Fee (`formatFeeRate(m.feeBps)`), Liquidity (`formatCollateral(poolWad→token)`), Created, Closes, Settles by. Every row carries a `data-testid="stat-…"`.

- [ ] **Step 5: Run the tests, confirm they pass**

Run: `npm test -w @brier/frontend -- market-stats`
Expected: PASS, 4/4.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/market/MarketStats.tsx frontend/src/lib/format.ts frontend/test/market-stats.test.tsx
git commit -m "feat(frontend): market statistics panel with per-row availability"
```

---

### Task 5: `PositionsTable` — who holds what, at what price

**Files:**
- Create: `frontend/src/components/market/PositionsTable.tsx`
- Create: `frontend/src/hooks/usePositions.ts`
- Test: `frontend/test/positions-table.test.tsx`

**Interfaces:**
- Consumes: `Position`, `MarketDetail`, `Query<T>` (Task 1); `probabilityWad`, `payoutPerShareWad` (F0 `dpm-view`); `formatShares`, `formatPricePerShare` (F0)
- Produces:
  - `function usePositions(address): Query<Position[]>`
  - `<PositionsTable positions={Position[]} market={MarketDetail} mode={DataMode} />`

Columns: Agent · Side · Shares · Entry price · Current price. **The current price is `dpm.price`, not the probability** — it is a price per share in collateral units, directly comparable to the entry price. Labelling it with a percent sign breaks the Global Constraints.

The **Entry price** column is the only one that can be unknown: `entryPriceWad === null` means this mode does not record what was paid. That cell renders `<Unavailable capability="COST_BASIS" mode={mode} />` while the other four columns stay populated — spec §2's per-row rule applied at cell level. That is why the component takes a `mode` prop.

- [ ] **Step 1: Write the failing tests**

```tsx
import {describe, expect, it} from "vitest";
import {render, screen, within} from "@testing-library/react";
import {PositionsTable} from "@/components/market/PositionsTable";
import {FIXTURE_MARKETS} from "@/lib/data/mock";
import type {Position} from "@/lib/data/types";

const WAD = 10n ** 18n;
const m = FIXTURE_MARKETS[0]!;
const positions: Position[] = [
  {agent: "0xAAaAaAAaAAaAaaAaaAAAAaAaAaaAAAAAaAaAaAaA", outcome: 1,
   shares: 100n * WAD, entryPriceWad: (WAD * 70n) / 100n},
  {agent: "0xBbBBBbbBbBbbbBBbBbbbbbBBbBbbbBBbBBbBBBbB", outcome: 0,
   shares: 40n * WAD, entryPriceWad: (WAD * 55n) / 100n},
];

describe("PositionsTable", () => {
  it("renders one row per position, with its side", () => {
    render(<PositionsTable positions={positions} market={m} mode="mock" />);
    expect(screen.getAllByRole("row")).toHaveLength(3); // kepala + 2
    expect(screen.getByText("YES")).toBeInTheDocument();
    expect(screen.getByText("NO")).toBeInTheDocument();
  });

  it("entry price and current price are both per share, with no percent label", () => {
    render(<PositionsTable positions={positions} market={m} mode="mock" />);
    const row = screen.getAllByRole("row")[1]!;
    expect(within(row).getByTestId("entry")).not.toHaveTextContent("%");
    expect(within(row).getByTestId("current")).not.toHaveTextContent("%");
  });

  it("an empty list explains itself rather than showing a bare table", () => {
    render(<PositionsTable positions={[]} market={m} mode="mock" />);
    expect(screen.getByText(/no positions/i)).toBeInTheDocument();
  });

  it("a null entry price renders an explanation, not a zero; the other columns stay populated", () => {
    const unknown = positions.map((p) => ({...p, entryPriceWad: null}));
    render(<PositionsTable positions={unknown} market={m} mode="chain" />);
    const row = screen.getAllByRole("row")[1]!;
    expect(within(row).getByTestId("entry")).toHaveTextContent(/not available/i);
    expect(within(row).getByTestId("entry")).not.toHaveTextContent("0.0000");
    expect(within(row).getByTestId("current")).not.toHaveTextContent(/not available/i);
  });

  it("memendekkan alamat agent", () => {
    render(<PositionsTable positions={positions} market={m} mode="mock" />);
    expect(screen.queryByText(positions[0]!.agent)).not.toBeInTheDocument();
    expect(screen.getByText(/0xAAaA…AaAa/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npm test -w @brier/frontend -- positions-table`

- [ ] **Step 3: Implementasikan `usePositions.ts`**

The same pattern as `useCandles`, with `queryKey: ["positions", src.mode, address]`.

- [ ] **Step 4: Implementasikan `PositionsTable.tsx`**

The current price for side `p.outcome`: `dpm.price(market.q, p.outcome)`, formatted with `formatPricePerShare`. Address elision uses the same helper as `CopyAddress` — if it is not exported yet, export it from there rather than rewriting it.

- [ ] **Step 5: Run the tests, confirm they pass**

Expected: PASS, 4/4.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/market/PositionsTable.tsx frontend/src/hooks/usePositions.ts frontend/test/positions-table.test.tsx
git commit -m "feat(frontend): agent positions table with entry price and current price"
```

---

### Task 6: `FinalOutcome` + `ResolutionEvidence` — evidence one can inspect

**Files:**
- Create: `frontend/src/components/settlement/FinalOutcome.tsx`
- Create: `frontend/src/components/settlement/ResolutionEvidence.tsx`
- Create: `frontend/src/hooks/useReceipt.ts`
- Test: `frontend/test/settlement.test.tsx`

**Interfaces:**
- Consumes: `SettlementReceipt`, `ResolverVote`, `MarketDetail` (Task 1); `payoutPerShareWad` (F0)
- Produces:
  - `function useReceipt(address): Query<SettlementReceipt>`
  - `<FinalOutcome receipt={SettlementReceipt} market={MarketDetail} />`
  - `<ResolutionEvidence receipt={SettlementReceipt} />`

Two rules that must not be broken:

1. **The resolver's reasoning is shown verbatim.** Not summarized, not cut off mid-sentence. Summarizing it means the UI is passing judgement too, and the reader loses exactly the part they wanted to examine. It may be folded (`<details>`); it may not be trimmed.
2. **`simulated: true` must be conspicuous.** A simulated result must never be mistaken for a real one.

The payout rate uses `payoutPerShareWad` (`1/pᵢ`), **not** `1/Pᵢ`.

- [ ] **Step 1: Write the failing tests**

```tsx
import {describe, expect, it} from "vitest";
import {render, screen} from "@testing-library/react";
import {FinalOutcome} from "@/components/settlement/FinalOutcome";
import {ResolutionEvidence} from "@/components/settlement/ResolutionEvidence";
import {FIXTURE_MARKETS} from "@/lib/data/mock";
import type {SettlementReceipt} from "@/lib/data/types";

const m = FIXTURE_MARKETS[0]!;
const receipt: SettlementReceipt = {
  outcome: 1,
  votes: [
    {model: "claude-opus-5", outcome: 1, teeVerified: true, simulated: true},
    {model: "gpt-5.5", outcome: 1, teeVerified: true, simulated: true},
    {model: "qwen3-32b", outcome: 0, teeVerified: false, simulated: true},
  ],
  judgeModel: "claude-opus-5",
  reasoning: "Two of three resolvers concluded YES.",
  criteria: "YES if the closing price is above $4,000.",
  sources: ["https://example.org/data"],
  provider: "0x0000000000000000000000000000000000000000",
  chatId: "stub-0001",
  simulated: true,
};

describe("FinalOutcome", () => {
  it("names the winner and its payout rate", () => {
    render(<FinalOutcome receipt={receipt} market={m} />);
    expect(screen.getByTestId("winner")).toHaveTextContent("YES");
    expect(screen.getByTestId("payout")).toHaveTextContent("×");
  });

  it("the payout rate uses 1/p, not 1/P", () => {
    render(<FinalOutcome receipt={receipt} market={m} />);
    // The fixture q gives P(YES)=59.0% -> p=0.7681 -> 1/p = 1.30x. 1/P would be 1.69x.
    expect(screen.getByTestId("payout")).toHaveTextContent("1.30×");
    expect(screen.getByTestId("payout")).not.toHaveTextContent("1.69×");
  });
});

describe("ResolutionEvidence", () => {
  it("shows every resolver model and its vote", () => {
    render(<ResolutionEvidence receipt={receipt} />);
    for (const v of receipt.votes) expect(screen.getByText(v.model)).toBeInTheDocument();
  });

  it("shows the reasoning verbatim, untrimmed", () => {
    render(<ResolutionEvidence receipt={receipt} />);
    expect(screen.getByTestId("reasoning")).toHaveTextContent(receipt.reasoning);
  });

  it("shows the resolution criteria and the data sources", () => {
    render(<ResolutionEvidence receipt={receipt} />);
    expect(screen.getByTestId("criteria")).toHaveTextContent(receipt.criteria);
    expect(screen.getByText(receipt.sources[0]!)).toBeInTheDocument();
  });

  it("menandai hasil tersimulasi secara mencolok", () => {
    render(<ResolutionEvidence receipt={receipt} />);
    expect(screen.getByTestId("simulated-badge")).toHaveTextContent(/simulasi/i);
  });

  it("does not flag simulation for a real receipt", () => {
    render(<ResolutionEvidence receipt={{...receipt, simulated: false}} />);
    expect(screen.queryByTestId("simulated-badge")).not.toBeInTheDocument();
  });

  it("flags a resolver whose vote differs from the final outcome", () => {
    render(<ResolutionEvidence receipt={receipt} />);
    expect(screen.getByTestId("vote-qwen3-32b")).toHaveTextContent(/NO/);
  });
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npm test -w @brier/frontend -- settlement`

- [ ] **Step 3: Implementasikan `useReceipt.ts`, `FinalOutcome.tsx`, `ResolutionEvidence.tsx`**

`ResolutionEvidence` shows each resolver's vote along with the side it took, so a reader sees that the committee was **not unanimous** when it was not. Hiding the minority vote makes the consensus look stronger than it was, and that is the same kind of lie as rendering zero for data that is not known.

- [ ] **Step 4: Run the tests, confirm they pass**

Expected: PASS, 8/8.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settlement frontend/src/hooks/useReceipt.ts frontend/test/settlement.test.tsx
git commit -m "feat(frontend): final outcome panel and inspectable resolution evidence"
```

---

### Task 7: Reassemble `MarketView` — the inspection page

**Files:**
- Modify: `frontend/src/app/market/[address]/MarketView.tsx`
- Delete: `frontend/src/components/market/OrderTicket.tsx`
- Delete: `frontend/src/hooks/useQuote.ts` → **move it**, do not delete it (see Step 3)
- Delete: `frontend/test/order-ticket.test.tsx`
- Create: `packages/protocol/src/quote.ts`
- Test: `frontend/test/market-page.test.tsx` (perbarui)

- [ ] **Step 1: Update the page tests**

The old tests asserted the order ticket exists. Replace them with ones asserting it does **not**, and that the new panels do:

```tsx
it("has no execution control on the human page", async () => {
  renderMarket();
  expect(await screen.findByTestId("probability-panel")).toBeInTheDocument();
  expect(screen.queryByTestId("order-ticket")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", {name: /buy|sell|approve|confirm/i})).not.toBeInTheDocument();
});

it("renders the inspection panels", async () => {
  renderMarket();
  for (const id of ["probability-panel", "payout-panel", "probability-chart",
                    "market-stats", "positions-table", "trade-tape"]) {
    expect(await screen.findByTestId(id)).toBeInTheDocument();
  }
});

it("explains an absent capability rather than rendering an empty table", async () => {
  renderMarket(new MockSource({omit: ["AGENT_POSITIONS"]}));
  expect(await screen.findByText(/agent positions.*not available/i)).toBeInTheDocument();
  expect(screen.queryByTestId("positions-table")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npm test -w @brier/frontend -- market-page`

- [ ] **Step 3: Move the quoting engine, do not discard it**

The maths in `useQuote` is the reference implementation for `agent-kit` (spec §6). Move its pure functions to `packages/protocol/src/quote.ts` — the fee inversion with the `10_000n + bps` denominator, `qAfterBuy`, and the probability/payout transitions — together with their tests. Only then delete the hook and its component from the frontend.

**A scope warning:** `packages/protocol` is the DPM mirror pinned to Solidity by a 512-vector differential test. Adding a new module is fine; changing `dpm.ts`, `units.ts`, or that package's import conventions is **not** part of this task.

- [ ] **Step 4: Rakit ulang `MarketView`**

The left column: the header → the probability panel → the payout panel → the chart → the positions table → the tape.

**There is no `SpecViewer` in F1, and that is deliberate.** Spec §4.2 mentions it, but its content comes from 0G Storage through `specRoot` (`MARKET_SPEC_BLOB`), whose integration does not exist yet. Building a capability nothing uses is precisely the dead weight just discarded along with `QUOTE`/`EXECUTE`. The resolution rules remain visible to a reader through the **Resolution criteria** row in `ResolutionEvidence`, sourced from the receipt rather than from the blob.
The right column: `MarketStats`; plus `FinalOutcome` and `ResolutionEvidence` when `market.status === "Settled"`.

Every `Query<T>` is unwrapped through a `switch` function with an explicit return-type annotation and no `default` — the same pattern as the existing `renderTrades`.

- [ ] **Step 5: Run the whole suite and the build**

```bash
npm test -w @brier/frontend && npm test -w @brier/protocol
npx tsc --noEmit -p frontend && npm run build -w @brier/frontend
```
Expected: semua hijau; build sukses.

- [ ] **Step 6: Verify on the production server**

Run `next start` on a port **verified to be free**, and make sure the process answering really is yours before trusting the result — one task in an earlier plan got a false 200 from a foreign process that happened to hold the port. Then `curl` the market page and confirm there is **no** buy/sell button in its HTML.

- [ ] **Step 7: Commit**

```bash
git add frontend packages/protocol/src/quote.ts packages/protocol/test
git commit -m "feat(frontend): the market page becomes an inspection page; the order ticket is removed"
```

---

## Fase berikutnya

F1 is done when the market detail page matches the Delphi reference, entirely from `MockSource`. Next, F2 (`ChainSource` + the market list) requires contract Task 17, which is already finished; F5 (`@brier/agent-kit`) uses the `packages/protocol/src/quote.ts` moved in Task 7 as its reference implementation.
