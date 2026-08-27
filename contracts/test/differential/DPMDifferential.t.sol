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
        uint256[] memory expSeed = vm.parseJsonUintArray(json, ".seed");

        assertGt(q0.length, 256, "vektor terlalu sedikit; jalankan npm run gen:vectors");
        assertEq(q1.length, q0.length);

        // Tiga pagar cakupan magnitudo, masing-masing menjaga properti berbeda:
        //   - maxQ0 dan bothLegsLarge menjamin seluruh 36 pasangan bucket dari skema (b)
        //     di gen-vectors.ts benar-benar hadir, termasuk (MAX_Q, MAX_Q) di kasus 35 —
        //     tapi keduanya bisa lolos semata dari baris konstanta itu (nol panggilan
        //     RNG), jadi TIDAK membuktikan rng128 (a) sungguh dipakai.
        //   - beyondOldRngCeiling menutup celah itu: menghitung nilai q BUKAN MAX_Q yang
        //     melampaui batas lama 2^64-1 — properti yang secara struktural hanya
        //     tercapai lewat rng128, sehingga regresi ke `rng() % modulus` polos
        //     tertangkap di sini walau dua pagar pertama tetap lolos.
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

            assertEq(DPMMath.cost(q), expCost[k], string.concat("cost tidak cocok pada kasus ", vm.toString(k)));
            assertEq(DPMMath.costUp(q), expCostUp[k], string.concat("costUp tidak cocok pada kasus ", vm.toString(k)));
            assertEq(DPMMath.price(q, 0), expPrice0[k], string.concat("price tidak cocok pada kasus ", vm.toString(k)));
            assertEq(
                DPMMath.probability(q, 0),
                expProb0[k],
                string.concat("probability tidak cocok pada kasus ", vm.toString(k))
            );
            assertEq(
                DPMMath.seedShares(q0[k]),
                expSeed[k],
                string.concat("seedShares tidak cocok pada kasus ", vm.toString(k))
            );
        }

        assertGe(
            maxQ0, 1e30, "q0 maksimum di bawah 1e30 - cakupan magnitudo menyempit; jalankan ulang npm run gen:vectors"
        );
        assertTrue(bothLegsLarge, "tak ada kasus dengan kedua kaki >= 1e30 - jalankan ulang npm run gen:vectors");
        assertGt(
            beyondOldRngCeiling,
            0,
            "generator tidak melampaui 2^64 di luar konstanta MAX_Q - rng128 hilang? jalankan npm run gen:vectors"
        );
    }
}
