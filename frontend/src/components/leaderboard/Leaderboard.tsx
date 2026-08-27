"use client";

import {useMemo} from "react";
import Link from "next/link";
import {usePathname, useRouter, useSearchParams} from "next/navigation";
import {Trophy} from "lucide-react";
import {Panel, PanelHeader} from "@/components/primitives/Panel";
import {ErrorNote} from "@/components/primitives/QueryStates";
import {SkeletonRows} from "@/components/primitives/Skeleton";
import {Unavailable} from "@/components/primitives/Unavailable";
import {usePositionsByMarket, useBalances, useTradesByMarket} from "@/hooks/useMarketRows";
import {useMarkets} from "@/hooks/useMarkets";
import {useDataSource} from "@/hooks/provider";
import {collect} from "@/lib/collect";
import {agentsSeen} from "@/lib/agent-book";
import {compareRows, leaderboard, type LeaderboardRow, type SortKey} from "@/lib/leaderboard";
import {formatCollateral, shortAddress} from "@/lib/format";
import type {CollateralInfo, DataMode, MarketSummary} from "@/lib/data/types";

/** The fixtures hold 24 trades a market; a real indexer would page this. */
const TAPE_LIMIT = 500;

const SORTS = [
  {key: "account", label: "Account value"},
  {key: "unrealised", label: "Unrealised"},
  {key: "volume", label: "Volume"},
  {key: "trades", label: "Trades"},
] as const;

export function Leaderboard(): React.JSX.Element {
  const markets = useMarkets();
  switch (markets.status) {
    case "ready":
      return <Body markets={markets.data} />;
    case "unavailable":
      return <Unavailable capability={markets.capability} mode={markets.mode} />;
    case "error":
      return <ErrorNote error={markets.error} what="the market list" />;
    case "loading":
      return (
        <Panel>
          <SkeletonRows rows={6} cols={7} />
        </Panel>
      );
  }
}

