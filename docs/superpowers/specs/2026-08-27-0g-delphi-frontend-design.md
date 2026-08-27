# 0G-Delphi Frontend — Design v1

**Status:** Design spec (v1) · **Date:** 2026-08-27 · **Parent:** `docs/superpowers/specs/2026-08-27-0g-delphi-design.md` §11

---

## 1. Summary

A web interface for **humans who observe** the 0G-Delphi binary prediction markets. Humans read prices, history, resolution evidence, and the agent position book — **humans execute nothing from these pages**. Every buy, sell, redeem, and liquidate runs through the `@0g-delphi/agent-kit` SDK outside the dApp, following the separation Delphi (Gensyn) uses.

The consequence is not merely "one component was deleted": the market detail page stops being a place to transact and becomes a place to **inspect** — what the price is, where its history came from, who holds what, and on what evidence it was resolved.

Three routes in v1: market list, market detail, portfolio. The agent routes (`/agents`, `/agents/[id]`, `/agents/new`) and `/create` get their own spec in P4.

### Locked decisions

| # | Decision | Reason |
|---|---|---|
| F1 | Data layer with modes `mock \| chain \| indexer`, composed as a **decorator** | `indexer` = `chain` + history, not a replacement for it; composition makes that property structural |
| F2 | `unavailable` is a first-class status, on a par with loading/error | `chain` mode cannot answer history questions at all; the UI must not disguise that as zero |
| F3 | **The human UI only observes; all execution goes through the agent SDK** | A literal Delphi-style separation, chosen by the product owner. The human pages have no write path to the chain at all — not hidden behind a flag, simply absent |
| F4 | Data-dense, calm, precise visuals | The substance of this product is numbers and evidence, not narrative |
| F5 | The quoting engine (quotes, price impact, dilution) moves to **`@0g-delphi/agent-kit`**, not into the pages | The party that needs it is the party that executes. Keeping it in the UI means putting sizing logic where nothing ever uses it |
| F7 | The resolution-evidence panel must show the **model, reasoning, criteria, and data sources** | "Resolved by AI" without evidence is a request to be trusted. Delphi publishes it; we have commit-reveal + 0G Storage, which ought to let us do it better |
| F6 | Decimal conversion imports `@0g-delphi/protocol` rather than being rewritten | That package already has the correct rounding directions and is differentially tested |

---

## 2. Capabilities per mode

This is the table that drives the entire design. The three modes are **not** equivalent.

| Capability | `mock` | `chain` | `indexer` | Source in the real modes |
|---|:--:|:--:|:--:|---|
| `LIST_MARKETS` | ✓ | ✓ | ✓ | `MarketFactory.marketCount/marketAt` · indexed table |
| `MARKET_STATE` | ✓ | ✓ | ✓ | `Market.qArray/probability/poolWad/status` |
| `AGENT_POSITIONS` | ✓ | ✓ | ✓ | `OutcomeShares.balanceOfOutcome` + `Market.seedSharesOf` |
| `POSITIONS_CURRENT` | ✓ | ✓ | ✓ | `OutcomeShares.balanceOfOutcome` + `Market.seedSharesOf` |
| `PRICE_HISTORY` | ✓ | ✗ | ✓ | indexer `price_points` |
| `TRADE_TAPE` | ✓ | ✗ | ✓ | indexer `trades` |
| `COST_BASIS` | ✓ | ✗ | ✓ | indexer `positions.avg_cost` |
| `MARKET_SPEC_BLOB` | ✓ | ✗ | ✓ | 0G Storage via `specRoot` |
| `SETTLEMENT_RECEIPT` | ✓ | ✗ | ✓ | 0G Storage + `resolutions` |

**There is no `MARKET_STATS` capability, and that is deliberate.** The stats panel combines fields whose sources differ in availability: fee, depth, and the timeline come from `MARKET_STATE` (always present), while volume comes from `TRADE_TAPE` (empty in `chain` mode). Making it a single capability would turn the whole panel `unavailable` merely because volume is unknown — throwing away six facts we have for the sake of one we do not. Availability is evaluated **per row**, not per panel.

