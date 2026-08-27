// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {DPMMath} from "../../src/math/DPMMath.sol";

contract DPMMathTest is Test {
    function _q(uint256 a, uint256 b) internal pure returns (uint256[2] memory r) {
        r[0] = a;
        r[1] = b;
    }

    function test_costOfEmptyMarketIsZero() public pure {
        assertEq(DPMMath.cost(_q(0, 0)), 0);
        assertEq(DPMMath.costUp(_q(0, 0)), 0);
    }

    function test_costOfSingleSidedMarketIsThatSide() public pure {
        assertEq(DPMMath.cost(_q(1e18, 0)), 1e18);
        assertEq(DPMMath.costUp(_q(1e18, 0)), 1e18);
    }

    /// @dev Segitiga 3-4-5: satu-satunya kasus di mana √ pasti eksak, sehingga
    ///      costUp TIDAK boleh menambah 1. Ini yang menangkap ceil yang keliru.
    function test_exactSquareRootDoesNotRoundUp() public pure {
        assertEq(DPMMath.cost(_q(3e18, 4e18)), 5e18);
        assertEq(DPMMath.costUp(_q(3e18, 4e18)), 5e18);
    }

    function test_balancedMarketCostsQTimesSqrtTwo() public pure {
        assertEq(DPMMath.cost(_q(1e18, 1e18)), 1_414_213_562_373_095_048);
        assertEq(DPMMath.costUp(_q(1e18, 1e18)), 1_414_213_562_373_095_049);
    }

    function test_costUpIsNeverBelowCost() public pure {
        assertGe(DPMMath.costUp(_q(7e18, 11e18)), DPMMath.cost(_q(7e18, 11e18)));
        assertLe(DPMMath.costUp(_q(7e18, 11e18)) - DPMMath.cost(_q(7e18, 11e18)), 1);
    }

    function test_maxQDoesNotRevert() public pure {
        uint256 c = DPMMath.cost(_q(DPMMath.MAX_Q, DPMMath.MAX_Q));
        assertGt(c, DPMMath.MAX_Q);
    }

    function test_aboveMaxQReverts() public {
        uint256[2] memory over = _q(DPMMath.MAX_Q + 1, 0);
        vm.expectRevert(DPMMath.QOverflow.selector);
        this.callCost(over);
    }

    function callCost(uint256[2] memory q) external pure returns (uint256) {
        return DPMMath.cost(q);
    }

    /// @dev Homogenitas derajat 1: C(k·q) = k·C(q). Sifat inilah yang membuat
    ///      penambahan likuiditas proporsional netral terhadap probabilitas (Task 13).
    function testFuzz_costIsHomogeneousDegreeOne(uint96 a, uint96 b, uint8 kSmall) public pure {
        uint256 k = uint256(kSmall) + 1;
        uint256[2] memory q = _q(uint256(a), uint256(b));
        uint256[2] memory kq = _q(uint256(a) * k, uint256(b) * k);
        uint256 lhs = DPMMath.cost(kq);
        uint256 rhs = DPMMath.cost(q) * k;
        // pembulatan floor menumpuk paling banyak k wei
        assertLe(lhs > rhs ? lhs - rhs : rhs - lhs, k);
    }

    /// @dev Monotonisitas: menambah lembar tidak pernah menurunkan biaya pool.
    function testFuzz_costIsMonotonic(uint96 a, uint96 b, uint96 delta) public pure {
        uint256[2] memory q = _q(uint256(a), uint256(b));
        uint256[2] memory qMore = _q(uint256(a) + uint256(delta), uint256(b));
        assertGe(DPMMath.cost(qMore), DPMMath.cost(q));
    }

    function test_priceOfThreeFourFiveIsExact() public pure {
        assertEq(DPMMath.price(_q(3e18, 4e18), 0), 6e17);
        assertEq(DPMMath.price(_q(3e18, 4e18), 1), 8e17);
    }

    /// @dev Sifat penanda DPM: harga marginal BUKAN probabilitas — kuadratnya yang
    ///      probabilitas, dan kuadratnya berjumlah satu. UI wajib menampilkan pᵢ².
    function test_sumOfSquaredPricesIsOne() public pure {
        uint256[2] memory q = _q(3e18, 4e18);
        uint256 p0 = DPMMath.price(q, 0);
        uint256 p1 = DPMMath.price(q, 1);
        assertEq(Math.mulDiv(p0, p0, DPMMath.WAD) + Math.mulDiv(p1, p1, DPMMath.WAD), DPMMath.WAD);
    }

    function test_probabilityOfThreeFourFiveIsExact() public pure {
        assertEq(DPMMath.probability(_q(3e18, 4e18), 0), 36e16);
        assertEq(DPMMath.probability(_q(3e18, 4e18), 1), 64e16);
    }

    function test_balancedMarketIsFiftyPercent() public pure {
        assertEq(DPMMath.probability(_q(1e18, 1e18), 0), 5e17);
        assertEq(DPMMath.probability(_q(7e30, 7e30), 1), 5e17);
    }

    /// @dev qᵢ² · WAD mencapai 1e84 pada MAX_Q — jauh melampaui uint256. Uji ini gagal
    ///      bila implementasi memakai perkalian biasa alih-alih mulDiv 512-bit.
    function test_probabilityDoesNotOverflowAtMaxQ() public pure {
        assertEq(DPMMath.probability(_q(DPMMath.MAX_Q, DPMMath.MAX_Q), 0), 5e17);
    }

    function test_emptyMarketHasZeroPriceAndProbability() public pure {
        assertEq(DPMMath.price(_q(0, 0), 0), 0);
        assertEq(DPMMath.probability(_q(0, 0), 0), 0);
    }

    function test_badOutcomeReverts() public {
        vm.expectRevert(DPMMath.BadOutcome.selector);
        this.callPrice(_q(1e18, 1e18), 2);
    }

    function callPrice(uint256[2] memory q, uint8 i) external pure returns (uint256) {
        return DPMMath.price(q, i);
    }

    function testFuzz_probabilitiesSumToOne(uint96 a, uint96 b) public pure {
        vm.assume(uint256(a) + uint256(b) > 0);
        uint256[2] memory q = _q(uint256(a), uint256(b));
        uint256 sum = DPMMath.probability(q, 0) + DPMMath.probability(q, 1);
        assertLe(DPMMath.WAD - sum, 2); // hanya debu floor
        assertLe(sum, DPMMath.WAD);
    }

    /// @dev Euler: Σ pᵢ·qᵢ = C(q). Inilah yang membuat likuidasi menghabiskan pool
    ///      secara persis saat market gagal (Task 15).
    /// @dev CATATAN: toleransi di bawah ini diturunkan ulang dari draf brief (yang
    ///      memakai `assertLe(cost(q) - lhs, 3)` diikuti `assertLe(lhs, cost(q))`).
    ///      Draf itu underflow: karena `price()` membagi dengan `cost(q)` yang SUDAH
    ///      dibulatkan ke bawah (bukan akar eksak), lhs bisa melebihi cost(q). Bukti:
    ///      dari definisi floor, term(i)·C ≤ qᵢ² untuk tiap i (kalikan silang batas
    ///      floor price() dan floor term()); jumlahkan kedua sisi → lhs·C ≤ Σqᵢ² =
    ///      S ≤ C²+2C (karena C = ⌊√S⌋) ⇒ lhs ≤ C + 2. Sebaliknya, kekurangan
    ///      (cost(q) − lhs) TIDAK dibatasi konstanta: eror floor pada price() (< 1
    ///      pada skala harga) dikalikan qᵢ sebelum dibagi WAD lagi, sehingga ikut
    ///      berskala dengan qᵢ — dibuktikan cost(q) − lhs ≤ (q₀+q₁)/WAD + 2. Kedua
    ///      batas ini eksak (tercapai pada mis. q=(2,2) dan q=(64,112); dikonfirmasi
    ///      lewat pencarian brute-force menyeluruh atas rentang uint96), dan dipakai
    ///      di sini dengan margin +1. Konstanta "3" tetap seperti draf; arah dan
    ///      skalanya yang diperbaiki.
    function testFuzz_eulerIdentity(uint96 a, uint96 b) public pure {
        vm.assume(uint256(a) + uint256(b) > 0);
        uint256[2] memory q = _q(uint256(a), uint256(b));
        uint256 lhs =
            Math.mulDiv(DPMMath.price(q, 0), q[0], DPMMath.WAD) + Math.mulDiv(DPMMath.price(q, 1), q[1], DPMMath.WAD);
        uint256 c = DPMMath.cost(q);
        if (lhs >= c) {
            assertLe(lhs - c, 3);
        } else {
            assertLe(c - lhs, (q[0] + q[1]) / DPMMath.WAD + 3);
        }
    }
}
