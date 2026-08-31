# Build brief — Brier human web UI

> **Status, 2026-08-28: this brief has been executed.** The three routes, the design system, and
> the English migration all shipped; `docs/superpowers/specs/2026-08-27-brier-frontend-design.md`
> and the code are now the authority, and this file is kept as the reasoning behind them. Four
> things below are deliberately out of date, corrected inline where they appear:
>
> - **Dependencies.** `lucide-react` was added for icons. Everything else in §8 still holds — no
>   component library, no charting library.
> - **Palette.** §6 describes the v1 zinc/blue tokens. The shipped palette is warm paper + teal
>   with Manrope and DM Mono; see spec §7.1, whose contrast ratios are measured, not chosen.
> - **The three gaps in §3.3 are closed.** `MarketSummary.createdAt` exists; `/portfolio/[agent]`
>   is composed from `listMarkets` + `getPositions`; there is no wallet anywhere.
> - **§13's build order is done.** What remains is F2/F4: `ChainSource` and `IndexerSource`.
>
> Everything else — the five laws, the data contract, the testing traps, the forbidden list — is
> current, and is what the next agent working here should read first.


**Paste this whole file as the opening message to the frontend agent.** It is written for a
coding agent working *inside* this repository (Cursor / Claude Code / Codex), not for a sandbox
generator: it may import workspace packages, run `vitest`, and read the existing components.

---

## 0. Your job, in one paragraph

Brier is an agent-native binary prediction market on 0G Chain. Pricing is Pennock's DPM
(`C(q) = √(Σqᵢ²)`), settlement is decided by a committee of AI resolvers, and **every trade is
executed by autonomous agents through an SDK — never by a human in a browser.** You are building
the human web UI, which is therefore an *instrument panel*, not an exchange: it shows what the
price is, where that price came from, who holds what, and on what evidence a market was resolved.
All data comes from `MockSource` for now; the same components will later be fed by a chain reader
and an indexer without being rewritten. Your primary success criterion is that **nobody has to
rewire data plumbing after you** — every value you render must come from a field that already
exists in the `DataSource` contract, or from a field you added to that contract properly.

---

## 1. Read these before you write a line

| File | What to take from it |
|---|---|
| `CLAUDE.md` (repo root) | The three rules this project gets wrong most often. Non-negotiable. |
| `frontend/src/lib/data/types.ts` | **The contract.** Every field the UI is allowed to render. |
| `frontend/src/lib/data/mock.ts` | The fixtures you will render, and how they are derived. |
| `frontend/src/lib/format.ts` | Every number-formatting rule. Components never format numbers themselves. |
| `frontend/src/lib/dpm-view.ts` | The only sanctioned source of probability and payout. |
| `frontend/src/app/market/[address]/MarketView.tsx` | The `Query<T>` unwrapping pattern. Copy it exactly. |
| `frontend/src/app/globals.css` | The design tokens. They already exist — do not invent a second palette. |
| `docs/superpowers/specs/2026-08-27-brier-frontend-design.md` | The authority for routes, columns, and the visual system. |
| `frontend/node_modules/next/dist/docs/01-app/` | Next.js 16 is **not** the Next.js in your training data. Read before using an App Router API. |

---

## 2. Five laws

Breaking any one of these makes the work unusable, no matter how it looks.

### L1 — Probability is `pᵢ²`. Payout is `1/pᵢ`. Never `1/Pᵢ`.

`dpm.price(q, i)` returns the **marginal price** `pᵢ = qᵢ/C(q)`. The implied probability is its
**square**, because `Σpᵢ² = 1`.

- Anything you label with `%` comes from `probabilityWad()` in `lib/dpm-view.ts`.
- Anything you label with `×` comes from `payoutPerShareWad()` in `lib/dpm-view.ts`.
- The marginal price `pᵢ` may appear **only** as a per-share execution price, formatted with
  `formatPricePerShare` (4 decimals, no unit) — in the positions table and the trade tape. Never
  with a percent sign.
- **There is no `1/probability` anywhere in this codebase, and you will not add one.** At
  `P(YES) = 59.0%` the correct payout is `1.30×`; `1/P` says `1.69×` — a 30% overstatement, in
  exactly the direction that hurts anyone who believes it. This project's own first spec draft
  shipped that bug.