`QUOTE` and `EXECUTE` **are no longer in this table.** Both belong to `@0g-delphi/agent-kit`; the frontend data layer never calls `Market.buy`, `sell`, `redeem`, or `liquidate`, and holds no signer. That boundary is structural, not conventional — `DataSource` has no writing method at all.

**Why `chain` cannot answer history.** Cost basis demands knowing what was paid, and that exists only in events. `eth_getLogs` from genesis on Galileo is not an honest way out for a UI. So PnL in `chain` mode is not zero — it is **unavailable**, and it is shown that way.

---

## 3. Data-layer contract

### 3.1 Shape

```ts
export type DataMode = 'mock' | 'chain' | 'indexer';

export type Capability =
  | 'LIST_MARKETS' | 'MARKET_STATE' | 'QUOTE' | 'EXECUTE'
  | 'POSITIONS_CURRENT' | 'PRICE_HISTORY' | 'TRADE_TAPE'
  | 'COST_BASIS' | 'MARKET_SPEC_BLOB' | 'SETTLEMENT_RECEIPT';

export class CapabilityUnavailableError extends Error {
  constructor(readonly capability: Capability, readonly mode: DataMode) {
    super(`${capability} is not available in ${mode} mode`);
  }
}

export interface DataSource {
  readonly mode: DataMode;
  readonly capabilities: ReadonlySet<Capability>;

  listMarkets(f: MarketFilter): Promise<MarketSummary[]>;
  getMarket(address: Address): Promise<MarketDetail>;
  getCandles(address: Address, interval: Interval): Promise<Candle[]>;
  getTrades(address: Address, page: Page): Promise<Trade[]>;
  getPositions(wallet: Address): Promise<Position[]>;
  getMarketSpec(specRoot: Hex): Promise<MarketSpec>;
  getSettlement(address: Address): Promise<Settlement>;

  quoteBuy(a: Address, outcome: 0 | 1, sharesOut: bigint): Promise<Quote>;
  quoteBuySpend(a: Address, outcome: 0 | 1, tokensIn: bigint): Promise<Quote>;
  quoteSell(a: Address, outcome: 0 | 1, sharesIn: bigint): Promise<Quote>;
}
```

A method whose capability is absent **throws** `CapabilityUnavailableError`. It does not return an empty array — an empty array means "there is no data", and that is a different claim from "I cannot know".

### 3.2 Composition

```
MockSource     implements DataSource   — every capability, from fixtures
ChainSource    implements DataSource   — viem; throws for the 5 history capabilities
IndexerSource  implements DataSource   — WRAPS ChainSource
                                          · state/quote/execution   → delegated
                                          · history                 → REST indexer
```

`IndexerSource` delegates instead of duplicating. That makes "quotes always come from the chain" a structural property: there is no code path in `IndexerSource` that could fetch a quote from anywhere else, because it has no quoting implementation of its own.

### 3.3 Status in React

```ts
export type Query<T> =
  | { status: 'loading' }
  | { status: 'ready';       data: T }
  | { status: 'unavailable'; capability: Capability; mode: DataMode }
  | { status: 'error';       error: Error };
```

Every hook returns this shape. Because `unavailable` is in the union, TypeScript **forces** every consumer to handle it — a component that forgets will not compile. That is the mechanism that keeps the UI honest, not its author's discipline.

The `<Unavailable capability mode />` component renders one calm line: the capability's name, the current mode, and which mode provides it. Not a spinner, not a zero, not an unexplained em dash.

### 3.4 Math on the client

`@0g-delphi/protocol` exports `dpm` — the TypeScript mirror of `DPMMath.sol`, already pinned to the Solidity by a 512-vector differential test. The frontend uses it for **preview**, not for truth:

