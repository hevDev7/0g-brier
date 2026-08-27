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

    /// @dev The fee ceiling is a promise to users, not a preference. The lock proves it.
    function test_feeCeilingIsThreePercentAndLocked() public {
        vm.expectRevert(
            abi.encodeWithSelector(ConfigRegistry.ParamOutOfBounds.selector, ConfigKeys.FEE_BPS, 301, 0, 300)
        );
        config.setParam(ConfigKeys.FEE_BPS, 301);
        vm.expectRevert(abi.encodeWithSelector(ConfigRegistry.BoundsLocked.selector, ConfigKeys.FEE_BPS));
        config.setBounds(ConfigKeys.FEE_BPS, 0, 10_000);
    }

    // ── operational addresses: the two a real deployment must be deliberate about ──
    //
    // The script used to set both TREASURY and CURATOR_SIGNER to the deployer with no chain
    // guard at all, while happily writing `deployments/<chainId>.json` for any chain it was
    // pointed at. That makes one EOA the protocol treasury AND the only key that can approve a
    // market — by accident, on a chain where it matters.

    address internal constant DEPLOYER = address(0xD1);
    address internal constant TREASURY = address(0x7);
    address internal constant CURATOR = address(0xC);
    uint256 internal constant GALILEO = 16602;

    function test_localChainMayFallBackToTheDeployer() public pure {
        (address treasury, address curator) =
            DeployLib.resolveOperationalAddresses(31337, address(0), address(0), DEPLOYER);
        assertEq(treasury, DEPLOYER);
        assertEq(curator, DEPLOYER);
    }

    /// @dev Even locally, an address that WAS supplied wins over the fallback — otherwise the
    ///      convenience would quietly override a deliberate choice.
    function test_localChainStillPrefersSuppliedAddresses() public pure {
        (address treasury, address curator) = DeployLib.resolveOperationalAddresses(31337, TREASURY, CURATOR, DEPLOYER);
        assertEq(treasury, TREASURY);
        assertEq(curator, CURATOR);
    }

    function test_nonLocalChainRefusesAnUnsetTreasury() public {
        vm.expectRevert(abi.encodeWithSelector(DeployLib.TreasuryUnset.selector, GALILEO));
        this.callResolve(GALILEO, address(0), CURATOR, DEPLOYER);
    }

    function test_nonLocalChainRefusesAnUnsetCuratorSigner() public {
        vm.expectRevert(abi.encodeWithSelector(DeployLib.CuratorSignerUnset.selector, GALILEO));
        this.callResolve(GALILEO, TREASURY, address(0), DEPLOYER);
    }

    function test_nonLocalChainAcceptsBothWhenSupplied() public view {
        (address treasury, address curator) =
            DeployLib.resolveOperationalAddresses(GALILEO, TREASURY, CURATOR, DEPLOYER);
        assertEq(treasury, TREASURY);
        assertEq(curator, CURATOR);
    }

    /// @dev Mainnet is not special-cased anywhere in the policy, and that is the point: the
    ///      fallback is allowed on exactly one chain id and every other chain — named,
    ///      unnamed, or not yet invented — goes through the same refusal.
    function test_mainnetGetsNoSpecialTreatment() public {
        vm.expectRevert(abi.encodeWithSelector(DeployLib.TreasuryUnset.selector, uint256(16661)));
        this.callResolve(16661, address(0), CURATOR, DEPLOYER);
    }

    /// @dev An external wrapper so `vm.expectRevert` binds to a real external call. A direct
    ///      internal library call is inlined, and the cheatcode would bind to whatever
    ///      external call happened next instead.
    function callResolve(uint256 chainId, address treasury, address curator, address deployer)
        external
        pure
        returns (address, address)
    {
        return DeployLib.resolveOperationalAddresses(chainId, treasury, curator, deployer);
    }

    function test_feeSharesSumToOneHundredPercent() public view {
        uint256 creator = config.params(ConfigKeys.CREATOR_FEE_SHARE_BPS);
        uint256 resolver = config.params(ConfigKeys.RESOLVER_FEE_SHARE_BPS);
        assertLe(creator + resolver, 10_000);
    }
}
