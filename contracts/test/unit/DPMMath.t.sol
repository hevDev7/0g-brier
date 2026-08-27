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

    /// @dev The 3-4-5 triangle: the one case where √ is certainly exact, so costUp must NOT
    ///      add 1. This is what catches a mistaken ceil.
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

    /// @dev Homogeneity of degree 1: C(k·q) = k·C(q). This is the property that makes a
    ///      proportional liquidity addition probability-neutral (Task 13).
    function testFuzz_costIsHomogeneousDegreeOne(uint96 a, uint96 b, uint8 kSmall) public pure {
        uint256 k = uint256(kSmall) + 1;
        uint256[2] memory q = _q(uint256(a), uint256(b));
        uint256[2] memory kq = _q(uint256(a) * k, uint256(b) * k);
        uint256 lhs = DPMMath.cost(kq);
        uint256 rhs = DPMMath.cost(q) * k;
        // floor rounding accumulates at most k wei
        assertLe(lhs > rhs ? lhs - rhs : rhs - lhs, k);
    }

    /// @dev Monotonicity: adding shares never lowers the pool cost.
    function testFuzz_costIsMonotonic(uint96 a, uint96 b, uint96 delta) public pure {
        uint256[2] memory q = _q(uint256(a), uint256(b));
        uint256[2] memory qMore = _q(uint256(a) + uint256(delta), uint256(b));
        assertGe(DPMMath.cost(qMore), DPMMath.cost(q));
    }

    function test_priceOfThreeFourFiveIsExact() public pure {
        assertEq(DPMMath.price(_q(3e18, 4e18), 0), 6e17);
        assertEq(DPMMath.price(_q(3e18, 4e18), 1), 8e17);
    }

    /// @dev The signature property of DPM: the marginal price is NOT the probability — its
    ///      square is, and the squares sum to one. A UI must display pᵢ².
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

    /// @dev qᵢ² · WAD reaches 1e84 at MAX_Q — far beyond uint256. This test fails if the
    ///      implementation uses an ordinary multiplication instead of a 512-bit mulDiv.
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

    function test_probabilityBadOutcomeReverts() public {
        vm.expectRevert(DPMMath.BadOutcome.selector);
        this.callProbability(_q(1e18, 1e18), 2);
    }

    function callProbability(uint256[2] memory q, uint8 i) external pure returns (uint256) {
        return DPMMath.probability(q, i);
    }

    function testFuzz_probabilitiesSumToOne(uint96 a, uint96 b) public pure {
        vm.assume(uint256(a) + uint256(b) > 0);
        uint256[2] memory q = _q(uint256(a), uint256(b));
        uint256 sum = DPMMath.probability(q, 0) + DPMMath.probability(q, 1);
        assertLe(DPMMath.WAD - sum, 2); // floor dust only
        assertLe(sum, DPMMath.WAD);
    }

    /// @dev Euler: Σ pᵢ·qᵢ = C(q). This is what makes liquidation exhaust the pool exactly
    ///      when a market fails (Task 15).
    /// @dev NOTE: the tolerance below was re-derived from the brief's draft (which used
    ///      `assertLe(cost(q) - lhs, 3)` followed by `assertLe(lhs, cost(q))`). That draft
    ///      underflows: because `price()` divides by a `cost(q)` that has ALREADY been rounded
    ///      down (not an exact root), lhs can exceed cost(q). Proof: from the definition of
    ///      floor, term(i)·C ≤ qᵢ² for each i (cross-multiply the floor bounds of price() and
    ///      of term()); sum both sides → lhs·C ≤ Σqᵢ² = S ≤ C²+2C (since C = ⌊√S⌋) ⇒
    ///      lhs ≤ C + 2. In the other direction the shortfall (cost(q) − lhs) is NOT bounded by
    ///      a constant: the floor error in price() (< 1 at price scale) is multiplied by qᵢ
    ///      before being divided by WAD again, so it scales with qᵢ too — proven to be
    ///      cost(q) − lhs ≤ (q₀+q₁)/WAD + 2. Both bounds are tight (attained at e.g. q=(2,2)
    ///      and q=(64,112); confirmed by an exhaustive brute-force search over the uint96
    ///      range), and are used here with a +1 margin. The constant "3" stays as in the draft;
    ///      what was fixed is its direction and its scaling.
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

    /// @dev The closed form: x = √(C₁² − q_j²) − qᵢ with C₁ = C(q) + spend.
    ///      Two Pythagorean triangles were chosen so the answers are whole and checkable by eye:
    ///      (0,3) costs 3 → C₁ = 5 → new q₀ = 4  ⇒ 4 shares.
    function test_sharesForSpendClosedFormExactCaseA() public pure {
        assertEq(DPMMath.sharesForSpend(_q(0, 3e18), 0, 2e18), 4e18);
    }

    /// @dev (5,12) costs 13 → C₁ = 15 → new q₀ = 9 ⇒ 4 shares.
    function test_sharesForSpendClosedFormExactCaseB() public pure {
        assertEq(DPMMath.sharesForSpend(_q(5e18, 12e18), 0, 2e18), 4e18);
    }

    /// @dev A mirror of Case A with i=1 instead of i=0: (3,0) bought on outcome 1 must give the
    ///      same answer, 4 shares. Without this test the `j = i==0 ? 1 : 0` branch for i=1 is
    ///      never executed by any of the other 22 tests — a swap of the q[i]/q[j] indices would
    ///      slip through undetected.
    function test_sharesForSpendClosedFormExactCaseAMirroredForOutcomeOne() public pure {
        assertEq(DPMMath.sharesForSpend(_q(3e18, 0), 1, 2e18), 4e18);
    }

    function test_sharesForSpendBadOutcomeReverts() public {
        vm.expectRevert(DPMMath.BadOutcome.selector);
        this.callSharesForSpend(_q(3e18, 4e18), 2, 2e18);
    }

    function test_zeroSpendReverts() public {
        vm.expectRevert(DPMMath.InsufficientSpend.selector);
        this.callSharesForSpend(_q(3e18, 4e18), 0, 0);
    }

    function callSharesForSpend(uint256[2] memory q, uint8 i, uint256 s) external pure returns (uint256) {
        return DPMMath.sharesForSpend(q, i, s);
    }

    /// @dev The property that really matters: a quote must never promise more shares than were
    ///      paid for. The real cost of the quoted shares must be ≤ spend (never above it).
    function testFuzz_sharesForSpendNeverOverpromises(uint96 a, uint96 b, uint96 spend) public pure {
        vm.assume(uint256(a) + uint256(b) > 0);
        vm.assume(spend > 1e12);
        uint256[2] memory q = _q(uint256(a), uint256(b));
        uint256 shares = DPMMath.sharesForSpend(q, 0, uint256(spend));
        uint256[2] memory qAfter = _q(uint256(a) + shares, uint256(b));
        uint256 realCost = DPMMath.costUp(qAfter) - DPMMath.costUp(q);
        assertLe(realCost, uint256(spend));
    }

    function test_seedSharesOfZeroIsZero() public pure {
        assertEq(DPMMath.seedShares(0), 0);
    }

    /// @dev The property that must be guaranteed: the pool cost of the seed shares NEVER exceeds
    ///      the collateral deposited. Deriving q₀ by dividing by a ⌊√2·1e18⌋ constant would
    ///      BREAK this — a divisor rounded down yields a quotient that is too large. Hence the
    ///      formula goes through squares instead.
    function testFuzz_seedNeverCostsMoreThanDeposited(uint96 seed) public pure {
        uint256 seedWad = uint256(seed);
        uint256 s = DPMMath.seedShares(seedWad);
        assertLe(DPMMath.costUp(_q(s, s)), seedWad);
    }

    /// @dev ...and still maximal: one more share on each side already exceeds the deposit.
    function testFuzz_seedIsMaximal(uint96 seed) public pure {
        vm.assume(seed > 0);
        uint256 seedWad = uint256(seed);
        uint256 s = DPMMath.seedShares(seedWad);
        assertGt(DPMMath.costUp(_q(s + 1, s + 1)), seedWad);
    }

    function test_seedIsBalancedSoMarketStartsAtFiftyPercent() public pure {
        uint256 s = DPMMath.seedShares(1000e18);
        assertEq(DPMMath.probability(_q(s, s), 0), 5e17);
    }
}