```ts
import { dpm, toWad, toTokensCeil } from '@0g-delphi/protocol';

// as the user types — instant, no RPC
const shares  = dpm.sharesForSpend(q, outcome, spendWad);
const qAfter  = withAdded(q, outcome, shares);
const probNow = dpm.probability(q, outcome);        // p_i^2
const probNew = dpm.probability(qAfter, outcome);

// sebelum kirim — otoritatif
const quote = await source.quoteBuy(addr, outcome, shares);
```

Two deliberate consequences: typing triggers no RPC call whatsoever, and the number the user signs always comes from the contract, never from the mirror.

---

## 4. Routes

### 4.1 `/` — market list

A table, not cards. The data-dense visual direction demands it, and comparing one market against another is this page's primary job.

| Column | Content | Notes |
|---|---|---|
| Question | text, truncated to 2 lines | links to the detail page |
| P(YES) | `pᵧ² ` as a percentage, 1 decimal | **the square of the marginal price**, see §5.1 |
| Δ24h | percentage points, colored | `PRICE_HISTORY` — `unavailable` in chain mode |
| Volume | collateral units | `TRADE_TAPE` |
| Depth | `poolWad` → tokens | see why below |
| Tier | `FAST`/`VERIFIED`/`DETERMINISTIC` badge | |
| Closes | relative (`2h 14m`), absolute on hover | |

Filters: category, status, tier. Sorts: volume, closing soon, newest.

**Why depth is a first-class column.** In DPM, depth comes entirely from the seed — a thinly capitalized market moves wildly, and two markets with identical probabilities can have completely different price behavior. Hiding depth means hiding half of the price information.

In `chain` mode the Δ24h and Volume columns render `<Unavailable>`; the table remains useful.

### 4.2 `/market/[address]` — market detail

Two-column layout: content on the left, the **inspection panel** sticky on the right (≥1024px); stacked below 1024px. The right column holds market statistics and resolution evidence — not controls.

**Header.** Question, status badge, tier badge, category, countdown to close, market address with copy + explorer link.

**Probability panel.** Large `P(YES)` and `P(NO)` figures, both `pᵢ²`, guaranteed to sum to 100% (±1 last unit — a consequence of two floor divisions, see §5.1).

**Probability history chart.** Two series (YES/NO), a time axis, a 0–100% axis. `PRICE_HISTORY` — renders `<Unavailable>` in `chain` mode, never an empty chart. The Y axis is **probability**, not marginal price; the axis label says `P(YES)` explicitly so that no reader takes it for `pᵢ`.

**Market statistics** (right column). Fee, pool depth, volume, and the full lifecycle timeline: created, closes, settlement starts, settle deadline. That timeline is not ornament — in a market with tiered resolution, the gap between "closes" and "settle deadline" is the dispute window, and an observer has a right to know how long their funds are locked.

**Live payout panel — required, not ornament.**

```
Payout if YES wins     1.30× per share
Payout if NO wins      1.56× per share

⚠  Payout floats until the market closes. The more that is bought on one
   side, the smaller the payout per share on that side — including
   purchases your own agent makes. Positions can only be sold while the
   market is Open, and selling walks back down the curve: the price
   received is below the one on screen, minus fee.
```

This is a disclosure, not a disclaimer. DPM funds its payouts out of the pool, and the consequence is that an early buyer's payout is diluted by later buyers. Hiding that would make this page lie about the instrument it describes. Because humans no longer execute here, this panel becomes the **only** place where a human sees that property — and `agent-kit` is required to surface it again on the agent side (§6).

**Agent positions table.** Agent, side, shares, entry price, current price. `AGENT_POSITIONS`. This is what replaces the order ticket as the page's main content: the human's question changes from "how much do I buy" to "who holds what, and at what price". Entry price needs `COST_BASIS`; in `chain` mode that column is `<Unavailable>` while shares and current price stay populated.

**Trade tape.** Time, side, shares, average price, truncated address. `TRADE_TAPE`.

**MarketSpec viewer.** Question, rules, sources, settlement prompt, deadline. Fetched from 0G Storage via `specRoot`. `MARKET_SPEC_BLOB`.

**Final outcome panel** (after resolution). The winning outcome and its payout rate — `1/pᵢ` at the frozen `q`, not `1/Pᵢ` (§5.1).

