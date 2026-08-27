import {WAD, dpm} from "@0g-delphi/protocol";
import type {Outcome} from "@/lib/data/types";

type Q = readonly [bigint, bigint];

/**
 * Turunan tampilan dari keadaan market. Setiap nilai di sini berasal dari
 * cermin TypeScript yang sudah disematkan ke DPMMath.sol lewat uji diferensial
 * 512 vektor — jadi angka di layar berasal dari sumber yang sama dengan angka
 * di rantai, bukan dari reimplementasi.
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
 * spec ini sendiri melakukan kesalahan itu.
 */
export function payoutPerShareWad(q: Q, outcome: Outcome): bigint {
  const price = dpm.price(q, outcome);
  if (price === 0n) return 0n;
  return (WAD * WAD) / price;
}

/** Keadaan q setelah `shares` lembar `outcome` dicetak. */
export function qAfterBuy(q: Q, outcome: Outcome, shares: bigint): Q {
  return outcome === 0 ? [q[0] + shares, q[1]] : [q[0], q[1] + shares];
}
