import { describe, expect, it } from 'vitest';
import { WAD } from '../src/units';
import { MAX_Q, price, probability } from '../src/dpm';
import { feeFromGross, payoutPerShareWad, qAfterBuy, quoteBuy } from '../src/quote';

const q: readonly [bigint, bigint] = [1000n * WAD, 1200n * WAD];

describe('feeFromGross — inversi fee', () => {
  /**
   * Kontrak mengenakan fee DI ATAS biaya pool (`fee = costTokens * feeBps / 10_000`
   * di Market._priceBuy). Membalik itu untuk anggaran KOTOR karena itu memakai
   * penyebut 10_000 + feeBps — persis seperti Market.quoteBuySpend.
   */
  it('memakai penyebut 10_000 + bps sehingga anggaran terpakai penuh', () => {
    const gross = 100n * WAD;
    const fee = feeFromGross(gross, 100);
    expect(fee).toBe(990_099_009_900_990_099n);

    const poolIn = gross - fee;
    // Fee yang akan dikenakan kontrak DI ATAS poolIn ini kembali ke fee semula:
    // itulah definisi inversinya benar — tak ada sisa anggaran yang menganggur.
    expect((poolIn * 100n) / 10_000n).toBe(fee);
    expect(poolIn + (poolIn * 100n) / 10_000n).toBe(gross);
  });

  it('penyebut naif 10_000 menyisakan anggaran tak terpakai', () => {
    const gross = 100n * WAD;
    const naive = (gross * 100n) / 10_000n;
    expect(naive).toBeGreaterThan(feeFromGross(gross, 100));

    const naivePool = gross - naive;
    // 0,01 token dari anggaran 100 tak pernah sampai ke pool: kuotasi yang
    // memakai penyebut ini menjanjikan lembar lebih sedikit dari yang seharusnya.
    expect(naivePool + (naivePool * 100n) / 10_000n).toBe(gross - 10n ** 16n);
  });

  it('nol bps berarti nol fee, dan anggaran nol tidak melempar', () => {
    expect(feeFromGross(100n * WAD, 0)).toBe(0n);
    expect(feeFromGross(0n, 100)).toBe(0n);
    expect(feeFromGross(-1n, 100)).toBe(0n);
  });

  it('menolak bps di luar jangkauan, bukan diam-diam menghitung', () => {
    expect(() => feeFromGross(WAD, -1)).toThrow(RangeError);
    expect(() => feeFromGross(WAD, 10_001)).toThrow(RangeError);
    expect(() => feeFromGross(WAD, 1.5)).toThrow(RangeError);
  });
});

describe('payoutPerShareWad', () => {
  it('adalah 1/p_i, BUKAN 1/P_i — jebakan yang melebihkan payout ~30%', () => {
    expect(payoutPerShareWad(q, 1)).toBe(1_301_708_279_317_775_732n);
    expect(payoutPerShareWad(q, 0)).toBe(1_562_049_935_181_330_879n);
    const wrong = (WAD * WAD) / probability(q, 1);
    expect(wrong).toBe(1_694_444_444_444_444_445n);
    expect(payoutPerShareWad(q, 1)).not.toBe(wrong);
  });

  it('payout dikali harga marginal mendekati satu', () => {
    const product = (payoutPerShareWad(q, 1) * price(q, 1)) / WAD;
    expect(WAD - product).toBeLessThanOrEqual(2n);
  });

  it('aman pada market kosong', () => {
    expect(payoutPerShareWad([0n, 0n], 0)).toBe(0n);
  });
});

describe('qAfterBuy', () => {
  it('hanya menambah kaki yang dibeli', () => {
    expect(qAfterBuy(q, 1, 100n * WAD)).toEqual([1000n * WAD, 1300n * WAD]);
    expect(qAfterBuy(q, 0, 100n * WAD)).toEqual([1100n * WAD, 1200n * WAD]);
  });
});

describe('quoteBuy', () => {
  const spendWad = 100n * WAD;

  it('menghitung lembar dan probabilitas secara sinkron, tanpa RPC', () => {
    const quote = quoteBuy({ q, outcome: 1, spendWad, feeBps: 100 });
    expect(quote.sharesOut).toBeGreaterThan(0n);
    expect(quote.probBeforeWad).toBe(590_163_934_426_229_508n);
    expect(quote.probAfterWad).toBeGreaterThan(quote.probBeforeWad);
  });

  /** Pembelian menaikkan harga, jadi rata-rata WAJIB di atas marginal awal. */
  it('harga rata-rata di atas harga marginal sebelum trade', () => {
    const quote = quoteBuy({ q, outcome: 1, spendWad, feeBps: 100 });
    expect(quote.avgPriceWad).toBeGreaterThan(768_221_279_597_375_842n);
  });

  /** Membeli sisi ini menurunkan payout sisi ini — dilusi, terlihat sebagai angka. */
  it('payout sisi yang dibeli turun setelah trade', () => {
    const quote = quoteBuy({ q, outcome: 1, spendWad, feeBps: 100 });
    expect(quote.payoutAfterWad).toBeLessThan(quote.payoutBeforeWad);
  });

  it('anggaran kotor terbagi habis jadi fee dan setoran pool', () => {
    const quote = quoteBuy({ q, outcome: 1, spendWad, feeBps: 100 });
    expect(quote.totalWad).toBe(spendWad);
    expect(quote.feeWad + quote.poolInWad).toBe(spendWad);
    expect(quote.feeWad).toBe(feeFromGross(spendWad, 100));
  });

  /**
   * Belanja nol bukan "tak tahu apa-apa": probabilitas dan payout SAAT INI tetap
   * diketahui, dan transisinya rata karena tak ada yang dibeli. Mengembalikan
   * nol di keempat medan itu akan membuat kotak input kosong terbaca seolah
   * market berharga nol.
   */
  it('belanja nol tidak melempar dan tetap melaporkan keadaan market sekarang', () => {
    const quote = quoteBuy({ q, outcome: 1, spendWad: 0n, feeBps: 100 });
    expect(quote.sharesOut).toBe(0n);
    expect(quote.totalWad).toBe(0n);
    expect(quote.probBeforeWad).toBe(probability(q, 1));
    expect(quote.probAfterWad).toBe(quote.probBeforeWad);
    expect(quote.payoutBeforeWad).toBe(payoutPerShareWad(q, 1));
    expect(quote.payoutAfterWad).toBe(quote.payoutBeforeWad);
  });

  /**
   * Di batas MAX_Q, `sharesForSpend` melempar. Pratinjau adalah pembacaan, bukan
   * transaksi — ia mengembalikan pratinjau kosong dan membiarkan pemanggil tetap
   * hidup, bukan meruntuhkan layar atau proses agent.
   */
  it('market di batas MAX_Q memberi pratinjau kosong, bukan lemparan', () => {
    const edge: readonly [bigint, bigint] = [MAX_Q, MAX_Q];
    const quote = quoteBuy({ q: edge, outcome: 1, spendWad, feeBps: 100 });
    expect(quote.sharesOut).toBe(0n);
    expect(quote.avgPriceWad).toBe(0n);
    expect(quote.probBeforeWad).toBe(probability(edge, 1));
  });
});