The two displayed probabilities can sum to one unit less than WAD (two independent floor
divisions). **Display both as they are. Do not normalise the pair to make it total exactly 100%** —
forcing the sum means showing a number that is not the contract's number.

### L2 — The human UI only observes. Execution controls are absent, not disabled.

There is no Buy, no Sell, no Redeem, no Liquidate, no Approve, no Connect Wallet, no signer, no
`wagmi`, no `viem` write path, no order ticket, no slippage input, no "coming soon" placeholder for
any of them. Not hidden behind a flag, not greyed out — **absent**. A disabled button still promises
something that will never exist here.

This is enforced by tests, not convention:
- `frontend/test/write-boundary.test.ts` greps `src/lib/data/*.ts` for
  `buyShares|sellShares|redeem|liquidate|writeContract|sendTransaction|getSigner|privateKey`
  and asserts `MockSource` exposes no method outside the read set.
- `frontend/test/market-page.test.tsx` asserts no button matches `/beli|jual|approve|setujui/i`.
  **When you translate the UI to English (§9.3), widen that pattern to
  `/buy|sell|approve|redeem|liquidate|beli|jual|setujui/i` — do not narrow it.**

If a screen feels like it needs an action, the answer is a **Status** column that tells the observer
something needs doing, without pretending this page can do it.

### L3 — `unavailable` is a status, not an empty state.

`Query<T>` has four members: `loading | ready | unavailable | error`. They mean four different
things and must look different:

| Status | Means | Renders |
|---|---|---|
| `loading` | data is on its way | skeleton with the final content's dimensions |
| `ready` + empty array | the source answered: there is nothing | a plain sentence ("No positions in this market yet.") |
| `unavailable` | the current mode **cannot know** | `<Unavailable capability mode />` |
| `error` | the request failed | the error message, in `text-neg` |

Never render `0`, `—`, `N/A`, `null`, or a spinner for `unavailable`. A zero is a claim, and it is
a false one.

Unwrap it with a `switch` on `.status`, in a function with an **explicit non-nullable return type**
(`React.JSX.Element`) and **no `default` case**. That combination is what makes TypeScript refuse to
compile a consumer that forgets a branch — adding `default` "just in case" silently destroys the
guarantee. Copy the pattern from `MarketView.renderTrades`.

**Availability is evaluated per row and per cell, never per panel.** `MarketStats` shows six facts
from `MARKET_STATE` plus volume from `TRADE_TAPE`; only the volume row may go `unavailable`.
`PositionsTable` shows five columns; only the entry-price cell may go `unavailable`. Darkening a
whole panel because one of its seven facts is unknown throws away six facts you have.

### L4 — Money is `bigint` in wad. Floats never touch it.

All DPM math is wad (1e18). Collateral is 6 decimals. **No `Number()`, no `parseFloat`, no
`.toFixed()`, no arithmetic operator on a monetary value that has been converted to `number`.**
Double precision cannot represent a wad value, and a silent rounding on money is not acceptable.

- Convert only at the token boundary, only with `toWad` / `toTokensFloor` / `toTokensCeil` from
  `@0g-brier/protocol`. Never write a `1e12` or `10n ** 12n` of your own.
- Money **in** rounds up (`toTokensCeil`), money **out** rounds down (`toTokensFloor`). A pool
  depth reading is money out — it must never overstate what backs the market.
- Every displayed number goes through `lib/format.ts`. If you need a format that does not exist
  there, add it there and test it there. A component that formats its own number is a defect.
- The **only** place a wad may cross to `number` is `lib/chart.ts`, for pixel coordinates, and never
  for a number a human reads. Keep it that way.

### L5 — Never guess a rounding tolerance.

Three defects in this project came from a hand-picked epsilon. If you need a tolerance, derive it in
closed form from the live `q` and write down where it came from. The single constant exception is
`Σ probability == WAD ± 2`, and only because the algebra makes it exactly constant.

---

## 3. The data contract is the boundary

### 3.1 What exists today

This is the live contract. **The UI may render a field only if it appears here.**

