// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "../helpers/Fixtures.sol";
import {Market} from "../../src/core/Market.sol";
import {DPMMath} from "../../src/math/DPMMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract MarketLiquidityTest is Fixtures {
    Market internal m;

    function setUp() public {
        _deployBase();
        m = _newMarket(SEED);
        _fund(alice, 1_000_000e6, address(m));
        _fund(bob, 1_000_000e6, address(m));
    }

    /// @dev The property that makes this an LP primitive rather than just a trade: the
    ///      probability does not move at all.
    function test_addLiquidityIsProbabilityNeutral() public {
        vm.prank(alice);
        m.buy(1, 300e18, type(uint256).max, alice); // put the market off balance first
        uint256 before = m.probability(1);

        vm.prank(bob);
        m.addLiquidity(500e6, 0, bob);

        uint256 diff = m.probability(1) > before ? m.probability(1) - before : before - m.probability(1);
        assertLe(diff, 1e9, "probability moved by more than rounding dust");
    }

    function test_addLiquidityDeepensTheMarket() public {
        uint256 poolBefore = m.poolWad();
        vm.prank(bob);
        m.addLiquidity(500e6, 0, bob);
        assertGt(m.poolWad(), poolBefore);
        assertEq(m.poolWad(), DPMMath.costUp(m.qArray()));
    }

    function test_addLiquidityNeverChargesMoreThanOffered() public {
        uint256 balBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        m.addLiquidity(500e6, 0, bob);
        assertLe(balBefore - usdc.balanceOf(bob), 500e6);
    }

    function test_addLiquidityMintsNonTransferableSeedShares() public {
        vm.prank(bob);
        uint256[2] memory minted = m.addLiquidity(500e6, 0, bob);
        assertGt(minted[0], 0);
        assertEq(m.seedSharesOf(bob)[0], minted[0]);
        assertEq(shares.balanceOfOutcome(bob, address(m), 0), 0, "seed shares must not become ERC-1155");
    }

    function test_removeLiquidityReturnsCollateral() public {
        vm.prank(bob);
        m.addLiquidity(500e6, 0, bob);
        uint256 balBefore = usdc.balanceOf(bob);

        vm.prank(bob);
        uint256 got = m.removeLiquidity(1e17, 0, bob); // 10% of the current q
        assertGt(got, 0);
        assertEq(usdc.balanceOf(bob) - balBefore, got);
        assertEq(m.poolWad(), DPMMath.costUp(m.qArray()));
    }

    /// @dev A hard floor. This is what keeps qᵢ > 0 forever; without it C(q)/q_winning could
    ///      divide by zero at settle.
    function test_creatorCannotWithdrawItsSeed() public {
        vm.prank(creator);
        vm.expectRevert(Market.CreatorSeedFloor.selector);
        m.removeLiquidity(1e16, 0, creator);
    }

    function test_removeLiquidityCannotExceedOwnPosition() public {
        vm.prank(bob);
        vm.expectRevert(Market.InsufficientSeedShares.selector);
        m.removeLiquidity(1e17, 0, bob);
    }

    function test_lambdaAboveOneReverts() public {
        vm.prank(bob);
        vm.expectRevert(Market.BadLambda.selector);
        m.removeLiquidity(1e18 + 1, 0, bob);
    }

    /// @dev An exit path again: withdrawing liquidity must not be blocked by the pause.
    function test_removeLiquiditySucceedsWhilePaused() public {
        vm.prank(bob);
        m.addLiquidity(500e6, 0, bob);
        vm.prank(guardian);
        config.pause();
        vm.prank(bob);
        assertGt(m.removeLiquidity(5e16, 0, bob), 0);
    }

    function testFuzz_addThenRemoveNeverProfits(uint64 amount) public {
        vm.assume(amount >= 10e6 && amount <= 100_000e6);
        uint256 balBefore = usdc.balanceOf(bob);
        vm.startPrank(bob);
        m.addLiquidity(uint256(amount), 0, bob);
        uint256[2] memory q = m.qArray();
        uint256[2] memory held = m.seedSharesOf(bob);
        // withdraw the largest fraction still covered by one's own position
        uint256 lambda = Math.min((held[0] * 1e18) / q[0], (held[1] * 1e18) / q[1]);
        if (lambda > 0) m.removeLiquidity(lambda, 0, bob);
        vm.stopPrank();
        assertLe(usdc.balanceOf(bob), balBefore);
    }
}
