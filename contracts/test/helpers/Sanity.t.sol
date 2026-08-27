// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev Membuktikan toolchain terpasang benar: forge-std terhubung, dan OZ Math
///      menyediakan sqrt dengan mode pembulatan — dasar seluruh DPMMath.
contract SanityTest is Test {
    function test_ozSqrtSupportsRounding() public pure {
        assertEq(Math.sqrt(2, Math.Rounding.Floor), 1);
        assertEq(Math.sqrt(2, Math.Rounding.Ceil), 2);
        assertEq(Math.sqrt(4, Math.Rounding.Ceil), 2);
    }

    function test_ozMulDivHandles512Bit() public pure {
        // 1e66 * 1e18 melebihi uint256 bila dikalikan langsung; mulDiv harus tetap benar.
        uint256 big = 1e33 * 1e33;
        assertEq(Math.mulDiv(big, 1e18, big), 1e18);
    }
}