```ts
type Outcome = 0 | 1;                              // 0 = NO, 1 = YES
type DataMode = "mock" | "chain" | "indexer";
type MarketStatus = "Open" | "Closed" | "Proposed" | "Disputed"
                  | "Settled" | "Failed" | "Voided";
type Tier = "FAST" | "VERIFIED" | "DETERMINISTIC";
type Interval = "1m" | "5m" | "1h" | "1d";

type Capability =
  | "LIST_MARKETS" | "MARKET_STATE" | "PRICE_HISTORY" | "TRADE_TAPE"
  | "AGENT_POSITIONS" | "COST_BASIS" | "SETTLEMENT_RECEIPT";

interface CollateralInfo { address: `0x${string}`; symbol: string; decimals: number }

interface MarketSummary {
  address: `0x${string}`;
  question: string;
  category: string;
  tier: Tier;
  status: MarketStatus;
  q: readonly [bigint, bigint];   // shares per outcome, wad. [0] = NO, [1] = YES
  poolWad: bigint;                // always dpm.costUp(q). Never hand-written
  tradingEnd: number;             // unix seconds
  collateral: CollateralInfo;
}

interface MarketDetail extends MarketSummary {
  feeBps: number;
  createdAt: number;
  settlementDeadline: number;
  creator: `0x${string}`;
  specRoot: `0x${string}`;
  rules: string;
}

interface Trade {
  id: string;
  timestamp: number;
  trader: `0x${string}`;
  outcome: Outcome;
  sharesDelta: bigint;   // positive = buy, negative = sell
  tokens: bigint;        // collateral units (6 dec), not wad
  fee: bigint;
  probAfterWad: bigint;  // P(YES) after this trade — already a probability
}

interface Candle {
  bucketStart: number;
  open: bigint; high: bigint; low: bigint; close: bigint;  // probabilities, wad
  volume: bigint;                                          // collateral units
}

interface Position {
  agent: `0x${string}`;
  outcome: Outcome;
  shares: bigint;              // wad
  entryPriceWad: bigint | null; // null = this mode CANNOT KNOW (COST_BASIS). Not zero
}

interface ResolverVote {
  model: string;
  outcome: Outcome | null;  // null = did not vote / abstained
  teeVerified: boolean;
  simulated: boolean;
}

interface SettlementReceipt {
  outcome: Outcome | null;  // null while the market is not yet settled
  votes: ResolverVote[];
  judgeModel: string | null;
  reasoning: string;        // VERBATIM. Never summarised, never truncated
  criteria: string;
  sources: string[];
  provider: `0x${string}`;
  chatId: string;
  simulated: boolean;       // true = stub receipt. MUST be conspicuous in the UI
}

interface DataSource {
  readonly mode: DataMode;
  readonly capabilities: ReadonlySet<Capability>;
  listMarkets(): Promise<MarketSummary[]>;
  getMarket(address: `0x${string}`): Promise<MarketDetail>;
  getTrades(address: `0x${string}`, limit: number): Promise<Trade[]>;
  getCandles(address: `0x${string}`, interval: Interval): Promise<Candle[]>;
  getPositions(address: `0x${string}`): Promise<Position[]>;  // BY MARKET, all agents
  getReceipt(address: `0x${string}`): Promise<SettlementReceipt>;
}
```

A method whose capability is absent **throws** `CapabilityUnavailableError`. It does not return an
empty array — an empty array means "there is no data", which is a different claim from "I cannot
know". `retry` is disabled for that error class in `hooks/provider.tsx`; do not re-enable it.

> The design spec also mentions `POSITIONS_CURRENT`, `MARKET_SPEC_BLOB`, `QUOTE` and `EXECUTE`.
> **None of those are implemented.** `QUOTE`/`EXECUTE` belong to the agent SDK and will never be
> here. Do not reference a capability that is not in the list above.

### 3.2 If you need a field that is not in the contract

Do **not** fake it in the component, derive it from an unrelated field, or hard-code it in JSX.
That is precisely the rework this brief exists to prevent. Extend the contract in one change:

1. Add the field to the interface in `src/lib/data/types.ts`, with a comment saying **which real
   source will provide it** (a chain call, or an indexer table).
2. Populate it in `src/lib/data/mock.ts` — **derived**, never hand-typed, if an invariant relates it
   to something else (`poolWad` is always `dpm.costUp(q)`; positions are always accumulated from the
   trade tape, never written separately).
3. If it cannot be answered in every mode, give it a `Capability`, add that capability to
   `ALL_CAPABILITIES`, and add a label + provider row to `components/primitives/Unavailable.tsx`.
