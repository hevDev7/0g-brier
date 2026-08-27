"use client";

import {useQuery} from "@tanstack/react-query";
import {toQuery} from "./toQuery";
import {useDataSource} from "./provider";
import type {MarketDetail, Query} from "@/lib/data/types";

export function useMarket(address: `0x${string}`): Query<MarketDetail> {
  const source = useDataSource();
  const result = useQuery({
    queryKey: ["market", source.mode, address],
    queryFn: () => source.getMarket(address),
  });
  return toQuery(result);
}
