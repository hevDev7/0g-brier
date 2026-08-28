"use client";

import {useQuery} from "@tanstack/react-query";
import {toQuery} from "./toQuery";
import {useDataSource} from "./provider";
import type {Query, SettlementReceipt} from "@/lib/data/types";

export function useReceipt(address: `0x${string}`): Query<SettlementReceipt | null> {
  const source = useDataSource();
  const result = useQuery({
    queryKey: ["receipt", source.mode, address],
    queryFn: () => source.getReceipt(address),
  });
  return toQuery(result);
}