4. Add a case to `test/mock-source.test.ts` asserting the invariant that ties it to the rest.

### 3.3 Three gaps you must close this way — do not improvise around them

**(a) `MarketSummary` has no `createdAt`, so "sort by newest" cannot be built.** *(Closed: the
field now lives on `MarketSummary`, since the list sorts by it and a list may not reach for a
field its type does not carry.)*
Add `createdAt: number` to `MarketSummary` (it is `MARKET_STATE` — readable in every mode, so it
needs no new capability). The fixtures already carry it, because `listMarkets()` returns
`FIXTURE_MARKETS`, which are `MarketDetail`.

**(b) `getPositions` is market-scoped, but `/portfolio` needs an agent's book across markets.**
*(Closed by composition, in `lib/agent-book.ts`.)*
Do **not** add a wallet connection to solve this. Compose:
`listMarkets()` → for each market `getPositions(market.address)` → filter by the agent address.
That needs no contract change and no new capability, and it stays honest about `chain` mode, which
really can read one balance per market. `IndexerSource` will later collapse it into a single indexed
query. Note the O(N) fan-out in a comment; spec risk R1 already accepts linear enumeration for v1.

**(c) There is no wallet, so `/portfolio` has no "my" address.** *(Closed: `/portfolio` takes a
typed address, `/portfolio/[agent]` shows the book.)*
The route is `/portfolio/[agent]`, addressed by an agent's wallet address in the URL. `/portfolio`
with no address renders an address input plus a list of the agents that appear in the current
fixtures — it does **not** render a Connect Wallet button. This page is "one agent's book",
observed from outside, not "my positions".

---

## 4. Capability × mode

| Capability | `mock` | `chain` | `indexer` | Real source |
|---|:--:|:--:|:--:|---|
| `LIST_MARKETS` | ✓ | ✓ | ✓ | `MarketFactory.marketCount/marketAt` |
| `MARKET_STATE` | ✓ | ✓ | ✓ | `Market.qArray/poolWad/status` |
| `AGENT_POSITIONS` | ✓ | ✓ | ✓ | `OutcomeShares.balanceOfOutcome` |
| `PRICE_HISTORY` | ✓ | ✗ | ✓ | indexer `price_points` |
| `TRADE_TAPE` | ✓ | ✗ | ✓ | indexer `trades` |
| `COST_BASIS` | ✓ | ✗ | ✓ | indexer `positions.avg_cost` |
| `SETTLEMENT_RECEIPT` | ✓ | ✗ | ✓ | 0G Storage + `resolutions` |

Why `chain` cannot answer history: cost basis requires knowing what was paid, and that exists only
in events. `eth_getLogs` from genesis is not an honest way to build a UI. So PnL in `chain` mode is
not zero — it is **unavailable**, and it is shown that way.

**You are building against `mock`, where everything is available.** That makes it very easy to ship
a UI that silently breaks in `chain` mode. Guard against it with `new MockSource({omit: [...]})`,
which simulates a degraded mode, and test every screen that way (§9.2).

---

## 5. Routes

### 5.1 App shell — new

Persistent header: product mark, nav (`Markets` · `Portfolio`), a **data-mode indicator** reading
the live `source.mode`, and a theme toggle.

The mode indicator is a product requirement, not chrome: a reader looking at a screen with
`unavailable` cells needs to know which mode produced them. When `mode === "mock"`, it must be
unmistakable that **the numbers on screen are fixtures, not a live market** — the same standard the
`simulated` receipt badge is held to. Simulated data must never be mistaken for real data.

Theme: `.dark` class on `<html>`, following `prefers-color-scheme` on first visit, persisted after
an explicit choice, applied before first paint so there is no flash of the wrong theme.

### 5.2 `/` — market list — currently a stub, rebuild it

A **table**, not cards. Comparing one market against another is this page's whole job.

| Column | Source | Notes |
|---|---|---|
| Question | `question` | truncate to 2 lines; links to detail |
| P(YES) | `probabilityWad(q, 1)` | `pᵧ²` as a percentage, 1 decimal |
| Δ24h | `getCandles` | percentage points, coloured, `+0.4 pt`. `PRICE_HISTORY` |
| Volume | `getTrades` | Σ\|tokens\|, collateral units. `TRADE_TAPE` |
| Depth | `toTokensFloor(poolWad, decimals)` | see below |
| Tier | `tier` | badge, neutral tone |
| Status | `status` | badge |
| Closes | `tradingEnd` | relative; absolute on hover |