function Body({markets}: {markets: MarketSummary[]}): React.JSX.Element {
  const addresses = useMemo(() => markets.map((m) => m.address), [markets]);
  const positionQueries = usePositionsByMarket(addresses);
  const tradeQueries = useTradesByMarket(addresses, TAPE_LIMIT);

  const positions = collect(positionQueries);
  const trades = collect(tradeQueries);

  // Summing across markets is only meaningful when they share a collateral:
  // adding a 6-decimal token to an 18-decimal one produces a number that means
  // nothing, and an account value is a quantity of ONE token.
  const collaterals = new Set(markets.map((m) => `${m.collateral.symbol}:${m.collateral.decimals}`));
  const collateral: CollateralInfo | undefined =
    collaterals.size === 1 ? markets[0]?.collateral : undefined;

  // The agent set is known only once positions or tapes have arrived; before
  // that this asks for nothing, which is what an empty list expresses.
  const agents = useMemo(() => {
    const fromPositions = positions.kind === "ready" ? agentsSeen(positions.data) : [];
    const fromTrades =
      trades.kind === "ready"
        ? [...new Set(trades.data.flat().map((t) => t.trader.toLowerCase()))].map(
            (a) => a as `0x${string}`,
          )
        : [];
    const merged = new Map<string, `0x${string}`>();
    for (const a of [...fromPositions, ...fromTrades]) merged.set(a.toLowerCase(), a);
    return [...merged.values()];
  }, [positions, trades]);

  const balanceQueries = useBalances(agents, collateral?.address);
  const balances = collect(balanceQueries);

  const params = useSortParam();

  // Both unreadable means there is no agent set at all — not an empty
  // leaderboard, which would assert that nobody has traded.
  if (positions.kind === "unavailable" && trades.kind === "unavailable") {
    return <Unavailable capability={positions.capability} mode={positions.mode} />;
  }
  if (positions.kind === "error") {
    return <ErrorNote error={positions.error} what="agent positions" />;
  }
  if (positions.kind === "loading" || trades.kind === "loading") {
    return (
      <Panel>
        <SkeletonRows rows={6} cols={7} />
      </Panel>
    );
  }

  const balanceMap = new Map<string, bigint>();
  if (balances.kind === "ready") {
    agents.forEach((agent, i) => {
      const value = balances.data[i];
      if (value !== undefined) balanceMap.set(agent.toLowerCase(), value);
    });
  }

  const rows = leaderboard({
    markets,
    positionsByMarket: positions.kind === "ready" ? positions.data : null,
    tradesByMarket: trades.kind === "ready" ? trades.data : null,
    balances: balanceMap,
    balancesKnown: balances.kind === "ready" && collateral !== undefined,
  }).sort((a, b) => compareRows(a, b, params.sort));

  return (
    <Panel testId="leaderboard" className="overflow-hidden">
      <PanelHeader
        eyebrow="Agent performance"
        title="Leaderboard"
        icon={Trophy}
        action={
          <div className="flex flex-wrap gap-1">
            {SORTS.map(({key, label}) => (
              <button
                key={key}
                type="button"
                onClick={() => params.set(key)}
                aria-pressed={params.sort === key}
                data-testid={`sort-${key}`}
                className={`rounded px-2 py-1 font-mono text-[10px] tracking-wide whitespace-nowrap uppercase transition-colors ${
                  params.sort === key
                    ? "bg-accent text-accent-fg"
                    : "text-text-muted hover:bg-bg-sunken hover:text-text"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />

      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-[13px] text-text-muted md:px-5">
          <span>No agent has traded in the indexed markets yet.</span>
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-[13px]">
            <caption className="sr-only">
              Agents ranked by {SORTS.find((s) => s.key === params.sort)?.label}, with trade
              count, traded volume, deployed value, free collateral, account value and unrealised
              profit.
            </caption>
            <thead className="bg-bg-sunken/60 text-[10px] tracking-[0.12em] text-text-faint uppercase">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  #
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  Agent
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">
                  Trades
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">
                  Volume
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">
                  Deployed
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">
                  Free
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">
                  Account value
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Unrealised
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <Row key={row.agent} row={row} rank={index + 1} collateral={collateral} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/*
        Three claims a reader would otherwise have to infer, and would infer
        wrongly: what "unrealised" leaves out, what "account value" is made of,
        and that the ranking cannot include agents whose figure is unknown.
      */}
      <div className="flex flex-col gap-1 border-t border-border bg-bg-sunken/40 px-4 py-2.5 text-[10px] leading-relaxed text-text-muted md:px-5">
        <p>
          <span className="text-text">Account value</span> is free collateral plus the value of
          open positions at the current marginal price. It is not a wallet total — only the
          collateral these markets settle in is counted.
        </p>
        <p>
          <span className="text-text">Unrealised</span> covers open positions only. Profit already
          taken by selling is not included: matching sold shares to what they cost needs the full
          trade history per agent, which arrives with the indexer.
        </p>
        <p>
          An agent whose figure cannot be read is ranked last rather than as zero — unknown is not
          the smallest value.
        </p>
      </div>
    </Panel>
  );
}

function Row({
  row,
  rank,
  collateral,
}: {
  row: LeaderboardRow;
  rank: number;
  collateral: CollateralInfo | undefined;
}) {
  // Read, never assumed. A cell that says "not available in chain mode" while
  // the app is running on `mock` names the wrong source, and sends a reader
  // looking for a fix in a place that has nothing to do with it.
  const {mode} = useDataSource();
  const decimals = collateral?.decimals ?? 6;
  return (
    <tr className="group border-t border-border hover:bg-bg-sunken/50">
      <td className="px-4 py-3 text-right font-mono text-[11px] text-text-faint">
        {String(rank).padStart(2, "0")}
      </td>
      <th scope="row" className="px-3 py-3 text-left font-normal">
        <Link
          href={`/portfolio/${row.agent}`}
          className="font-mono text-[12px] text-text group-hover:text-accent"
        >
          {shortAddress(row.agent)}
        </Link>
      </th>
      <Cell testId="lb-trades" value={row.trades} render={(v) => String(v)} capability="TRADE_TAPE" mode={mode} />
      <Cell
        testId="lb-volume"
        value={row.volumeTokens}
        render={(v) => formatCollateral(v, decimals)}
        capability="TRADE_TAPE"
        mode={mode}
      />
      <Cell
        testId="lb-deployed"
        value={row.positionValueTokens}
        render={(v) => formatCollateral(v, decimals)}
        capability="AGENT_POSITIONS"
        mode={mode}
      />
      <Cell
        testId="lb-free"
        value={row.balanceTokens}
        render={(v) => formatCollateral(v, decimals)}
        capability="AGENT_BALANCE"
        mode={mode}
      />
      <Cell
        testId="lb-account"
        value={row.accountValueTokens}
        render={(v) => formatCollateral(v, decimals)}
        capability="AGENT_BALANCE"
        mode={mode}
        strong
      />
      <Cell
        testId="lb-unrealised"
        value={row.unrealisedTokens}
        capability="COST_BASIS"
        mode={mode}
        last
        render={(v) => (
          <span className={v > 0n ? "text-pos" : v < 0n ? "text-neg" : ""}>
            {v > 0n ? "+" : ""}
            {formatCollateral(v, decimals)}
          </span>
        )}
      />
    </tr>
  );
}

/**
 * A null value renders the capability that would have supplied it, never a zero.
 * The distinction matters most here: on a ranked table a zero reads as "this
 * agent did nothing", which is a claim about the agent rather than about the
 * source.
 */
function Cell<T extends bigint | number>({
  testId,
  value,
  render,
  capability,
  mode,
  strong = false,
  last = false,
}: {
  testId: string;
  value: T | null;
  render: (value: T) => React.ReactNode;
  capability: Parameters<typeof Unavailable>[0]["capability"];
  mode: DataMode;
  strong?: boolean;
  last?: boolean;
}) {
  return (
    <td
      data-testid={testId}
      className={`${last ? "px-4" : "px-3"} py-3 text-right font-mono ${
        strong ? "font-medium text-text" : ""
      }`}
    >
      {value === null ? <Unavailable capability={capability} mode={mode} compact /> : render(value)}
    </td>
  );
}

/** The chosen ranking lives in the URL so a leaderboard view can be shared. */
function useSortParam() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("sort");
  const sort = (SORTS.some((s) => s.key === raw) ? raw : "account") as SortKey;
  return {
    sort,
    set(next: SortKey) {
      const query = new URLSearchParams(params.toString());
      query.set("sort", next);
      router.replace(`${pathname}?${query.toString()}`, {scroll: false});
    },
  };
}
