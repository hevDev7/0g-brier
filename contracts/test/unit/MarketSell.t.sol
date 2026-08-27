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
        assertEq(m.probability(1), 5e17); // exactly back to the seed
    }

    function test_sellRespectsMinTokensOut() public {
        (uint256 quoted,) = m.quoteSell(1, 200e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Market.SlippageExceeded.selector, quoted, quoted + 1));
        m.sell(1, 200e18, quoted + 1, alice);
    }

    /// @dev A non-negotiable property: the pause NEVER blocks the way out.
    function test_sellSucceedsWhilePaused() public {
        vm.prank(guardian);
        config.pause();
        vm.prank(alice);
        uint256 got = m.sell(1, 100e18, 0, alice);
        assertGt(got, 0);
    }

    function test_cannotSellMoreThanOwned() public {
        // A bare `vm.expectRevert()` cannot tell revert reasons apart. The tradable supply of
        // outcome 1 here is exactly 500e18 (the only purchase, by alice herself in setUp), so
        // selling 600e18 ALWAYS hits the seed floor (_q falls below _seedSupply) BEFORE the
        // ERC-1155 burn is evaluated at all — the burn never executes because SeedFloorBreached
        // has already reverted earlier in the body of `sell`. The selector is pinned explicitly
        // here so this test proves the mechanism, not merely that "something reverted".
        vm.prank(alice);
        vm.expectRevert(Market.SeedFloorBreached.selector);
        m.sell(1, 600e18, 0, alice);
    }

    /// @dev Seed shares are NOT ERC-1155, so the creator has no tradable balance to sell at
    ///      all — the seed floor is held structurally.
    function test_creatorCannotSellSeedShares() public {
        assertEq(shares.balanceOfOutcome(creator, address(m), 0), 0);
        // As above: the tradable supply of outcome 0 here is zero (nobody ever bought it), so
        // selling even 1 wei hits the seed floor immediately and reverts SeedFloorBreached
        // BEFORE the ERC-1155 burn (which would revert anyway, the creator's balance being
        // zero) is evaluated. The selector is pinned explicitly rather than a bare
        // `expectRevert()` so this test proves the guard's mechanism, not merely "it reverted".
        vm.prank(creator);
        vm.expectRevert(Market.SeedFloorBreached.selector);
        m.sell(0, 1e18, 0, creator);
    }

    /// @dev Buying and then immediately selling MUST NOT be profitable. This is the principal
    ///      guard against a sign or rounding error in the cost function.
    function testFuzz_buyThenSellNeverProfits(uint64 amount) public {
        // The naive threshold `vm.assume(amount > 1e15 && amount < 1e21)` lets through many values
        // that fail LEGITIMATELY with TradeTooSmall before the assertion ever runs — not skipped
        // by vm.assume, but making `buy`/`sell` genuinely revert and the whole fuzz run fail.
        // The starting point is NOT a pure symmetric seed: `setUp` has already had alice buy
        // 500e18 of outcome 1, so when bob starts here q = (s, s+500e18) — asymmetric, not
        // (s, s). costUp depends on BOTH q0 and q1, so the dust threshold for bob's buy/sell
        // legs (he trades outcome 0) is higher than it would be from a pure seed. Found by
        // binary search over the real formula (not assumed): the combined threshold at which
        // BOTH legs just reach MIN_TRADE_TOKENS (1e6) is 1_976_382_237_836_578_641 — below it
        // the sell-back leg drops to 999_999 (grossTokens rounds DOWN while the buy leg's
        // costTokens rounds UP, so the sell leg always reaches the threshold first). Verified
        // to pass monotonically from this point up to type(uint64).max across a sweep of 2000+
        // random points, so this floor is safe as the single lower bound for `bound`. The upper
        // bound `< 1e21` means nothing for a uint64 either (its maximum ~1.8447e19 is already
        // below it) — replaced explicitly with type(uint64).max via `bound` rather than
        // `vm.assume`, so the fuzzer does not "give up" rejecting too many inputs near a
        // threshold this thin.
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
