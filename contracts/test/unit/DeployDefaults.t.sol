// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ConfigRegistry} from "../../src/core/ConfigRegistry.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";
import {MockUSDC} from "../../src/mocks/MockUSDC.sol";
import {DeployLib} from "../../script/DeployLib.sol";

contract DeployDefaultsTest is Test {
    ConfigRegistry internal config;
    MockUSDC internal usdc;

    function setUp() public {
        usdc = new MockUSDC();
        ConfigRegistry impl = new ConfigRegistry();
        config = ConfigRegistry(
            address(
                new ERC1967Proxy(
                    address(impl), abi.encodeCall(ConfigRegistry.initialize, (address(this), address(this)))
                )
            )
        );
        DeployLib.applyDefaults(config, address(usdc));
    }

    function test_defaultsMatchSpecTable() public view {
        assertEq(config.params(ConfigKeys.FEE_BPS), 100);
        assertEq(config.params(ConfigKeys.CREATOR_FEE_SHARE_BPS), 4000);
        assertEq(config.params(ConfigKeys.RESOLVER_FEE_SHARE_BPS), 3000);
        assertEq(config.params(ConfigKeys.MIN_SEED), 100e6);
        assertEq(config.params(ConfigKeys.MIN_SETTLEMENT_DEPOSIT), 20e6);
        assertEq(config.params(ConfigKeys.MIN_TRADE_TOKENS), 1e6);
        assertEq(config.params(ConfigKeys.SWEEP_UNCLAIMED_AFTER), 365 days);
    }

    function test_collateralIsAllowlisted() public view {
        assertTrue(config.allowedCollateral(address(usdc)));
    }

    /// @dev Plafon fee adalah janji ke pengguna, bukan preferensi. Kunci membuktikannya.
    function test_feeCeilingIsThreePercentAndLocked() public {
        vm.expectRevert(
            abi.encodeWithSelector(ConfigRegistry.ParamOutOfBounds.selector, ConfigKeys.FEE_BPS, 301, 0, 300)
        );
        config.setParam(ConfigKeys.FEE_BPS, 301);
        vm.expectRevert(abi.encodeWithSelector(ConfigRegistry.BoundsLocked.selector, ConfigKeys.FEE_BPS));
        config.setBounds(ConfigKeys.FEE_BPS, 0, 10_000);
    }

    function test_feeSharesSumToOneHundredPercent() public view {
        uint256 creator = config.params(ConfigKeys.CREATOR_FEE_SHARE_BPS);
        uint256 resolver = config.params(ConfigKeys.RESOLVER_FEE_SHARE_BPS);
        assertLe(creator + resolver, 10_000);
    }
}
