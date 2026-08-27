import {dpm} from "@0g-delphi/protocol";
import {Unavailable} from "@/components/primitives/Unavailable";
import {formatPricePerShare, formatShares, shortAddress} from "@/lib/format";
import type {DataMode, MarketDetail, Position} from "@/lib/data/types";

/**
 * The observation desk: who holds what, at what price. This takes the order
 * ticket's place in the market page's importance — the human UI only observes
 * (spec §1 F3); all execution lives in @0g-delphi/agent-kit, not here.
 *
 * "Current price" is `dpm.price(market.q, outcome)` — a price per share in
 * collateral units, directly comparable to the entry price an agent paid. NOT
 * the probability (p_i^2, which lives in the probability panel, via
 * `probabilityWad`): labelling it with a percent sign breaks the Global
 * Constraints. This project's own first spec draft once shipped the same
 * price-versus-probability confusion.
 *
 * Only the "Entry price" column can be unknown: only events record what was
 * paid, so `chain` mode returns `entryPriceWad: null`. That cell renders
 * `<Unavailable capability="COST_BASIS">` while the other four columns stay
 * populated — the per-row rule (spec §2) applied at CELL level rather than panel
 * level: the row itself, and its current price, remain fully known whatever the
 * mode.
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
  if (positions.length === 0) {
    return (
      <div
        data-testid="positions-table"
        className="rounded-lg border border-border p-4 text-[13px] text-text-muted"
      >
        {/* One text node deliberately — getByText joins only an element's DIRECT
            text nodes and does not descend into children (see Unavailable.tsx for
            the same case). */}
        <span>No positions in this market yet.</span>
      </div>
    );
  }

  return (
    <div data-testid="positions-table" className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-[13px]">
        <thead className="bg-bg-sunken text-[11px] uppercase tracking-wide text-text-faint">
          <tr>
            {["Agent", "Side", "Shares", "Entry price", "Current price"].map((h) => (
              <th key={h} className="px-3 py-2 text-left font-medium last:text-right">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {positions.map((p, i) => {
            // The current price does not depend on what an agent paid — it is the
            // pool's state RIGHT NOW, so it is computed straight from market.q and
            // is always populated, in any mode.
            const currentPriceWad = dpm.price(market.q, p.outcome);
            return (
              <tr key={`${p.agent}-${p.outcome}-${i}`} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-text-muted">{shortAddress(p.agent)}</td>
                <td className={`px-3 py-2 ${p.outcome === 1 ? "text-pos" : "text-neg"}`}>
                  {p.outcome === 1 ? "YES" : "NO"}
                </td>
                <td className="px-3 py-2">{formatShares(p.shares)}</td>
                <td data-testid="entry" className="px-3 py-2">
                  {p.entryPriceWad === null ? (
                    <Unavailable capability="COST_BASIS" mode={mode} />
                  ) : (
                    formatPricePerShare(p.entryPriceWad)
                  )}
                </td>
                <td data-testid="current" className="px-3 py-2 text-right">
                  {formatPricePerShare(currentPriceWad)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
