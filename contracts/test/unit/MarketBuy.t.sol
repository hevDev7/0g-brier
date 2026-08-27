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
        // DPMMath.probability rounds p0 and p1 down independently (mulDiv floor). For a
        // symmetric q both divisions land exactly (see MarketInitTest), but once q is
        // asymmetric — exactly this post-buy condition — the sum can be WAD or WAD-1, never
        // more. This is a DPMMath property present since Tasks 6-8, not a bug in `buy`.
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

    /// @dev The central invariant, checked after a real operation.
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

    /// @dev Dust trades are rejected: with rounding up, a very small purchase could come to a
    ///      cost of zero tokens and hand out free shares.
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

    /// @dev quoteBuySpend is an estimate: the real cost must not exceed the notional the user
    ///      asked for.
    function testFuzz_quoteBuySpendNeverOverpromises(uint96 spend) public {
        vm.assume(spend >= 1e6 && spend <= 100_000e6);
        (uint256 sharesOut,) = m.quoteBuySpend(1, uint256(spend));
        vm.assume(sharesOut > 0);
        (uint256 realCost,) = m.quoteBuy(1, sharesOut);
        // quoteBuySpend inverts the fee via tokensIn·feeBps/(10000+feeBps) (floor), whereas
        // quoteBuy recomputes the fee from a ceilDiv'd costTokens — these two independent
        // roundings sometimes compound and put realCost one token unit above `spend`. That
        // one-unit margin is pure rounding on a VIEW function; `buy` itself still uses
        // `maxTokensIn` to protect the caller — this quote is deliberately not authoritative.
        assertLe(realCost, uint256(spend) + 1);
        // The lower side matters just as much: sharesForSpend looks for the LARGEST share count
        // that fits inside the budget, so realCost must not fall far below `spend` — otherwise
        // a completely broken quote (say 1 wei of shares for a $100k budget) would still pass
        // this test. Holds for scale > 1 (the 6-decimal collateral in this fixture); at
        // scale == 1 the bound is T-1.
        assertGe(realCost, uint256(spend));
    }

    /// @dev Buying in two steps must not be cheaper than buying in one (path independence,
    ///      within the bounds of rounding dust).
    function testFuzz_buyIsPathIndependent(uint64 partA, uint64 partB) public {
        // The old threshold (vm.assume(partA > 1e15 ...)) sat far below MIN_TRADE_TOKENS (1e6
        // tokens, 6-decimal collateral), and the previous `bound` floor (2e18+1) sat far ABOVE
        // it: an exact binary search on the real formula shows that a share count as small as
        // 1413506453827668971 out of the symmetric seed state already reaches MIN_TRADE_TOKENS.
        // The floor below is one above that exact threshold, so the region [1.4135e18, 2e18] —
        // the small-but-valid trades where the [-1,+2] rounding dust is most likely to appear —
        // is covered by the fuzzer too, not merely values far above it. Below the threshold
        // `buy` legitimately reverts TradeTooSmall (the same dust protection as
        // test_dustBuyReverts). `bound` maps every input instead of rejecting it (vm.assume on
        // a threshold this thin makes the fuzzer give up with "rejected too many inputs").
        partA = uint64(bound(uint256(partA), 1413506453827668972, type(uint64).max));
        partB = uint64(bound(uint256(partB), 1413506453827668972, type(uint64).max));
        uint256 total = uint256(partA) + uint256(partB);
        (uint256 oneShot,) = m.quoteBuy(1, total);

        vm.startPrank(alice);
        uint256 first = m.buy(1, uint256(partA), type(uint256).max, alice);
        uint256 second = m.buy(1, uint256(partB), type(uint256).max, alice);
        vm.stopPrank();

        // costTokens splits through ceilDiv (biased upward by as much as +1 against the one-shot
        // path) while the fee splits through floor (biased downward by as much as -1) — and the
        // two can compound. The real range of (first+second)-oneShot is [-1, +2], not "never
        // cheaper than 0". Written as addition rather than subtraction so it cannot underflow.
        assertGe(first + second + 1, oneShot);
        assertLe(first + second, oneShot + 2);
    }
}
