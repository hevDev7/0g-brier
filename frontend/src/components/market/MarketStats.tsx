import {toTokensFloor} from "@0g-delphi/protocol";
import {Unavailable} from "@/components/primitives/Unavailable";
import {formatCollateral, formatFeeRate, formatTimestamp} from "@/lib/format";
import type {MarketDetail, Query, Trade} from "@/lib/data/types";

/**
 * Seven market facts, but availability is evaluated PER ROW, not per panel
 * (spec §2). Six come from `market: MarketDetail` — MARKET_STATE, which any mode
 * can answer — so the five rows below (fee, liquidity, created, closes, settles
 * by) are always populated once `market` exists. Only the volume row depends on
 * `trades: Query<Trade[]>`, because only events record what was traded
 * (TRADE_TAPE) — `chain` mode cannot answer it. Were availability evaluated per
 * PANEL, this whole panel would go dark whenever volume is unknown: six facts we
 * have thrown away for one we do not. So only `stat-volume` may render
 * `<Unavailable>`; the other five rows never ask about `trades.status` at all.
 */
export function MarketStats({market, trades}: {market: MarketDetail; trades: Query<Trade[]>}) {
  const decimals = market.collateral.decimals;
  // floor, not ceil: this is a reading of pool liquidity, not an incoming
  // transfer. Rounding up would claim more collateral than actually backs the
  // market — floor keeps this number from ever overstating what really exists,
  // for the same reason toTokensFloor covers the "funds out" direction in
  // units.ts.
  const liquidityTokens = toTokensFloor(market.poolWad, decimals);

  return (
    <div
      data-testid="market-stats"
      className="flex flex-col gap-1.5 rounded-lg border border-border p-4"
    >
      <h2 className="mb-1 text-[12px] uppercase tracking-wide text-text-faint">Market statistics</h2>
      <Row testId="stat-volume" label="Volume">
        {volumeRow(trades, market)}
      </Row>
      <Row testId="stat-fee" label="Fee">
        <span>{formatFeeRate(market.feeBps)}</span>
      </Row>
      <Row testId="stat-liquidity" label="Liquidity">
        <span>{formatCollateral(liquidityTokens, decimals)}</span>
      </Row>
      <Row testId="stat-created" label="Created">
        <span>{formatTimestamp(market.createdAt)}</span>
      </Row>
      <Row testId="stat-closes" label="Closes">
        <span>{formatTimestamp(market.tradingEnd)}</span>
      </Row>
      <Row testId="stat-settles-by" label="Settles by">
        <span>{formatTimestamp(market.settlementDeadline)}</span>
      </Row>
    </div>
  );
}

/**
 * Extracted into a switch over `trades.status` with an explicit non-nullable
 * return type (`React.JSX.Element`) DELIBERATELY — this is not style. Under
 * `strict`, a function that falls off the end of a switch without a `return`
 * returns `undefined`, and `undefined` is not assignable to `React.JSX.Element`
 * (TS2366): deleting a `case` fails to compile. Without this annotation
 * TypeScript quietly infers `| undefined` and the exhaustiveness guarantee
 * evaporates — exactly the defect that was once found and fixed in
 * `MarketView.renderTrades`.
 *
 * There is DELIBERATELY no `default`: adding one disarms this very
 * exhaustiveness check.
 */
function volumeRow(trades: Query<Trade[]>, m: MarketDetail): React.JSX.Element {
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
      return <span className="text-neg">Failed to load</span>;
    case "loading":
      return <span className="text-text-muted">Loading…</span>;
  }
}

function Row({testId, label, children}: {testId: string; label: string; children: React.ReactNode}) {
  return (
    <div data-testid={testId} className="flex items-baseline justify-between text-[13px]">
      <span className="text-text-muted">{label}</span>
      <span className="text-text">{children}</span>
    </div>
  );
}
