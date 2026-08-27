// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../../src/mocks/MockUSDC.sol";

contract MockUSDCTest is Test {
    MockUSDC internal usdc;
    address internal alice = makeAddr("alice");

    function setUp() public {
        usdc = new MockUSDC();
    }

    function test_hasSixDecimals() public view {
        assertEq(usdc.decimals(), 6);
    }

    function test_claimMintsFaucetAmount() public {
        vm.prank(alice);
        usdc.claim();
        assertEq(usdc.balanceOf(alice), usdc.FAUCET_AMOUNT());
    }

    function test_claimTwiceWithinCooldownReverts() public {
        vm.startPrank(alice);
        usdc.claim();
        vm.expectRevert(
            abi.encodeWithSelector(MockUSDC.FaucetCooldown.selector, block.timestamp + usdc.FAUCET_COOLDOWN())
        );
        usdc.claim();
        vm.stopPrank();
    }

    function test_claimAgainAfterCooldownSucceeds() public {
        vm.startPrank(alice);
        usdc.claim();
        vm.warp(block.timestamp + usdc.FAUCET_COOLDOWN());
        usdc.claim();
        vm.stopPrank();
        assertEq(usdc.balanceOf(alice), usdc.FAUCET_AMOUNT() * 2);
    }

    function test_mintToIsOpenForTests() public {
        usdc.mintTo(alice, 5e6);
        assertEq(usdc.balanceOf(alice), 5e6);
    }
}
