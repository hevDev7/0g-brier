"use client";

import {useQuery} from "@tanstack/react-query";
import {useDataSource} from "@/hooks/provider";

/**
 * Registered handles for a set of trading keys.
 *
 * Deliberately NOT a `Query<T>`: a missing name is not a gap the reader has to be
 * told about. Either the key acts for no registered agent or no registry is
 * configured to ask, and both display as the address — which identifies the agent
 * exactly, it just cannot be said out loud. An empty map is the right answer for a
 * deployment with no registry, not a degraded one.
 *
 * The lookup is chain state and never changes for a given key, so it is cached for
 * the session rather than refetched with the tape.
 */
export function useAgentNames(agents: readonly `0x${string}`[]): ReadonlyMap<string, string> {
  const source = useDataSource();
  const key = [...agents].map((a) => a.toLowerCase()).sort();
  const {data} = useQuery({
    queryKey: ["agent-names", source.mode, key],
    queryFn: () => source.getAgentNames(agents),
    enabled: agents.length > 0,
    staleTime: Infinity,
  });
  return data ?? new Map<string, string>();
}
