import {Layers} from "lucide-react";
import {dpm} from "@brier/protocol";
import {Panel, PanelHeader} from "@/components/primitives/Panel";
import {Unavailable} from "@/components/primitives/Unavailable";
import {formatPricePerShare, formatShares, shortAddress} from "@/lib/format";
import type {DataMode, MarketDetail, Position} from "@/lib/data/types";

/**
 * The observation desk: who holds what, at what price. This is what replaces the
 * order ticket as the market page's main content — the human's question changes
 * from "how much do I buy" to "who holds what, and at what price".
 *
 * "Current price" is `dpm.price(market.q, outcome)` — the price per share in
 * collateral units, directly comparable with the entry price an agent paid. It
 * is NOT the probability (p_i^2, which lives in the probability panel via
 * `probabilityWad`): labelling it with a percent sign would break the rule this
 * project has already broken once in its own spec draft.
 *
 * Only "Entry price" can be unknown: only events record what was paid, so
 * `chain` mode returns `entryPriceWad: null`. That CELL renders
 * `<Unavailable capability="COST_BASIS">` while the other four stay populated —
 * the per-row rule (spec §2) applied at the level of a cell.
 */
export function PositionsTable({
  positions,
  market,
  mode,
}: {
  positions: Position[];
  market: MarketDetail;
  mode: DataMode;
}) {
  return (
    <Panel testId="positions-table" className="overflow-hidden">
      <PanelHeader eyebrow="Observed exposure" title="Agent positions" icon={Layers} />
      {positions.length === 0 ? (
        <p className="px-4 py-8 text-center text-[13px] text-text-muted md:px-5">
          {/* Deliberately one text node — getByText joins only an element's
              DIRECT text nodes and does not descend into children. */}
          <span>No positions in this market yet.</span>
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-left text-[13px]">
            <caption className="sr-only">
              Agent holdings in this market, with the price each paid and the price now.
            </caption>
            <thead className="bg-bg-sunken/60 text-[10px] tracking-[0.12em] text-text-faint uppercase">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Agent
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  Side
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">
                  Shares
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">
                  Entry price
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Current price
                </th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position, index) => {
                // The current price does not depend on what the agent paid — it
                // is the pool's state NOW, so it comes straight from market.q
                // and is populated in every mode.
                const currentPriceWad = dpm.price(market.q, position.outcome);
                return (
                  <tr
                    key={`${position.agent}-${position.outcome}-${index}`}
                    className="border-t border-border"
                  >
                    <td className="px-4 py-2.5 font-mono text-[11px] text-text-muted">
                      {shortAddress(position.agent)}
                    </td>
                    <td
                      className={`px-3 py-2.5 font-mono text-[11px] font-medium ${
                        position.outcome === 1 ? "text-pos" : "text-neg"
                      }`}
                    >
                      {position.outcome === 1 ? "YES" : "NO"}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono">
                      {formatShares(position.shares)}
                    </td>
                    <td data-testid="entry" className="px-3 py-2.5 text-right font-mono">
                      {position.entryPriceWad === null ? (
                        <Unavailable capability="COST_BASIS" mode={mode} compact />
                      ) : (
                        formatPricePerShare(position.entryPriceWad)
                      )}
                    </td>
                    <td data-testid="current" className="px-4 py-2.5 text-right font-mono">
                      {formatPricePerShare(currentPriceWad)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-border bg-bg-sunken/40 px-4 py-2 text-[10px] text-text-muted md:px-5">
        Prices are per share in {market.collateral.symbol}, not probabilities.
      </p>
    </Panel>
  );
}
