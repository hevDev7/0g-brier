"use client";
import {useQuery} from "@tanstack/react-query";
import {useDataSource} from "@/hooks/provider";
import {toQuery} from "@/hooks/toQuery";
import type {Position, Query} from "@/lib/data/types";

export function usePositions(address: `0x${string}`): Query<Position[]> {
  const src = useDataSource();
  return toQuery(useQuery({
      queryKey: ["positions", src.mode, address],
      queryFn: () => src.getPositions(address),
    }));
}
