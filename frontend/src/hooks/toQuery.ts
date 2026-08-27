import type {UseQueryResult} from "@tanstack/react-query";
import {CapabilityUnavailableError, type Query} from "@/lib/data/types";

/**
 * Translates TanStack's states into our union, with `unavailable` as a branch of
 * its own.
 *
 * Note the mode is NOT taken as a parameter. It comes from the error that was
 * thrown, and that is not a saving but a correction:
 * `CapabilityUnavailableError` carries the mode of THE LAYER THAT ACTUALLY
 * COULD NOT ANSWER. When `IndexerSource` wraps `ChainSource`, the caller's mode
 * and the failing mode can differ — and the one the user deserves to be told
 * about is the one that failed.
 */
export function toQuery<T>(result: UseQueryResult<T>): Query<T> {
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
