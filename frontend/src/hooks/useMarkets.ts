"use client";

import {useQuery} from "@tanstack/react-query";
import {toQuery} from "./toQuery";
import {useDataSource} from "./provider";
import type {MarketSummary, Query} from "@/lib/data/types";

export function useMarkets(): Query<MarketSummary[]> {
  const source = useDataSource();
  const result = useQuery({
    queryKey: ["markets", source.mode],
    queryFn: () => source.listMarkets(),
  });
  return toQuery(result);
}
