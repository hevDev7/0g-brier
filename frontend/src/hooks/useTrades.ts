"use client";

import {useQuery} from "@tanstack/react-query";
import {toQuery} from "./toQuery";
import {useDataSource} from "./provider";
import type {Query, Trade} from "@/lib/data/types";

export function useTrades(address: `0x${string}`, limit: number): Query<Trade[]> {
  const source = useDataSource();
  const result = useQuery({
    queryKey: ["trades", source.mode, address, limit],
    queryFn: () => source.getTrades(address, limit),
  });
  return toQuery(result, source.mode);
}
