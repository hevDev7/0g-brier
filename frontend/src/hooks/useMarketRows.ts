"use client";

import {useQueries, type UseQueryResult} from "@tanstack/react-query";
import {toQuery} from "./toQuery";
import {useDataSource} from "./provider";
import type {Candle, Interval, Position, Query, Trade} from "@/lib/data/types";

/**
 * Per-market history for the market list, fanned out one query per market.
 *
 * Two things are deliberate here. First, the fan-out: `listMarkets()` answers
 * MARKET_STATE only, so volume and the 24-hour change have to be fetched per
 * market — and each one carries its OWN status, which is what lets a single
 * row's volume cell read `unavailable` while every other cell on that row stays
 * populated. A single combined query would collapse that to all-or-nothing.
 *
 * Second, the cost: this is O(markets) requests in `chain`/`indexer` mode. That
 * is accepted for v1 (spec risk R1, the same linear-enumeration trade-off the
 * factory already makes); the indexer collapses it to one query in F4.
 */
export function useTradesByMarket(
  addresses: readonly `0x${string}`[],
  limit: number,
): Query<Trade[]>[] {
  const source = useDataSource();
  const results = useQueries({
    queries: addresses.map((address) => ({
      queryKey: ["trades", source.mode, address, limit],
      queryFn: () => source.getTrades(address, limit),
    })),
  });
  return results.map((r) => toQuery(r as UseQueryResult<Trade[]>));
}

export function useCandlesByMarket(
  addresses: readonly `0x${string}`[],
  interval: Interval,
): Query<Candle[]>[] {
  const source = useDataSource();
  const results = useQueries({
    queries: addresses.map((address) => ({
      queryKey: ["candles", source.mode, address, interval],
      queryFn: () => source.getCandles(address, interval),
    })),
  });
  return results.map((r) => toQuery(r as UseQueryResult<Candle[]>));
}

/**
 * Positions for every market, one query each.
 *
 * `DataSource.getPositions` is scoped to a MARKET and returns every agent's
 * holding in it. An agent's book across markets is therefore a composition, not
 * a new capability — which is deliberate: `chain` mode really can read one
 * balance per market, so composing keeps the portfolio page honest in every mode
 * instead of inventing a method only an indexer could serve. `IndexerSource`
 * collapses this into a single indexed query in F4.
 */
export function usePositionsByMarket(
  addresses: readonly `0x${string}`[],
): Query<Position[]>[] {
  const source = useDataSource();
  const results = useQueries({
    queries: addresses.map((address) => ({
      queryKey: ["positions", source.mode, address],
      queryFn: () => source.getPositions(address),
    })),
  });
  return results.map((r) => toQuery(r as UseQueryResult<Position[]>));
}
