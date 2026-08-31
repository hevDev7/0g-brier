"use client";

import {Activity, Layers} from "lucide-react";
import {useState} from "react";
import {Panel} from "@/components/primitives/Panel";
import {ErrorNote} from "@/components/primitives/QueryStates";
import {SkeletonRows} from "@/components/primitives/Skeleton";
import {Unavailable} from "@/components/primitives/Unavailable";
import {PositionsBody} from "@/components/market/PositionsTable";
import {TradeTapeBody} from "@/components/market/TradeTape";
import type {CollateralInfo, DataMode, MarketDetail, Position, Query, Trade} from "@/lib/data/types";

/**
 * Two tables, one panel, two tabs.
 *
 * THEY ARE NOT MERGED, AND THEY CANNOT BE. Positions are state — one row per
 * (agent, side), a balance, with no natural order. Trades are events — one row
 * per transaction, newest first — and an agent who traded five times has five of
 * them and one position. A single table over the union of both column sets would
 * leave every row half empty, and in this application an empty cell is not blank
 * space: it renders `Unavailable`, which asserts "this could not be obtained".
 * Dozens of cells would claim failure where the truth is "does not apply", which
 * is a worse confusion than the one being fixed.
 *
 * The column names collide while the meanings do not — `Shares` is a balance in
 * one table and a single trade's delta in the other — so one header spanning both
 * would be the most misleading merge available.
 *
 * WHAT WAS ACTUALLY WRONG was the chrome. Two panels, identical styling, three
 * overlapping column names, stacked one above the other: they read as the same
 * thing said twice. So the container is merged and the rows are not, and each tab
 * is titled by the question it answers rather than by what its data is called.
 *
 * BOTH TABPANELS STAY MOUNTED, the inactive one `hidden` — the ARIA tabs pattern,
 * and it also means switching back does not lose the filter.
 */
export function MarketActivity({
  positions,
  trades,
  market,
  mode,
  collateral,
}: {
  positions: Query<Position[]>;
  trades: Query<Trade[]>;
  market: MarketDetail;
  mode: DataMode;
  collateral: CollateralInfo;
}) {
  const [tab, setTab] = useState<"holdings" | "activity">("holdings");
  const [agent, setAgent] = useState<string | null>(null);

  // Picking an agent is a question about the tape, so it moves there. Applying a
  // filter to a panel the reader cannot see would look like nothing happened.
  function showAgent(next: string) {
    setAgent(next);
    setTab("activity");
  }

  const tabs = [
    {id: "holdings" as const, label: "Who holds what", icon: Layers},
    {id: "activity" as const, label: "What happened", icon: Activity},
  ];

  return (
    <Panel testId="market-activity" className="overflow-hidden">
      <div
        role="tablist"
        aria-label="Market participation"
        className="flex items-stretch gap-1 border-b border-border bg-bg-sunken/40 px-2"
      >
        {tabs.map(({id, label, icon: Icon}) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            onClick={() => setTab(id)}
            className={`-mb-px flex cursor-pointer items-center gap-2 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors ${
              tab === id ? "border-accent text-text" : "border-transparent text-text-muted hover:text-text"
            }`}
          >
            <Icon className="size-3.5" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="panel-holdings" aria-labelledby="tab-holdings" hidden={tab !== "holdings"}>
        {/* The testId marks A TABLE, not a slot where one might go. Hanging it on a
            wrapper that always renders would make "the positions are shown" and
            "the positions could not be obtained" indistinguishable to anything
            looking for it — the very confusion `Unavailable` exists to prevent,
            reintroduced one level up. */}
        {positions.status === "ready" ? (
          <div data-testid="positions-table">
            <PositionsBody
              positions={positions.data}
              market={market}
              mode={mode}
              onSelectAgent={trades.status === "ready" ? showAgent : undefined}
            />
          </div>
        ) : positions.status === "unavailable" ? (
          <Unavailable capability={positions.capability} mode={positions.mode} />
        ) : positions.status === "error" ? (
          <ErrorNote error={positions.error} what="the positions" />
        ) : (
          <SkeletonRows rows={4} cols={5} />
        )}
      </div>

      <div role="tabpanel" id="panel-activity" aria-labelledby="tab-activity" hidden={tab !== "activity"}>
        {trades.status === "ready" ? (
          <div data-testid="trade-tape">
            <TradeTapeBody
              trades={trades.data}
              collateral={collateral}
              filterAgent={agent}
              onClearFilter={() => setAgent(null)}
            />
          </div>
        ) : trades.status === "unavailable" ? (
          <Unavailable capability={trades.capability} mode={trades.mode} />
        ) : trades.status === "error" ? (
          <ErrorNote error={trades.error} what="the trade tape" />
        ) : (
          <SkeletonRows rows={5} cols={5} />
        )}
      </div>
    </Panel>
  );
}
