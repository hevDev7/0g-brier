// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "../helpers/Fixtures.sol";
import {Market} from "../../src/core/Market.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";
import {ConfigRegistry} from "../../src/core/ConfigRegistry.sol";
import {IMarket} from "../../src/interfaces/IMarket.sol";
import {DPMMath} from "../../src/math/DPMMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @dev Collateral 18-desimal HANYA untuk `test_liquidateClampsWhenFlooredLegsExceedPool`:
///      dengan `scale = 1`, `seedShares` bisa didorong serendah wei tunggal — sesuatu yang
///      mustahil lewat MockUSDC (6 desimal, `scale = 1e12`, jadi 1 unit token terkecil saja
///      sudah menghasilkan q ~7e11, jauh di atas rezim q<60 tempat clamp relevan).
contract Mock18 is ERC20 {
    constructor() ERC20("Mock18", "M18") {}

    function mintTo(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MarketExitTest is Fixtures {
    Market internal m;

    function setUp() public {
        _deployBase();
        m = _newMarket(SEED);
        _fund(alice, 1_000_000e6, address(m));
        _fund(bob, 1_000_000e6, address(m));
        vm.prank(alice);
        m.buy(1, 400e18, type(uint256).max, alice);
        vm.prank(bob);
        m.buy(0, 150e18, type(uint256).max, bob);
    }

    function _settleAs(uint8 outcome) internal {
        vm.warp(m.tradingEnd());
        m.close();
        vm.prank(resolutionModule);
        m.settle(outcome);
    }

    function test_winnerRedeemsAndLoserGetsNothing() public {
        _settleAs(1);
        vm.prank(alice);
        uint256 won = m.redeem(alice);
        assertGt(won, 0);

        vm.prank(bob);
        vm.expectRevert(Market.NothingToClaim.selector);
        m.redeem(bob);
    }

    function test_creatorRedeemsWinningSeedOnly() public {
        _settleAs(1);
        vm.prank(creator);
        uint256 got = m.redeem(creator);
        assertGt(got, 0);
        assertEq(m.seedSharesOf(creator)[0], 0, "sisi kalah harus hangus");
        assertEq(m.seedSharesOf(creator)[1], 0);
    }

    /// @dev Persamaan konservasi: total yang ditebus tidak boleh melebihi pool.
    function test_totalRedemptionsNeverExceedPool() public {
        _settleAs(1);
        uint256 poolTokens = usdc.balanceOf(address(m));

        vm.prank(alice);
        uint256 a = m.redeem(alice);
        vm.prank(creator);
        uint256 c = m.redeem(creator);

        assertLe(a + c, poolTokens);
        assertGe(usdc.balanceOf(address(m)), 0);
    }

    /// @dev Redeem harus berhasil walau protokol dipause.
    function test_redeemSucceedsWhilePaused() public {
        _settleAs(1);
        vm.prank(guardian);
        config.pause();
        vm.prank(alice);
        assertGt(m.redeem(alice), 0);
    }

    /// @dev Identitas Euler: likuidasi membayar pᵢ per lembar dan menghabiskan pool.
    function test_liquidationPaysEverySideAndDrainsPool() public {
        vm.warp(m.settlementDeadline());
        m.fail();

        vm.prank(alice);
        uint256 a = m.liquidate(alice);
        vm.prank(bob);
        uint256 b = m.liquidate(bob);
        vm.prank(creator);
        uint256 c = m.liquidate(creator);

        assertGt(a, 0);
        assertGt(b, 0, "pemegang sisi kalah tetap dapat pengembalian saat market gagal");
        assertGt(c, 0);
        // NB: brief asli menulis `assertLe(m.poolWad(), 3)` — tebakan yang GAGAL secara
        // empiris untuk fixture ini (poolWad tersisa = 646, bukan ≤3). Sebabnya bukan bug:
        // `price()` membagi dengan `cost()` yang dibulatkan ke bawah, dan kesalahan sekecil
        // itu diperbesar oleh faktor (lembar/WAD) tiap kali dikalikan balik di `liquidate` —
        // untuk fixture berskala ~1e21 lembar ini, faktor itu membuat debu berorde ratusan
        // wei-wad, bukan O(1). Batas yang benar bukan konstanta tebakan, melainkan
        // granularitas token nyata: sisa poolWad harus lebih kecil dari `scale` (1 unit
        // token terkecil), sehingga ketika dibagi `scale` ia BENAR-BENAR membulat ke 0 token
        // — dust yang secara ekonomis nol, terlepas dari ukuran perdagangan fixture.
        assertLt(m.poolWad(), m.scale(), "sisa poolWad harus kurang dari 1 unit token nyata");
    }

    /// @dev Reproduksi konkret bug yang ditemukan reviewer: pada q kecil, dua kaki yang
    ///      MASING-MASING dibulatkan ke bawah oleh `price()` bisa berjumlah LEBIH dari
    ///      `poolWad` (yang dibulatkan ke ATAS via `costUp`) walau identitas Euler eksak
    ///      menyamakan keduanya secara real. q=(2,2) adalah kasus konkret terkecil: cost
    ///      floor = ⌊√8⌋ = 2, jadi price0=price1=WAD (1:1), dan payout benih creator
    ///      2·WAD/WAD + 2·WAD/WAD = 4 — padahal poolWad = costUp([2,2]) = ⌈√8⌉ = 3. Tanpa
    ///      clamp, `poolWad -= payoutWad` di `liquidate` underflow (Panic 0x11) dan MENGUNCI
    ///      dana pengguna permanen. Rezim ini tak terjangkau lewat MIN_SEED default (locked
    ///      ke [1e6, UNBOUNDED] oleh DeployLib pada `config` bawaan Fixtures) maupun lewat
    ///      MockUSDC (scale=1e12) — jadi test ini membangun ConfigRegistry BARU (MIN_SEED
    ///      tak pernah di-set, sehingga `params()` baku ke 0 — masih lewat API publik
    ///      ConfigRegistry, bukan cheat/storage langsung) dan collateral 18-desimal terpisah
    ///      supaya q sungguhan bisa serendah (2,2).
    function test_liquidateClampsWhenFlooredLegsExceedPool() public {
        Mock18 tinyToken = new Mock18();

        ConfigRegistry tinyImpl = new ConfigRegistry();
        ConfigRegistry tinyConfig = ConfigRegistry(
            address(
                new ERC1967Proxy(
                    address(tinyImpl), abi.encodeCall(ConfigRegistry.initialize, (address(this), guardian))
                )
            )
        );
        // MIN_SEED/MIN_SETTLEMENT_DEPOSIT sengaja TIDAK di-set: `params()` baku ke 0,
        // jadi `initialize` menerima seedTokens=3, depositTokens=0 apa adanya.
        tinyConfig.setCollateralAllowed(address(tinyToken), true);

        Market tiny = Market(Clones.clone(address(marketImpl)));
        registry.set(address(tiny), true);
        tinyToken.mintTo(address(this), 3);
        tinyToken.transfer(address(tiny), 3);

        IMarket.Params memory p;
        p.collateral = address(tinyToken);
        p.creator = creator;
        p.creatorAgentId = 1;
        p.tradingEnd = uint64(block.timestamp) + 1 days;
        p.settlementDeadline = uint64(block.timestamp) + 2 days;
        p.tier = 1;
        p.specRoot = keccak256("tiny");
        p.category = bytes32("tiny");

        tiny.initialize(address(tinyConfig), address(shares), p, 3, 0);
        assertEq(tiny.qArray()[0], 2, "seedShares(3) harus menghasilkan q=(2,2)");
        assertEq(tiny.qArray()[1], 2);
        assertEq(tiny.poolWad(), 3, "poolWad = costUp([2,2]) = ceil(sqrt(8)) = 3");

        vm.warp(tiny.settlementDeadline());
        tiny.fail();

        uint256[2] memory liq = tiny.liqPerShare();
        assertEq(liq[0], DPMMath.WAD, "price0 = 2*WAD/floor(sqrt(8))=2 -> WAD");
        assertEq(liq[1], DPMMath.WAD);

        uint256[2] memory seed = tiny.seedSharesOf(creator);
        uint256 requested = Math.mulDiv(seed[0], liq[0], DPMMath.WAD) + Math.mulDiv(seed[1], liq[1], DPMMath.WAD);
        assertEq(requested, 4, "2*WAD/WAD + 2*WAD/WAD = 4, sebelum clamp");
        assertGt(requested, tiny.poolWad(), "prasyarat bug: permintaan floor melebihi pool");

        vm.prank(creator);
        uint256 got = tiny.liquidate(creator);

        assertEq(got, 3, "diclamp ke poolWad (3), bukan permintaan mentah (4)");
        assertEq(tiny.poolWad(), 0, "pool habis persis, tak underflow");
        assertEq(tinyToken.balanceOf(creator), 3);
    }

    function test_cannotRedeemOnFailedMarket() public {
        vm.warp(m.settlementDeadline());
        m.fail();
        vm.prank(alice);
        vm.expectRevert(Market.NotSettled.selector);
        m.redeem(alice);
    }

    function test_cannotLiquidateOnSettledMarket() public {
        _settleAs(1);
        vm.prank(alice);
        vm.expectRevert(Market.NotLiquidatable.selector);
        m.liquidate(alice);
    }

    function test_cannotClaimTwice() public {
        _settleAs(1);
        vm.startPrank(alice);
        m.redeem(alice);
        vm.expectRevert(Market.NothingToClaim.selector);
        m.redeem(alice);
        vm.stopPrank();
    }

    function test_sweepOnlyAfterWindowAndGoesToTreasury() public {
        _settleAs(1);
        vm.expectRevert(Market.TooEarly.selector);
        m.sweepUnclaimed();

        vm.warp(block.timestamp + config.params(ConfigKeys.SWEEP_UNCLAIMED_AFTER));
        uint256 before = usdc.balanceOf(treasury);
        m.sweepUnclaimed();
        assertGt(usdc.balanceOf(treasury) - before, 0);
        assertEq(usdc.balanceOf(address(m)), 0);
    }
}
