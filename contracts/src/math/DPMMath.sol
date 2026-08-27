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
///        • Σ pᵢ·qᵢ ≈ C(q), bisa melampaui poolWad ≤2 wei karena price() membagi
///          dengan cost() yang sudah dibulatkan ke bawah → likuidasi WAJIB clamp
///          payout total ke poolWad, bukan mengasumsikan Euler eksak
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

    error InsufficientSpend();

    /// @notice Lembar outcome `i` yang diperoleh bila `spendWad` masuk ke pool.
    /// @param spendWad bagian yang masuk pool — sudah bersih dari fee.
    /// @dev Untuk n = 2 tidak perlu iterasi Newton. Kita mencari x sehingga
    ///        √((qᵢ+x)² + q_j²) = C(q) + spend = C₁
    ///      yang menghasilkan bentuk tertutup
    ///        x = √(C₁² − q_j²) − qᵢ
    ///      Basis memakai costUp (sama dengan poolWad milik Market) dan hasil akhir
    ///      dibulatkan ke bawah, sehingga kuotasi tidak pernah melebih-lebihkan.
    ///      Ini KUOTASI, bukan otoritas: `Market.buy` menghitung ulang biaya sebenarnya
    ///      dan pemanggil melindungi diri lewat `maxTokensIn`.
    function sharesForSpend(uint256[2] memory q, uint8 i, uint256 spendWad) internal pure returns (uint256) {
        if (i > 1) revert BadOutcome();
        if (spendWad == 0) revert InsufficientSpend();

        uint256 j = i == 0 ? 1 : 0;
        uint256 c1 = costUp(q) + spendWad;
        if (c1 > MAX_Q) revert QOverflow();

        // c1 > C(q) ≥ q[j], jadi pengurangan di bawah tidak pernah underflow.
        uint256 inner = c1 * c1 - q[j] * q[j];
        uint256 newQi = Math.sqrt(inner, Math.Rounding.Floor);
        if (newQi <= q[i]) revert InsufficientSpend();
        return newQi - q[i];
    }
}
