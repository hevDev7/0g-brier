// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "../helpers/Fixtures.sol";
import {Market} from "../../src/core/Market.sol";
import {IMarket} from "../../src/interfaces/IMarket.sol";

/**
 * `fail()` used to accept a market that was still trading.
 *
 * The guard it carried was a BLACKLIST — Settled, Failed, Voided — and `Open` was
 * simply not on it, while the module branch skipped the clock entirely. Its twin
 * `settle()` used a whitelist and refused the same market. One lifecycle, two
 * shapes of guard, opposite answers.
 *
 * It was not only premature. `_snapshotLiquidation` freezes the MARGINAL price,
 * and a buyer pays the integral under the cost curve, which convexity makes
 * strictly smaller — so buy-then-fail returned more than it cost, and Euler's
 * identity says every unit of that came out of the other holders.
 */
contract MarketExpiredWindowTest is Fixtures {
    Market internal m;

    function setUp() public {
        _deployBase();
        m = _newMarket(SEED);
        _fund(alice, 1_000_000e6, address(m));
        _fund(bob, 1_000_000e6, address(m));
    }

    function test_moduleCannotFailALiveMarket() public {
        assertEq(uint8(m.status()), uint8(IMarket.Status.Open));
        assertLt(block.timestamp, m.tradingEnd(), "still mid-trading");

        vm.prank(resolutionModule);
        vm.expectRevert(Market.TradingNotEnded.selector);
        m.fail();

        // The twin guard, for the contrast this test exists to hold.
        vm.prank(resolutionModule);
        vm.expectRevert(Market.BadTransition.selector);
        m.settle(1);
    }

    function test_buyThenFailNoLongerPays() public {
        vm.prank(bob);
        m.buy(1, 5_000e18, type(uint256).max, bob);

        vm.prank(resolutionModule);
        vm.expectRevert(Market.TradingNotEnded.selector);
        m.fail();
    }

    /// The path the fix must NOT break: nobody ever called `close()`, the settlement
    /// deadline has passed, and the market is still `Open`. A whitelist would strand
    /// its collateral forever; the clock check lets the rescue through.
    function test_rescueOfAnOpenMarketPastItsDeadlineStillWorks() public {
        vm.prank(alice);
        m.buy(1, 400e18, type(uint256).max, alice);

        vm.warp(m.settlementDeadline());
        assertEq(uint8(m.status()), uint8(IMarket.Status.Open), "never closed");

        m.fail(); // permissionless, and it must succeed
        assertEq(uint8(m.status()), uint8(IMarket.Status.Failed));

        vm.prank(alice);
        uint256 out = m.liquidate(alice);
        assertGt(out, 0, "the rescue has to actually return the money");
    }

    /// And the ordinary path: closed first, then failed by the module.
    function test_moduleCanStillFailAClosedMarket() public {
        vm.warp(m.tradingEnd());
        m.close();
        vm.prank(resolutionModule);
        m.fail();
        assertEq(uint8(m.status()), uint8(IMarket.Status.Failed));
    }

    /**
     * EVERY entry path, in the window between `tradingEnd` and somebody calling
     * `close()`. The status enum still reads `Open` here, so a guard that trusted
     * the status alone would let all four through — and only `buy` was pinned by a
     * test. The other three could have had their clock check deleted and the whole
     * suite would have stayed green.
     */
    function test_everyTradingPathIsShutByTheClockNotTheStatus() public {
        vm.prank(alice);
        m.buy(1, 400e18, type(uint256).max, alice);

        vm.warp(m.tradingEnd());
        assertEq(uint8(m.status()), uint8(IMarket.Status.Open), "nobody called close()");

        vm.startPrank(alice);
        vm.expectRevert(Market.TradingEnded.selector);
        m.buy(1, 1e18, type(uint256).max, alice);

        vm.expectRevert(Market.TradingEnded.selector);
        m.sell(1, 1e18, 0, alice);

        vm.expectRevert(Market.TradingEnded.selector);
        m.addLiquidity(100e6, 0, alice);

        vm.expectRevert(Market.TradingEnded.selector);
        m.removeLiquidity(1e18, 0, alice);
        vm.stopPrank();
    }

    /// One second earlier, the same four calls are fine. Without this the test above
    /// would pass against a contract that had simply broken trading altogether.
    function test_oneSecondEarlierTheSameCallsSucceed() public {
        vm.warp(m.tradingEnd() - 1);
        vm.startPrank(alice);
        m.buy(1, 100e18, type(uint256).max, alice);
        // Enough shares that the proceeds clear MIN_TRADE_TOKENS; a dust sell is
        // refused by a different guard and would prove nothing about the clock.
        m.sell(1, 50e18, 0, alice);
        m.addLiquidity(100e6, 0, alice);
        vm.stopPrank();
    }
}
