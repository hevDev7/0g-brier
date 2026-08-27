import {dpm, quote} from "@0g-delphi/protocol";
import type {Outcome} from "@/lib/data/types";

type Q = readonly [bigint, bigint];

/**
 * Turunan tampilan dari keadaan market. Setiap nilai di sini berasal dari
 * cermin TypeScript yang sudah disematkan ke DPMMath.sol lewat uji diferensial
 * 512 vektor — jadi angka di layar berasal dari sumber yang sama dengan angka
 * di rantai, bukan dari reimplementasi.
 *
 * Berkas ini TIDAK menghitung apa pun sendiri; ia hanya menamai turunan yang
 * dipakai layar. Rumusnya hidup di `@0g-delphi/protocol`, satu-satunya salinan,
 * yang juga dipakai `@0g-delphi/agent-kit` — dua salinan rumus payout adalah
 * cara paling mudah membuat layar dan agent tidak sepakat soal angka yang sama.
 */

/** Probabilitas implisit P_i = p_i^2. Ini satu-satunya sumber untuk nilai berlabel %. */
export function probabilityWad(q: Q, outcome: Outcome): bigint {
  return dpm.probability(q, outcome);
}

/**
 * Payout per lembar menang = 1/p_i, dalam wad.
 *
 * BUKAN 1/P_i. Keduanya menghasilkan angka yang terlihat masuk akal, dan
 * memakai yang salah melebih-lebihkan payout sekitar 30% pada skew biasa —
 * persis arah yang merugikan pengguna bila ia mempercayainya. Draf pertama
 * spec ini sendiri melakukan kesalahan itu; uji yang menjaganya ada di
 * packages/protocol/test/quote.test.ts, di sisi rumusnya.
 */
export function payoutPerShareWad(q: Q, outcome: Outcome): bigint {
  return quote.payoutPerShareWad(q, outcome);
}
