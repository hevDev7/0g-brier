// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DPMMath} from "../../src/math/DPMMath.sol";

/// @notice Pins DPMMath to the TypeScript mirror. That mirror is itself pinned to the
///         hand-computed golden values in packages/protocol/test/dpm.test.ts, so the two
///         sides cannot be wrong together.
contract DPMDifferentialTest is Test {
    function test_solidityMatchesTypeScriptMirror() public view {
        string memory json = vm.readFile("test/vectors/dpm.json");

        uint256[] memory q0 = vm.parseJsonUintArray(json, ".q0");
        uint256[] memory q1 = vm.parseJsonUintArray(json, ".q1");
        uint256[] memory expCost = vm.parseJsonUintArray(json, ".cost");
        uint256[] memory expCostUp = vm.parseJsonUintArray(json, ".costUp");
        uint256[] memory expPrice0 = vm.parseJsonUintArray(json, ".price0");
        uint256[] memory expProb0 = vm.parseJsonUintArray(json, ".prob0");
        uint256[] memory expSeed = vm.parseJsonUintArray(json, ".seed");

        assertGt(q0.length, 256, "too few vectors; run npm run gen:vectors");
        assertEq(q1.length, q0.length);

        // Three magnitude-coverage fences, each guarding a different property:
        //   - maxQ0 and bothLegsLarge guarantee that all 36 bucket pairs from scheme (b) in
        //     gen-vectors.ts are genuinely present, including (MAX_Q, MAX_Q) at case 35 —
        //     but both could pass on that constant line alone (zero RNG calls), so they do
        //     NOT prove rng128 (a) is actually in use.
        //   - beyondOldRngCeiling closes that gap: it counts q values that are NOT MAX_Q and
        //     exceed the old 2^64-1 ceiling — a property structurally reachable only through
        //     rng128, so a regression to a plain `rng() % modulus` is caught here even while
        //     the first two fences still pass.
        uint256 maxQ0 = 0;
        bool bothLegsLarge = false;
        uint256 beyondOldRngCeiling = 0;

        for (uint256 k = 0; k < q0.length; k++) {
            uint256[2] memory q;
            q[0] = q0[k];
            q[1] = q1[k];

            if (q0[k] > maxQ0) maxQ0 = q0[k];
            if (q0[k] >= 1e30 && q1[k] >= 1e30) bothLegsLarge = true;
            if (q0[k] != DPMMath.MAX_Q && q0[k] > type(uint64).max) beyondOldRngCeiling++;
            if (q1[k] != DPMMath.MAX_Q && q1[k] > type(uint64).max) beyondOldRngCeiling++;

            assertEq(DPMMath.cost(q), expCost[k], string.concat("cost mismatch at case ", vm.toString(k)));
            assertEq(DPMMath.costUp(q), expCostUp[k], string.concat("costUp mismatch at case ", vm.toString(k)));
            assertEq(DPMMath.price(q, 0), expPrice0[k], string.concat("price mismatch at case ", vm.toString(k)));
            assertEq(
                DPMMath.probability(q, 0), expProb0[k], string.concat("probability mismatch at case ", vm.toString(k))
            );
            assertEq(
                DPMMath.seedShares(q0[k]), expSeed[k], string.concat("seedShares mismatch at case ", vm.toString(k))
            );
        }

        assertGe(maxQ0, 1e30, "max q0 below 1e30 - magnitude coverage has narrowed; re-run npm run gen:vectors");
        assertTrue(bothLegsLarge, "no case with both legs >= 1e30 - re-run npm run gen:vectors");
        assertGt(
            beyondOldRngCeiling,
            0,
            "generator never exceeds 2^64 outside the MAX_Q constant - rng128 missing? run npm run gen:vectors"
        );
    }
}
