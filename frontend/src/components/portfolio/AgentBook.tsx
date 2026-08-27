"use client";

import Link from "next/link";
import {BookOpen} from "lucide-react";
import {Badge} from "@/components/primitives/Badge";
import {Panel, PanelHeader} from "@/components/primitives/Panel";
import {ErrorNote} from "@/components/primitives/QueryStates";
import {SkeletonRows} from "@/components/primitives/Skeleton";
import {Unavailable} from "@/components/primitives/Unavailable";
import {usePositionsByMarket} from "@/hooks/useMarketRows";
import {useMarkets} from "@/hooks/useMarkets";
import {agentBook, holdingStatus, type BookRow} from "@/lib/agent-book";
import {collect} from "@/lib/collect";
import {statusTone} from "@/lib/market-rows";
import {formatCollateral, formatPricePerShare, formatShares} from "@/lib/format";
import type {MarketSummary} from "@/lib/data/types";

/**
 * One agent's book, read-only and addressed by URL.
 *
 * There is no wallet connection anywhere in this flow, and that is the point:
 * the human pages hold no signer, so "my positions" is not a concept this UI
 * can have. What it can do is inspect a public address, which is what it does.
 */
export function AgentBook({agent}: {agent: string}): React.JSX.Element {
  const markets = useMarkets();
  switch (markets.status) {
    case "ready":
      return <Book agent={agent} markets={markets.data} />;
    case "unavailable":
      return <Unavailable capability={markets.capability} mode={markets.mode} />;
    case "error":
      return <ErrorNote error={markets.error} what="the market list" />;
    case "loading":
      return (
        <Panel>
          <SkeletonRows rows={4} cols={6} />
        </Panel>
      );
  }
}

function Book({agent, markets}: {agent: string; markets: MarketSummary[]}): React.JSX.Element {
  const addresses = markets.map((m) => m.address);
  const positions = usePositionsByMarket(addresses);

  // A partial book would understate an agent's exposure while looking like the
  // whole of it, so one unreadable market makes the book unknowable rather than
  // smaller. `collect` is where that rule lives now, shared with the leaderboard.
  const collected = collect(positions);
  switch (collected.kind) {
    case "unavailable":
      return <Unavailable capability={collected.capability} mode={collected.mode} />;
    case "error":
      return <ErrorNote error={collected.error} what="this agent's positions" />;
    case "loading":
      return (
        <Panel>
          <SkeletonRows rows={4} cols={6} />
        </Panel>
      );
    case "ready":
      break;
  }

  const rows = agentBook(markets, collected.data, agent);

  return (
    <div className="flex flex-col gap-5">
      <Totals rows={rows} />
      <Panel testId="agent-book" className="overflow-hidden">
        <PanelHeader eyebrow="Exposure map" title="Positions across markets" icon={BookOpen} />
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-text-muted md:px-5">
            <span>No positions found for this address in the indexed markets.</span>
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[13px]">
              <caption className="sr-only">
                Every market in which this agent holds shares, with entry price, current price,
                value, and unrealised profit or loss.
              </caption>
              <thead className="bg-bg-sunken/60 text-[10px] tracking-[0.12em] text-text-faint uppercase">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Market
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    Side
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    Shares
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    Entry
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    Current
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    Value
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    Unrealised
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <BookRowCells key={`${row.market.address}-${row.outcome}`} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {/*
          There is no Actions column, and its absence is the design. Redeeming
          and liquidating are execution; execution lives in the agent SDK. The
          Status column tells an observer that something needs doing without
          pretending this page can do it.
        */}
        <p className="border-t border-border bg-bg-sunken/40 px-4 py-2 text-[10px] leading-relaxed text-text-muted md:px-5">
          Read-only. Redeeming and liquidating are done by the agent through the SDK, never from
          this page. Rows are rounded to two decimals while the totals above are summed from exact
          amounts, so adding a column by hand can differ in the last digit.
        </p>
      </Panel>
    </div>
  );
}