Filters: category, status, tier. Sorts: volume, closing soon, newest. `listMarkets()` takes no
filter argument — filter and sort client-side over the returned array.

**Depth is a first-class column, not an afterthought.** In DPM, depth comes entirely from the seed:
a thinly capitalised market moves wildly, and two markets with identical probabilities can behave
completely differently. Hiding depth hides half of the price information.

In `chain` mode the Δ24h and Volume cells render `<Unavailable>` and the table stays useful. Reserve
their column width so the layout does not shift between modes.

### 5.3 `/market/[address]` — exists; rebuild the visuals, keep the guarantees

Two columns: content left, a **sticky inspection panel** right at ≥1024px, stacked below. The right
column holds statistics and resolution evidence — never controls.

Present already and to be preserved in substance: `ProbabilityPanel`, `PayoutPanel`,
`ProbabilityChart`, `MarketStats`, `PositionsTable`, `TradeTape`, settlement rules, `FinalOutcome`,
`ResolutionEvidence`.

Non-negotiable details, each of which is load-bearing:

- **The payout panel's dilution paragraph must survive verbatim in meaning.** DPM funds payouts out
  of the pool, so an early buyer's payout is diluted by later buyers. Since humans no longer execute
  here, this panel is the **only** place a human is ever told the payout floats. It may not be
  trimmed, shrunk, moved below the fold, or folded behind a disclosure.
- **The chart's Y axis is probability, 0–100%, fixed.** Label it `P(YES)` explicitly so no reader
  takes it for `pᵢ`. Do not auto-scale the axis to the data range — a market moving 49%→51% must
  look like a market that barely moved.
- **`reasoning` is shown verbatim.** It may be folded inside `<details>`; it may not be summarised
  or truncated. Summarising means the UI is passing judgment, and the reader loses exactly the part
  they came to check.
- **A dissenting resolver is rendered, and marked as dissenting.** Hiding the minority vote makes
  consensus look more solid than it was.
- **`simulated: true` is conspicuous**, on both the final-outcome and evidence panels.
- **The lifecycle timeline is not ornament.** The gap between `tradingEnd` and `settlementDeadline`
  is the dispute window, and an observer has a right to know how long funds are locked. Consider
  rendering it as an actual timeline rather than four date rows.
- Settlement panels render only when `status === "Settled"`.
- The countdown renders only while `status === "Open"` — otherwise it reads "closes in closed".
- There is **no** spec viewer. `specRoot` points at 0G Storage and that integration does not exist.
  Do not build a placeholder for it.

### 5.4 `/portfolio/[agent]` — new

One agent's book, read-only, addressed by the URL (§3.3c).

| Column | Source |
|---|---|
| Market · Outcome | `MarketSummary.question`, `Position.outcome` |
| Shares | `Position.shares` |
| Avg entry price | `Position.entryPriceWad` — `COST_BASIS`, `unavailable` on chain |
| Current price | `dpm.price(market.q, outcome)` — always known |
| Current value | `dpm.price(market.q, outcome) × shares`, at the token boundary |
| Unrealised PnL | needs `COST_BASIS` — `unavailable` on chain |
| Status | Open · Settled (not yet redeemed) · Failed/Voided (liquidatable) |

**There is no Actions column.** Redeem and liquidate are execution. The Status column takes its
place: it tells the observer something needs doing without pretending this page can do it.

---

## 6. Visual system — it already exists

`src/app/globals.css` defines the tokens. **Use them. Do not add a second palette, a second neutral
ramp, or a `tailwind.config.js`.**

Surfaces/text: `--bg`, `--bg-sunken`, `--border`, `--text`, `--text-muted`, `--text-faint`.
One accent: `--accent`, for primary action and focus rings only, never decoration.
Semantic: `--pos`, `--neg`, `--warn`, `--verified`.

Exposed to Tailwind v4 via `@theme inline` as `bg-bg`, `text-text-muted`, `border-border`,
`text-pos`, and so on. Every colour is defined in `:root`; `.dark` only overrides. **No colour may
have its only definition inside the dark block.**

**The chroma rule: an element may be coloured only when its colour carries information that exists
nowhere else.** A rising probability is coloured. A market's title is not. The TEE badge is
coloured. The category badge is grey.

