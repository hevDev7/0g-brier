"use client";

import Link from "next/link";
import {ArrowLeft, ScrollText} from "lucide-react";
import {Badge} from "@/components/primitives/Badge";
import {CopyAddress} from "@/components/primitives/CopyAddress";
import {Countdown} from "@/components/primitives/Countdown";
import {PageHeading} from "@/components/primitives/PageHeading";
import {Panel, PanelHeader} from "@/components/primitives/Panel";
import {ErrorNote} from "@/components/primitives/QueryStates";
import {SkeletonRows} from "@/components/primitives/Skeleton";
import {Unavailable} from "@/components/primitives/Unavailable";
import {Lifecycle} from "@/components/market/Lifecycle";
import {MarketStats} from "@/components/market/MarketStats";
import {PayoutPanel} from "@/components/market/PayoutPanel";
import {PositionsTable} from "@/components/market/PositionsTable";
import {ProbabilityChart} from "@/components/market/ProbabilityChart";
import {ProbabilityPanel} from "@/components/market/ProbabilityPanel";
import {TradeTape} from "@/components/market/TradeTape";
import {FinalOutcome} from "@/components/settlement/FinalOutcome";
import {SettlementReport} from "@/components/settlement/SettlementReport";
import {useDataSource} from "@/hooks/provider";
import {useState} from "react";
import {useCandles} from "@/hooks/useCandles";
import {useMarket} from "@/hooks/useMarket";
import {usePositions} from "@/hooks/usePositions";
import {useReceipt} from "@/hooks/useReceipt";
import {useTrades} from "@/hooks/useTrades";
import {statusTone} from "@/lib/market-rows";
import type {
  Candle,
  Interval,
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
 * where it came from, who holds what, and on what evidence the market was
 * resolved. Buy, sell, redeem and liquidate all live in `@brier/agent-kit`,
 * outside the dApp — so there is no execution control in this file. Not hidden
 * and not disabled: ABSENT. A disabled button still promises something that will
 * never exist here, and this page's test asserts that no buy/sell/approve
 * control remains.
 *
 * There is no SpecViewer here yet. The MarketSpec is now readable — `specRoot`
 * is a 0G Storage content address and the document behind it is fetched and
 * verified — but the panel that would show its SOURCES and settlement prompt is
 * still to be built. What that document supplies today is the question and the
 * settlement rules below, and the criteria the committee actually used arrive
 * through `ResolutionEvidence` once the market settles.
 */
export function MarketView({address}: {address: `0x${string}`}): React.JSX.Element {
  const market = useMarket(address);

  // The same pattern as every Query<T> unwrapping below — a switch with no
  // `default` and an explicit non-nullable return type on the signature. The
  // `ready` branch hands off to a component of its own so the other data hooks
  // (tape, candles, positions, receipt) need not be called before `market.data`
  // exists, and stay unconditional inside that component.
  switch (market.status) {
    case "ready":
      return <MarketBody market={market.data} />;
    case "unavailable":
      return <Unavailable capability={market.capability} mode={market.mode} />;
    case "error":
      return <ErrorNote error={market.error} what="this market" />;
    case "loading":
      return (
        <Panel>
          <SkeletonRows rows={6} cols={3} />
        </Panel>
      );
  }
}

function MarketBody({market}: {market: MarketDetail}): React.JSX.Element {
  const source = useDataSource();
  // The bucket width lives here rather than inside the chart, because the HOOK needs
  // it too: changing it re-asks the source for a different aggregation, not just a
  // different drawing of the same numbers.
  const [interval, setInterval] = useState<Interval>("1h");
  const trades = useTrades(market.address, 24);
  const candles = useCandles(market.address, interval);
  const positions = usePositions(market.address);
  const receipt = useReceipt(market.address);

  return (
    <>
      <Link
        href="/"
        className="mb-5 inline-flex items-center gap-2 text-[12px] font-semibold text-text-muted hover:text-accent"
      >
        <ArrowLeft size={14} aria-hidden />
        Back to markets
      </Link>

      <PageHeading
        eyebrow={`${market.category} / ${market.tier}`}
        // The question lives in a 0G Storage blob keyed by `specRoot`; only the root
        // is on chain. A heading has to say something, so it says what is true rather
        // than rendering an empty h1 — and the rules section below carries the full
        // `<Unavailable>` explanation.
        title={market.question ?? "Question not readable in this mode"}
        description="Inspect the price, its history, who holds what, and the evidence behind the settlement. Every trade shown here was executed by an agent through the SDK."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(market.status)} label={market.status} dot />
            {/* A countdown only makes sense while trading is still running: on a
                closed market formatCountdown returns "closed" and the line would
                read "closes in closed". The status badge above already says it. */}
            {market.status === "Open" && (
              <span className="text-[12px] text-text-muted">
                closes in <Countdown until={market.tradingEnd} />
              </span>
            )}
            <CopyAddress address={market.address} />
          </div>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,380px)]">
        {/*
          `min-w-0` is load-bearing, not tidying. A grid item's automatic minimum
          size is its MIN-CONTENT width, so the widest thing in this column — the
          600px chart viewBox, the 600px positions table — would widen the track
          past the viewport and make the whole PAGE scroll sideways on a phone,
          instead of scrolling inside its own overflow-x-auto wrapper. Measured:
          without this, /market/[address] overflowed by 256px at 375px wide.
        */}
        <div className="flex min-w-0 flex-col gap-5">
          <ProbabilityPanel q={market.q} />
          {/* The dilution disclosure lives in the main column, directly under the
              probability, rather than in the sidebar: it is the only place a human
              is ever told the payout floats, so it must not sit below the fold. */}
          <PayoutPanel q={market.q} />
          {renderChart(candles, interval, setInterval)}
          {renderPositions(positions, market, source.mode)}
          {renderTrades(trades, market.collateral)}

          {/* The rules come from the MarketSpec on 0G Storage, not from chain
              state — MARKET_SPEC_BLOB, and so genuinely unavailable where no
              storage indexer is configured or where the creator never uploaded a
              document. An inspection page without the rules that bind it hides
              the very thing a reader most needs to check before the market
              resolves, which is why the absence is stated rather than left
              blank. */}
          <Panel testId="settlement-rules">
            <PanelHeader
              eyebrow="Market specification"
              title="Settlement rules"
              icon={ScrollText}
            />
            {/* Rendering `{market.rules}` unconditionally put a heading over an
                empty paragraph the moment the rules were null — and a panel that
                promises a settlement rule and delivers nothing reads as "this
                market has no rules", not as "this cannot be read here". Exactly
                the defect ResolutionEvidence shipped once already; fixtures never
                show it because a fixture always has rules. */}
            {market.rules === null ? (
              <div className="p-4 md:p-5">
                <Unavailable capability="MARKET_SPEC_BLOB" mode={source.mode} />
              </div>
            ) : (
              <p className="p-4 text-[13px] leading-relaxed text-text-muted md:p-5">
                {market.rules}
              </p>
            )}
          </Panel>
        </div>

        <aside className="flex min-w-0 flex-col gap-5 xl:sticky xl:top-[84px] xl:self-start">
          <MarketStats market={market} trades={trades} />
          <Lifecycle market={market} mode={source.mode} />
          {market.status === "Settled" && renderSettlement(receipt, market, source.mode)}
        </aside>
      </div>
    </>
  );
}