function BookRowCells({row}: {row: BookRow}) {
  const {market} = row;
  const decimals = market.collateral.decimals;
  return (
    <tr className="group border-t border-border hover:bg-bg-sunken/50">
      <th scope="row" className="max-w-[320px] px-4 py-3 text-left font-normal">
        <Link
          href={`/market/${market.address}`}
          className="text-[12px] leading-snug font-semibold text-text group-hover:text-accent"
        >
          {market.question}
        </Link>
      </th>
      <td
        className={`px-3 py-3 font-mono text-[11px] font-medium ${
          row.outcome === 1 ? "text-pos" : "text-neg"
        }`}
      >
        {row.outcome === 1 ? "YES" : "NO"}
      </td>
      <td className="px-3 py-3 text-right font-mono">{formatShares(row.shares)}</td>
      <td data-testid="book-entry" className="px-3 py-3 text-right font-mono">
        {row.entryPriceWad === null ? (
          <Unavailable capability="COST_BASIS" mode="chain" compact />
        ) : (
          formatPricePerShare(row.entryPriceWad)
        )}
      </td>
      <td className="px-3 py-3 text-right font-mono">
        {formatPricePerShare(row.currentPriceWad)}
      </td>
      <td className="px-3 py-3 text-right font-mono">
        {formatCollateral(row.currentValueTokens, decimals)}
      </td>
      <td data-testid="book-pnl" className="px-3 py-3 text-right font-mono">
        {row.pnlTokens === null ? (
          <Unavailable capability="COST_BASIS" mode="chain" compact />
        ) : (
          <span className={row.pnlTokens > 0n ? "text-pos" : row.pnlTokens < 0n ? "text-neg" : ""}>
            {row.pnlTokens > 0n ? "+" : ""}
            {formatCollateral(row.pnlTokens, decimals)}
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <Badge tone={statusTone(market.status)} label={holdingStatus(market.status)} dot />
      </td>
    </tr>
  );
}

function Totals({rows}: {rows: BookRow[]}) {
  const collaterals = new Set(
    rows.map((r) => `${r.market.collateral.symbol}:${r.market.collateral.decimals}`),
  );
  const single = collaterals.size === 1 ? rows[0]?.market.collateral : undefined;
  const value = single ? rows.reduce((sum, r) => sum + r.currentValueTokens, 0n) : null;
  // A total is only reported when EVERY row's cost basis is known: summing the
  // rows that happen to have one would look like the agent's whole result.
  const everyPnlKnown = rows.length > 0 && rows.every((r) => r.pnlTokens !== null);
  const pnl = single && everyPnlKnown ? rows.reduce((s, r) => s + (r.pnlTokens ?? 0n), 0n) : null;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <Tile label="Markets held" value={String(rows.length).padStart(2, "0")} />
      <Tile
        label={single ? `Value · ${single.symbol}` : "Value"}
        value={
          value !== null && single ? (
            formatCollateral(value, single.decimals)
          ) : (
            <span className="text-[13px] text-text-muted">mixed collateral</span>
          )
        }
      />
      <Tile
        label={single ? `Unrealised · ${single.symbol}` : "Unrealised"}
        value={
          pnl !== null && single ? (
            <span className={pnl > 0n ? "text-pos" : pnl < 0n ? "text-neg" : ""}>
              {pnl > 0n ? "+" : ""}
              {formatCollateral(pnl, single.decimals)}
            </span>
          ) : rows.length === 0 ? (
            <span className="text-[13px] text-text-muted">no positions</span>
          ) : (
            <Unavailable capability="COST_BASIS" mode="chain" compact />
          )
        }
      />
    </div>
  );
}

function Tile({label, value}: {label: string; value: React.ReactNode}) {
  return (
    <Panel as="div" className="p-4">
      <p className="font-mono text-[20px] leading-none font-medium tracking-tight text-text">
        {value}
      </p>
      <p className="mt-2 text-[10px] tracking-[0.1em] text-text-faint uppercase">{label}</p>
    </Panel>
  );
}

