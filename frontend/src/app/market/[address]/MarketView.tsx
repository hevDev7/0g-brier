"use client";

import {Badge} from "@/components/primitives/Badge";
import {CopyAddress} from "@/components/primitives/CopyAddress";
import {Countdown} from "@/components/primitives/Countdown";
import {Unavailable} from "@/components/primitives/Unavailable";
import {MarketStats} from "@/components/market/MarketStats";
import {PayoutPanel} from "@/components/market/PayoutPanel";
import {PositionsTable} from "@/components/market/PositionsTable";
import {ProbabilityChart} from "@/components/market/ProbabilityChart";
import {ProbabilityPanel} from "@/components/market/ProbabilityPanel";
import {TradeTape} from "@/components/market/TradeTape";
import {FinalOutcome} from "@/components/settlement/FinalOutcome";
import {ResolutionEvidence} from "@/components/settlement/ResolutionEvidence";
import {useDataSource} from "@/hooks/provider";
import {useCandles} from "@/hooks/useCandles";
import {useMarket} from "@/hooks/useMarket";
import {usePositions} from "@/hooks/usePositions";
import {useReceipt} from "@/hooks/useReceipt";
import {useTrades} from "@/hooks/useTrades";
import type {
  Candle,
  CollateralInfo,
  DataMode,
  MarketDetail,
  Position,
  Query,
  SettlementReceipt,
  Trade,
} from "@/lib/data/types";

/**
 * An INSPECTION page, not a place to transact (spec §1 F3): what the price is,
 * where that price came from, who holds what, and on what evidence the market
 * was resolved. Buy, sell, redeem, and liquidate all live in
 * `@0g-delphi/agent-kit`, outside the dApp — so there is no execution control in
 * this file. Not hidden and not disabled: ABSENT. A dead button still promises
 * something that will never exist here, and this page's test asserts that not one
 * buy/sell/approve button remains.
 *
 * There is no SpecViewer here, and that is deliberate: its content comes from 0G
 * Storage through `specRoot`, whose integration does not exist yet. The
 * resolution rules stay readable through `market.rules` below, and the criteria
 * the committee actually used through `ResolutionEvidence` once the market is
 * settled.
 */
export function MarketView({address}: {address: `0x${string}`}): React.JSX.Element {
  const market = useMarket(address);

  // The same pattern as every other Query<T> unwrap below — a switch with no
  // `default`, and an explicit non-nullable return type on the function
  // signature. The `ready` branch hands off to a component of its own so the
  // other data hooks (tape, candles, positions, receipt) need not be called
  // before `market.data` exists, and stay unconditional inside that component.
  switch (market.status) {
    case "ready":
      return <MarketBody market={market.data} />;
    case "unavailable":
      return (
        <Shell>
          <Unavailable capability={market.capability} mode={market.mode} />
        </Shell>
      );
    case "error":
      return <Shell>Failed to load: {market.error.message}</Shell>;
    case "loading":
      return <Shell>Loading…</Shell>;
  }
}

function MarketBody({market}: {market: MarketDetail}): React.JSX.Element {
  const source = useDataSource();
  const trades = useTrades(market.address, 24);
  const candles = useCandles(market.address, "1h");
  const positions = usePositions(market.address);
  const receipt = useReceipt(market.address);

  return (
    <Shell>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4">
          <header className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral" label={market.tier} />
              <Badge
                tone={market.status === "Open" ? "positive" : "neutral"}
                label={market.status}
              />
              <span className="text-[12px] text-text-muted">{market.category}</span>
              {/* A countdown is only meaningful while trading is still running: on a
                  market that has closed, `formatCountdown` returns "closed" and the
                  line would read "closes in closed". The market status already says
                  so through the badge above. */}
              {market.status === "Open" && (
                <span className="text-[12px] text-text-muted">
                  closes in <Countdown until={market.tradingEnd} />
                </span>
              )}
              <CopyAddress address={market.address} />
            </div>
            <h1 className="max-w-3xl text-[20px] leading-snug text-text">{market.question}</h1>
          </header>

          <ProbabilityPanel q={market.q} />
          <PayoutPanel q={market.q} />
          {renderChart(candles)}
          {renderPositions(positions, market, source.mode)}
          {renderTrades(trades, market.collateral)}

          {/* The resolution rules come from MARKET_STATE — any mode can answer it,
              so they are never `unavailable`. An inspection page without the rules
              that bind it hides precisely the thing a reader most needs to examine
              before the market settles. */}
          <section className="rounded-lg border border-border p-4">
            <h2 className="mb-2 text-[12px] uppercase tracking-wide text-text-faint">
              Resolution rules
            </h2>
            <p className="text-[13px] leading-relaxed text-text-muted">{market.rules}</p>
          </section>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
          <MarketStats market={market} trades={trades} />
          {market.status === "Settled" && renderSettlement(receipt, market)}
        </aside>
      </div>
    </Shell>
  );
}

