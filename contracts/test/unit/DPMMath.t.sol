// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
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

    /// @dev Segitiga 3-4-5: satu-satunya kasus di mana √ pasti eksak, sehingga
    ///      costUp TIDAK boleh menambah 1. Ini yang menangkap ceil yang keliru.
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

    /// @dev Homogenitas derajat 1: C(k·q) = k·C(q). Sifat inilah yang membuat
    ///      penambahan likuiditas proporsional netral terhadap probabilitas (Task 13).
    function testFuzz_costIsHomogeneousDegreeOne(uint96 a, uint96 b, uint8 kSmall) public pure {
        uint256 k = uint256(kSmall) + 1;
        uint256[2] memory q = _q(uint256(a), uint256(b));
        uint256[2] memory kq = _q(uint256(a) * k, uint256(b) * k);
        uint256 lhs = DPMMath.cost(kq);
        uint256 rhs = DPMMath.cost(q) * k;
        // pembulatan floor menumpuk paling banyak k wei
        assertLe(lhs > rhs ? lhs - rhs : rhs - lhs, k);
    }

    /// @dev Monotonisitas: menambah lembar tidak pernah menurunkan biaya pool.
    function testFuzz_costIsMonotonic(uint96 a, uint96 b, uint96 delta) public pure {
        uint256[2] memory q = _q(uint256(a), uint256(b));
        uint256[2] memory qMore = _q(uint256(a) + uint256(delta), uint256(b));
        assertGe(DPMMath.cost(qMore), DPMMath.cost(q));
    }
}
