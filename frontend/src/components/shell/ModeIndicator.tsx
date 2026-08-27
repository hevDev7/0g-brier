"use client";

import {Database} from "lucide-react";
import {useDataSource} from "@/hooks/provider";
import type {DataMode} from "@/lib/data/types";

const DESCRIPTION: Record<DataMode, string> = {
  mock: "fixture data, not a live market",
  chain: "read directly from 0G Chain",
  indexer: "chain state plus indexed history",
};

/**
 * Which source produced the numbers on screen, stated in the chrome rather than
 * left to be inferred.
 *
 * This is not decoration. A reader looking at a page full of `unavailable`
 * cells needs to know which mode produced them, and a reader looking at `mock`
 * needs to know the figures are fixtures. `mock` therefore gets the same `warn`
 * treatment as a simulated settlement receipt: simulated data must never be
 * mistaken for real data.
 */
export function ModeIndicator() {
  const {mode} = useDataSource();
  const isFixture = mode === "mock";
  return (
    <span
      data-testid="mode-indicator"
      title={DESCRIPTION[mode]}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] tracking-[0.08em] whitespace-nowrap uppercase ${
        isFixture ? "border-warn/40 bg-warn/10 text-warn" : "border-border text-text-muted"
      }`}
    >
      <Database size={11} aria-hidden />
      <span>{isFixture ? "Mock source · fixture data" : `${mode} source`}</span>
    </span>
  );
}
