// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CommitteeFixtures} from "../helpers/CommitteeFixtures.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";
import {Market} from "../../src/core/Market.sol";
import {IMarket} from "../../src/interfaces/IMarket.sol";
import {ResolutionModule} from "../../src/core/ResolutionModule.sol";
import {Outcomes} from "../../src/interfaces/IResolutionModule.sol";

/// @dev A settlement is worth what a resolver loses by getting it wrong. These are the
///      tests of that sentence.
contract ResolutionSlashingTest is CommitteeFixtures {
    uint256 internal constant STAKE = 1_000e6;

    function setUp() public {
        _deployBase();
        _deployCommittee(14, STAKE);
    }

    function _open() internal returns (Market m) {
        m = _closedMarket();
        _openRound1(address(m));
    }

    function _commit(address market, uint256 id, uint8 outcome) internal {
        address op = registry_.operatorOf(id);
        vm.prank(op);
        module.commitVote(
            market, id, _commitment(market, outcome, keccak256(abi.encode("s", id)), keccak256(abi.encode("r", id)), op)
        );
    }

    function _reveal(address market, uint256 id, uint8 outcome) internal {
        vm.prank(registry_.operatorOf(id));
        module.revealVote(market, id, outcome, keccak256(abi.encode("s", id)), keccak256(abi.encode("r", id)));
    }

    /// @dev Three of five agree on YES, one votes NO, one never shows. Each is treated
    ///      differently, and the differences are the policy.
    function test_theThreeWaysOfFailingCostDifferentAmounts() public {
        Market m = _open();
        address market = address(m);
        uint256[] memory c = module.committeeOf(market);

        for (uint256 i = 0; i < 4; i++) {
            _commit(market, c[i], i < 3 ? Outcomes.YES : Outcomes.NO);
        }
        // c[4] commits nothing at all.
        vm.warp(module.roundOf(market).commitDeadline + 1);
        for (uint256 i = 0; i < 4; i++) {
            _reveal(market, c[i], i < 3 ? Outcomes.YES : Outcomes.NO);
        }

        vm.warp(module.roundOf(market).disputeDeadline + 1);
        module.finalize(market);

        uint256 noShowBps = config.params(ConfigKeys.NO_SHOW_SLASH_BPS);
        uint256 disagreeBps = config.params(ConfigKeys.DISAGREE_SLASH_BPS);

        assertEq(registry_.stakeOf(c[0]), STAKE, "an agreeing resolver was slashed");
        assertEq(registry_.stakeOf(c[3]), STAKE - (STAKE * disagreeBps) / 10_000, "disagreement not priced");
        assertEq(registry_.stakeOf(c[4]), STAKE - (STAKE * noShowBps) / 10_000, "absence not priced");
        // Being outvoted is not misconduct; not turning up is.
        assertGt(registry_.stakeOf(c[3]), registry_.stakeOf(c[4]), "disagreeing cost more than absence");
    }

    function test_agreementIsRecordedAsReputation() public {
        Market m = _open();
        _committeeAgrees(address(m), Outcomes.YES);
        vm.warp(module.roundOf(address(m)).disputeDeadline + 1);
        module.finalize(address(m));
        uint256[] memory c = module.committeeOf(address(m));
        assertEq(registry_.reputationOf(c[0]).resolutionsAgreed, 1, "agreement not recorded");
    }

    // ── dispute ───────────────────────────────────────────────────────────────

    function _proposeThenDispute(uint8 outcome) internal returns (Market m, uint256[] memory roundOne) {
        m = _open();
        _committeeAgrees(address(m), outcome);
        roundOne = module.committeeOf(address(m));

        usdc.mintTo(alice, 50e6);
        vm.startPrank(alice);
        usdc.approve(address(module), 50e6);
        module.dispute(address(m), keccak256("evidence"));
        vm.stopPrank();

        // The dispute posts the bond and ASKS for a committee; the draw itself is a
        // separate call at a block that did not exist yet. Sampling inside the
        // challenger's own transaction is what let a challenger pick the round that
        // would review the round it was challenging.
        _openRound2(address(m));
    }

    /// @dev A cartel that could re-sample itself into the round reviewing its own work
    ///      would make the dispute a formality.
    function test_theDisputeRoundExcludesEveryMemberOfRoundOne() public {
        (Market m, uint256[] memory roundOne) = _proposeThenDispute(Outcomes.YES);
        uint256[] memory roundTwo = module.committeeOf(address(m));

        assertEq(roundTwo.length, 9, "dispute committee is the wrong size");
        assertEq(module.roundOf(address(m)).index, 2, "not in round 2");
        assertEq(uint8(m.status()), uint8(IMarket.Status.Disputed), "market not Disputed");
        for (uint256 i = 0; i < roundTwo.length; i++) {
            for (uint256 j = 0; j < roundOne.length; j++) {
                assertTrue(roundTwo[i] != roundOne[j], "a round-1 member reviewed its own work");
            }
        }
    }

    /// @dev The heaviest penalty in the protocol, and the one that pays the challenger.
    ///      Without the refund nobody would ever post a bond to be right.
    function test_anOverturnSlashesRoundOneAndMakesTheChallengerWhole() public {
        (Market m, uint256[] memory roundOne) = _proposeThenDispute(Outcomes.YES);
        address market = address(m);
        uint256 aliceBefore = usdc.balanceOf(alice);

        _committeeAgrees(market, Outcomes.NO); // round 2 reverses round 1
        // The REVEAL deadline, not the dispute one: round 2 has no dispute window and
        // now always waits its reveal window out, so that the tally is visible to
        // everyone before it takes effect rather than only to the members casting it.
        vm.warp(module.roundOf(market).revealDeadline + 1);
        module.finalize(market);

        assertEq(m.winningOutcome(), Outcomes.NO, "the reversed outcome did not stand");
        uint256 overturnBps = config.params(ConfigKeys.OVERTURN_SLASH_BPS);
        assertEq(registry_.stakeOf(roundOne[0]), STAKE - (STAKE * overturnBps) / 10_000, "round 1 was not made to pay");
        assertEq(registry_.reputationOf(roundOne[0]).resolutionsOverturned, 1, "overturn not recorded");
        assertEq(usdc.balanceOf(alice) - aliceBefore, 50e6, "the challenger's bond was not returned");
    }

    /// @dev A challenge that fails is noise, and the bond is what prices noise.
    function test_aConfirmedOutcomeForfeitsTheChallengersBond() public {
        (Market m, uint256[] memory roundOne) = _proposeThenDispute(Outcomes.YES);
        address market = address(m);
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 aliceBefore = usdc.balanceOf(alice);

        _committeeAgrees(market, Outcomes.YES); // round 2 confirms round 1
        vm.warp(module.roundOf(market).revealDeadline + 1);
        module.finalize(market);

        assertEq(m.winningOutcome(), Outcomes.YES, "the confirmed outcome did not stand");
        assertEq(usdc.balanceOf(alice), aliceBefore, "the bond came back to a failed challenger");
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, 50e6, "the forfeited bond did not reach the treasury");
        assertEq(registry_.stakeOf(roundOne[0]), STAKE, "round 1 was punished for being right");
    }

    function test_aMarketCanOnlyBeDisputedOnce() public {
        (Market m,) = _proposeThenDispute(Outcomes.YES);
        address market = address(m);
        usdc.mintTo(bob, 50e6);
        vm.startPrank(bob);
        usdc.approve(address(module), 50e6);
        vm.expectRevert(ResolutionModule.NoThreshold.selector);
        module.dispute(market, keccak256("more evidence"));
        vm.stopPrank();
    }

    // ── the deadline ──────────────────────────────────────────────────────────

    /// @dev Nobody answered in time. Not a failure of the market but of the process,
    ///      and either way the exit is liquidation rather than paying a side.
    function test_aMarketNobodyResolvedFailsAfterItsDeadline() public {
        Market m = _open();
        address market = address(m);
        vm.expectRevert(ResolutionModule.TooEarly.selector);
        module.markFailed(market);

        vm.warp(m.settlementDeadline() + 1);
        module.markFailed(market);
        assertEq(uint8(m.status()), uint8(IMarket.Status.Failed), "market not Failed");
    }
}