**Density.** Table rows ~38px. 1px dividers, never shadows. 6px radius. No gradients, no glows, no
coloured shadows, no glassmorphism. Type scale 12 / 13 / 14 / 16 / 20 / 28px — the first four carry
almost the whole UI.

**Numerals.** `font-variant-numeric: tabular-nums` is already on `body` and must stay. Without it
the probability column wobbles as it updates and the table becomes unscannable — a functional
requirement in a UI made of columns of numbers, not a preference. Numeric columns right-align;
every column keeps a fixed decimal count.

**Formatting — all of it lives in `lib/format.ts`:**

| Quantity | Function | Example |
|---|---|---|
| Probability | `formatProbability` | `59.0%` |
| Probability delta | `formatProbabilityDelta` | `+0.4 pt` |
| Payout | `formatPayout` | `1.30×` |
| Collateral | `formatCollateral` | `1,234.56` |
| Shares | `formatShares` | `135.31` |
| Price per share | `formatPricePerShare` | `0.7682` |
| Fee rate | `formatFeeRate` | `1.00%` |
| Address | `shortAddress` | `0x1111…1111`, mono, click-to-copy |
| Countdown | `formatCountdown` | two largest units, no seconds |
| Timestamp | `formatTimestamp` | absolute, reader's timezone |

Mono is for addresses, hashes, and mode names only.

---

## 7. What "professional" means here

Not "add a component library". This product's credibility rests on numbers and evidence, so the
quality bar is about honesty, legibility, and never lying by omission.

**States.** Every panel and every table is designed for all four `Query` statuses **plus** the
ready-but-empty case. Loading is a skeleton with the final content's dimensions — no layout shift
when data arrives, no centred spinner standing in for a table. Empty, error, and unavailable are
three visibly different treatments, because they are three different facts.

**Accessibility.**
- Every interactive element reachable by keyboard, with a visible `--accent` focus ring. Skip-to-content link.
- Tables: `<th scope="col">`, `aria-sort` on sortable headers, a `<caption>` (visually hidden is fine).
- Regions that replace a number or table the user was reading get `role="status"` — otherwise
  "unavailable" is only ever seen, never heard. `Unavailable.tsx` already does this.
- The chart carries `role="img"` and an `aria-label` that states what it plots, plus a
  visually-hidden data table or a `<figcaption>` summarising the current value and range.
- Colour is never the only channel: YES/NO carry a text label as well as a colour; a dissenting
  vote carries a badge, not just a hue.
- Contrast ≥ 4.5:1 for text in **both** themes. `--text-faint` on `--bg-sunken` is the pair most
  likely to fail — check it.

**Responsive.** Three breakpoints. The two-column market page stacks below 1024px. Below 640px,
wide tables become stacked rows (label/value pairs) rather than a horizontal scroll of a 7-column
grid; where a table must scroll, it scrolls inside its own `overflow-x-auto` container and the page
body never scrolls horizontally.

**Motion.** Only to signal a state change, ≤150ms, and gated on `prefers-reduced-motion`. A number
that updates may flash its cell background briefly; nothing slides, bounces, or fades in on load.

**Feedback.** Copy-to-address confirms. Relative times update on an interval but keep a stable
width so rows do not jitter. Sort and filter state is reflected in the URL so a view can be shared.

**Per-route metadata.** Each route exports `metadata` with a real title and description — the market
detail page's title should name the market.

**Error boundaries.** A thrown render error takes down one panel, not the page.

---

## 8. Stack rules

- **Next.js 16 App Router.** This is not the Next.js in your training data. Read
  `frontend/node_modules/next/dist/docs/01-app/` before using an App Router API, and heed
  deprecation notices. Note in particular that `params` is a **Promise** and must be awaited:
  `export default async function Page({params}: {params: Promise<{address: string}>})`.
- **React 19.** Server Components by default. Anything using a hook, context, or an event handler
  needs `"use client"`. Keep the client boundary as low in the tree as possible — data hooks are
  client-side because `AppProviders` is, but presentational leaves need not be.
- **Tailwind v4, CSS-first.** Configuration lives in `globals.css` via `@theme inline` and
  `@custom-variant`. **There is no `tailwind.config.js` and you will not create one.**
