// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ConfigRegistry} from "../../src/core/ConfigRegistry.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";

contract ConfigRegistryTest is Test {
    ConfigRegistry internal config;
    address internal owner = makeAddr("owner");
    address internal guardian = makeAddr("guardian");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        ConfigRegistry impl = new ConfigRegistry();
        bytes memory data = abi.encodeCall(ConfigRegistry.initialize, (owner, guardian));
        config = ConfigRegistry(address(new ERC1967Proxy(address(impl), data)));
    }

    function test_initializeSetsOwnerAndGuardian() public view {
        assertEq(config.owner(), owner);
        assertEq(config.guardian(), guardian);
        assertFalse(config.paused());
    }

    function test_setParamRequiresBoundsFirst() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ConfigRegistry.UnboundedParam.selector, ConfigKeys.FEE_BPS));
        config.setParam(ConfigKeys.FEE_BPS, 100);
    }

    function test_setParamWithinBoundsSucceeds() public {
        vm.startPrank(owner);
        config.setBounds(ConfigKeys.FEE_BPS, 0, 300);
        config.setParam(ConfigKeys.FEE_BPS, 100);
        vm.stopPrank();
        assertEq(config.params(ConfigKeys.FEE_BPS), 100);
    }

    function test_setParamAboveHardCeilingReverts() public {
        vm.startPrank(owner);
        config.setBounds(ConfigKeys.FEE_BPS, 0, 300);
        vm.expectRevert(
            abi.encodeWithSelector(ConfigRegistry.ParamOutOfBounds.selector, ConfigKeys.FEE_BPS, 301, 0, 300)
        );
        config.setParam(ConfigKeys.FEE_BPS, 301);
        vm.stopPrank();
    }

    /// @dev The most important property of this contract: bounds cannot be loosened once set.
    ///      Without it a "hard bound" is merely advice, because the owner could raise it.
    function test_boundsAreLockedForever() public {
        vm.startPrank(owner);
        config.setBounds(ConfigKeys.FEE_BPS, 0, 300);
        vm.expectRevert(abi.encodeWithSelector(ConfigRegistry.BoundsLocked.selector, ConfigKeys.FEE_BPS));
        config.setBounds(ConfigKeys.FEE_BPS, 0, 10_000);
        vm.stopPrank();
    }

    /// @dev Inverted bounds (lo > hi) must not lock a key permanently into an empty range —
    ///      a rejected call must not consume the one-shot key.
    function test_setBoundsRejectsInvertedRangeAndLeavesKeyUnlocked() public {
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(ConfigRegistry.BadBounds.selector, 300, 0));
        config.setBounds(ConfigKeys.FEE_BPS, 300, 0);

        config.setBounds(ConfigKeys.FEE_BPS, 0, 300);
        config.setParam(ConfigKeys.FEE_BPS, 100);
        vm.stopPrank();
        assertEq(config.params(ConfigKeys.FEE_BPS), 100);
    }

    function test_onlyOwnerCanSetParam() public {
        vm.prank(owner);
        config.setBounds(ConfigKeys.FEE_BPS, 0, 300);
        vm.prank(stranger);
        vm.expectRevert();
        config.setParam(ConfigKeys.FEE_BPS, 100);
    }

    function test_guardianCanPauseOwnerCanUnpause() public {
        vm.prank(guardian);
        config.pause();
        assertTrue(config.paused());

        vm.prank(guardian);
        vm.expectRevert();
        config.unpause();

        vm.prank(owner);
        config.unpause();
        assertFalse(config.paused());
    }

    function test_strangerCannotPause() public {
        vm.prank(stranger);
        vm.expectRevert(ConfigRegistry.NotGuardian.selector);
        config.pause();
    }

    function test_addressesAndCollateralAllowlist() public {
        address token = makeAddr("token");
        vm.startPrank(owner);
        config.setAddress(ConfigKeys.TREASURY, address(0xBEEF));
        config.setCollateralAllowed(token, true);
        vm.stopPrank();
        assertEq(config.addresses(ConfigKeys.TREASURY), address(0xBEEF));
        assertTrue(config.allowedCollateral(token));
    }
}
