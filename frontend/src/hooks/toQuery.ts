import type {UseQueryResult} from "@tanstack/react-query";
import {CapabilityUnavailableError, type DataMode, type Query} from "@/lib/data/types";

/** Menerjemahkan keadaan TanStack jadi union kita, dengan `unavailable` sebagai cabang tersendiri. */
export function toQuery<T>(result: UseQueryResult<T>, mode: DataMode): Query<T> {
  if (result.isPending) return {status: "loading"};
  if (result.error) {
    const error = result.error;
    if (error instanceof CapabilityUnavailableError) {
      return {status: "unavailable", capability: error.capability, mode: error.mode};
    }
    return {status: "error", error: error as Error};
  }
  return {status: "ready", data: result.data as T};
}