- **No new dependencies** beyond `lucide-react`, added for icons after this brief was written.
  No shadcn/ui (its `--background`/`--primary` token namespace collides
  with `--bg`/`--text`/`--accent`), no Recharts or visx (they take `number`, and wad values must not
  become floats), no framer-motion, no icon package unless you inline the handful of SVGs you need.
  Charts are hand-rolled SVG built from `lib/chart.ts`, which is pure arithmetic and unit-tested.
- **`@0g-brier/protocol` is the single copy of the DPM math**, pinned to `DPMMath.sol` by a
  512-vector differential test and shared with the agent SDK. Import it. Adding modules to it is
  fine; **changing its arithmetic or reimplementing any of it in the frontend is not.** Two copies
  of the payout formula is the easiest way to make the screen and the agents disagree.
- Path alias `@/*` → `frontend/src/*`, in both `tsconfig.json` and `vitest.config.ts`.
- `strict: true`. No `any`, no non-null assertion on data that can genuinely be absent.

---

## 9. Tests

`npm test` runs vitest + Testing Library. `MockSource` **is** the fixture — the same code path
development uses, so it cannot rot unnoticed.

### 9.1 Preserve these `data-testid`s

Existing tests query them. Renaming one without updating its test is a silent regression:
`probability-panel`, `payout-panel`, `probability-chart`, `market-stats`, `positions-table`,
`trade-tape`, `final-outcome`, `final-outcome-simulated`, `resolution-evidence`, `simulated-badge`,
`criteria`, `reasoning`, `winner`, `payout`, `entry`, `current`, `vote-<model>`,
`stat-volume`, `stat-fee`, `stat-liquidity`, `stat-created`, `stat-closes`, `stat-settles-by`.

Give new panels test ids in the same style.

### 9.2 The test that is required and easiest to forget

**Render every screen with capabilities omitted and assert that no zero appears where
`unavailable` should be.**

```ts
renderMarkets(new MockSource({omit: ["TRADE_TAPE", "PRICE_HISTORY", "COST_BASIS"]}));
```

That enforces L3 at the level of behaviour, not just of types. Every route you build gets one.

### 9.3 Two traps this repo has already paid for

- **`getByText` joins only an element's *direct* text nodes and does not descend into children.**
  A phrase split across `<span>`s will never match. Either keep the phrase in one text node (see the
  deliberate comments in `Unavailable.tsx` and `PayoutPanel.tsx`) or assert with `toHaveTextContent`,
  which reads recursively. This has caused four separate failures here.
- **A `switch` over `Query.status` needs an explicit `React.JSX.Element` return type and no
  `default`.** Under `strict`, a function that falls off the end of a switch returns `undefined`,
  which is not assignable to `React.JSX.Element` — so deleting a `case` fails to compile (TS2366).
  Without the annotation TypeScript quietly infers `| undefined` and the guarantee evaporates.

### 9.4 Language — English throughout, and the migration that got it there

Repo convention (`CLAUDE.md`) is **English throughout** — comments, JSDoc, test names, UI copy — and
locale formatting is `en-US`.

**This translation is done.** The frontend was Indonesian when this brief was written and was
converted wholesale; as of 2026-08-31 no Indonesian string remains in `frontend/src` or
`frontend/test`, `lang` is `"en"`, and every locale call is `en-US`. What used to stand here was an
inventory of surfaces and of the tests that asserted Indonesian copy — a work order, kept in the
present tense, which went on telling readers the UI "is still Indonesian" long after it was not.

The rule it existed to serve is the part worth keeping, and it still applies to anything you add:
**write English, and translate copy and its assertions in the same change.** Several tests assert
UI strings verbatim, so changing copy without them turns a green suite red for the wrong reason.

One thing the migration had to get right, and that any edit to the fixtures still has to: the
settled market's `criteria`, `reasoning`, and `sources` must keep referring to the euro-area HICP
question they belong to. It is the only market whose receipt is reachable, so an off-topic receipt
there would never be masked by another market.

---

## 10. Self-check — numbers you must reproduce

Computed from the live fixtures via `@0g-brier/protocol`. If your UI disagrees with any of these,
you have the probability/payout confusion described in L1.

**Market 1 — `0x1111…1111`, Open, `q = [1000, 1200]` (NO, YES)**

