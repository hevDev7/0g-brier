// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title DPMMath
/// @notice Dynamic pari-mutuel cost function (Pennock): C(q) = √(q₀² + q₁²).
/// @dev All values are in wad (1e18). Because qᵢ is scaled by 1e18, qᵢ² is scaled by 1e36,
///      so the integer square root of their sum lands directly in wad —
///      no rescaling, and no place for a scale error to hide.
///
///      The properties this library guarantees:
///        • Σ pᵢ² = WAD           → pᵢ² is a valid probability distribution
///        • Σ pᵢ·qᵢ ≈ C(q), may exceed poolWad by ≤2 wei because price() divides
///          by a cost() that has already been rounded down → liquidation MUST clamp
///          the total payout to poolWad rather than assume Euler holds exactly
///        • C(k·q) = k·C(q)       → proportional liquidity additions are price-neutral
library DPMMath {
    uint256 internal constant WAD = 1e18;

    /// @dev 2·(1e33)² = 2e66 < 2²⁵⁶ ≈ 1.16e77, so the sum of squares never overflows.
    uint256 internal constant MAX_Q = 1e33;

    error QOverflow();

    function _sumSq(uint256[2] memory q) private pure returns (uint256) {
        if (q[0] > MAX_Q || q[1] > MAX_Q) revert QOverflow();
        return q[0] * q[0] + q[1] * q[1];
    }

    /// @notice C(q) rounded DOWN. Used for reporting, not for pool state.
    function cost(uint256[2] memory q) internal pure returns (uint256) {
        return Math.sqrt(_sumSq(q), Math.Rounding.Floor);
    }

    /// @notice C(q) rounded UP. `Market.poolWad` always uses this value,
    ///         so every speck of rounding dust is left inside the pool, never outside it.
    function costUp(uint256[2] memory q) internal pure returns (uint256) {
        return Math.sqrt(_sumSq(q), Math.Rounding.Ceil);
    }

    error BadOutcome();

    /// @notice Marginal price pᵢ = ∂C/∂qᵢ = qᵢ / C(q), in wad.
    /// @dev NOT the probability. The probability is pᵢ² — see `probability`.
    function price(uint256[2] memory q, uint8 i) internal pure returns (uint256) {
        if (i > 1) revert BadOutcome();
        uint256 c = cost(q);
        if (c == 0) return 0;
        return Math.mulDiv(q[i], WAD, c);
    }

    /// @notice Implied probability Pᵢ = pᵢ² = qᵢ² / Σqⱼ², in wad. Σ Pᵢ = WAD.
    /// @dev mulDiv is mandatory: qᵢ² reaches 1e66, and qᵢ²·WAD reaches 1e84 — beyond
    ///      uint256. mulDiv forms the 512-bit product before dividing.
    function probability(uint256[2] memory q, uint8 i) internal pure returns (uint256) {
        if (i > 1) revert BadOutcome();
        uint256 s = _sumSq(q);
        if (s == 0) return 0;
        return Math.mulDiv(q[i] * q[i], WAD, s);
    }

    error InsufficientSpend();

    /// @notice Shares of outcome `i` obtained when `spendWad` enters the pool.
    /// @param spendWad the portion that enters the pool — already net of fee.
    /// @dev For n = 2 no Newton iteration is needed. We are looking for x such that
    ///        √((qᵢ+x)² + q_j²) = C(q) + spend = C₁
    ///      which yields the closed form
    ///        x = √(C₁² − q_j²) − qᵢ
    ///      The base uses costUp (the same value as Market's poolWad) and the final
    ///      result is rounded down, so the quote never overstates.
    ///      This is a QUOTE, not the authority: `Market.buy` recomputes the real cost
    ///      and the caller protects itself with `maxTokensIn`.
    function sharesForSpend(uint256[2] memory q, uint8 i, uint256 spendWad) internal pure returns (uint256) {
        if (i > 1) revert BadOutcome();
        if (spendWad == 0) revert InsufficientSpend();

        uint256 j = i == 0 ? 1 : 0;
        uint256 c1 = costUp(q) + spendWad;
        if (c1 > MAX_Q) revert QOverflow();

        // c1 > C(q) ≥ q[j], so the subtraction below never underflows.
        uint256 inner = c1 * c1 - q[j] * q[j];
        uint256 newQi = Math.sqrt(inner, Math.Rounding.Floor);
        if (newQi <= q[i]) revert InsufficientSpend();
        return newQi - q[i];
    }

    /// @notice The largest symmetric share count (q₀ = q₁) whose cost does not exceed `seedWad`.
    /// @dev q₀ = ⌊√(⌊seedWad²/2⌋)⌋. From that, 2q₀² ≤ seedWad², which is equivalent to
    ///      costUp([q₀,q₀]) ≤ seedWad because ⌈√x⌉ ≤ S ⟺ x ≤ S².
    ///
    ///      Do not be tempted to write q₀ = seedWad·WAD/SQRT2_WAD: a √2 constant
    ///      rounded down makes the quotient slightly TOO LARGE, so the pool required
    ///      exceeds the collateral that was actually deposited.
    function seedShares(uint256 seedWad) internal pure returns (uint256) {
        if (seedWad > MAX_Q) revert QOverflow();
        return Math.sqrt((seedWad * seedWad) / 2, Math.Rounding.Floor);
    }
}
