"use client";

import {useMemo, useState} from "react";
import Link from "next/link";
import {usePathname, useRouter, useSearchParams} from "next/navigation";
import {ArrowDownUp, ChevronRight, Filter, Search} from "lucide-react";
import {toTokensFloor} from "@0g-delphi/protocol";
import {Badge} from "@/components/primitives/Badge";
import {Countdown} from "@/components/primitives/Countdown";
import {Panel} from "@/components/primitives/Panel";
import {ErrorNote} from "@/components/primitives/QueryStates";
import {Skeleton, SkeletonRows} from "@/components/primitives/Skeleton";
import {Unavailable} from "@/components/primitives/Unavailable";
import {useCandlesByMarket, useTradesByMarket} from "@/hooks/useMarketRows";
import {useMarkets} from "@/hooks/useMarkets";
import {useDataSource} from "@/hooks/provider";
import {probabilityWad} from "@/lib/dpm-view";
import {delta24h, statusTone, volumeOf} from "@/lib/market-rows";
import {
  formatCollateral,
  formatCountdown,
  formatProbability,
  formatProbabilityDelta,
  formatTimestamp,
  shortAddress,
} from "@/lib/format";
import type {Candle, CollateralInfo, MarketSummary, Query, Trade} from "@/lib/data/types";

const SORTS = [
  {key: "volume", label: "Volume"},
  {key: "closing", label: "Closing soon"},
  {key: "newest", label: "Newest"},
] as const;
type SortKey = (typeof SORTS)[number]["key"];

export function MarketList(): React.JSX.Element {
  const markets = useMarkets();
  switch (markets.status) {
    case "ready":
      return <MarketsBody markets={markets.data} />;
    case "unavailable":
      return <Unavailable capability={markets.capability} mode={markets.mode} />;
    case "error":
      return <ErrorNote error={markets.error} what="the market list" />;
    case "loading":
      return (
        <Panel testId="market-table">
          <SkeletonRows rows={5} cols={6} />
        </Panel>
      );
  }
}

