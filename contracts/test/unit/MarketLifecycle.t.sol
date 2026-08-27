// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "../helpers/Fixtures.sol";
import {Market} from "../../src/core/Market.sol";
import {IMarket} from "../../src/interfaces/IMarket.sol";
import {DPMMath} from "../../src/math/DPMMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract MarketLifecycleTest is Fixtures {
    Market internal m;

    function setUp() public {
        _deployBase();
        m = _newMarket(SEED);
        _fund(alice, 1_000_000e6, address(m));
        vm.prank(alice);
        m.buy(1, 400e18, type(uint256).max, alice);
    }

    function test_closeOnlyAfterTradingEnd() public {
        vm.expectRevert(Market.TradingNotEnded.selector);
        m.close();
        vm.warp(m.tradingEnd());
        m.close();
        assertEq(uint8(m.status()), uint8(IMarket.Status.Closed));
    }

    function test_closedMarketRejectsAllTrading() public {
        vm.warp(m.tradingEnd());
        m.close();
        vm.startPrank(alice);
        vm.expectRevert(Market.NotOpen.selector);
        m.buy(1, 1e18, type(uint256).max, alice);
        vm.expectRevert(Market.NotOpen.selector);
        m.sell(1, 1e18, 0, alice);
        vm.stopPrank();
    }

    function test_onlyResolutionModuleCanSettle() public {
        vm.warp(m.tradingEnd());
        m.close();
        vm.prank(alice);
        vm.expectRevert(Market.NotResolutionModule.selector);
        m.settle(1);
    }

    /// @dev Payout dipotret sekali saat settle. Kalau tidak, penebus pertama dan
    ///      terakhir akan menerima kurs berbeda.
    function test_settleSnapshotsPayoutRate() public {
        vm.warp(m.tradingEnd());
        m.close();
        uint256 pool = m.poolWad();
        uint256[2] memory q = m.qArray();

        vm.prank(resolutionModule);
        m.settle(1);

        assertEq(uint8(m.status()), uint8(IMarket.Status.Settled));
        assertEq(m.winningOutcome(), 1);
        assertEq(m.payoutPerShareWad(), Math.mulDiv(DPMMath.WAD, pool, q[1]));
    }

    /// @dev Konsekuensi lantai seed: pembagi tidak pernah nol.
    function test_winningSupplyIsNeverZero() public {
        vm.warp(m.tradingEnd());
        m.close();
        vm.prank(resolutionModule);
        m.settle(0);
        assertGt(m.qArray()[0], 0);
        assertGt(m.payoutPerShareWad(), 0);
    }

    function test_failSnapshotsLiquidationRates() public {
        vm.warp(m.settlementDeadline());
        m.fail();
        assertEq(uint8(m.status()), uint8(IMarket.Status.Failed));
        uint256[2] memory rates = m.liqPerShare();
        assertGt(rates[0], 0);
        assertGt(rates[1], 0);
    }

    function test_anyoneCanFailAfterSettlementDeadline() public {
        vm.expectRevert(Market.BadTransition.selector);
        m.fail(); // masih Open dan belum lewat deadline
        vm.warp(m.settlementDeadline());
        vm.prank(bob);
        m.fail();
        assertEq(uint8(m.status()), uint8(IMarket.Status.Failed));
    }

    function test_onlyGuardianCanVoidAndOnlyWhileOpen() public {
        vm.prank(alice);
        vm.expectRevert(Market.NotGuardian.selector);
        m.void("abuse");

        vm.warp(m.tradingEnd());
        m.close();
        vm.prank(guardian);
        vm.expectRevert(Market.BadTransition.selector);
        m.void("abuse");
    }

    function test_voidSlashesSettlementDepositToTreasury() public {
        uint256 deposit = m.settlementDeposit();
        uint256 before = usdc.balanceOf(treasury);
        vm.prank(guardian);
        m.void("abuse");
        assertEq(uint8(m.status()), uint8(IMarket.Status.Voided));
        assertGe(usdc.balanceOf(treasury) - before, deposit);
    }

    function test_settleDistributesFeesAndDeposit() public {
        uint256 fees = m.feeAccrued();
        assertGt(fees, 0);
        uint256 creatorBefore = usdc.balanceOf(creator);
        uint256 resolverBefore = usdc.balanceOf(resolutionModule);

        vm.warp(m.tradingEnd());
        m.close();
        vm.prank(resolutionModule);
        m.settle(1);

        assertEq(m.feeAccrued(), 0);
        assertEq(m.settlementDeposit(), 0);
        assertEq(usdc.balanceOf(creator) - creatorBefore, (fees * 4000) / 10_000);
        assertEq(usdc.balanceOf(resolutionModule) - resolverBefore, (fees * 3000) / 10_000 + DEPOSIT);
    }

    function test_cannotSettleTwice() public {
        vm.warp(m.tradingEnd());
        m.close();
        vm.startPrank(resolutionModule);
        m.settle(1);
        vm.expectRevert(Market.BadTransition.selector);
        m.settle(0);
        vm.stopPrank();
    }
}
