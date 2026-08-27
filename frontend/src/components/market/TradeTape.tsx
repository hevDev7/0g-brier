import {formatCollateral, formatProbability, formatShares, shortAddress} from "@/lib/format";
import type {CollateralInfo, Trade} from "@/lib/data/types";

export function TradeTape({trades, collateral}: {trades: Trade[]; collateral: CollateralInfo}) {
  return (
    <div data-testid="trade-tape" className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-[13px]">
        <thead className="bg-bg-sunken text-[11px] uppercase tracking-wide text-text-faint">
          <tr>
            {["Waktu", "Sisi", "Lembar", collateral.symbol, "P(YES)"].map((h) => (
              <th key={h} className="px-3 py-2 text-left font-medium last:text-right">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.id} className="border-t border-border">
              <td className="px-3 py-2 text-text-muted">
                {new Date(t.timestamp * 1000).toISOString().slice(11, 16)}
              </td>
              <td className={`px-3 py-2 ${t.outcome === 1 ? "text-pos" : "text-neg"}`}>
                {t.outcome === 1 ? "YES" : "NO"}
              </td>
              <td className="px-3 py-2">{formatShares(t.sharesDelta)}</td>
              <td className="px-3 py-2">{formatCollateral(t.tokens, collateral.decimals)}</td>
              <td className="px-3 py-2 text-right text-text-muted">
                {formatProbability(t.probAfterWad)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-border px-3 py-1.5 text-[11px] text-text-faint">
        {trades.length} transaksi terakhir · trader {shortAddress(trades[0]?.trader ?? "0x")}…
      </div>
    </div>
  );
}
