// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeployLib} from "../../script/DeployLib.sol";

/// @dev The mainnet-readiness finding, turned into something that fails a build.
///
///      The live Galileo deployment has ConfigRegistry's owner and guardian,
///      MarketFactory's owner, the module's owner, the treasury, the curator signer
///      AND the resolver allowlist all on ONE key. That key can settle any market to
///      any outcome, upgrade every contract, pause, approve every market and collect
///      every fee. It was the right call for a testnet and it must never travel, so
///      the refusal lives in code rather than in a checklist.
/// @dev An external wrapper, because `vm.expectRevert` binds to the next EXTERNAL call
///      and an `internal` library function is not one — the cheatcode then reports
///      that nothing reverted at a lower depth. The same trap this repo has paid for
///      twice already, in a third disguise.
contract RolesHarness {
    function resolve(uint256 chainId, DeployLib.Roles memory r, address deployer)
        external
        pure
        returns (DeployLib.Roles memory)
    {
        return DeployLib.resolveRoles(chainId, r, deployer);
    }
}

contract DeployRolesTest is Test {
    RolesHarness internal harness;

    function setUp() public {
        harness = new RolesHarness();
    }

    address internal constant DEPLOYER = address(0xD1);
    address internal constant GOV = address(0x60);
    address internal constant GUARD = address(0x64);
    address internal constant TREAS = address(0x77);
    address internal constant CURATOR = address(0xC0);

    function _full() internal pure returns (DeployLib.Roles memory) {
        return DeployLib.Roles({governance: GOV, guardian: GUARD, treasury: TREAS, curatorSigner: CURATOR});
    }

    function _empty() internal pure returns (DeployLib.Roles memory r) {
        r;
    }

    function test_anvilFillsEveryRoleWithTheDeployer() public pure {
        DeployLib.Roles memory r = DeployLib.resolveRoles(31337, _empty(), DEPLOYER);
        assertEq(r.governance, DEPLOYER);
        assertEq(r.guardian, DEPLOYER);
        assertEq(r.treasury, DEPLOYER);
        assertEq(r.curatorSigner, DEPLOYER);
    }

    function test_aTestnetMustNameEveryRole() public {
        vm.expectRevert(abi.encodeWithSelector(DeployLib.GovernanceUnset.selector, uint256(16602)));
        harness.resolve(16602, _empty(), DEPLOYER);
    }

    /// @dev A testnet may point every role at one key — that is what this project did,
    ///      deliberately — but it has to say so rather than get it by default.
    function test_aTestnetMayPointEveryRoleAtOneKeyIfItSaysSo() public pure {
        DeployLib.Roles memory one =
            DeployLib.Roles({governance: DEPLOYER, guardian: DEPLOYER, treasury: DEPLOYER, curatorSigner: DEPLOYER});
        DeployLib.Roles memory r = DeployLib.resolveRoles(16602, one, DEPLOYER);
        assertEq(r.governance, DEPLOYER, "a testnet was refused a shared key");
    }

    function test_mainnetRefusesEveryRoleTheDeployerHolds() public {
        bytes32[4] memory names = [bytes32("GOVERNANCE"), "GUARDIAN", "TREASURY", "CURATOR_SIGNER"];
        for (uint256 i = 0; i < 4; i++) {
            DeployLib.Roles memory r = _full();
            if (i == 0) r.governance = DEPLOYER;
            if (i == 1) r.guardian = DEPLOYER;
            if (i == 2) r.treasury = DEPLOYER;
            if (i == 3) r.curatorSigner = DEPLOYER;
            vm.expectRevert(abi.encodeWithSelector(DeployLib.RoleHeldByDeployer.selector, uint256(16661), names[i]));
            harness.resolve(16661, r, DEPLOYER);
        }
    }

    /// @dev The guardian exists so that fast action does not need the key that can
    ///      change the rules. One address holding both defeats the reason it exists.
    function test_mainnetRefusesAGuardianThatIsAlsoGovernance() public {
        DeployLib.Roles memory r = _full();
        r.guardian = GOV;
        vm.expectRevert(
            abi.encodeWithSelector(DeployLib.RolesNotDistinct.selector, bytes32("GOVERNANCE"), bytes32("GUARDIAN"))
        );
        harness.resolve(16661, r, DEPLOYER);
    }

    function test_mainnetAcceptsFourDistinctKeys() public pure {
        DeployLib.Roles memory r = DeployLib.resolveRoles(16661, _full(), DEPLOYER);
        assertEq(r.governance, GOV);
        assertEq(r.guardian, GUARD);
    }

    /// @dev The exact arrangement that is live on Galileo today. It passes for 16602
    ///      and is refused for mainnet, which is the whole point of the function.
    function test_theLiveTestnetArrangementWouldBeRefusedOnMainnet() public {
        DeployLib.Roles memory oneKey =
            DeployLib.Roles({governance: DEPLOYER, guardian: DEPLOYER, treasury: DEPLOYER, curatorSigner: DEPLOYER});
        harness.resolve(16602, oneKey, DEPLOYER); // fine on a testnet
        vm.expectRevert(
            abi.encodeWithSelector(DeployLib.RoleHeldByDeployer.selector, uint256(16661), bytes32("GOVERNANCE"))
        );
        harness.resolve(16661, oneKey, DEPLOYER);
    }
}
