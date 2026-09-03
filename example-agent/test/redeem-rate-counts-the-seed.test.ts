import {describe, expect, it} from "vitest";
import {measuredRateWad} from "../src/redeem.js";

const WAD = 10n ** 18n;

/**
 * The reporting bug this project has already paid for once.
 *
 * `Claim.sharesBefore` counts TRADABLE PLUS SEED. The seed half is held by the
 * Market rather than by OutcomeShares, so `getPosition` cannot see it while
 * `redeem` pays for it regardless — and a market's creator is usually its largest
 * winner. Dividing proceeds by the tradable balance alone printed an implied rate
 * of 21.01x for a market whose real rate was 1.3689x.
 *
 * The agent-kit carries the same two figures in types.ts and client.test.ts. This
 * pins them on the example, because a developer reads the number the example
 * prints and believes it.
 */
describe("the measured rate divides by every share the claim burned", () => {
  // The historical case, reconstructed: a claim that burned 15.35x more shares
  // than the tradable balance alone, at 18-decimal collateral.
  const tradable = 100n * WAD;
  const seed = 1435n * WAD;
  const sharesBefore = tradable + seed;
  const tokensReceived = (sharesBefore * 13689n) / 10000n; // a true rate of 1.3689x

  it("reports the real rate when it counts tradable plus seed", () => {
    const rate = measuredRateWad({tokensReceived, decimals: 18, sharesBefore});
    expect(rate).toBe(1368900000000000000n); // 1.3689x
  });

  it("REGRESSION: dividing by the tradable balance alone overstates it fifteen-fold", () => {
    const wrong = measuredRateWad({tokensReceived, decimals: 18, sharesBefore: tradable});
    expect(wrong).toBe(21012615000000000000n); // 21.01x, the number that shipped
    expect(wrong).toBeGreaterThan(15n * 1368900000000000000n);
  });

  it("scales collateral up to wad, so a 6-decimal token reports the same rate", () => {
    // mUSDC on Galileo is 6 decimals; shares are always 18. A rate computed
    // without the conversion would be out by 1e12.
    const sixDecimals = (sharesBefore * 13689n) / 10000n / 10n ** 12n;
    const rate = measuredRateWad({tokensReceived: sixDecimals, decimals: 6, sharesBefore});
    expect(rate).toBe(1368900000000000000n);
  });

  it("refuses to divide by zero rather than reporting a rate it cannot know", () => {
    expect(() => measuredRateWad({tokensReceived: 1n, decimals: 18, sharesBefore: 0n})).toThrow(
      /no shares were burned/,
    );
  });
});
