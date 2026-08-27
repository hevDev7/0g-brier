import { describe, expect, it } from 'vitest';
import { WAD } from '../src/units';
import { MAX_Q, price, probability } from '../src/dpm';
import { feeFromGross, payoutPerShareWad, qAfterBuy, quoteBuy } from '../src/quote';

const q: readonly [bigint, bigint] = [1000n * WAD, 1200n * WAD];

describe('feeFromGross — fee inversion', () => {
  /**
   * The contract charges the fee ON TOP OF the pool cost (`fee = costTokens * feeBps / 10_000`
   * in Market._priceBuy). Inverting that for a GROSS budget therefore uses the
   * denominator 10_000 + feeBps — exactly as Market.quoteBuySpend does.
   */
  it('uses the 10_000 + bps denominator so the whole budget is spent', () => {
    const gross = 100n * WAD;
    const fee = feeFromGross(gross, 100);
    expect(fee).toBe(990_099_009_900_990_099n);

    const poolIn = gross - fee;
    // The fee the contract would charge ON TOP OF this poolIn comes back to the original fee:
    // that is what it means for the inversion to be correct — no part of the budget sits idle.
    expect((poolIn * 100n) / 10_000n).toBe(fee);
    expect(poolIn + (poolIn * 100n) / 10_000n).toBe(gross);
  });

  it('the naive 10_000 denominator leaves budget unspent', () => {
    const gross = 100n * WAD;
    const naive = (gross * 100n) / 10_000n;
    expect(naive).toBeGreaterThan(feeFromGross(gross, 100));

    const naivePool = gross - naive;
    // 0.01 token out of a budget of 100 never reaches the pool: a quote using
    // this denominator promises fewer shares than the budget actually buys.
    expect(naivePool + (naivePool * 100n) / 10_000n).toBe(gross - 10n ** 16n);
  });

  it('zero bps means zero fee, and a zero budget does not throw', () => {
    expect(feeFromGross(100n * WAD, 0)).toBe(0n);
    expect(feeFromGross(0n, 100)).toBe(0n);
    expect(feeFromGross(-1n, 100)).toBe(0n);
  });

  it('rejects out-of-range bps instead of quietly computing', () => {
    expect(() => feeFromGross(WAD, -1)).toThrow(RangeError);
    expect(() => feeFromGross(WAD, 10_001)).toThrow(RangeError);
    expect(() => feeFromGross(WAD, 1.5)).toThrow(RangeError);
  });
});

describe('payoutPerShareWad', () => {
  it('is 1/p_i, NOT 1/P_i — the trap that overstates payout by ~30%', () => {
    expect(payoutPerShareWad(q, 1)).toBe(1_301_708_279_317_775_732n);
    expect(payoutPerShareWad(q, 0)).toBe(1_562_049_935_181_330_879n);
    const wrong = (WAD * WAD) / probability(q, 1);
    expect(wrong).toBe(1_694_444_444_444_444_445n);
    expect(payoutPerShareWad(q, 1)).not.toBe(wrong);
  });

  it('payout times marginal price lands within dust of one', () => {
    const product = (payoutPerShareWad(q, 1) * price(q, 1)) / WAD;
    expect(WAD - product).toBeLessThanOrEqual(2n);
  });

  it('is safe on an empty market', () => {
    expect(payoutPerShareWad([0n, 0n], 0)).toBe(0n);
  });
});

describe('qAfterBuy', () => {
  it('adds only to the leg that was bought', () => {
    expect(qAfterBuy(q, 1, 100n * WAD)).toEqual([1000n * WAD, 1300n * WAD]);
    expect(qAfterBuy(q, 0, 100n * WAD)).toEqual([1100n * WAD, 1200n * WAD]);
  });
});

describe('quoteBuy', () => {
  const spendWad = 100n * WAD;

  it('computes shares and probability in step, with no RPC', () => {
    const quote = quoteBuy({ q, outcome: 1, spendWad, feeBps: 100 });
    expect(quote.sharesOut).toBeGreaterThan(0n);
    expect(quote.probBeforeWad).toBe(590_163_934_426_229_508n);
    expect(quote.probAfterWad).toBeGreaterThan(quote.probBeforeWad);
  });

  /** A purchase raises the price, so the average MUST be above the opening marginal price. */
  it('the average price is above the marginal price before the trade', () => {
    const quote = quoteBuy({ q, outcome: 1, spendWad, feeBps: 100 });
    expect(quote.avgPriceWad).toBeGreaterThan(768_221_279_597_375_842n);
  });

  /** Buying this side lowers this side's payout — dilution, visible as a number. */
  it('the payout on the side bought falls after the trade', () => {
    const quote = quoteBuy({ q, outcome: 1, spendWad, feeBps: 100 });
    expect(quote.payoutAfterWad).toBeLessThan(quote.payoutBeforeWad);
  });

  it('the gross budget divides exactly into fee and pool deposit', () => {
    const quote = quoteBuy({ q, outcome: 1, spendWad, feeBps: 100 });
    expect(quote.totalWad).toBe(spendWad);
    expect(quote.feeWad + quote.poolInWad).toBe(spendWad);
    expect(quote.feeWad).toBe(feeFromGross(spendWad, 100));
  });

  /**
   * Zero spend is not "nothing is known": the CURRENT probability and payout are
   * still known, and the transition is flat because nothing was bought. Returning
   * zero in all four fields would make an empty input box read as though the
   * market were worth nothing.
   */
  it('zero spend does not throw and still reports the current market state', () => {
    const quote = quoteBuy({ q, outcome: 1, spendWad: 0n, feeBps: 100 });
    expect(quote.sharesOut).toBe(0n);
    expect(quote.totalWad).toBe(0n);
    expect(quote.probBeforeWad).toBe(probability(q, 1));
    expect(quote.probAfterWad).toBe(quote.probBeforeWad);
    expect(quote.payoutBeforeWad).toBe(payoutPerShareWad(q, 1));
    expect(quote.payoutAfterWad).toBe(quote.payoutBeforeWad);
  });

  /**
   * At the MAX_Q limit, `sharesForSpend` throws. A preview is a read, not a
   * transaction — it returns an empty preview and leaves the caller alive rather
   * than bringing down the screen or the agent process.
   */
  it('a market at the MAX_Q limit gives an empty preview, not a throw', () => {
    const edge: readonly [bigint, bigint] = [MAX_Q, MAX_Q];
    const quote = quoteBuy({ q: edge, outcome: 1, spendWad, feeBps: 100 });
    expect(quote.sharesOut).toBe(0n);
    expect(quote.avgPriceWad).toBe(0n);
    expect(quote.probBeforeWad).toBe(probability(edge, 1));
  });
});
