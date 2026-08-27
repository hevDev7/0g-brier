/**
 * Satu-satunya tempat aturan pemformatan angka hidup (spec §7.2).
 * Komponen tidak boleh memformat angka sendiri: format yang berbeda antar
 * layar adalah cara tercepat sebuah UI angka kehilangan kredibilitas.
 *
 * Semua fungsi bekerja dari bigint ke string secara langsung. Tidak ada
 * Number() maupun parseFloat pada nilai moneter — presisi ganda tidak bisa
 * mewakili nilai wad, dan pembulatan diam-diam pada uang tidak dapat diterima.
 */

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Membulatkan setengah-ke-atas ke `places` desimal, murni bigint. */
function formatFixed(value: bigint, decimals: number, places: number): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const factor = 10n ** BigInt(places);
  const scaled = (magnitude * factor + scale / 2n) / scale;
  const whole = groupThousands((scaled / factor).toString());
  const body = places > 0 ? `${whole}.${(scaled % factor).toString().padStart(places, "0")}` : whole;
  return negative && scaled !== 0n ? `-${body}` : body;
}

/** Probabilitas implisit (p_i^2) dalam wad → "59.0%". */
export function formatProbability(probWad: bigint): string {
  return `${formatFixed(probWad * 100n, 18, 1)}%`;
}

/** Pergeseran probabilitas dalam poin persentase, selalu bertanda. */
export function formatProbabilityDelta(fromWad: bigint, toWad: bigint): string {
  const delta = (toWad - fromWad) * 100n;
  const body = formatFixed(delta, 18, 1);
  // Sign dari `body` yang sudah dibulatkan, bukan dari `delta` mentah:
  // formatFixed menekan tanda minus saat magnitudo membulat ke nol, dan
  // keputusan tanda di sini harus konsisten dengan itu — kalau tidak,
  // pergeseran negatif yang membulat ke nol tetap kehilangan tanda "+".
  return body.startsWith("-") ? `${body} pt` : `+${body} pt`;
}

/** Payout per lembar (1/p_i) dalam wad → "1.30×". */
export function formatPayout(payoutWad: bigint): string {
  return `${formatFixed(payoutWad, 18, 2)}×`;
}

/**
 * Fee dalam basis poin (1 bps = 0,01%) → tarif persen: 100 → "1.00%".
 *
 * Berbeda dari fungsi lain di berkas ini: `feeBps` BUKAN nilai moneter bigint
 * — ia integer konfigurasi kecil (`MarketDetail.feeBps: number`), jadi
 * larangan Number()/parseFloat pada berkas ini tidak berlaku di sini; aturan
 * yang berlaku hanyalah "komponen tidak memformat angka sendiri". Tetap
 * dihitung lewat pembagian & modulo bilangan bulat, bukan `.toFixed`, supaya
 * tidak ada pembulatan floating-point sama sekali.
 */
export function formatFeeRate(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const frac = Math.abs(bps % 100)
    .toString()
    .padStart(2, "0");
  return `${whole}.${frac}%`;
}

/** Jumlah collateral dalam satuan token terkecil → "1,234.56". */
export function formatCollateral(amount: bigint, decimals: number): string {
  return formatFixed(amount, decimals, 2);
}

/** Lembar outcome (18 desimal) → "126.32". */
export function formatShares(sharesWad: bigint): string {
  return formatFixed(sharesWad, 18, 2);
}

/** Harga per lembar dalam wad → "0.7838". Empat desimal: pada rentang 0..1 dua tidak cukup. */
export function formatPricePerShare(priceWad: bigint): string {
  return formatFixed(priceWad, 18, 4);
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Dua satuan terbesar; tanpa detik — presisi detik menyiratkan ketepatan yang tak dimiliki blok. */
export function formatCountdown(secondsRemaining: number): string {
  if (secondsRemaining <= 0) return "tutup";
  const days = Math.floor(secondsRemaining / 86_400);
  const hours = Math.floor((secondsRemaining % 86_400) / 3_600);
  const minutes = Math.floor((secondsRemaining % 3_600) / 60);
  if (days > 0) return `${days}h ${hours}j`;
  if (hours > 0) return `${hours}j ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Waktu absolut, zona lokal pembaca. Dipakai untuk garis waktu siklus hidup.
 *
 * Tidak ada penanganan tepi khusus di sini dengan sengaja: 0 adalah timestamp
 * Unix yang sah (epoch 1 Jan 1970) dan dirender apa adanya, persis seperti
 * formatCollateral(0n, ...) merender "0.00", bukan disembunyikan — "belum
 * diketahui" adalah urusan Query.status, bukan sesuatu yang boleh disimpulkan
 * fungsi ini dari sebuah nilai numerik. Tanggal jauh di masa depan (mis. tahun
 * 9999, dipakai settlementDeadline yang sangat longgar) juga terformat tanpa
 * overflow: Date menampung hingga sekitar tahun 275760, jauh melampaui domain
 * timestamp market mana pun di sini.
 */
export function formatTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
