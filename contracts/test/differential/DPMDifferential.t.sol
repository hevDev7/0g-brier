// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DPMMath} from "../../src/math/DPMMath.sol";

/// @notice Menyematkan DPMMath pada cermin TypeScript. Cermin itu sendiri disematkan
///         pada nilai emas hitung-tangan di packages/protocol/test/dpm.test.ts, sehingga
///         kedua sisi tidak bisa salah bersama-sama.
contract DPMDifferentialTest is Test {
    function test_solidityMatchesTypeScriptMirror() public view {
        string memory json = vm.readFile("test/vectors/dpm.json");

        uint256[] memory q0 = vm.parseJsonUintArray(json, ".q0");
        uint256[] memory q1 = vm.parseJsonUintArray(json, ".q1");
        uint256[] memory expCost = vm.parseJsonUintArray(json, ".cost");
        uint256[] memory expCostUp = vm.parseJsonUintArray(json, ".costUp");
        uint256[] memory expPrice0 = vm.parseJsonUintArray(json, ".price0");
        uint256[] memory expProb0 = vm.parseJsonUintArray(json, ".prob0");

        assertGt(q0.length, 256, "vektor terlalu sedikit; jalankan npm run gen:vectors");
        assertEq(q1.length, q0.length);

        for (uint256 k = 0; k < q0.length; k++) {
            uint256[2] memory q;
            q[0] = q0[k];
            q[1] = q1[k];

            assertEq(DPMMath.cost(q), expCost[k], string.concat("cost tidak cocok pada kasus ", vm.toString(k)));
            assertEq(DPMMath.costUp(q), expCostUp[k], string.concat("costUp tidak cocok pada kasus ", vm.toString(k)));
            assertEq(DPMMath.price(q, 0), expPrice0[k], string.concat("price tidak cocok pada kasus ", vm.toString(k)));
            assertEq(
                DPMMath.probability(q, 0),
                expProb0[k],
                string.concat("probability tidak cocok pada kasus ", vm.toString(k))
            );
        }
    }
}
