import { WAD } from './units';
import { price, probability, sharesForSpend, type Outcome, type Q } from './dpm';

/**
 * Mesin kuotasi: apa yang didapat sebuah anggaran, dan apa yang dilakukannya
 * pada market. Murni — tanpa React, tanpa RPC, tanpa state — supaya satu
 * implementasi yang sama melayani UI manusia dan `@0g-delphi/agent-kit`.
 *
 * Ini implementasi RUJUKAN, bukan otoritas: sebelum mengirim transaksi,
 * pemanggil memanggil `quoteBuySpend`/`quoteBuy` di rantai dan angka itulah
 * yang ditandatangani. Modul ini mencerminkan `Market.quoteBuySpend` — inversi
 * fee yang sama, `DPMMath.sharesForSpend` yang sama lewat cermin di `dpm.ts` —
 * dengan satu perbedaan yang disengaja: di sini semuanya wad, sedangkan
 * kontrak membalik fee dalam satuan token lalu menaikkannya ke wad. Konversi
 * desimal hanya terjadi di batas token, tidak pernah di tengah perhitungan.
 */
export interface QuotePreview {
  /** Lembar outcome yang diterima, wad. */
  sharesOut: bigint;
  /** Bagian anggaran yang benar-benar masuk pool, wad. */
  poolInWad: bigint;
  /** Bagian anggaran yang jadi fee, wad. */
  feeWad: bigint;
  /** Anggaran kotor: selalu `poolInWad + feeWad`. */
  totalWad: bigint;
  /** Harga rata-rata yang dibayar per lembar, wad. Selalu di atas harga marginal awal. */
  avgPriceWad: bigint;
  probBeforeWad: bigint;
  probAfterWad: bigint;
  payoutBeforeWad: bigint;
  payoutAfterWad: bigint;
}

const MAX_FEE_BPS = 10_000;

/**
 * Payout per lembar menang = 1/p_i, dalam wad.
 *
 * BUKAN 1/P_i. Keduanya menghasilkan angka yang terlihat masuk akal, dan
 * memakai yang salah melebih-lebihkan payout sekitar 30% pada skew biasa —
 * persis arah yang merugikan siapa pun yang mempercayainya. Draf pertama spec
 * proyek ini sendiri melakukan kesalahan itu.
 */
export function payoutPerShareWad(q: Q, outcome: Outcome): bigint {
  const p = price(q, outcome);
  if (p === 0n) return 0n;
  return (WAD * WAD) / p;
}

/** Keadaan q setelah `shares` lembar `outcome` dicetak. */
export function qAfterBuy(q: Q, outcome: Outcome, shares: bigint): Q {
  return outcome === 0 ? [q[0] + shares, q[1]] : [q[0], q[1] + shares];
}

/**
 * Fee yang terkandung DI DALAM anggaran kotor `grossWad`.
 *
 * Penyebutnya `10_000 + feeBps`, bukan `10_000`, dan itu bukan detail: kontrak
 * mengenakan fee di ATAS biaya pool (`fee = costTokens * feeBps / 10_000`, lihat
 * `Market._priceBuy`), jadi membaliknya dari anggaran kotor harus memakai
 * penyebut yang sudah memuat fee itu sendiri. Memakai `10_000` menyisakan
 * sebagian anggaran menganggur — kuotasinya menjanjikan lembar lebih sedikit
 * daripada yang sebenarnya dibeli anggaran itu.
 */
export function feeFromGross(grossWad: bigint, feeBps: number): bigint {
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > MAX_FEE_BPS) {
    throw new RangeError(`feeBps tidak didukung: ${feeBps} (harus bilangan bulat 0..${MAX_FEE_BPS})`);
  }
  if (grossWad <= 0n) return 0n;
  const bps = BigInt(feeBps);
  return (grossWad * bps) / (10_000n + bps);
}

/** Pratinjau saat tak ada yang dibeli: keadaan market sekarang, transisi rata. */
function still(q: Q, outcome: Outcome): QuotePreview {
  const prob = probability(q, outcome);
  const payout = payoutPerShareWad(q, outcome);
  return {
    sharesOut: 0n,
    poolInWad: 0n,
    feeWad: 0n,
    totalWad: 0n,
    avgPriceWad: 0n,
    probBeforeWad: prob,
    probAfterWad: prob,
    payoutBeforeWad: payout,
    payoutAfterWad: payout,
  };
}

/**
 * Pratinjau pembelian `spendWad` (anggaran KOTOR, sudah termasuk fee).
 *
 * Belanja nol dan market yang menolak pembelian (mis. `q` di batas MAX_Q, yang
 * membuat `sharesForSpend` melempar) menghasilkan pratinjau kosong — dengan
 * probabilitas dan payout SAAT INI tetap terisi, bukan nol. Pratinjau adalah
 * pembacaan, bukan transaksi: ia tidak boleh meruntuhkan layar atau proses
 * agent yang memanggilnya, dan tidak boleh membuat market terbaca berharga nol
 * hanya karena tak ada yang dibelanjakan.
 */
export function quoteBuy(input: {
  q: Q;
  outcome: Outcome;
  spendWad: bigint;
  feeBps: number;
}): QuotePreview {
  const { q, outcome, spendWad, feeBps } = input;
  const feeWad = feeFromGross(spendWad, feeBps);
  const poolInWad = spendWad - feeWad;
  if (poolInWad <= 0n) return still(q, outcome);

  let sharesOut: bigint;
  try {
    sharesOut = sharesForSpend(q, outcome, poolInWad);
  } catch {
    return still(q, outcome);
  }
  const after = qAfterBuy(q, outcome, sharesOut);
  return {
    sharesOut,
    poolInWad,
    feeWad,
    totalWad: spendWad,
    avgPriceWad: sharesOut === 0n ? 0n : (poolInWad * WAD) / sharesOut,
    probBeforeWad: probability(q, outcome),
    probAfterWad: probability(after, outcome),
    payoutBeforeWad: payoutPerShareWad(q, outcome),
    payoutAfterWad: payoutPerShareWad(after, outcome),
  };
}