**Resolution evidence panel** (right column, after resolution). This is the panel that makes "resolved by AI" checkable rather than something you have to believe:

| Row | Content |
|---|---|
| Resolver models | the list of committee models that voted |
| Judge model | the model that decided, when the tier is `VERIFIED`/`DETERMINISTIC` |
| Final outcome | YES / NO / VOID |
| Reasoning | the receipt's text as-is — **not summarized** |
| Resolution criteria | from `MarketSpec`, so the reader can judge the reasoning against the promised rules |
| Data sources | the URLs the resolver actually consulted |
| TEE badge | `teeVerified`, provider address, model, `chatID`, receipt link |

The badge shows `simulated: true` conspicuously when the receipt came from stub mode — a simulated result must never be mistaken for a real one. The resolver's reasoning is shown verbatim: summarizing it means the UI is passing judgment too, and the reader loses precisely the part they wanted to check. `SETTLEMENT_RECEIPT`.

### 4.3 `/portfolio` — an agent's book, read-only

Because humans do not execute, this page is no longer "my positions" but **one agent's position book**, addressed by that agent's wallet.

| Column | Source |
|---|---|
| Market · Outcome | — |
| Shares | `POSITIONS_CURRENT` |
| Average entry price | `COST_BASIS` — `unavailable` on chain |
| Current value | `pᵢ × shares` from `MARKET_STATE` |
| Unrealized PnL | needs `COST_BASIS` |
| Status | Open · Settled (not yet redeemed) · Failed/Voided (liquidatable) |

The **Actions column is gone.** Redeem and liquidate are execution, and execution lives in `agent-kit`. The Status column takes its place: it tells the observer that something needs doing, without pretending this page can do it.

In `chain` mode the shares and current-value columns are fully populated; entry price and PnL render `<Unavailable>`. That is a table which is useful and honest at the same time — precisely why `unavailable` was made a status rather than a zero.

**Open:** whether this route eventually gets folded into `/agents/[address]` together with the leaderboard in P4. Left as `/portfolio` for now so as not to pre-empt the agent spec.

---

## 5. Correctness rules that bind the UI

### 5.1 Probability is `pᵢ²`

`DPMMath.price` returns the marginal price `pᵢ = qᵢ/C(q)`. The implied probability is **its square**, because `Σpᵢ² = WAD`. Showing `pᵢ` as the probability is wrong by up to ~5 percentage points at the skews that ordinarily occur.

Use `dpm.probability(q, i)` — never `dpm.price(q, i)` — for anything labeled as a percentage. `marginalPrice` appears in exactly one place: as the per-share execution price in the order ticket and the tape.

**Payout per share is `1/pᵢ`, not `1/Pᵢ`.** This is the twin trap, and the subtler one, because both produce numbers that look plausible. At `P(YES) = 59.0%` the correct payout is `1/0.7682 = 1.30×`; using `1/0.59 = 1.69×` overstates the payout by **30%** — exactly the direction that harms a user who believes it. The first draft of this very spec made that mistake; it was caught only because the numbers were recomputed, not because they were reread.

The practical consequence for implementers: every value labeled `%` comes from `dpm.probability`; every value labeled `×` comes from `1/dpm.price`. There is no `1/probability` anywhere in the codebase.

The sum of the two probabilities can come up 1 last unit short (two independent floor divisions). The UI shows both as they are and does not "fix" the total to make it exactly 100% — forcing the sum means displaying a number that is not the contract's number.

### 5.2 Quotes are estimates; the slippage bound is what binds

`quoteBuySpend` rounds down and is not authoritative. The contract recomputes. The order ticket always sends `maxTokensIn` (buy) or `minTokensOut` (sell), derived from the quote plus a user-adjustable tolerance (0.5% by default), and displays that bound before confirmation.

### 5.3 Decimals

Collateral has 6 decimals; shares 18; all math is wad. Conversion happens only at the token boundary, via `toWad`/`toTokensFloor`/`toTokensCeil` from `@0g-delphi/protocol`. The frontend must not have a `1e12` constant of its own.