/**
 * Extracted from a ternary into a switch over `.status` so that the
 * exhaustiveness guarantee is STRUCTURAL rather than an accident of how this
 * code happens to be written today. The explicit non-nullable return type
 * (`React.JSX.Element`) is the part that enforces it: under `strict`, a function
 * that "falls off" the end of a switch without returning returns `undefined`,
 * and `undefined` is not assignable to `React.JSX.Element` — so deleting a
 * `case` fails to compile (TS2366). Without this annotation TypeScript quietly
 * infers `| undefined` and the guarantee evaporates.
 *
 * There is DELIBERATELY no `default` in any of the functions below: adding one
 * "just in case" would disarm this exhaustiveness check — the compiler stops
 * forcing new cases to be handled the moment a catch-all fallback exists.
 */
function renderTrades(trades: Query<Trade[]>, collateral: CollateralInfo): React.JSX.Element {
  switch (trades.status) {
    case "ready":
      return <TradeTape trades={trades.data} collateral={collateral} />;
    case "unavailable":
      return <Unavailable capability={trades.capability} mode={trades.mode} />;
    case "error":
      return (
        <div className="text-[13px] text-neg">Failed to load trades: {trades.error.message}</div>
      );
    case "loading":
      return <div className="text-[13px] text-text-muted">Loading trades…</div>;
  }
}

function renderChart(candles: Query<Candle[]>): React.JSX.Element {
  switch (candles.status) {
    case "ready":
      return <ProbabilityChart candles={candles.data} />;
    case "unavailable":
      return <Unavailable capability={candles.capability} mode={candles.mode} />;
    case "error":
      return (
        <div className="text-[13px] text-neg">Failed to load history: {candles.error.message}</div>
      );
    case "loading":
      return <div className="text-[13px] text-text-muted">Loading history…</div>;
  }
}

/**
 * `mode` comes from the data source, not from `positions` — the `ready` branch
 * does not carry it, and the table still needs the current mode for the entry
 * price cell, which can be `null` (COST_BASIS). Availability per CELL, not per
 * panel.
 */
function renderPositions(
  positions: Query<Position[]>,
  market: MarketDetail,
  mode: DataMode,
): React.JSX.Element {
  switch (positions.status) {
    case "ready":
      return <PositionsTable positions={positions.data} market={market} mode={mode} />;
    case "unavailable":
      return <Unavailable capability={positions.capability} mode={positions.mode} />;
    case "error":
      return (
        <div className="text-[13px] text-neg">Failed to load positions: {positions.error.message}</div>
      );
    case "loading":
      return <div className="text-[13px] text-text-muted">Loading positions…</div>;
  }
}

/** The committee's verdict AND the evidence that makes it inspectable — one receipt, two panels. */
function renderSettlement(
  receipt: Query<SettlementReceipt>,
  market: MarketDetail,
): React.JSX.Element {
  switch (receipt.status) {
    case "ready":
      return (
        <>
          <FinalOutcome receipt={receipt.data} market={market} />
          <ResolutionEvidence receipt={receipt.data} />
        </>
      );
    case "unavailable":
      return <Unavailable capability={receipt.capability} mode={receipt.mode} />;
    case "error":
      return (
        <div className="text-[13px] text-neg">
          Failed to load the resolution evidence: {receipt.error.message}
        </div>
      );
    case "loading":
      return <div className="text-[13px] text-text-muted">Loading resolution evidence…</div>;
  }
}

function Shell({children}: {children: React.ReactNode}) {
  return <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">{children}</main>;
}