| Value | Correct | The trap |
|---|---|---|
| P(YES) | `59.0%` | not `0.7682` |
| P(NO) | `41.0%` | not `0.6402` |
| marginal p(YES) | `0.7682` | never labelled `%` |
| Payout if YES wins | `1.30×` | `1/P` says `1.69×` — **wrong** |
| Payout if NO wins | `1.56×` | `1/P` says `2.44×` — **wrong** |
| Depth | `1,562.05` mUSDC | |
| Volume, 24 trades | `781.02` mUSDC | |

The two probabilities sum to `999999999999999999` wad — one unit short of WAD. Both still display
as `59.0%` and `41.0%`. **Do not correct the pair.**

**Market 2 — `0x2222…2222`, Open, `q` balanced:** P(YES) = P(NO) = `50.0%`, payout `1.41×` both
sides (`1/P` would say `2.00×`), depth `1,000.00`.

**Market 3 — `0x3333…3333`, Settled, `q = [1800, 600]`:** P(YES) = `10.0%`, P(NO) = `90.0%`,
payout YES `3.16×` (`1/P` would say `10.00×` — the most dramatic version of the trap), payout NO
`1.05×`, depth `1,897.37`.

**Cross-panel coherence:** the most recent trade in the tape shows exactly the same P(YES) as the
probability panel, in every fixture. The fixtures are built so that this is true by construction. If
your tape and your panel disagree, the bug is in your rendering, not in the data.

---

## 11. Forbidden

| Do not | Why |
|---|---|
| Label `dpm.price` with `%` | It is `√P`, wrong by up to ~5 points |
| Compute payout as `1/probability` | Overstates by ~30% |
| Normalise the probability pair to exactly 100% | Displays a number the contract does not hold |
| Render `0`, `—`, or a spinner for `unavailable` | A zero is a false claim |
| Add `default` to a `Query.status` switch | Destroys the exhaustiveness guarantee |
| Add a buy/sell/redeem/approve/connect control, even disabled | Violates the product's core separation; fails tests |
| Add a signer, `wagmi`, or a `viem` write path | Same |
| `Number()` / `parseFloat` / `.toFixed()` on money | wad is not representable in double |
| Write your own `1e12` or decimal conversion | `@0g-brier/protocol` has the correct rounding directions |
| Format a number inside a component | Formatting must be identical across screens |
| Reimplement DPM math in the frontend | Two copies make the screen and the agents disagree |
| Create `tailwind.config.js` | Tailwind v4 is CSS-first here |
| Add shadcn/ui, Recharts, visx, framer-motion | Token collision; floats on wad; no need |
| Summarise or truncate `reasoning` | The reader loses the part they came to check |
| Hide a dissenting resolver vote | Makes consensus look more solid than it was |
| Let a `simulated` receipt or `mock` mode look real | Simulated data must never pass for real |
| Invent a rounding tolerance | Three defects here came from exactly that |
| Render a field that is not in `DataSource` | The rework this brief exists to prevent |
| Match the existing Indonesian copy | Repo convention is English; translate what you touch |

---

## 12. Definition of done

All four green, from `frontend/`:

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest run
npm run build       # next build
```

Plus, by inspection:

- Every route renders correctly under `new MockSource({omit: [...]})` with no zero standing in for
  an unknown.
- Every route renders correctly in both themes, at 375px / 768px / 1440px.
- No execution control anywhere, in any state.
- Every displayed number traceable to a `DataSource` field and a `lib/format.ts` function.
- The §10 numbers reproduce exactly.

---

## 13. Suggested order

1. **App shell** — header, nav, mode indicator, theme toggle. Smallest surface, and everything else
   sits inside it.
2. **`/` market list** — including the `MarketSummary.createdAt` contract change (§3.3a). This is
   where you prove the "extend the contract, don't fake the field" workflow.
3. **`/market/[address]` visual rebuild** — keep the test ids, keep the guarantees, change the
   presentation. Run the existing suite continuously; it is your safety net.
4. **`/portfolio/[agent]`** — composition over `listMarkets` + `getPositions` (§3.3b), no wallet.
5. **Degraded-mode pass** — `omit` tests for all four routes.
6. **Language pass** — copy and assertions together, per §9.4.

Do 1–4 as separate commits. If you find yourself wanting a field that does not exist, stop and do
§3.2 rather than working around it — that decision is the whole point of this brief.
