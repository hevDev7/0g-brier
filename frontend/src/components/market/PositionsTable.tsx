import {dpm} from "@0g-delphi/protocol";
import {Unavailable} from "@/components/primitives/Unavailable";
import {formatPricePerShare, formatShares, shortAddress} from "@/lib/format";
import type {DataMode, MarketDetail, Position} from "@/lib/data/types";

/**
 * Meja observasi: siapa memegang apa, pada harga berapa. Ini menggantikan
 * order ticket di pentingnya halaman market — UI manusia hanya mengamati
 * (spec §1 F3); seluruh eksekusi hidup di @0g-delphi/agent-kit, bukan di sini.
 *
 * "Harga sekarang" adalah `dpm.price(market.q, outcome)` — harga per lembar
 * dalam satuan collateral, sebanding langsung dengan harga masuk yang dibayar
 * agent. BUKAN probabilitas (p_i^2, yang hidup di panel probabilitas, lewat
 * `probabilityWad`): memberi label persen padanya melanggar Global
 * Constraints. Draf pertama spec proyek ini sendiri pernah mengirim
 * kebingungan harga-vs-probabilitas yang sama.
 *
 * Hanya kolom "Harga masuk" yang bisa tidak diketahui: hanya event yang
 * menyimpan apa yang dibayar, jadi mode `chain` mengembalikan
 * `entryPriceWad: null`. Sel itu merender `<Unavailable capability=
 * "COST_BASIS">` sementara empat kolom lain tetap terisi — penerapan aturan
 * per-baris (spec §2) di tingkat SEL, bukan panel: baris itu sendiri, dan
 * harga sekarangnya, tetap sepenuhnya diketahui terlepas dari mode.
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
        {/* Satu node teks dengan sengaja — getByText hanya menggabungkan node
            teks LANGSUNG suatu elemen, tidak turun ke elemen anak (lihat
            Unavailable.tsx untuk kejadian yang sama). */}
        <span>Belum ada posisi di market ini.</span>
      </div>
    );
  }

  return (
    <div data-testid="positions-table" className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-[13px]">
        <thead className="bg-bg-sunken text-[11px] uppercase tracking-wide text-text-faint">
          <tr>
            {["Agent", "Sisi", "Lembar", "Harga masuk", "Harga sekarang"].map((h) => (
              <th key={h} className="px-3 py-2 text-left font-medium last:text-right">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {positions.map((p, i) => {
            // Harga sekarang tidak bergantung pada apa yang dibayar agent —
            // ia keadaan pool SAAT INI, jadi dihitung langsung dari
            // market.q dan selalu terisi, di mode manapun.
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
