import {describe, expect, it} from "vitest";
import {WAD, dpm} from "@brier/protocol";
import {payoutPerShareWad, probabilityWad} from "@/lib/dpm-view";

const q: readonly [bigint, bigint] = [1000n * WAD, 1200n * WAD];

describe("probabilityWad", () => {
  it("returns p_i^2, not p_i", () => {
    expect(probabilityWad(q, 0)).toBe(409_836_065_573_770_491n);
    expect(probabilityWad(q, 1)).toBe(590_163_934_426_229_508n);
  });

  it("sums to one within floor dust", () => {
    const sum = probabilityWad(q, 0) + probabilityWad(q, 1);
    expect(WAD - sum).toBeLessThanOrEqual(2n);
    expect(sum).toBeLessThanOrEqual(WAD);
  });
});

describe("payoutPerShareWad", () => {
  it("is 1/p_i", () => {
    expect(payoutPerShareWad(q, 1)).toBe(1_301_708_279_317_775_732n);
    expect(payoutPerShareWad(q, 0)).toBe(1_562_049_935_181_330_879n);
  });

  it("is NOT 1/P_i — the trap that overstates payout by ~30%", () => {
    const wrong = (WAD * WAD) / probabilityWad(q, 1);
    expect(wrong).toBe(1_694_444_444_444_444_445n);
    expect(payoutPerShareWad(q, 1)).not.toBe(wrong);
  });

  it("payout times marginal price lands within dust of one", () => {
    const product = (payoutPerShareWad(q, 1) * dpm.price(q, 1)) / WAD;
    expect(WAD - product).toBeLessThanOrEqual(2n);
  });

  it("is safe on an empty market", () => {
    expect(payoutPerShareWad([0n, 0n], 0)).toBe(0n);
  });
});
