// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "../helpers/Fixtures.sol";
import {Market} from "../../src/core/Market.sol";
import {IMarket} from "../../src/interfaces/IMarket.sol";
import {DPMMath} from "../../src/math/DPMMath.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

contract MarketInitTest is Fixtures {
    function setUp() public {
        _deployBase();
    }

    function test_marketOpensAtFiftyPercent() public {
        Market m = _newMarket(SEED);
        assertEq(uint8(m.status()), uint8(IMarket.Status.Open));
        assertEq(m.probability(0), 5e17);
        assertEq(m.probability(1), 5e17);
    }

    function test_creatorHoldsSeedOnBothSides() public {
        Market m = _newMarket(SEED);
        uint256[2] memory q = m.qArray();
        uint256[2] memory held = m.seedSharesOf(creator);
        assertEq(q[0], q[1]);
        assertEq(held[0], q[0]);
        assertEq(held[1], q[1]);
        assertEq(m.creatorSeed()[0], q[0]);
    }

    /// @dev Invarian pusat sistem, diperiksa sejak detik nol.
    function test_poolEqualsCostUpAtInit() public {
        Market m = _newMarket(SEED);
        assertEq(m.poolWad(), DPMMath.costUp(m.qArray()));
    }

    /// @dev Pool tidak pernah boleh menuntut lebih banyak collateral daripada yang ada.
    function test_collateralCoversPoolAndDeposit() public {
        Market m = _newMarket(SEED);
        assertGe(usdc.balanceOf(address(m)), m.collateralOwed());
        assertLe(Math.ceilDiv(m.poolWad(), m.scale()), SEED);
    }

    function test_scaleMatchesSixDecimalCollateral() public {
        Market m = _newMarket(SEED);
        assertEq(m.scale(), 1e12);
    }

    /// @dev Market yang sudah hidup KEBAL terhadap perubahan parameter. Fee dan
    ///      ukuran trade minimum dipotret saat inisialisasi, bukan dibaca tiap trade.
    function test_liveMarketIsImmuneToLaterConfigChanges() public {
        Market m = _newMarket(SEED);
        assertEq(m.feeBps(), 100);
        config.setParam(ConfigKeys.FEE_BPS, 300);
        assertEq(m.feeBps(), 100);
    }

    /// @dev Sama seperti `feeBps`/`minTradeTokens`: bagian fee creator dan resolver juga
    ///      dipotret saat inisialisasi, bukan dibaca ulang di `_distributeFees`. Tanpa ini,
    ///      `setParam` yang secara individual sah (masing-masing ≤ 10_000) tapi jumlahnya
    ///      melampaui 10_000 akan membekukan settle/fail/void SETIAP market yang sudah
    ///      hidup di bawah ConfigRegistry ini, bukan cuma market baru.
    function test_liveMarketKeepsSnapshottedFeeShares() public {
        Market m = _newMarket(SEED);
        assertEq(m.creatorFeeShareBps(), 4000);
        assertEq(m.resolverFeeShareBps(), 3000);

        // Keduanya individual sah (batas ConfigRegistry masing-masing [0, 10_000]) walau
        // jumlahnya 12_000 — persis skenario yang membekukan market TANPA potret ini.
        config.setParam(ConfigKeys.CREATOR_FEE_SHARE_BPS, 6000);
        config.setParam(ConfigKeys.RESOLVER_FEE_SHARE_BPS, 6000);

        assertEq(m.creatorFeeShareBps(), 4000);
        assertEq(m.resolverFeeShareBps(), 3000);
    }

    /// @dev `vm.expectRevert` mengikat ke panggilan BERIKUTNYA secara harfiah — termasuk
    ///      CREATE. `_newMarket` melakukan `Clones.clone` (sebuah CREATE) sebelum
    ///      `initialize`, jadi membungkus seluruh helper akan salah sasaran ke clone
    ///      yang sukses. Kloning dan pendanaan karena itu dilakukan manual di luar
    ///      jendela expectRevert, sama seperti `test_deadlinesMustBeOrdered` di bawah.
    function test_seedBelowMinimumReverts() public {
        Market m = Market(Clones.clone(address(marketImpl)));
        registry.set(address(m), true);
        uint256 seedTokens = 1e6; // MIN_SEED adalah 100e6
        usdc.mintTo(address(this), seedTokens + DEPOSIT);
        usdc.transfer(address(m), seedTokens + DEPOSIT);
        vm.expectRevert(Market.SeedTooSmall.selector);
        m.initialize(address(config), address(shares), _params(), seedTokens, DEPOSIT);
    }

    function test_disallowedCollateralReverts() public {
        config.setCollateralAllowed(address(usdc), false);
        Market m = Market(Clones.clone(address(marketImpl)));
        registry.set(address(m), true);
        usdc.mintTo(address(this), SEED + DEPOSIT);
        usdc.transfer(address(m), SEED + DEPOSIT);
        vm.expectRevert(Market.CollateralNotAllowed.selector);
        m.initialize(address(config), address(shares), _params(), SEED, DEPOSIT);
    }

    function test_deadlinesMustBeOrdered() public {
        Market m = Market(Clones.clone(address(marketImpl)));
        registry.set(address(m), true);
        IMarket.Params memory p = _params();
        p.settlementDeadline = p.tradingEnd - 1;
        usdc.mintTo(address(this), SEED + DEPOSIT);
        usdc.transfer(address(m), SEED + DEPOSIT);
        vm.expectRevert(Market.BadDeadlines.selector);
        m.initialize(address(config), address(shares), p, SEED, DEPOSIT);
    }

    /// @dev Ditolak SAAT LAHIR, bukan diam-diam disimpan lalu meledak (Panic underflow)
    ///      di settle/fail/void pertama. Kloning dan pendanaan tetap di luar jendela
    ///      expectRevert — sama seperti `test_seedBelowMinimumReverts` di atas.
    function test_initializeRevertsWhenFeeSharesExceedTotal() public {
        config.setParam(ConfigKeys.CREATOR_FEE_SHARE_BPS, 6000);
        config.setParam(ConfigKeys.RESOLVER_FEE_SHARE_BPS, 6000);

        Market m = Market(Clones.clone(address(marketImpl)));
        registry.set(address(m), true);
        usdc.mintTo(address(this), SEED + DEPOSIT);
        usdc.transfer(address(m), SEED + DEPOSIT);
        vm.expectRevert(abi.encodeWithSelector(Market.FeeSharesExceedTotal.selector, 6000, 6000));
        m.initialize(address(config), address(shares), _params(), SEED, DEPOSIT);
    }

    function test_cannotInitializeTwice() public {
        Market m = _newMarket(SEED);
        vm.expectRevert();
        m.initialize(address(config), address(shares), _params(), SEED, DEPOSIT);
    }

    function test_implementationCannotBeInitialized() public {
        vm.expectRevert();
        marketImpl.initialize(address(config), address(shares), _params(), SEED, DEPOSIT);
    }
}
