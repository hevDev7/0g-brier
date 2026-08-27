// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "../helpers/Fixtures.sol";
import {Market} from "../../src/core/Market.sol";
import {DPMMath} from "../../src/math/DPMMath.sol";

contract MarketSellTest is Fixtures {
    Market internal m;

    function setUp() public {
        _deployBase();
        m = _newMarket(SEED);
        _fund(alice, 1_000_000e6, address(m));
        vm.prank(alice);
        m.buy(1, 500e18, type(uint256).max, alice);
    }

    function test_sellBurnsSharesAndPaysQuote() public {
        (uint256 quoted,) = m.quoteSell(1, 200e18);
        uint256 balBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        uint256 got = m.sell(1, 200e18, 0, alice);

        assertEq(got, quoted);
        assertEq(usdc.balanceOf(alice) - balBefore, quoted);
        assertEq(shares.balanceOfOutcome(alice, address(m), 1), 300e18);
    }

    function test_poolStillEqualsCostUpAfterSell() public {
        vm.prank(alice);
        m.sell(1, 200e18, 0, alice);
        assertEq(m.poolWad(), DPMMath.costUp(m.qArray()));
        assertGe(usdc.balanceOf(address(m)), m.collateralOwed());
    }

    function test_sellMovesProbabilityBack() public {
        uint256 before = m.probability(1);
        vm.prank(alice);
        m.sell(1, 500e18, 0, alice);
        assertLt(m.probability(1), before);
        assertEq(m.probability(1), 5e17); // kembali persis ke seed
    }

    function test_sellRespectsMinTokensOut() public {
        (uint256 quoted,) = m.quoteSell(1, 200e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Market.SlippageExceeded.selector, quoted, quoted + 1));
        m.sell(1, 200e18, quoted + 1, alice);
    }

    /// @dev Sifat non-negosiasi: pause TIDAK PERNAH menghalangi jalan keluar.
    function test_sellSucceedsWhilePaused() public {
        vm.prank(guardian);
        config.pause();
        vm.prank(alice);
        uint256 got = m.sell(1, 100e18, 0, alice);
        assertGt(got, 0);
    }

    function test_cannotSellMoreThanOwned() public {
        // Bare `vm.expectRevert()` tak bisa membedakan alasan revert. Pasokan
        // tradable outcome 1 di sini persis 500e18 (satu-satunya pembelian, oleh alice sendiri
        // di setUp), jadi menjual 600e18 SELALU menabrak lantai benih (_q turun di bawah
        // _seedSupply) SEBELUM burn ERC-1155 sempat dievaluasi sama sekali — burn tak pernah
        // tereksekusi karena SeedFloorBreached sudah revert lebih dulu di badan `sell`.
        // Selector dipatok eksplisit di sini supaya uji ini membuktikan mekanismenya,
        // bukan sekadar "sesuatu me-revert".
        vm.prank(alice);
        vm.expectRevert(Market.SeedFloorBreached.selector);
        m.sell(1, 600e18, 0, alice);
    }

    /// @dev Lembar seed BUKAN ERC-1155, jadi creator tidak punya saldo tradable
    ///      untuk dijual sama sekali — lantai seed terjaga secara struktural.
    function test_creatorCannotSellSeedShares() public {
        assertEq(shares.balanceOfOutcome(creator, address(m), 0), 0);
        // Sama seperti di atas: pasokan tradable outcome 0 di sini nol (tak seorang pun pernah
        // membelinya), jadi menjual walau 1 wei langsung menabrak lantai benih dan revert
        // SeedFloorBreached SEBELUM burn ERC-1155 (yang toh juga akan revert karena saldo
        // creator nol) sempat dievaluasi. Selector dipatok eksplisit alih-alih bare
        // `expectRevert()` supaya uji ini membuktikan mekanisme penjaganya, bukan cuma "revert".
        vm.prank(creator);
        vm.expectRevert(Market.SeedFloorBreached.selector);
        m.sell(0, 1e18, 0, creator);
    }

    /// @dev Beli lalu jual seketika TIDAK BOLEH menguntungkan. Ini penjaga utama
    ///      terhadap kesalahan tanda atau pembulatan pada cost function.
    function testFuzz_buyThenSellNeverProfits(uint64 amount) public {
        // Ambang naif `vm.assume(amount > 1e15 && amount < 1e21)` meloloskan banyak nilai yang
        // gagal SAH dengan TradeTooSmall sebelum assertion sempat berjalan — bukan di-skip oleh
        // vm.assume, tapi bikin `buy`/`sell` revert sungguhan dan seluruh fuzz run gagal.
        // Titik mula BUKAN benih simetris murni: `setUp` sudah membuat alice membeli 500e18
        // outcome 1, jadi saat bob mulai di sini q = (s, s+500e18) — asimetris, bukan (s, s).
        // costUp bergantung pada KEDUA q0 dan q1, jadi ambang debu leg beli/jual bob (yang
        // berdagang outcome 0) lebih tinggi daripada andai dihitung dari benih murni. Dicari
        // lewat pencarian biner atas rumus sungguhan (bukan andaian): ambang gabungan tempat
        // KEDUA leg tepat menyentuh MIN_TRADE_TOKENS (1e6) adalah 1_976_382_237_836_578_641 —
        // di bawahnya leg jual-balik jatuh ke 999_999 (grossTokens dibulatkan ke BAWAH sedangkan
        // costTokens leg beli dibulatkan ke ATAS, jadi leg jual selalu menyentuh ambang duluan).
        // Diverifikasi monoton lolos dari titik ini sampai type(uint64).max lewat sapuan 2000+
        // titik acak, jadi floor ini aman dipakai sebagai batas bawah `bound` tunggal. Batas atas
        // `< 1e21` pun tak berarti apa-apa untuk uint64 (maksimum ~1.8447e19 sudah di bawahnya)
        // — diganti eksplisit type(uint64).max lewat `bound`, bukan `vm.assume`, supaya fuzzer
        // tidak "menyerah" menolak terlalu banyak input di dekat ambang setipis ini.
        amount = uint64(bound(uint256(amount), 1_976_382_237_836_578_641, type(uint64).max));
        _fund(bob, 1_000_000e6, address(m));
        uint256 before = usdc.balanceOf(bob);

        vm.startPrank(bob);
        uint256 paid = m.buy(0, uint256(amount), type(uint256).max, bob);
        uint256 got = m.sell(0, uint256(amount), 0, bob);
        vm.stopPrank();

        assertLe(got, paid);
        assertLe(usdc.balanceOf(bob), before);
    }
}
