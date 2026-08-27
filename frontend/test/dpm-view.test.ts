import {describe, expect, it} from "vitest";
import {WAD, dpm} from "@0g-delphi/protocol";
import {payoutPerShareWad, probabilityWad} from "@/lib/dpm-view";

const q: readonly [bigint, bigint] = [1000n * WAD, 1200n * WAD];

describe("probabilityWad", () => {
  it("mengembalikan p_i^2, bukan p_i", () => {
    expect(probabilityWad(q, 0)).toBe(409_836_065_573_770_491n);
    expect(probabilityWad(q, 1)).toBe(590_163_934_426_229_508n);
  });

  it("berjumlah satu dalam batas debu floor", () => {
    const sum = probabilityWad(q, 0) + probabilityWad(q, 1);
    expect(WAD - sum).toBeLessThanOrEqual(2n);
    expect(sum).toBeLessThanOrEqual(WAD);
  });
});

describe("payoutPerShareWad", () => {
  it("adalah 1/p_i", () => {
    expect(payoutPerShareWad(q, 1)).toBe(1_301_708_279_317_775_732n);
    expect(payoutPerShareWad(q, 0)).toBe(1_562_049_935_181_330_879n);
  });

  it("BUKAN 1/P_i — jebakan yang melebihkan payout ~30%", () => {
    const wrong = (WAD * WAD) / probabilityWad(q, 1);
    expect(wrong).toBe(1_694_444_444_444_444_445n);
    expect(payoutPerShareWad(q, 1)).not.toBe(wrong);
  });

  it("payout dikali harga marginal mendekati satu", () => {
    const product = (payoutPerShareWad(q, 1) * dpm.price(q, 1)) / WAD;
    expect(WAD - product).toBeLessThanOrEqual(2n);
  });

  it("aman pada market kosong", () => {
    expect(payoutPerShareWad([0n, 0n], 0)).toBe(0n);
  });
});
