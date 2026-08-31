import {Layers} from "lucide-react";
import {dpm, toTokensFloor} from "@0g-brier/protocol";
import {Panel, PanelHeader} from "@/components/primitives/Panel";
import {Unavailable} from "@/components/primitives/Unavailable";
import {formatCollateral, formatPricePerShare, formatShares, shortAddress} from "@/lib/format";
import {payoutPerShareWad} from "@/lib/dpm-view";
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
 *
 * ONCE THE MARKET IS SETTLED the last column stops being a price. The marginal
 * price is still a real number after settlement — `q` has stopped moving, so it
 * is frozen rather than stale — but it is no longer what the row is worth, and
 * it reads as though it were: 73.91 shares beside "0.7413" invites the product,
 * 54.79, when the position actually redeems for 99.70. The winning side pays
 * `1/p` per share, which is the reciprocal, so the error is not small and it
 * runs in the direction that understates. On the losing side the same column
 * quotes a price for shares that are worth nothing at all.
 */
export function PositionsTable(props: {positions: Position[]; market: MarketDetail; mode: DataMode}) {
  return (
    <Panel testId="positions-table" className="overflow-hidden">
      <PanelHeader eyebrow="Observed exposure" title="Agent positions" icon={Layers} />
      <PositionsBody {...props} />
    </Panel>
  );
}

/**
 * The same table without a Panel around it, so it can sit inside one that already
 * exists. `MarketActivity` puts this and the trade tape in a single panel behind
 * two tabs, and nesting a Panel in a Panel would draw two borders and two headers
 * for one thing.
 *
 * `onSelectAgent` is what makes the pairing worth more than shelf space. These two
 * tables share an Agent column and nothing else — one is a balance, the other a
 * sequence of changes — so the only useful link between them is "show me how this
 * holding was built", which is the tape narrowed to one address.
 */
export function PositionsBody({
  positions,
  market,
  mode,
  onSelectAgent,
}: {
  positions: Position[];
  market: MarketDetail;
  mode: DataMode;
  onSelectAgent?: (agent: string) => void;
}) {
  const winner = market.winningOutcome;
  return (
    <>
      {positions.length === 0 ? (
        <p className="px-4 py-8 text-center text-[14px] text-text-muted md:px-5">
          {/* Deliberately one text node — getByText joins only an element's
              DIRECT text nodes and does not descend into children. */}
          <span>No positions in this market yet.</span>
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-left text-[14px]">
            <caption className="sr-only">
              Agent holdings in this market, with the price each paid and the price now.
            </caption>
            <thead className="bg-bg-sunken/60 text-[11px] tracking-[0.12em] text-text-faint uppercase">
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
                  {winner === null ? "Current price" : `Redeems for (${market.collateral.symbol})`}
                </th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position, index) => {
                // The current price does not depend on what the agent paid — it
                // is the pool's state NOW, so it comes straight from market.q
                // and is populated in every mode.
                const currentPriceWad = dpm.price(market.q, position.outcome);
                // shares x payout, both wad, so a wad comes back out — and it
                // still has to be brought down to the collateral's own decimals
                // before `formatCollateral`, which takes the smallest token unit.
                // FLOOR, because money leaving the pool rounds the pool's way,
                // which is the rule `redeem` itself follows on chain.
                const redeemsFor =
                  winner === null
                    ? null
                    : position.outcome === winner
                      ? toTokensFloor(
                          (position.shares * payoutPerShareWad(market.q, winner)) / 10n ** 18n,
                          market.collateral.decimals,
                        )
                      : 0n;
                return (
                  <tr
                    key={`${position.agent}-${position.outcome}-${index}`}
                    className="border-t border-border"
                  >
                    <td className="px-4 py-2.5 font-mono text-[12px] text-text-muted">
                      {onSelectAgent === undefined ? (
                        shortAddress(position.agent)
                      ) : (
                        // A control only where a handler exists. A button that does
                        // nothing is worse than plain text: it advertises an action
                        // the page cannot perform.
                        <button
                          type="button"
                          onClick={() => onSelectAgent(position.agent)}
                          title="Show this agent's trades"
                          className="cursor-pointer underline decoration-border decoration-dotted underline-offset-4 hover:text-text hover:decoration-accent"
                        >
                          {shortAddress(position.agent)}
                        </button>
                      )}
                    </td>
                    <td
                      className={`px-3 py-2.5 font-mono text-[12px] font-medium ${
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
                    <td
                      data-testid="current"
                      className={`px-4 py-2.5 text-right font-mono ${
                        redeemsFor === 0n ? "text-text-faint" : ""
                      }`}
                    >
                      {redeemsFor === null
                        ? formatPricePerShare(currentPriceWad)
                        : formatCollateral(redeemsFor, market.collateral.decimals)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-border bg-bg-sunken/40 px-4 py-2 text-[11px] text-text-muted md:px-5">
        {winner === null
          ? `Prices are per share in ${market.collateral.symbol}, not probabilities.`
          : `${winner === 1 ? "YES" : "NO"} won. Losing shares redeem for nothing; the amounts above are what the winning side can claim, not a price.`}
      </p>
    </>
  );
}
