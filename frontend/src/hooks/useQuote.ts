"use client";

import {WAD, dpm} from "@0g-delphi/protocol";
import {useMemo} from "react";
import {payoutPerShareWad, probabilityWad, qAfterBuy} from "@/lib/dpm-view";
import type {Outcome} from "@/lib/data/types";

export interface QuotePreview {
  sharesOut: bigint;
  poolInWad: bigint;
  feeWad: bigint;
  totalWad: bigint;
  avgPriceWad: bigint;
  probBeforeWad: bigint;
  probAfterWad: bigint;
  payoutBeforeWad: bigint;
  payoutAfterWad: bigint;
}

/**
 * Pratinjau LOKAL, dihitung dari cermin TypeScript — sinkron, tanpa RPC, jadi
 * mengetik tidak memicu satu pun panggilan jaringan. Ini TAKSIRAN: sebelum
 * mengirim transaksi, F1 memanggil `quoteBuy` di rantai dan angka itulah yang
 * ditandatangani pengguna.
 */
export function useQuote(input: {
  q: readonly [bigint, bigint];
  outcome: Outcome;
  spendWad: bigint;
  feeBps: number;
}): QuotePreview {
  const {q, outcome, spendWad, feeBps} = input;
  return useMemo(() => {
    const empty: QuotePreview = {
      sharesOut: 0n, poolInWad: 0n, feeWad: 0n, totalWad: 0n, avgPriceWad: 0n,
      probBeforeWad: probabilityWad(q, outcome),
      probAfterWad: probabilityWad(q, outcome),
      payoutBeforeWad: payoutPerShareWad(q, outcome),
      payoutAfterWad: payoutPerShareWad(q, outcome),
    };
    if (spendWad <= 0n) return empty;

    // Kontrak mengenakan fee DI ATAS biaya pool, jadi membaliknya untuk
    // anggaran kotor memakai penyebut 10000 + feeBps, bukan 10000.
    const bps = BigInt(feeBps);
    const feeWad = (spendWad * bps) / (10_000n + bps);
    const poolInWad = spendWad - feeWad;
    if (poolInWad <= 0n) return empty;

    let sharesOut: bigint;
    try {
      sharesOut = dpm.sharesForSpend(q, outcome, poolInWad);
    } catch {
      return empty;
    }
    const qAfter = qAfterBuy(q, outcome, sharesOut);
    return {
      sharesOut,
      poolInWad,
      feeWad,
      totalWad: spendWad,
      avgPriceWad: sharesOut === 0n ? 0n : (poolInWad * WAD) / sharesOut,
      probBeforeWad: probabilityWad(q, outcome),
      probAfterWad: probabilityWad(qAfter, outcome),
      payoutBeforeWad: payoutPerShareWad(q, outcome),
      payoutAfterWad: payoutPerShareWad(qAfter, outcome),
    };
  }, [q, outcome, spendWad, feeBps]);
}