function MarketsBody({markets}: {markets: MarketSummary[]}) {
  const addresses = useMemo(() => markets.map((m) => m.address), [markets]);
  // Hooks are called unconditionally on a stable-length input: `markets` is
  // already `ready` here, so the fan-out cannot change arity between renders.
  const trades = useTradesByMarket(addresses, 24);
  const candles = useCandlesByMarket(addresses, "1h");

  const params = useListParams();
  const [search, setSearch] = useState("");

  const volumes = useMemo(() => {
    const map = new Map<string, bigint | null>();
    markets.forEach((m, i) => {
      const q = trades[i];
      map.set(m.address, q?.status === "ready" ? volumeOf(q.data) : null);
    });
    return map;
  }, [markets, trades]);

  const categories = useMemo(
    () => [...new Set(markets.map((m) => m.category))].sort(),
    [markets],
  );

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return markets
      .map((market, index) => ({market, index}))
      .filter(
        ({market}) =>
          (!params.category || market.category === params.category) &&
          (!params.status || market.status === params.status) &&
          (!params.tier || market.tier === params.tier) &&
          // The address is searchable too, and not only as a convenience: in a mode
          // that cannot read the MarketSpec blob the question is null, and a filter
          // that matched on the question alone would make those markets unreachable
          // through search rather than merely unlabelled.
          (!needle ||
            (market.question ?? "").toLowerCase().includes(needle) ||
            market.address.toLowerCase().includes(needle)),
      )
      .sort((a, b) => compareRows(a.market, b.market, params.sort, volumes));
  }, [markets, params.category, params.status, params.tier, params.sort, search, volumes]);

  return (
    <div className="flex flex-col gap-5">
      <SummaryTiles markets={markets} trades={trades} />

      <Panel testId="market-table" className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between">
          <p className="flex items-center gap-2">
            <Filter size={14} className="text-text-faint" aria-hidden />
            <span className="eyebrow text-text-faint">Market registry</span>
            <span
              data-testid="market-count"
              className="rounded-full bg-bg-sunken px-2 py-0.5 font-mono text-[10px] text-text-muted"
            >
              {rows.length} / {markets.length}
            </span>
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <span className="sr-only">Search markets</span>
              <Search
                size={14}
                aria-hidden
                className="pointer-events-none absolute top-2.5 left-2.5 text-text-faint"
              />
              <input
                data-testid="market-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find a market"
                className="h-8 w-full rounded-md border border-border bg-bg pr-3 pl-8 text-[12px] placeholder:text-text-faint sm:w-[180px]"
              />
            </label>
            <Select
              label="Category"
              value={params.category}
              onChange={(v) => params.set("category", v)}
              options={categories}
              allLabel="All categories"
            />
            <Select
              label="Status"
              value={params.status}
              onChange={(v) => params.set("status", v)}
              options={["Open", "Closed", "Proposed", "Disputed", "Settled", "Failed", "Voided"]}
              allLabel="All statuses"
            />
            <Select
              label="Tier"
              value={params.tier}
              onChange={(v) => params.set("tier", v)}
              options={["FAST", "VERIFIED", "DETERMINISTIC"]}
              allLabel="All tiers"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-border bg-bg-sunken/60 px-4 py-2">
          <span className="eyebrow text-text-faint">Sort</span>
          <div className="flex gap-1">
            {SORTS.map(({key, label}) => (
              <button
                key={key}
                type="button"
                onClick={() => params.set("sort", key)}
                aria-pressed={params.sort === key}
                data-testid={`sort-${key}`}
                className={`rounded px-2 py-1 font-mono text-[10px] tracking-wide uppercase transition-colors ${
                  params.sort === key
                    ? "bg-accent text-accent-fg"
                    : "text-text-muted hover:bg-bg-sunken hover:text-text"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="px-4 py-12 text-center text-[13px] text-text-muted">
            No market matches these filters.
          </p>
        ) : (
          /*
            The table scrolls horizontally inside its own container rather than
            collapsing into stacked cards on small screens. Stacking would mean
            hiding <thead>, which breaks the header/cell association a screen
            reader relies on — and this is a comparison table, where reading one
            row at a time defeats the point of the page.
          */
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-[13px]">
              <caption className="sr-only">
                Binary prediction markets, with implied probability, 24-hour change, traded
                volume, and pool depth.
              </caption>
              <thead className="bg-bg-sunken/60 text-[10px] tracking-[0.12em] text-text-faint uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Market
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    P(YES)
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Δ24h
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Volume
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Depth
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Tier
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Closes
                  </th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Open market</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({market, index}) => (
                  <MarketRow
                    key={market.address}
                    market={market}
                    trades={trades[index]}
                    candles={candles[index]}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="flex items-start gap-2 border-t border-border bg-bg-sunken/40 px-4 py-2.5 text-[10px] leading-relaxed text-text-muted">
          <ArrowDownUp size={12} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            Depth is the pool that backs every payout in a market. Two markets can show the same
            probability and behave completely differently if their depth differs. Rows are rounded
            to two decimals while the totals above are summed from exact amounts, so adding a
            column by hand can differ in the last digit.
          </span>
        </p>
      </Panel>
    </div>
  );
}

function MarketRow({
  market,
  trades,
  candles,
}: {
  market: MarketSummary;
  trades: Query<Trade[]> | undefined;
  candles: Query<Candle[]> | undefined;
}) {
  // The live mode, not a guess. A cell that names the wrong mode is worse than
  // one that names none: it sends a reader to a source that would not help.
  const {mode} = useDataSource();
  const decimals = market.collateral.decimals;
  return (
    <tr className="group border-t border-border hover:bg-bg-sunken/50">
      <th scope="row" className="max-w-[380px] px-4 py-4 text-left font-normal">
        {/*
          A null question is not a market without a question: only `specRoot` is
          on chain, and the text it commits to lives in 0G Storage. Rendering it
          raw left this cell blank, which is the same lie as a zero — it read as
          a market with no name. The address is the identity that IS known, so
          the row stays usable and the explanation sits beneath it.
        */}
        <Link href={`/market/${market.address}`} className="block">
          <span
            className={`leading-snug font-semibold text-text group-hover:text-accent ${
              market.question === null ? "font-mono text-[12px]" : "text-[13px]"
            }`}
          >
            {market.question ?? shortAddress(market.address)}
          </span>
          <span className="mt-1 block font-mono text-[10px] text-text-faint">
            {market.category}
          </span>
        </Link>
        {market.question === null && (
          <span className="mt-1.5 inline-block">
            <Unavailable capability="MARKET_SPEC_BLOB" mode={mode} compact />
          </span>
        )}
      </th>
      <td className="px-3 py-4 text-right font-mono font-medium">
        {formatProbability(probabilityWad(market.q, 1))}
      </td>
      <td className="px-3 py-4 text-right">
        <DeltaCell candles={candles} />
      </td>
      <td className="px-3 py-4 text-right font-mono">
        <VolumeCell trades={trades} collateral={market.collateral} />
      </td>
      <td className="px-3 py-4 text-right font-mono text-text-muted">
        {formatCollateral(toTokensFloor(market.poolWad, decimals), decimals)}
      </td>
      <td className="px-3 py-4">
        <Badge tone="neutral" label={market.tier} />
      </td>
      <td className="px-3 py-4">
        <Badge tone={statusTone(market.status)} label={market.status} dot />
      </td>
      <td
        className="px-3 py-4 text-right font-mono text-[12px] text-text-muted"
        title={formatTimestamp(market.tradingEnd)}
      >
        {/* A countdown is only meaningful while trading is still open; on a
            closed market it would read "closed", which the status badge on this
            same row already says. */}
        {market.status === "Open" ? (
          <Countdown until={market.tradingEnd} />
        ) : (
          formatTimestamp(market.tradingEnd)
        )}
      </td>
      <td className="px-4 py-4 text-right">
        <ChevronRight
          size={15}
          aria-hidden
          className="ml-auto text-text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
        />
      </td>
    </tr>
  );
}

function DeltaCell({candles}: {candles: Query<Candle[]> | undefined}): React.JSX.Element {
  if (candles === undefined) return <Skeleton className="h-3 w-12" />;
  switch (candles.status) {
    case "ready": {
      const delta = delta24h(candles.data);
      if (delta === null) {
        return (
          <span className="text-[11px] whitespace-nowrap text-text-faint">not enough history</span>
        );
      }
      const tone =
        delta.deltaWad > 0n ? "text-pos" : delta.deltaWad < 0n ? "text-neg" : "text-text-muted";
      return (
        <span
          // nowrap: the value and its unit are one figure, and "+0.5" on one
          // line above "pt" on the next reads as two.
          className={`font-mono whitespace-nowrap ${tone}`}
          // The header says 24h; this says what was actually measured. A market
          // four hours old has no 24-hour move, and reporting one would be false.
          title={`Measured over ${formatCountdown(delta.spanSeconds)} of recorded history`}
        >
          {formatProbabilityDelta(0n, delta.deltaWad)}
        </span>
      );
    }
    case "unavailable":
      return <Unavailable capability={candles.capability} mode={candles.mode} compact />;
    case "error":
      return <span className="text-[11px] text-neg">failed</span>;
    case "loading":
      return <Skeleton className="h-3 w-12" />;
  }
}

function VolumeCell({
  trades,
  collateral,
}: {
  trades: Query<Trade[]> | undefined;
  collateral: CollateralInfo;
}): React.JSX.Element {
  if (trades === undefined) return <Skeleton className="h-3 w-16" />;
  switch (trades.status) {
    case "ready":
      return <>{formatCollateral(volumeOf(trades.data), collateral.decimals)}</>;
    case "unavailable":
      return <Unavailable capability={trades.capability} mode={trades.mode} compact />;
    case "error":
      return <span className="text-[11px] text-neg">failed</span>;
    case "loading":
      return <Skeleton className="h-3 w-16" />;
  }
}

function SummaryTiles({markets, trades}: {markets: MarketSummary[]; trades: Query<Trade[]>[]}) {
  const open = markets.filter((m) => m.status === "Open").length;

  // Summing across markets is only meaningful when they share a collateral:
  // adding a 6-decimal token to an 18-decimal one produces a number that means
  // nothing. The fixtures all use mUSDC, but the type does not promise that.
  const collaterals = new Set(markets.map((m) => `${m.collateral.symbol}:${m.collateral.decimals}`));
  const single = collaterals.size === 1 ? markets[0]?.collateral : undefined;

  const depth = single
    ? markets.reduce((sum, m) => sum + toTokensFloor(m.poolWad, single.decimals), 0n)
    : null;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label="Indexed markets" value={String(markets.length).padStart(2, "0")} />
      <Tile label="Open now" value={String(open).padStart(2, "0")} />
      <Tile
        label={single ? `Total depth · ${single.symbol}` : "Total depth"}
        value={
          depth === null || single === undefined ? (
            <span className="text-[13px] text-text-muted">mixed collateral</span>
          ) : (
            formatCollateral(depth, single.decimals)
          )
        }
      />
      <Tile
        label={single ? `Volume · ${single.symbol}` : "Volume"}
        value={<TotalVolume trades={trades} collateral={single} />}
      />
    </div>
  );
}

/**
 * A partial sum would understate the total while looking like the whole of it,
 * so this reports a number only when EVERY market's tape has arrived. One
 * unavailable tape makes the aggregate unknowable, not smaller.
 */
function TotalVolume({
  trades,
  collateral,
}: {
  trades: Query<Trade[]>[];
  collateral: CollateralInfo | undefined;
}): React.JSX.Element {
  if (collateral === undefined) {
    return <span className="text-[13px] text-text-muted">mixed collateral</span>;
  }
  const missing = trades.find((t) => t.status === "unavailable");
  if (missing?.status === "unavailable") {
    return <Unavailable capability={missing.capability} mode={missing.mode} compact />;
  }
  if (trades.some((t) => t.status === "error")) {
    return <span className="text-[13px] text-neg">failed</span>;
  }
  if (trades.length === 0 || trades.some((t) => t.status !== "ready")) {
    return <Skeleton className="h-5 w-24" />;
  }
  const total = trades.reduce(
    (sum, t) => sum + (t.status === "ready" ? volumeOf(t.data) : 0n),
    0n,
  );
  return <>{formatCollateral(total, collateral.decimals)}</>;
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

function Select({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  allLabel: string;
}) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select
        data-testid={`filter-${label.toLowerCase()}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-md border border-border bg-bg px-2 text-[12px] text-text"
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Filters and sort live in the URL so a view can be shared or bookmarked; the
 * free-text search stays local, because a half-typed query is not a view worth
 * sharing and writing it on every keystroke would flood the history stack.
 */
function useListParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === "") next.delete(key);
    else next.set(key, value);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {scroll: false});
  }

  const sort = params.get("sort");
  return {
    category: params.get("category") ?? "",
    status: params.get("status") ?? "",
    tier: params.get("tier") ?? "",
    sort: (SORTS.some((s) => s.key === sort) ? sort : "volume") as SortKey,
    set,
  };
}

/** Unknown volume sorts LAST rather than as zero — it is not a small number. */
function compareRows(
  a: MarketSummary,
  b: MarketSummary,
  sort: SortKey,
  volumes: Map<string, bigint | null>,
): number {
  if (sort === "closing") return a.tradingEnd - b.tradingEnd;
  if (sort === "newest") {
    // A market whose creation time is unknown sorts after every market that has
    // one, and unknowns keep their incoming order relative to each other. That
    // order is not arbitrary: `MarketFactory.marketAt` is an append-only array, so
    // the source can preserve creation ORDER even where it cannot supply a
    // timestamp.
    if (a.createdAt === null && b.createdAt === null) return 0;
    if (a.createdAt === null) return 1;
    if (b.createdAt === null) return -1;
    return b.createdAt - a.createdAt;
  }
  const va = volumes.get(a.address) ?? null;
  const vb = volumes.get(b.address) ?? null;
  if (va === null && vb === null) return 0;
  if (va === null) return 1;
  if (vb === null) return -1;
  return va === vb ? 0 : vb > va ? 1 : -1;
}