### 5.4 Never render the unknown

Already enforced by the types (§3.3). Stated here because it is a product rule, not merely a technical detail.

---

## 6. The quoting engine belongs to the SDK, not to the pages

Humans do not execute, so the order ticket leaves the market page. What must **not** leave with it is the logic — quoting, price impact, slippage bounds, and dilution disclosure remain mandatory; they simply move to the party that actually uses them: `@0g-delphi/agent-kit`.

### 6.1 The surface mirrored from Delphi

The shapes below are taken from the Delphi SDK because agent authors already know them, and that familiarity reduces mistakes:

```ts
quoteBuy ({ market, outcome, sharesOut })          -> { tokensIn }
quoteSell({ market, outcome, sharesIn  })          -> { tokensOut }
ensureTokenApproval({ market, minimumAmount })     -> { approvalNeeded }
buyShares ({ market, outcome, sharesOut, maxTokensIn  }) -> { transactionHash }
sellShares({ market, outcome, sharesIn,  minTokensOut }) -> { transactionHash }
getMarket ({ address, pricesAndImpliedProbabilities }) -> { spotPrices[], spotImpliedProbabilities[], ... }
```

Two details from that SDK we adopt as-is, because both are right:

- **Approve `maxTokensIn`, not the quoted amount.** The price can move anywhere up to that bound before the transaction lands; approving only the quoted amount makes the trade fail exactly when the price moves.
- **`spotPrices` and `spotImpliedProbabilities` are returned separately**, even though in LMSR the two are identical. In our system they are **fundamentally different**, so a shape that already separates them carries that difference correctly.

### 6.2 The porting trap: LMSR is not Pennock's DPM

**For an agent author this is the most important section in the whole document.** Delphi uses LMSR. We use Pennock's DPM, `C(q) = √(Σqᵢ²)`. The difference is not an implementation detail:

| | Delphi (LMSR) | 0G-Delphi (DPM Pennock) |
|---|---|---|
| Normalization | `Σpᵢ = 1` | `Σpᵢ² = 1` |
| Implied probability | `Pᵢ = pᵢ` | `Pᵢ = pᵢ²` |
| Payout per winning share | **1** (fixed from the moment of purchase) | **`1/pᵢ`** (floats until close) |
| Kelly | `f* = (P̂ − p)/(1 − p)` | `f* = (P̂ − P)/(1 − P)` |

At `P = 59%`: our market pays **1.30×**, an LMSR market pays **1.69×**. An agent ported without adjustment will **overstate payout by around 30%** — and it will still "work", it will just bleed slowly.

Note the form of the Kelly criterion: the formula is the same, but **the variable is probability, not price**. The derivation: net odds `b = payout/cost − 1 = (1/p)/p − 1 = (1−P)/P`, hence `f* = (P̂ − P)/(1 − P)`. An agent that feeds our `price` (which is worth `√P`) into a Delphi-style formula sizes wrong systematically, not occasionally.

API consequence: **`agent-kit` must not expose a field named `price` that could be taken for a probability.** Name them `marginalPrice` and `impliedProbability`, and let the types refuse the swap.

### 6.3 Dilution is a risk dimension LMSR does not have

In LMSR a winning share pays exactly 1, locked in at purchase. In our DPM the payout is `1/p_final`, and **every subsequent purchase on the same side lowers it**. That means a Kelly figure computed at the current price overstates the edge — not because the probability estimate is wrong, but because the prize shrinks once the agent is in.

`quoteBuy` therefore has to return **the payout before and after**, the same way the payout panel shows it to humans:

```ts
{ tokensIn, sharesOut, avgPrice,
  probBefore, probAfter,
  payoutBefore, payoutAfter }   // payoutAfter < payoutBefore, always, for a buy
```

Returning `tokensIn` alone would hide the one thing that makes this market different from the one an agent author already knows.

### 6.4 Size is bounded by impact, not by capital alone

