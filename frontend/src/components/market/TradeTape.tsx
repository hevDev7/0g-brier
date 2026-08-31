import {Activity} from "lucide-react";
import {Panel, PanelHeader} from "@/components/primitives/Panel";
import {formatCollateral, formatProbability, formatShares, shortAddress} from "@/lib/format";
import type {CollateralInfo, Trade} from "@/lib/data/types";

/**
 * P(YES) here is `Trade.probYesAfterWad`, which is already a probability and is
 * always the YES side whichever side was traded — the state the market was left
 * in by that trade. The newest row therefore agrees
 * with the probability panel by construction, not by coincidence; the fixtures
 * are built to converge on the market's q for exactly that reason.
 */
export function TradeTape(props: {trades: Trade[]; collateral: CollateralInfo}) {
  return (
    <Panel testId="trade-tape" className="overflow-hidden">
      <PanelHeader eyebrow="Recent activity" title="Trade tape" icon={Activity} />
      <TradeTapeBody {...props} />
    </Panel>
  );
}

/**
 * The tape without a Panel around it, and optionally narrowed to one agent.
 *
 * FILTERING IS STATED, NEVER IMPLIED. A tape showing four of nine trades looks
 * exactly like a market that had four trades, and the difference matters — this
 * panel is evidence about what happened. So a narrowed tape says whose trades
 * these are, how many it is hiding, and offers the way back.
 */
export function TradeTapeBody({
  trades,
  collateral,
  filterAgent,
  onClearFilter,
}: {
  trades: Trade[];
  collateral: CollateralInfo;
  filterAgent?: string | null;
  onClearFilter?: () => void;
}) {
  const shown =
    filterAgent == null
      ? trades
      : trades.filter((t) => t.trader.toLowerCase() === filterAgent.toLowerCase());
  return (
    <>
      {filterAgent != null && (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-bg-sunken/40 px-4 py-2 text-[12px] md:px-5">
          <span className="text-text-muted">
            Showing <span className="font-mono text-text">{shortAddress(filterAgent)}</span> only —{" "}
            {shown.length} of {trades.length} trades.
          </span>
          {onClearFilter !== undefined && (
            <button
              type="button"
              onClick={onClearFilter}
              className="cursor-pointer text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
            >
              Show all
            </button>
          )}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="px-4 py-8 text-center text-[14px] text-text-muted md:px-5">
          <span>
              {filterAgent == null
                ? "No trades recorded in this market yet."
                : "This agent has no trades in this market."}
            </span>
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[14px]">
            <caption className="sr-only">
              The most recent trades, newest first, with the probability each one left behind.
            </caption>
            <thead className="bg-bg-sunken/60 text-[11px] tracking-[0.12em] text-text-faint uppercase">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Time
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  Agent
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  Side
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">
                  Shares
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">
                  {collateral.symbol}
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  P(YES) after
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((trade) => (
                <tr key={trade.id} className="border-t border-border">
                  <td className="px-4 py-2.5 font-mono text-[12px] text-text-muted">
                    {new Date(trade.timestamp * 1000).toISOString().slice(11, 16)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[12px] text-text-muted">
                    {shortAddress(trade.trader)}
                  </td>
                  <td
                    className={`px-3 py-2.5 font-mono text-[12px] font-medium ${
                      trade.outcome === 1 ? "text-pos" : "text-neg"
                    }`}
                  >
                    {trade.outcome === 1 ? "YES" : "NO"}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    {formatShares(trade.sharesDelta)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    {formatCollateral(trade.tokens, collateral.decimals)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-text-muted">
                    {formatProbability(trade.probYesAfterWad)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-border bg-bg-sunken/40 px-4 py-2 text-[11px] text-text-muted md:px-5">
        Times are UTC. Every trade here was executed by an agent through the SDK.
      </p>
    </>
  );
}
