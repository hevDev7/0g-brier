import {payoutPerShareWad} from "@/lib/dpm-view";
import {formatPayout} from "@/lib/format";
import type {MarketDetail, SettlementReceipt} from "@/lib/data/types";

/**
 * Verdict komite: pemenang dan kurs payout per lembar untuknya.
 *
 * Kurs WAJIB dari `payoutPerShareWad` (1/p_i), tidak pernah 1/P_i — memakai
 * probabilitas alih-alih harga melebih-lebihkan payout sekitar 30% pada skew
 * biasa, persis arah yang merugikan pembaca yang mempercayainya. Draf pertama
 * spec proyek ini sendiri pernah melakukan kesalahan itu; lihat dpm-view.ts.
 */
export function FinalOutcome({receipt, market}: {receipt: SettlementReceipt; market: MarketDetail}) {
  const outcome = receipt.outcome;

  // outcome null berarti mode ini BELUM TAHU keputusan akhir — belum
  // diselesaikan, bukan "NO" dan bukan panel kosong tak berpenjelasan. Sama
  // seperti `unavailable` di Query<T>: ketidaktahuan dirender apa adanya.
  if (outcome === null) {
    return (
      <div data-testid="final-outcome" className="rounded-lg border border-border p-4">
        <h2 className="mb-1 text-[12px] uppercase tracking-wide text-text-faint">Hasil akhir</h2>
        <p className="text-[13px] text-text-muted">Belum diselesaikan — resolusi komite belum tersedia.</p>
      </div>
    );
  }

  const label = outcome === 1 ? "YES" : "NO";
  const payout = payoutPerShareWad(market.q, outcome);

  return (
    <div data-testid="final-outcome" className="flex flex-col gap-3 rounded-lg border border-border p-4">
      {receipt.simulated && (
        <div
          data-testid="final-outcome-simulated"
          role="status"
          className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-warn"
        >
          Hasil simulasi — bukan resolusi sungguhan dari komite AI
        </div>
      )}

      <h2 className="text-[12px] uppercase tracking-wide text-text-faint">Hasil akhir</h2>

      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-text-muted">Pemenang</span>
        <span data-testid="winner" className="text-[28px] leading-none text-text">
          {label}
        </span>
      </div>

      <div className="flex items-baseline justify-between border-t border-border pt-3">
        <span className="text-[13px] text-text-muted">Payout per lembar</span>
        <span data-testid="payout" className="text-[15px] text-text">
          {formatPayout(payout)}
        </span>
      </div>
    </div>
  );
}
