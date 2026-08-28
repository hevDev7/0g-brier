// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CommitteeFixtures} from "../helpers/CommitteeFixtures.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";
import {Market} from "../../src/core/Market.sol";
import {IMarket} from "../../src/interfaces/IMarket.sol";
import {ResolutionModule} from "../../src/core/ResolutionModule.sol";
import {Outcomes} from "../../src/interfaces/IResolutionModule.sol";

contract ResolutionCommitteeTest is CommitteeFixtures {
    uint256 internal constant STAKE = 1_000e6;

    function setUp() public {
        _deployBase();
        // Nine resolvers: enough for a VERIFIED committee of five AND a dispute round
        // that must exclude every one of them.
        _deployCommittee(14, STAKE);
    }

    function _open() internal returns (Market m) {
        m = _closedMarket();
        module.openResolution(address(m));
    }

    // ── the ordinary path ─────────────────────────────────────────────────────

    function test_openingSamplesACommitteeOfTheTiersShape() public {
        Market m = _open();
        // The fixture builds tier 1 (VERIFIED): five members, threshold three.
        assertEq(module.roundOf(address(m)).n, 5, "wrong committee size");
        assertEq(module.roundOf(address(m)).k, 3, "wrong threshold");
        assertEq(module.committeeOf(address(m)).length, 5, "wrong number sampled");
    }

    function test_aMarketThatHasNotClosedCannotBeResolved() public {
        Market m = _newMarket(SEED); // still Open
        address market = address(m);
        vm.expectRevert(abi.encodeWithSelector(ResolutionModule.MarketNotClosed.selector, market));
        module.openResolution(market);
    }

    function test_thresholdProposesAndFinalizeSettles() public {
        Market m = _open();
        _committeeAgrees(address(m), Outcomes.YES);

        assertEq(module.roundOf(address(m)).proposedOutcome, Outcomes.YES, "not proposed");
        assertEq(uint8(m.status()), uint8(IMarket.Status.Proposed), "market not Proposed");

        vm.warp(module.roundOf(address(m)).disputeDeadline + 1);
        module.finalize(address(m));

        assertEq(uint8(m.status()), uint8(IMarket.Status.Settled), "market not Settled");
        assertEq(m.winningOutcome(), Outcomes.YES, "wrong winner");
        assertTrue(module.viaCommittee(address(m)), "settlement not recorded as a committee decision");
    }

    /// @dev UNRESOLVABLE is not a third answer to the question — it routes to `fail`,
    ///      where every side exits at its own price rather than one side taking the pool.
    function test_unresolvableFailsTheMarketRatherThanPickingASide() public {
        Market m = _open();
        _committeeAgrees(address(m), Outcomes.UNRESOLVABLE);
        vm.warp(module.roundOf(address(m)).disputeDeadline + 1);
        module.finalize(address(m));
        assertEq(uint8(m.status()), uint8(IMarket.Status.Failed), "market not Failed");
    }

    function test_finalizeIsRefusedWhileAnyoneCanStillDispute() public {
        Market m = _open();
        _committeeAgrees(address(m), Outcomes.YES);
        address market = address(m);
        vm.expectRevert(ResolutionModule.TooEarly.selector);
        module.finalize(market);
    }

    // ── commit–reveal ─────────────────────────────────────────────────────────

    /// @dev The reason commit–reveal exists. A commitment lifted from another
    ///      resolver's transaction hashes to something else, so copying an answer is
    ///      not merely discouraged — it does not work.
    function test_aCommitmentCannotBeCopiedFromAnotherResolver() public {
        Market m = _open();
        uint256[] memory members = module.committeeOf(address(m));
        address opA = registry_.operatorOf(members[0]);
        address opB = registry_.operatorOf(members[1]);
        bytes32 salt = keccak256("salt");
        bytes32 receipt = keccak256("receipt");

        bytes32 aCommitment = _commitment(address(m), Outcomes.YES, salt, receipt, opA);
        vm.prank(opA);
        module.commitVote(address(m), members[0], aCommitment);

        // B copies A's commitment verbatim, having seen it on chain.
        vm.prank(opB);
        module.commitVote(address(m), members[1], aCommitment);

        vm.warp(module.roundOf(address(m)).commitDeadline + 1);
        address market = address(m);
        uint256 idB = members[1];
        vm.prank(opB);
        vm.expectRevert(ResolutionModule.BadCommitment.selector);
        module.revealVote(market, idB, Outcomes.YES, salt, receipt);
    }

    function test_revealIsRefusedBeforeTheCommitWindowCloses() public {
        Market m = _open();
        uint256[] memory members = module.committeeOf(address(m));
        address op = registry_.operatorOf(members[0]);
        bytes32 salt = keccak256("s");
        bytes32 receipt = keccak256("r");
        vm.prank(op);
        module.commitVote(address(m), members[0], _commitment(address(m), Outcomes.YES, salt, receipt, op));

        address market = address(m);
        uint256 id = members[0];
        vm.prank(op);
        vm.expectRevert(ResolutionModule.WindowOpen.selector);
        module.revealVote(market, id, Outcomes.YES, salt, receipt);
    }

    /// @dev The same defect a market's `specRoot` shipped with once: a commitment to a
    ///      document that cannot exist.
    function test_aRevealWithNoReceiptIsRefused() public {
        Market m = _open();
        uint256[] memory members = module.committeeOf(address(m));
        address op = registry_.operatorOf(members[0]);
        bytes32 salt = keccak256("s");
        vm.prank(op);
        module.commitVote(address(m), members[0], _commitment(address(m), Outcomes.YES, salt, bytes32(0), op));
        vm.warp(module.roundOf(address(m)).commitDeadline + 1);

        address market = address(m);
        uint256 id = members[0];
        vm.prank(op);
        vm.expectRevert(ResolutionModule.EmptyReceipt.selector);
        module.revealVote(market, id, Outcomes.YES, salt, bytes32(0));
    }

    function test_onlyTheCommitteeMayVote() public {
        Market m = _open();
        address market = address(m);
        // An agent that exists and is staked, but was not sampled.
        uint256 outsider = _anAgentNotOnTheCommittee(market);
        address op = registry_.operatorOf(outsider);
        vm.prank(op);
        vm.expectRevert(abi.encodeWithSelector(ResolutionModule.NotOnCommittee.selector, outsider));
        module.commitVote(market, outsider, keccak256("anything"));
    }

    function test_onlyTheAgentsOperatorMayVoteForIt() public {
        Market m = _open();
        uint256[] memory members = module.committeeOf(address(m));
        address market = address(m);
        uint256 id = members[0];
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ResolutionModule.NotOperator.selector, id));
        module.commitVote(market, id, keccak256("anything"));
    }

    function _anAgentNotOnTheCommittee(address market) internal view returns (uint256) {
        uint256[] memory members = module.committeeOf(market);
        for (uint256 i = 0; i < agentIds.length; i++) {
            bool onIt;
            for (uint256 j = 0; j < members.length; j++) {
                if (members[j] == agentIds[i]) {
                    onIt = true;
                    break;
                }
            }
            if (!onIt) return agentIds[i];
        }
        revert("every agent was sampled");
    }
}