A pattern from production agents worth copying: quote the target size, then **halve it repeatedly until the impact is below a threshold**, and refuse the trade if the market is too thin to absorb even the smallest size. Then recheck the edge against **the price actually paid**, not the spot price — a 0.8% edge against a 3.7% execution cost is a loss with extra steps.

---

## 7. Visual system

Data-dense, calm, precise. Numbers are first-class citizens; color carries meaning only.

### 7.1 Tokens

```css
:root {
  /* neutral — the only ramp used for surfaces and text */
  --n-0:#ffffff; --n-1:#fafafa; --n-2:#f4f4f5; --n-3:#e4e4e7;
  --n-4:#d4d4d8; --n-6:#a1a1aa; --n-8:#52525b; --n-10:#27272a; --n-12:#09090b;

  --bg:var(--n-0); --bg-sunken:var(--n-1); --bg-raised:var(--n-0);
  --border:var(--n-3); --border-strong:var(--n-4);
  --text:var(--n-12); --text-muted:var(--n-8); --text-faint:var(--n-6);

  /* one accent, used for the primary action and for focus — never for decoration */
  --accent:#2563eb; --accent-fg:#ffffff;

  /* semantic: for meaning only */
  --pos:#15803d;      /* up, profit */
  --neg:#b91c1c;      /* down, loss */
  --warn:#a16207;     /* dilution, limits, attention */
  --verified:#15803d; /* TEE verified */
  --unverified:var(--n-6);

  --radius:6px;
  --row-h:38px;
}

.dark {
  --bg:var(--n-12); --bg-sunken:#050507; --bg-raised:var(--n-10);
  --border:#27272a; --border-strong:#3f3f46;
  --text:var(--n-1); --text-muted:var(--n-6); --text-faint:var(--n-8);
  --accent:#3b82f6;
  --pos:#4ade80; --neg:#f87171; --warn:#fbbf24; --verified:#4ade80;
}
```

Tailwind `darkMode: 'class'`. Every color has a definition in `:root`; `.dark` only overrides. No color has its only definition inside the dark block.

### 7.2 Typography & numerals

One sans family for the UI (Inter or the system stack), one mono used solely for addresses and hashes.

**`font-variant-numeric: tabular-nums` on every numeric cell.** Without it the probability column wobbles as it updates and the table becomes hard to scan — this is a functional requirement in a UI made of columns of numbers, not an aesthetic preference.

| Quantity | Format | Example |
|---|---|---|
| Probability | 1 decimal + `%` | `59.0%` |
| Probability delta | 1 decimal + `pt`, colored | `+0.4 pt` |
| Payout | 2 decimals + `×` | `1.70×` |
| Collateral | 2 decimals + symbol | `1,234.56 mUSDC` |
| Shares | 2 decimals | `135.31` |
| Price/share | 4 decimals | `0.7391` |
| Address | `0x1234…cdef`, mono, click-to-copy | |
| Close time | relative; absolute on hover | `2h 14m` |

Type scale: 12 / 13 / 14 / 16 / 20 / 28 px. The first four carry almost the entire UI.

### 7.3 Density & chroma

Table rows at `--row-h: 38px`. 1px dividers, not shadows. 6px radius. No gradients, glows, or colored shadows.

The color rule: an element may be colored **only when its color carries information that exists nowhere else**. A rising/falling probability is colored; a market's name is not. The TEE badge is colored; the category badge is gray.

---

## 8. File structure

```
frontend/
├─ app/
│  ├─ layout.tsx                 shell, provider, tema
│  ├─ page.tsx                   /
│  ├─ market/[address]/page.tsx  /market/[address]
│  └─ portfolio/page.tsx         /portfolio
├─ lib/
│  ├─ data/
│  │  ├─ types.ts                DataSource, Capability, Query, model
│  │  ├─ mock.ts                 MockSource + fixtures
│  │  ├─ chain.ts                ChainSource (viem)
│  │  ├─ indexer.ts              IndexerSource (wraps ChainSource)
│  │  └─ index.ts                mode selector from env
│  ├─ hooks/                     useMarkets, useMarket, useCandles, usePositions
│  └─ format.ts                  all of §7.2's rules, in one place
├─ components/
│  ├─ primitives/                Table, Badge, Unavailable, CopyAddress, Countdown
│  ├─ market/                    ProbabilityPanel, PayoutPanel, ProbabilityChart,
│  │                             MarketStats, PositionsTable, TradeTape, SpecViewer
│  └─ settlement/                FinalOutcome, ResolutionEvidence, TeeBadge, ReceiptViewer
└─ test/                         vitest + playwright
```

