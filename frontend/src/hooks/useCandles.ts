"use client";
import {useQuery} from "@tanstack/react-query";
import {useDataSource} from "@/hooks/provider";
import {toQuery} from "@/hooks/toQuery";
import type {Candle, Interval, Query} from "@/lib/data/types";

export function useCandles(address: `0x${string}`, interval: Interval): Query<Candle[]> {
  const src = useDataSource();
  return toQuery(useQuery({
      queryKey: ["candles", src.mode, address, interval],
      queryFn: () => src.getCandles(address, interval),
    }));
}
