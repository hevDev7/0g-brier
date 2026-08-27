import {describe, expect, it} from "vitest";
import {WAD, dpm} from "@0g-delphi/protocol";

describe("integrasi workspace", () => {
  it("mengimpor WAD dari @0g-delphi/protocol", () => {
    expect(WAD).toBe(1_000_000_000_000_000_000n);
  });

  it("cermin DPM menghitung probabilitas 3-4-5 yang benar", () => {
    // P_i = q_i^2 / (q_0^2 + q_1^2); untuk (3,4): 9/25 dan 16/25
    expect(dpm.probability([3n * WAD, 4n * WAD], 0)).toBe(360_000_000_000_000_000n);
    expect(dpm.probability([3n * WAD, 4n * WAD], 1)).toBe(640_000_000_000_000_000n);
  });

  it("harga marginal BUKAN probabilitas — keduanya berbeda", () => {
    const q: readonly [bigint, bigint] = [3n * WAD, 4n * WAD];
    expect(dpm.price(q, 1)).toBe(800_000_000_000_000_000n);   // 0.8
    expect(dpm.probability(q, 1)).toBe(640_000_000_000_000_000n); // 0.64
    expect(dpm.price(q, 1)).not.toBe(dpm.probability(q, 1));
  });
});