`lib/format.ts` centralizes §7.2 so that no component formats a number on its own — formatting that differs from screen to screen is the easiest way for a numeric UI to lose its credibility.

---

## 9. Tests

| Layer | Content | Tool |
|---|---|---|
| Data layer | every source satisfies the contract; an absent capability **throws**, it does not return empty | vitest |
| Decoration | `IndexerSource` delegates state reads to `ChainSource` — proven with a spy, not by inspection | vitest |
| Write boundary | `DataSource` **has no** method that writes to the chain; tested as a type property and as a grep for `buy\|sell\|redeem\|liquidate` under `lib/data/` | vitest |
| Formatting | the §7.2 table as test cases | vitest |
| Components | every consumer of `Query<T>` renders all four statuses | vitest + Testing Library |
| e2e | the three routes against anvil in `chain` mode; including a real buy and verifying that `unavailable` shows up in the history columns | Playwright |

`MockSource` **is** the test fixture — the same code path development uses, so it cannot rot in silence.

One test that is required and easy to forget: **render every component in `chain` mode and make sure no zero appears anywhere that should read `unavailable`.** That enforces F2 at the level of behavior, not just of types.

---

## 10. Phases

| Phase | Content | Prerequisite | Done when |
|---|---|---|---|
| **F0** | workspace, tokens, `lib/format`, `types.ts`, `MockSource`, primitives | — | vitest green; a storybook-less token demo page |
| **F1** | The market page enriched in mock mode: probability chart, market statistics, positions table, final outcome, resolution evidence. `OrderTicket` removed. | F0 | the detail page matches the Delphi reference, entirely from `MockSource` |
| **F2** | `ChainSource` + the `/` market list | Task 17 (factory) | the list populates from factory enumeration; history columns are honestly `unavailable` |
| **F3** | `/portfolio`, read-only | Task 16 | the agent's book reads from the chain |
| **F4** | `IndexerSource` | P3 | chart, tape, and entry price populate; `unavailable` disappears |
| **F5** | `@0g-delphi/agent-kit` — quoting, dilution, execution (§6) | Task 13, 16, 17 | an agent really buys and sells on anvil through the SDK |

Note that the ordering changed: F1 used to be "buy & sell from the browser". Now **no** phase makes the browser buy anything. The moment where "you watch the DPM curve move" shifts to F5, and what moves it is an agent, not a human typing.

The `OrderTicket` work from F0 is not thrown away: the `useQuote` logic — fee inversion with the denominator `10_000n + bps`, price impact via re-evaluating `dpm` at `qAfter`, and the payout transition — is the reference implementation that `agent-kit` mirrors in F5. What was deleted is the component, not the mathematics.

---

## 11. Open risks

| # | Issue | Stance |
|---|---|---|
| R1 | `MarketFactory.marketAt` enumerates linearly; thousands of markets will be slow | Accepted for v1; the indexer replaces it in F4 |
| R2 | `chain` mode without a chart makes the detail page feel empty | Accepted and deliberate — better honestly empty than dishonestly full |
| R3 | The default 0.5% slippage tolerance may be too tight for shallow markets | Watch in F1; can be made a function of depth |
| R4 | The dilution warning risks being ignored the way disclaimers generally are | Which is why it is presented as a **numeric transition** (`1.30× → 1.25×`), not as text alone |
| R5 | `deploymentBlock` in the manifest records the pre-broadcast block | Already recorded in the P0 ledger; must be sorted out before F4 uses it for backfill |
