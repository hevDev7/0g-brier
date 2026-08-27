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
import {InvariantBounds} from "../helpers/InvariantBounds.sol";

/// @dev An 18-decimal collateral ONLY for `test_liquidateClampsWhenFlooredLegsExceedPool`:
///      with `scale = 1`, `seedShares` can be pushed as low as a single wei — something
///      impossible through MockUSDC (6 decimals, `scale = 1e12`, so even one smallest token
///      unit already yields q ~7e11, far above the q<60 regime where the clamp matters).
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
        assertEq(m.seedSharesOf(creator)[0], 0, "the losing side must be forfeited");
        assertEq(m.seedSharesOf(creator)[1], 0);
    }

    /// @dev The conservation equation: total redemptions must not exceed the pool.
    function test_totalRedemptionsNeverExceedPool() public {
        _settleAs(1);
        uint256 poolTokens = usdc.balanceOf(address(m));

        vm.prank(alice);
        uint256 a = m.redeem(alice);
        vm.prank(creator);
        uint256 c = m.redeem(creator);

        assertLe(a + c, poolTokens);
        // What the balance must actually satisfy is solvency, not `>= 0` (vacuous for a
        // uint256): whatever is left still has to cover what the pool still owes.
        assertGe(usdc.balanceOf(address(m)), m.collateralOwed());
    }

    /// @dev Redeem must succeed even while the protocol is paused.
    function test_redeemSucceedsWhilePaused() public {
        _settleAs(1);
        vm.prank(guardian);
        config.pause();
        vm.prank(alice);
        assertGt(m.redeem(alice), 0);
    }

    /// @dev The Euler identity: liquidation pays pᵢ per share and exhausts the pool.
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
        assertGt(b, 0, "a losing-side holder still gets a refund when the market fails");
        assertGt(c, 0);
        // Two guessed bounds have already failed here. The brief wrote `assertLe(poolWad, 3)`,
        // which is off by two orders of magnitude for this fixture (the real leftover is 646).
        // The replacement, `< scale`, passes here but Task 18 then proved it non-general: at a
        // 10^12 fixture scale the leftover reaches 2.4e14 against a `scale` of 1e12. Both were
        // constants dressed up as reasoning — `scale` is a property of the COLLATERAL, and the
        // dust is a property of `q`.
        //
        // The bound used now is the derived one, `InvariantBounds.inv4LiquidationDust`, which
        // scales as (q₀+q₁)/WAD + 2H + 1 and carries its proof in that library. Three
        // liquidators paid here, so H = 3.
        uint256 tol = InvariantBounds.inv4LiquidationDust(m.qArray(), 3);
        assertLe(m.poolWad(), tol, "leftover poolWad exceeds the derived liquidation-dust bound");
    }

    /// @dev A concrete reproduction of the bug the reviewer found: at small q, two legs EACH
    ///      rounded down by `price()` can sum to MORE than `poolWad` (which is rounded UP via
    ///      `costUp`) even though the exact Euler identity equates them over the reals.
    ///      q=(2,2) is the smallest concrete case: floor cost = ⌊√8⌋ = 2, so price0=price1=WAD
    ///      (1:1), and the creator's seed payout is 2·WAD/WAD + 2·WAD/WAD = 4 — while
    ///      poolWad = costUp([2,2]) = ⌈√8⌉ = 3. Without the clamp, `poolWad -= payoutWad` in
    ///      `liquidate` underflows (Panic 0x11) and LOCKS user funds permanently. That regime
    ///      is unreachable through the default MIN_SEED (locked to [1e6, UNBOUNDED] by
    ///      DeployLib on the `config` Fixtures provides) or through MockUSDC (scale=1e12) — so
    ///      this test builds a NEW ConfigRegistry (MIN_SEED is never set, so `params()`
    ///      defaults to 0 — still through ConfigRegistry's public API, not a cheatcode or
    ///      direct storage write) and a separate 18-decimal collateral, so that a real q can
    ///      go as low as (2,2).
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
        // MIN_SEED/MIN_SETTLEMENT_DEPOSIT are deliberately NOT set: `params()` defaults to 0,
        // so `initialize` accepts seedTokens=3, depositTokens=0 as they are.
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
        assertEq(tiny.qArray()[0], 2, "seedShares(3) must yield q=(2,2)");
        assertEq(tiny.qArray()[1], 2);
        assertEq(tiny.poolWad(), 3, "poolWad = costUp([2,2]) = ceil(sqrt(8)) = 3");

        vm.warp(tiny.settlementDeadline());
        tiny.fail();

        uint256[2] memory liq = tiny.liqPerShare();
        assertEq(liq[0], DPMMath.WAD, "price0 = 2*WAD/floor(sqrt(8))=2 -> WAD");
        assertEq(liq[1], DPMMath.WAD);

        uint256[2] memory seed = tiny.seedSharesOf(creator);
        uint256 requested = Math.mulDiv(seed[0], liq[0], DPMMath.WAD) + Math.mulDiv(seed[1], liq[1], DPMMath.WAD);
        assertEq(requested, 4, "2*WAD/WAD + 2*WAD/WAD = 4, before the clamp");
        assertGt(requested, tiny.poolWad(), "the bug precondition: the floored request exceeds the pool");

        vm.prank(creator);
        uint256 got = tiny.liquidate(creator);

        assertEq(got, 3, "clamped to poolWad (3), not the raw request (4)");
        assertEq(tiny.poolWad(), 0, "the pool empties exactly, with no underflow");
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

    // ── after the sweep: the claim window is closed, and says so ─────────────
    //
    // `sweepUnclaimed` moves the entire remaining pool to the Treasury and permanently
    // ends the claim window — that is its documented purpose (spec §13.1, "unclaimed
    // funds"). What was undefined was how the two exits behave once it has run, and they
    // disagreed:
    //
    //   redeem    → `poolWad -= payoutWad` underflowed against a zeroed pool: Panic 0x11.
    //   liquidate → the clamp drove payoutWad to 0, so the call SUCCEEDED, paid nothing,
    //               and burned the holder's ERC-1155 shares anyway.
    //
    // Both were fund-safe — the money was already gone, legitimately — but one crashed and
    // the other silently destroyed a position. Neither told the caller what had happened.
    // The Panic was also load-bearing damage elsewhere: Task 18 had to keep
    // `sweepUnclaimed` out of the invariant handler entirely, because a known Panic would
    // have forced `invariant_noArithmeticPanic` to be weakened, and that invariant is
    // INV-3's teeth.
    //
    // Both exits now reject with `AlreadySwept`, which is a statement rather than a
    // symptom.

    function _sweep() internal {
        vm.warp(block.timestamp + config.params(ConfigKeys.SWEEP_UNCLAIMED_AFTER));
        m.sweepUnclaimed();
    }

    function test_redeemAfterSweepRevertsCleanlyInsteadOfPanicking() public {
        _settleAs(1);
        _sweep();

        vm.prank(alice);
        vm.expectRevert(Market.AlreadySwept.selector);
        m.redeem(alice);
    }

    /// @dev The sharper half: before this, `liquidate` did not revert at all. It burned the
    ///      holder's shares for a zero payout. The balance assertion below is what separates
    ///      "rejected" from "silently consumed" — it fails loudly if the call ever goes
    ///      through again.
    function test_liquidateAfterSweepRevertsAndDoesNotBurnShares() public {
        vm.warp(m.settlementDeadline());
        m.fail();
        uint256 held = shares.balanceOfOutcome(alice, address(m), 1);
        assertGt(held, 0, "precondition: alice holds a tradable position");

        _sweep();

        vm.prank(alice);
        vm.expectRevert(Market.AlreadySwept.selector);
        m.liquidate(alice);

        assertEq(shares.balanceOfOutcome(alice, address(m), 1), held, "shares must survive a rejected exit");
    }

    /// @dev A second sweep used to be blocked only by the accident of a zero balance. Making
    ///      it explicit is what lets `sweptAt` be trusted as the single closed-window flag.
    function test_sweepIsOneShot() public {
        _settleAs(1);
        _sweep();
        vm.expectRevert(Market.AlreadySwept.selector);
        m.sweepUnclaimed();
    }

    function test_sweepRecordsWhenItHappenedAndEmits() public {
        _settleAs(1);
        assertEq(m.sweptAt(), 0, "not swept yet");

        vm.warp(block.timestamp + config.params(ConfigKeys.SWEEP_UNCLAIMED_AFTER));
        uint256 remaining = usdc.balanceOf(address(m));
        vm.expectEmit(true, false, false, true, address(m));
        emit IMarket.Swept(treasury, remaining);
        m.sweepUnclaimed();

        assertEq(m.sweptAt(), uint64(block.timestamp));
    }

    // ── the pause never blocks an exit (spec §6.3) ───────────────────────────
    //
    // Only `redeem` was covered. `liquidate` is the other user exit, and `sweepUnclaimed`
    // is the governance path whose whole point is that it eventually runs — none of the
    // three may depend on the protocol being unpaused.

    function test_liquidateSucceedsWhilePaused() public {
        vm.warp(m.settlementDeadline());
        m.fail();
        vm.prank(guardian);
        config.pause();
        vm.prank(alice);
        assertGt(m.liquidate(alice), 0);
    }

    function test_sweepSucceedsWhilePaused() public {
        _settleAs(1);
        vm.warp(block.timestamp + config.params(ConfigKeys.SWEEP_UNCLAIMED_AFTER));
        vm.prank(guardian);
        config.pause();
        uint256 before = usdc.balanceOf(treasury);
        m.sweepUnclaimed();
        assertGt(usdc.balanceOf(treasury) - before, 0);
    }

    // ── the exit events an indexer rebuilds positions from ───────────────────

    function test_redeemEmitsRedeemedWithSharesAndTokens() public {
        _settleAs(1);
        uint256 amount = shares.balanceOfOutcome(alice, address(m), 1) + m.seedSharesOf(alice)[1];
        (uint256 expected,) = (0, 0);
        // The payout is recomputed here from the snapshotted rate rather than read back from
        // the call, so the event is checked against the contract's stated arithmetic and not
        // against its own return value.
        expected = Math.mulDiv(amount, m.payoutPerShareWad(), DPMMath.WAD) / m.scale();

        vm.expectEmit(true, false, false, true, address(m));
        emit IMarket.Redeemed(alice, amount, expected);
        vm.prank(alice);
        m.redeem(alice);
    }

    function test_liquidateEmitsLiquidatedWithBothLegs() public {
        vm.warp(m.settlementDeadline());
        m.fail();

        uint256[2] memory amounts;
        uint256 payoutWad;
        for (uint8 i = 0; i < 2; ++i) {
            amounts[i] = shares.balanceOfOutcome(alice, address(m), i) + m.seedSharesOf(alice)[i];
            payoutWad += Math.mulDiv(amounts[i], m.liqPerShare()[i], DPMMath.WAD);
        }

        vm.expectEmit(true, false, false, true, address(m));
        emit IMarket.Liquidated(alice, amounts, payoutWad / m.scale());
        vm.prank(alice);
        m.liquidate(alice);
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
