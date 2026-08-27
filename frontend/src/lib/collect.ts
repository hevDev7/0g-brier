import type {Capability, DataMode, Query} from "@/lib/data/types";

/**
 * One state for a FAN-OUT of queries, collapsed with the same honesty rules a
 * single `Query<T>` has.
 *
 * The collapse is deliberately pessimistic: one unreadable market makes the
 * whole set unknowable rather than smaller. A partial answer here would
 * understate a total while looking like the whole of it — an agent's book that
 * silently omits one market, a leaderboard that ranks on volume it could only
 * half see. Which capability is reported is the one that actually failed, so the
 * explanation names the real gap.
 */
export type Collected<T> =
  | {kind: "loading"}
  | {kind: "ready"; data: T[]}
  | {kind: "unavailable"; capability: Capability; mode: DataMode}
  | {kind: "error"; error: Error};

export function collect<T>(queries: readonly Query<T>[]): Collected<T> {
  const missing = queries.find((q) => q.status === "unavailable");
  if (missing?.status === "unavailable") {
    return {kind: "unavailable", capability: missing.capability, mode: missing.mode};
  }
  const failed = queries.find((q) => q.status === "error");
  if (failed?.status === "error") return {kind: "error", error: failed.error};
  if (queries.some((q) => q.status !== "ready")) return {kind: "loading"};
  // Every entry is `ready` by here, so the filter is a type narrowing rather
  // than a guard against anything.
  return {kind: "ready", data: queries.flatMap((q) => (q.status === "ready" ? [q.data] : []))};
}
