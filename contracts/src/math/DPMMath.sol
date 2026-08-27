// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title DPMMath
/// @notice Cost function pari-mutuel dinamis (Pennock): C(q) = √(q₀² + q₁²).
/// @dev Seluruh nilai dalam wad (1e18). Karena qᵢ berskala 1e18, qᵢ² berskala 1e36,
///      sehingga akar kuadrat integer dari jumlahnya langsung menghasilkan wad —
///      tidak ada penskalaan ulang, tidak ada tempat bagi kesalahan skala.
///
///      Sifat yang dijamin pustaka ini:
///        • Σ pᵢ² = WAD           → pᵢ² adalah distribusi probabilitas yang sah
///        • Σ pᵢ·qᵢ = C(q)        → likuidasi menghabiskan pool secara persis (Euler)
///        • C(k·q) = k·C(q)       → penambahan likuiditas proporsional netral terhadap harga
library DPMMath {
    uint256 internal constant WAD = 1e18;

    /// @dev 2·(1e33)² = 2e66 < 2²⁵⁶ ≈ 1.16e77, jadi jumlah kuadrat tidak pernah meluap.
    uint256 internal constant MAX_Q = 1e33;

    error QOverflow();

    function _sumSq(uint256[2] memory q) private pure returns (uint256) {
        if (q[0] > MAX_Q || q[1] > MAX_Q) revert QOverflow();
        return q[0] * q[0] + q[1] * q[1];
    }

    /// @notice C(q) dibulatkan KE BAWAH. Dipakai untuk pelaporan, bukan untuk state pool.
    function cost(uint256[2] memory q) internal pure returns (uint256) {
        return Math.sqrt(_sumSq(q), Math.Rounding.Floor);
    }

    /// @notice C(q) dibulatkan KE ATAS. `Market.poolWad` selalu memakai nilai ini,
    ///         sehingga setiap debu pembulatan tertinggal di dalam pool, bukan di luar.
    function costUp(uint256[2] memory q) internal pure returns (uint256) {
        return Math.sqrt(_sumSq(q), Math.Rounding.Ceil);
    }

    error BadOutcome();

    /// @notice Harga marginal pᵢ = ∂C/∂qᵢ = qᵢ / C(q), dalam wad.
    /// @dev BUKAN probabilitas. Probabilitas adalah pᵢ² — lihat `probability`.
    function price(uint256[2] memory q, uint8 i) internal pure returns (uint256) {
        if (i > 1) revert BadOutcome();
        uint256 c = cost(q);
        if (c == 0) return 0;
        return Math.mulDiv(q[i], WAD, c);
    }

    /// @notice Probabilitas implisit Pᵢ = pᵢ² = qᵢ² / Σqⱼ², dalam wad. Σ Pᵢ = WAD.
    /// @dev mulDiv wajib: qᵢ² mencapai 1e66, dan qᵢ²·WAD mencapai 1e84 — melampaui
    ///      uint256. mulDiv menghitung hasil kali 512-bit sebelum membagi.
    function probability(uint256[2] memory q, uint8 i) internal pure returns (uint256) {
        if (i > 1) revert BadOutcome();
        uint256 s = _sumSq(q);
        if (s == 0) return 0;
        return Math.mulDiv(q[i] * q[i], WAD, s);
    }
}
