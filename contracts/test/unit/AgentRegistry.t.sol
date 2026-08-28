// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CommitteeFixtures} from "../helpers/CommitteeFixtures.sol";
import {AgentRegistry} from "../../src/core/AgentRegistry.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";
import {IAgentRegistry} from "../../src/interfaces/IAgentRegistry.sol";

contract AgentRegistryTest is CommitteeFixtures {
    uint256 internal constant STAKE = 1_000e6;

    function setUp() public {
        _deployBase();
        _deployCommittee(3, STAKE);
    }

    function test_registeringMintsAnAgentAndListsResolvers() public view {
        assertEq(registry_.resolverCount(), 3, "resolvers not listed");
        assertEq(registry_.ownerOf(agentIds[0]), address(this), "agent not minted to registrant");
        assertEq(uint8(registry_.roleOf(agentIds[0])), uint8(IAgentRegistry.Role.Resolver), "wrong role");
        assertEq(registry_.operatorOf(agentIds[0]), operators[0], "operator not set");
    }

    /// @dev The claim `activeStake` makes: it is what backs a vote. A resolver that
    ///      could vote on stake it had already given notice on would be voting with
    ///      nothing at risk by the time anyone could dispute the result.
    function test_requestingUnstakeRemovesTheStakeFromRiskImmediately() public {
        assertEq(registry_.activeStake(agentIds[0]), STAKE, "stake not active");

        registry_.requestUnstake(agentIds[0], STAKE);

        assertEq(registry_.activeStake(agentIds[0]), 0, "notice did not remove the stake from risk");
        (uint256 cooling, uint64 endsAt) = registry_.coolingOf(agentIds[0]);
        assertEq(cooling, STAKE, "not cooling");
        assertEq(endsAt, block.timestamp + config.params(ConfigKeys.UNSTAKE_COOLDOWN), "wrong cooldown");
    }

    function test_stakeCannotBeWithdrawnBeforeTheCooldown() public {
        registry_.requestUnstake(agentIds[0], STAKE);
        (, uint64 endsAt) = registry_.coolingOf(agentIds[0]);

        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.StillCooling.selector, endsAt));
        registry_.withdrawUnstaked(agentIds[0], address(this));

        vm.warp(endsAt);
        uint256 before = usdc.balanceOf(address(this));
        registry_.withdrawUnstaked(agentIds[0], address(this));
        assertEq(usdc.balanceOf(address(this)) - before, STAKE, "stake not returned");
    }

    /// @dev Slashing reaches cooling stake LAST but it does reach it. Otherwise a
    ///      resolver could shield everything from a slash simply by giving notice
    ///      before the dispute window closed.
    function test_slashingTakesBondedStakeFirstAndCoolingStakeAfter() public {
        registry_.requestUnstake(agentIds[0], 600e6); // 400 bonded, 600 cooling

        vm.prank(address(module));
        uint256 taken = registry_.slash(agentIds[0], 500e6, "TEST");

        assertEq(taken, 500e6, "wrong amount taken");
        assertEq(registry_.stakeOf(agentIds[0]), 0, "bonded stake not exhausted first");
        (uint256 cooling,) = registry_.coolingOf(agentIds[0]);
        assertEq(cooling, 500e6, "cooling stake not reached for the remainder");
    }

    function test_slashedStakeGoesToTheTreasury() public {
        uint256 before = usdc.balanceOf(treasury);
        vm.prank(address(module));
        registry_.slash(agentIds[0], 100e6, "TEST");
        assertEq(usdc.balanceOf(treasury) - before, 100e6, "treasury not paid");
    }

    function test_slashingIsCappedByWhatTheAgentActuallyHas() public {
        vm.prank(address(module));
        uint256 taken = registry_.slash(agentIds[0], STAKE * 10, "TEST");
        assertEq(taken, STAKE, "slashed more than existed");
    }

    /// @dev The single most important access check in this contract: anyone who could
    ///      call `slash` could confiscate every resolver's stake.
    function test_onlyTheResolutionModuleMaySlash() public {
        vm.prank(alice);
        vm.expectRevert(AgentRegistry.NotResolutionModule.selector);
        registry_.slash(agentIds[0], 1, "TEST");

        vm.prank(alice);
        vm.expectRevert(AgentRegistry.NotResolutionModule.selector);
        registry_.recordResolution(agentIds[0], true, false);
    }

    function test_onlyTheAgentOwnerMayMoveItsStakeOrOperator() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.NotAgentOwner.selector, agentIds[0]));
        registry_.requestUnstake(agentIds[0], 1);
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.NotAgentOwner.selector, agentIds[0]));
        registry_.setOperator(agentIds[0], alice);
        vm.stopPrank();
    }

    /// @dev Only resolvers stake, because only a resolver's vote is backed by it.
    function test_aTraderCannotStake() public {
        uint256 id = registry_.register(IAgentRegistry.Role.Trader, alice, "a-trader", bytes32(0));
        usdc.mintTo(address(this), 1e6);
        usdc.approve(address(registry_), 1e6);
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.NotAResolver.selector, id));
        registry_.stake(id, 1e6);
        assertEq(registry_.activeStake(id), 0, "a non-resolver reported active stake");
    }
}
