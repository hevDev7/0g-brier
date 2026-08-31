// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {CommitteeFixtures} from "../helpers/CommitteeFixtures.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";
import {StubIdentity} from "./Erc8004.t.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";
import {Market} from "../../src/core/Market.sol";
import {IMarket} from "../../src/interfaces/IMarket.sol";
import {ResolutionModule} from "../../src/core/ResolutionModule.sol";
import {Outcomes} from "../../src/interfaces/IResolutionModule.sol";

/// @dev An ERC-8004 ReputationRegistry that can be told to fail, so the property that
///      matters — a foreign contract cannot block a settlement — is tested against a
///      contract that actually reverts rather than against a comment saying it would.
contract HostileReputation {
    bool public broken;
    uint256 public calls;

    function setBroken(bool b) external {
        broken = b;
    }

    function giveFeedback(
        uint256,
        int128,
        uint8,
        string calldata,
        string calldata,
        string calldata,
        string calldata,
        bytes32
    ) external {
        // The counter is only meaningful on the path that does NOT revert: a reverting
        // call rolls its own increment back, which is what made the first version of
        // this test claim the module had never tried.
        require(!broken, "no");
        calls++;
    }
}

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
        _openRound1(address(m));
    }

    // ── the ordinary path ─────────────────────────────────────────────────────

    function test_openingSamplesACommitteeOfTheTiersShape() public {
        Market m = _open();
        // The fixture builds tier 1 (VERIFIED): five members, threshold three.
        assertEq(module.roundOf(address(m)).n, 5, "wrong committee size");
        assertEq(module.roundOf(address(m)).k, 3, "wrong threshold");
        assertEq(module.committeeOf(address(m)).length, 5, "wrong number sampled");
    }

    /// @dev Bound to `requestResolution`, not to the `_openRound1` helper: the status
    ///      gate lives at the REQUEST step now, and `vm.expectRevert` binds to the very
    ///      next external call — through the helper it would be consumed there and the
    ///      helper's remaining two calls would run unguarded.
    function test_aMarketThatHasNotClosedCannotBeResolved() public {
        Market m = _newMarket(SEED); // still Open
        address market = address(m);
        vm.expectRevert(abi.encodeWithSelector(ResolutionModule.MarketNotClosed.selector, market));
        module.requestResolution(market);
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

    // ── publishing a resolver's record to ERC-8004 ────────────────────────────

    /**
     * THE PROPERTY THAT MATTERS. A market whose outcome is already decided must never
     * become unsettleable because a foreign contract reverted. The money in it is real;
     * the reputation signal is a courtesy, and a courtesy that can freeze a settlement
     * is a liability dressed as a feature.
     *
     * Tested against a registry that genuinely reverts rather than a comment claiming
     * the try/catch works.
     */
    function test_aBrokenForeignRegistryCannotBlockASettlement() public {
        HostileReputation hostile = new HostileReputation();
        hostile.setBroken(true);
        config.setAddress(ConfigKeys.ERC8004_REPUTATION, address(hostile));

        // Link every committee member, so the module genuinely tries to publish.
        Market m = _open();
        uint256[] memory members = module.committeeOf(address(m));
        _linkAll(members);

        // The link is what makes the module reach for the foreign registry at all.
        assertGt(registry_.erc8004Of(members[0]), 0, "fixture failed to link a committee member");

        _committeeAgrees(address(m), Outcomes.YES);
        vm.warp(module.roundOf(address(m)).disputeDeadline + 1);

        // What proves the attempt is OUR event, not the stub's counter: a reverting call
        // undoes anything it wrote, so a counter can only ever report the successes.
        vm.recordLogs();
        module.finalize(address(m));

        assertEq(uint8(m.status()), uint8(IMarket.Status.Settled), "a reverting registry stopped the settlement");
        assertEq(m.winningOutcome(), Outcomes.YES, "wrong winner");

        uint256 failures;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == keccak256("FeedbackFailed(uint256,uint256)")) failures++;
        }
        assertEq(failures, members.length, "the module did not try, or did not say that it failed");
    }

    /// @dev Unset is not an error, it is the integration being off. Nothing about a
    ///      settlement should depend on whether an optional signal has a home.
    function test_settlementIsUnaffectedWhenNoForeignRegistryIsConfigured() public {
        config.setAddress(ConfigKeys.ERC8004_REPUTATION, address(0));
        Market m = _open();
        _committeeAgrees(address(m), Outcomes.YES);
        vm.warp(module.roundOf(address(m)).disputeDeadline + 1);
        module.finalize(address(m));
        assertEq(uint8(m.status()), uint8(IMarket.Status.Settled), "settlement needed a registry it should not need");
    }

    /// @dev An agent that never linked publishes nothing. Guessing an 8004 id would be
    ///      writing somebody else's reputation.
    function test_anUnlinkedResolverPublishesNothing() public {
        HostileReputation quiet = new HostileReputation();
        config.setAddress(ConfigKeys.ERC8004_REPUTATION, address(quiet));

        Market m = _open();
        _committeeAgrees(address(m), Outcomes.YES);
        vm.warp(module.roundOf(address(m)).disputeDeadline + 1);
        module.finalize(address(m));

        assertEq(quiet.calls(), 0, "published a record for an agent with no 8004 identity");
        assertEq(uint8(m.status()), uint8(IMarket.Status.Settled), "market not settled");
    }

    /// @dev The ordinary path: every member of a unanimous committee gets a +1
    ///      published under its own 8004 identity, addressed by the receipt it revealed.
    function test_aUnanimousCommitteePublishesOneRecordPerResolver() public {
        HostileReputation working = new HostileReputation();
        config.setAddress(ConfigKeys.ERC8004_REPUTATION, address(working));

        Market m = _open();
        uint256[] memory members = module.committeeOf(address(m));
        _linkAll(members);
        _committeeAgrees(address(m), Outcomes.YES);
        vm.warp(module.roundOf(address(m)).disputeDeadline + 1);
        module.finalize(address(m));

        assertEq(working.calls(), members.length, "one record per resolver, and no more");
        assertEq(uint8(m.status()), uint8(IMarket.Status.Settled), "market not settled");
    }

    /// @dev Links every committee member to a freshly minted 8004 token held by the same
    ///      owner, which is the only shape `linkErc8004` accepts.
    function _linkAll(uint256[] memory members) internal {
        StubIdentity id = new StubIdentity();
        config.setAddress(ConfigKeys.ERC8004_IDENTITY, address(id));
        for (uint256 i = 0; i < members.length; i++) {
            address owner = registry_.ownerOf(members[i]);
            vm.prank(owner);
            uint256 foreign = id.register();
            vm.prank(owner);
            registry_.linkErc8004(members[i], foreign);
        }
    }
}
