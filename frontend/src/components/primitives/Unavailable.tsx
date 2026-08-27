import type {Capability, DataMode} from "@/lib/data/types";

const LABELS: Record<Capability, string> = {
  LIST_MARKETS: "Daftar market",
  MARKET_STATE: "Keadaan market",
  QUOTE: "Kuotasi",
  EXECUTE: "Eksekusi",
  PRICE_HISTORY: "Riwayat harga",
  TRADE_TAPE: "Riwayat transaksi",
};

/** Mode paling ringan yang menyediakan kemampuan ini. */
const PROVIDED_BY: Record<Capability, DataMode> = {
  LIST_MARKETS: "chain",
  MARKET_STATE: "chain",
  QUOTE: "chain",
  EXECUTE: "chain",
  PRICE_HISTORY: "indexer",
  TRADE_TAPE: "indexer",
};

/**
 * Wujud visual dari aturan bahwa UI tidak pernah merender angka yang mode saat
 * ini tidak bisa ketahui. Bukan spinner (data tidak sedang datang), bukan nol
 * (itu klaim yang salah), bukan strip telanjang (itu tidak menjelaskan apa pun).
 */
export function Unavailable({capability, mode}: {capability: Capability; mode: DataMode}) {
  return (
    <div className="rounded-md border border-dashed border-border px-3 py-2 text-[13px] text-text-muted">
      {/* Label dan "tidak tersedia" sengaja satu node teks: getByText hanya
          menggabungkan node teks LANGSUNG suatu elemen (lihat get-node-text.js),
          tidak turun ke elemen anak — jadi frasa yang perlu cocok bersama
          sebagai satu string tidak boleh terpisah lintas elemen. */}
      <span className="text-text">{LABELS[capability]} tidak tersedia</span> di mode{" "}
      <span className="font-mono">{mode}</span> — sumber ini tidak menyimpan riwayat. Tersedia di
      mode <span className="font-mono">{PROVIDED_BY[capability]}</span>.
    </div>
  );
}
