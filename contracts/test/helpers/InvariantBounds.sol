// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {DPMMath} from "../../src/math/DPMMath.sol";

/// @title InvariantBounds
/// @notice Derived dust bounds for INV-4 and INV-9.
///
/// @dev NO constant here is fitted to a measurement. Every bound has a written derivation and
///      SCALES with the live `q` at the moment it is asserted. This protocol has been bitten
///      three times by a guessed constant (`≤ 3` twice, against a measured 646 wei); the rule
///      it has already paid for: a dust bound here ALWAYS scales with q, never a constant. The
///      one exception is INV-8, and only because the algebra makes it so (Σqᵢ² = C² exactly) —
///      see `invariant_INV8_*`.
library InvariantBounds {
    uint256 internal constant WAD = DPMMath.WAD;

    /// @notice INV-4 — the `poolWad` left over after EVERY holder has liquidated.
    ///
    /// @dev Notation: q = (q₀,q₁) frozen since resolution, S = q₀²+q₁², C = √S (real),
    ///      c = ⌊C⌋ = `DPMMath.cost(q)`, P = ⌈C⌉ = `DPMMath.costUp(q)` = `poolWad` at
    ///      resolution (INV-1), and Lᵢ = ⌊qᵢ·WAD/c⌋ = the `_liqPerShareWad[i]` snapshotted by
    ///      `_snapshotLiquidation`. Write Lᵢ = qᵢ·WAD/c − εᵢ with 0 ≤ εᵢ < 1.
    ///
    ///      `liquidate` pays holder h a total of Σᵢ ⌊a_{h,i}·Lᵢ/WAD⌋ — one floor per non-zero
    ///      outcome. Because every share (tradable or seed) is held by one of the claimants and
    ///      is never transferred away, Σ_h a_{h,i} = qᵢ EXACTLY. Hence
    ///
    ///        T = Σ_h Σᵢ ⌊a_{h,i}Lᵢ/WAD⌋ > Σᵢ qᵢLᵢ/WAD − N,   N = number of non-zero legs ≤ 2H
    ///          = S/c − (Σᵢ qᵢεᵢ)/WAD − N
    ///          > S/c − (q₀+q₁)/WAD − N.
    ///
    ///      Leftover = P − T < P − S/c + (q₀+q₁)/WAD + N. Since c ≤ C ≤ P we have
    ///      S/c = C²/c ≥ C, so P − S/c ≤ P − C = ⌈C⌉ − C ≤ 1. With integer division
    ///      (q₀+q₁)/WAD ≤ ⌊(q₀+q₁)/WAD⌋ + 1, and N ≤ 2H:
    ///
    ///        Leftover ≤ ⌊(q₀+q₁)/WAD⌋ + 2H + 1.
    ///
    ///      H = the number of `liquidate` calls that actually paid; one per holder, because a
    ///      second call from the same holder reverts `NothingToClaim`.
    ///
    ///      If the `payoutWad > poolWad` clamp ever engaged, the pool is drained completely
    ///      (Leftover = 0) and this bound is satisfied trivially.
    ///
    ///      The dominant term is LINEAR in q₀+q₁ — exactly the scaling the Task 16 reviewer
    ///      measured at 1×/10³×/10⁶×/10⁹×. Any small constant would pass on a small fixture and
    ///      fail on a much larger market; even the `< scale` Task 16 used is valid only for its
    ///      own fixture's scale, not across the whole MAX_Q range.
    function inv4LiquidationDust(uint256[2] memory q, uint256 liquidators) internal pure returns (uint256) {
        return (q[0] + q[1]) / WAD + 2 * liquidators + 1;
    }

    /// @notice INV-9 — the maximum `probability` drift caused by a proportional `addLiquidity`.
    ///
    /// @dev Before: qᵢ. After: q'ᵢ = qᵢ + ⌊qᵢ·λ/WAD⌋ = μqᵢ − δᵢ, with μ = 1 + λ/WAD ≥ 1 and
    ///      0 ≤ δᵢ < 1. In real arithmetic q' = μq and the probability does NOT move (C is
    ///      homogeneous of degree 1); the entire drift comes from those two floors.
    ///
    ///      With x = q'₀, y = q'₁ and P₀ = q₀²/(q₀²+q₁²):
    ///
    ///        P'₀ − P₀ = (xq₁ − q₀y)(xq₁ + q₀y) / [(x²+y²)(q₀²+q₁²)]
    ///
    ///      and xq₁ − q₀y = (μq₀−δ₀)q₁ − q₀(μq₁−δ₁) = δ₁q₀ − δ₀q₁, so |xq₁ − q₀y| < q₀+q₁.
    ///      Further xq₁ + q₀y ≤ 2μq₀q₁, and since δᵢ < 1 ≤ μ we have x ≥ μ(q₀−1), hence
    ///      x²+y² ≥ μ²((q₀−1)²+(q₁−1)²). Therefore
    ///
    ///        |ΔP|/WAD < (q₀+q₁)·2μq₀q₁ / [μ²((q₀−1)²+(q₁−1)²)(q₀²+q₁²)]
    ///                 ≤ 2(q₀+q₁)q₀q₁ / [((q₀−1)²+(q₁−1)²)(q₀²+q₁²)]      [μ ≥ 1]
    ///                 ≤ 8(q₀+q₁)q₀q₁ / (q₀²+q₁²)²                        [qᵢ ≥ 2 ⇒ (qᵢ−1)² ≥ qᵢ²/4]
    ///                 ≤ 4(q₀+q₁) / (q₀²+q₁²)                              [2q₀q₁ ≤ q₀²+q₁²]
    ///                 ≤ 8 / (q₀+q₁).                                      [(q₀+q₁)² ≤ 2(q₀²+q₁²)]
    ///
    ///      `probability()` itself rounds down at BOTH measurement points, adding ≤ 2:
    ///
    ///        |P'measured − Pmeasured| ≤ ⌈8·WAD/(q₀+q₁)⌉ + 2.
    ///
    ///      The qᵢ ≥ 2 condition is guaranteed by INV-6 plus MIN_SEED: the opening
    ///      q = `seedShares(seedWad)` with seedWad ≥ 100e6·1e12, so qᵢ ≥ ~7.07e19 and never
    ///      falls below the creator's seed.
    ///
    ///      This bound SHRINKS as q grows (at the fixture's seed q ≈ 7.07e20 it is 3) and GROWS
    ///      in the degenerate regime (q = (2,2) → 2e18+2). That is why the `± 2 wei` written in
    ///      the spec is NOT valid for this invariant: it happens to be right at realistic q and
    ///      is arbitrarily wrong at small q. We derived the bound rather than constraining the
    ///      handler, so the invariant stays meaningful at any q.
    function inv9ProbabilityDrift(uint256[2] memory q) internal pure returns (uint256) {
        return Math.ceilDiv(8 * WAD, q[0] + q[1]) + 2;
    }
}
