import {payoutPerShareWad} from "@/lib/dpm-view";
import {formatPayout} from "@/lib/format";

/**
 * Payout DPM didanai seluruhnya oleh pool, dan konsekuensinya payout milik
 * pembeli awal terdilusi oleh pembeli belakangan. Menyembunyikan itu membuat
 * halaman ini berbohong tentang instrumen yang dijualnya — karena itu
 * pengungkapannya ada di sini dan diulang di tiket order sebelum konfirmasi.
 */
export function PayoutPanel({q}: {q: readonly [bigint, bigint]}) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <div className="flex flex-col gap-1.5">
        {([1, 0] as const).map((outcome) => (
          <div key={outcome} className="flex items-baseline justify-between">
            <span className="text-[13px] text-text-muted">
              Payout jika {outcome === 1 ? "YES" : "NO"} menang
            </span>
            <span className="text-[15px] text-text">
              {/* Nilai dibungkus elemen sendiri: tanpa ini ia berbagi node teks
                  dengan " per lembar" dan tidak pernah cocok dengan pencarian
                  teks persis atas string payout saja. */}
              <span>{formatPayout(payoutPerShareWad(q, outcome))}</span> per lembar
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 border-t border-border pt-3 text-[12px] leading-relaxed text-warn">
        Payout mengambang sampai market tutup. Semakin banyak yang membeli sisi yang sama denganmu,
        semakin kecil payout per lembarmu. Jual kapan saja untuk mengunci harga saat ini.
      </p>
    </div>
  );
}