/**
 * Extracted from a ternary into a switch over `.status` so that the
 * exhaustiveness guarantee is STRUCTURAL rather than an accident of how this
 * code happens to be written today. The explicit non-nullable return type
 * (`React.JSX.Element`) is the part that enforces it: under `strict`, a function
 * that falls off the end of a switch without returning gives back `undefined`,
 * and `undefined` is not assignable to `React.JSX.Element` — so removing a
 * `case` fails to compile (TS2366). Without the annotation TypeScript quietly
 * infers `| undefined` and the guarantee disappears.
 *
 * There is DELIBERATELY no `default` in any of the functions below: adding one
 * "just in case" strips the exhaustiveness check — the compiler stops forcing a
 * new case to be handled the moment a catch-all exists.
 */
function renderTrades(trades: Query<Trade[]>, collateral: CollateralInfo): React.JSX.Element {
  switch (trades.status) {
    case "ready":
      return <TradeTape trades={trades.data} collateral={collateral} />;
    case "unavailable":
      return <Unavailable capability={trades.capability} mode={trades.mode} />;
    case "error":
      return <ErrorNote error={trades.error} what="the trade tape" />;
    case "loading":
      return (
        <Panel>
          <SkeletonRows rows={5} cols={5} />
        </Panel>
      );
  }
}

function renderChart(
  candles: Query<Candle[]>,
  interval: Interval,
  onIntervalChange: (next: Interval) => void,
): React.JSX.Element {
  switch (candles.status) {
    case "ready":
      return (
        <ProbabilityChart candles={candles.data} interval={interval} onIntervalChange={onIntervalChange} />
      );
    case "unavailable":
      return <Unavailable capability={candles.capability} mode={candles.mode} />;
    case "error":
      return <ErrorNote error={candles.error} what="the price history" />;
    case "loading":
      return (
        <Panel>
          <SkeletonRows rows={4} cols={2} />
        </Panel>
      );
  }
}

/**
 * `mode` comes from the data source rather than from `positions` — the `ready`
 * branch does not carry it, and the table still needs the current mode for the
 * entry-price cell, which can be `null` (COST_BASIS). Availability per CELL, not
 * per panel.
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
      return <ErrorNote error={positions.error} what="the positions" />;
    case "loading":
      return (
        <Panel>
          <SkeletonRows rows={4} cols={5} />
        </Panel>
      );
  }
}

/**
 * The verdict in the sidebar, the record behind a click.
 *
 * `ResolutionEvidence` used to sit here as a second panel. It now lives inside
 * `SettlementReport`, which is the only place that can put it beside what the
 * market PROMISED — and showing the same panel twice on one screen was the
 * alternative.
 *
 * Neither element switches on the receipt's query state any more, and that is
 * the point: `Market.winningOutcome` answers in every mode, so the verdict and
 * the whole promised half of the report are readable with no receipt at all.
 * Gating them on the receipt hid what IS known behind what is not — a settled
 * market on a live chain read as though nobody had decided anything.
 */
function renderSettlement(
  receipt: Query<SettlementReceipt | null>,
  market: MarketDetail,
  mode: DataMode,
): React.JSX.Element {
  return (
    <>
      <FinalOutcome market={market} receipt={receipt.status === "ready" ? receipt.data : null} />
      <SettlementReport market={market} receipt={receipt} mode={mode} />
    </>
  );
}
