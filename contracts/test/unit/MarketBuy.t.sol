// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "../helpers/Fixtures.sol";
import {Market} from "../../src/core/Market.sol";
import {DPMMath} from "../../src/math/DPMMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract MarketBuyTest is Fixtures {
    Market internal m;

    function setUp() public {
        _deployBase();
        m = _newMarket(SEED);
        _fund(alice, 1_000_000e6, address(m));
        _fund(bob, 1_000_000e6, address(m));
    }

    function test_buyMovesProbabilityTowardBoughtSide() public {
        uint256 before = m.probability(1);
        vm.prank(alice);
        m.buy(1, 100e18, type(uint256).max, alice);
        assertGt(m.probability(1), before);
        // DPMMath.probability membulatkan p0 dan p1 ke bawah secara independen (mulDiv floor).
        // Untuk q simetris kedua pembagian pas persis (lihat MarketInitTest), tapi begitu q
        // asimetris — persis kondisi pasca-beli ini — jumlahnya bisa WAD atau WAD-1, tak
        // pernah lebih. Ini properti DPMMath yang sudah ada sejak Task 6-8, bukan bug `buy`.
        uint256 sumProb = m.probability(0) + m.probability(1);
        assertLe(sumProb, 1e18);
        assertGe(sumProb, 1e18 - 1);
    }

    function test_buyMintsSharesAndChargesQuote() public {
        (uint256 quoted, uint256 fee) = m.quoteBuy(1, 100e18);
        uint256 balBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        uint256 paid = m.buy(1, 100e18, type(uint256).max, alice);

        assertEq(paid, quoted);
        assertEq(balBefore - usdc.balanceOf(alice), quoted);
        assertEq(shares.balanceOfOutcome(alice, address(m), 1), 100e18);
        assertEq(m.feeAccrued(), fee);
    }

    /// @dev Invarian pusat, diperiksa setelah operasi nyata.
    function test_poolStillEqualsCostUpAfterBuy() public {
        vm.prank(alice);
        m.buy(0, 250e18, type(uint256).max, alice);
        assertEq(m.poolWad(), DPMMath.costUp(m.qArray()));
        assertGe(usdc.balanceOf(address(m)), m.collateralOwed());
    }

    function test_buyRespectsSlippageBound() public {
        (uint256 quoted,) = m.quoteBuy(1, 100e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Market.SlippageExceeded.selector, quoted, quoted - 1));
        m.buy(1, 100e18, quoted - 1, alice);
    }

    function test_buyToAnotherRecipient() public {
        vm.prank(alice);
        m.buy(1, 10e18, type(uint256).max, bob);
        assertEq(shares.balanceOfOutcome(bob, address(m), 1), 10e18);
        assertEq(shares.balanceOfOutcome(alice, address(m), 1), 0);
    }

    /// @dev Perdagangan debu ditolak: dengan pembulatan ke atas, pembelian sangat kecil
    ///      bisa menghasilkan biaya nol token dan memberi lembar gratis.
    function test_dustBuyReverts() public {
        vm.prank(alice);
        vm.expectRevert(Market.TradeTooSmall.selector);
        m.buy(1, 1, type(uint256).max, alice);
    }

    function test_buyRevertsWhenPaused() public {
        vm.prank(guardian);
        config.pause();
        vm.prank(alice);
        vm.expectRevert(Market.ProtocolPaused.selector);
        m.buy(1, 100e18, type(uint256).max, alice);
    }

    function test_buyRevertsAfterTradingEnd() public {
        vm.warp(m.tradingEnd());
        vm.prank(alice);
        vm.expectRevert(Market.TradingEnded.selector);
        m.buy(1, 100e18, type(uint256).max, alice);
    }

    function test_badOutcomeReverts() public {
        vm.prank(alice);
        vm.expectRevert(Market.BadOutcome.selector);
        m.buy(2, 100e18, type(uint256).max, alice);
    }

    /// @dev quoteBuySpend adalah taksiran: biaya sebenarnya tidak boleh melebihi nominal
    ///      yang diminta pengguna.
    function testFuzz_quoteBuySpendNeverOverpromises(uint96 spend) public {
        vm.assume(spend >= 1e6 && spend <= 100_000e6);
        (uint256 sharesOut,) = m.quoteBuySpend(1, uint256(spend));
        vm.assume(sharesOut > 0);
        (uint256 realCost,) = m.quoteBuy(1, sharesOut);
        // quoteBuySpend membalik fee lewat tokensIn·feeBps/(10000+feeBps) (floor), sedangkan
        // quoteBuy menghitung ulang fee dari costTokens hasil ceilDiv — dua pembulatan yang
        // independen ini kadang berpadu dan membuat realCost 1 unit token lebih tinggi dari
        // `spend`. Batas 1 unit ini murni pembulatan pada fungsi VIEW; `buy` sendiri tetap
        // memakai `maxTokensIn` untuk melindungi pemanggil — kuotasi ini sengaja tidak otoritatif.
        assertLe(realCost, uint256(spend) + 1);
        // Sisi bawah sama pentingnya: sharesForSpend mencari lembar TERBESAR yang muat dalam
        // anggaran, jadi realCost tak boleh jatuh jauh di bawah `spend` — kalau tidak, kuotasi
        // yang rusak total (mis. 1 wei lembar untuk anggaran $100rb) tetap lulus uji ini. Berlaku
        // untuk scale > 1 (collateral 6-desimal di fixture ini); pada scale == 1 batasnya T-1.
        assertGe(realCost, uint256(spend));
    }

    /// @dev Membeli dalam dua langkah tidak boleh lebih murah daripada sekali jalan
    ///      (path independence, dalam batas debu pembulatan).
    function testFuzz_buyIsPathIndependent(uint64 partA, uint64 partB) public {
        // Ambang lama (vm.assume(partA > 1e15 ...)) jauh di bawah MIN_TRADE_TOKENS (1e6 token,
        // collateral 6-desimal), dan lantai `bound` sebelumnya (2e18+1) terlalu jauh DI ATASNYA:
        // cari-biner eksak pada rumus sungguhan menunjukkan lembar sekecil 1413506453827668971
        // dari state benih simetris sudah menyentuh MIN_TRADE_TOKENS. Lantai di bawah ini adalah
        // satu di atas ambang eksak itu, supaya wilayah [1.4135e18, 2e18] — trade kecil-tapi-sah
        // tempat debu pembulatan [-1,+2] paling mungkin muncul — ikut tercakup fuzzer, bukan
        // cuma nilai jauh di atasnya. Di bawah ambang, `buy` sah revert TradeTooSmall (proteksi
        // debu yang sama seperti test_dustBuyReverts). `bound` memetakan setiap input alih-alih
        // menolaknya (vm.assume pada ambang setipis ini membuat fuzzer menyerah, "rejected too
        // many inputs").
        partA = uint64(bound(uint256(partA), 1413506453827668972, type(uint64).max));
        partB = uint64(bound(uint256(partB), 1413506453827668972, type(uint64).max));
        uint256 total = uint256(partA) + uint256(partB);
        (uint256 oneShot,) = m.quoteBuy(1, total);

        vm.startPrank(alice);
        uint256 first = m.buy(1, uint256(partA), type(uint256).max, alice);
        uint256 second = m.buy(1, uint256(partB), type(uint256).max, alice);
        vm.stopPrank();

        // costTokens terbelah lewat ceilDiv (condong menambah hingga +1 dibanding sekali jalan)
        // sedangkan fee terbelah lewat floor (condong mengurangi hingga -1) — keduanya bisa
        // berpadu. Rentang sebenarnya (first+second)-oneShot ∈ [-1, +2], bukan "tidak pernah
        // lebih murah dari 0". Ditulis lewat penjumlahan, bukan pengurangan, agar tak underflow.
        assertGe(first + second + 1, oneShot);
        assertLe(first + second, oneShot + 2);
    }
}
