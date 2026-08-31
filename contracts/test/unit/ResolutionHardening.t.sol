// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {CommitteeFixtures} from "../helpers/CommitteeFixtures.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";
import {ConfigRegistry} from "../../src/core/ConfigRegistry.sol";
import {Market} from "../../src/core/Market.sol";
import {IMarket} from "../../src/interfaces/IMarket.sol";
import {ResolutionModule} from "../../src/core/ResolutionModule.sol";
import {Outcomes} from "../../src/interfaces/IResolutionModule.sol";

/// @notice The properties that close three measured attacks on resolution. Every test
///         here corresponds to something that WORKED against the previous code, and the
///         numbers in the comments were measured against it, not imagined.
contract ResolutionHardeningTest is CommitteeFixtures {
    uint256 internal constant STAKE = 1_000e6;
    uint256 internal constant RESOLVERS = 24;

    function setUp() public {
        _deployBase();
        _deployCommittee(RESOLVERS, STAKE);
    }

    // ── the draw cannot be shopped for ────────────────────────────────────────

    /**
     * THE CENTRAL PROPERTY. The committee is fixed by the block the draw was requested
     * against, not by the block the draw is claimed in — so a caller gets no choice at
     * all, however long it waits or however many times it simulates.
     *
     * Against the previous code the same scan found, for an attacker holding four of
     * twenty-four equally-staked resolvers, a block 185 blocks out that seated three of
     * five committee seats — exactly the threshold, and so unilateral control of the
     * outcome for the price of six minutes' waiting.
     */
    function test_theCommitteeDoesNotDependOnWhenTheDrawIsClaimed() public {
        Market m = _closedMarket();
        module.requestResolution(address(m));

        uint64 drawBlock = module.drawOf(address(m)).drawBlock;
        bytes32 drawHash = keccak256("the hash that block actually had");

        uint256[] memory first;
        for (uint256 attempt = 0; attempt < 40; attempt++) {
            uint256 snap = vm.snapshot();
            // A real chain gives that block ONE hash. Claiming the draw later does not
            // change it, and nothing else feeds the seed.
            vm.roll(uint256(drawBlock) + 1 + attempt);
            vm.setBlockhash(drawBlock, drawHash);
            module.openResolution(address(m));
            uint256[] memory picked = module.committeeOf(address(m));
            if (attempt == 0) {
                first = picked;
            } else {
                assertEq(picked.length, first.length, "committee size moved with the claim block");
                for (uint256 i = 0; i < picked.length; i++) {
                    assertEq(picked[i], first[i], "committee membership moved with the claim block");
                }
            }
            vm.revertTo(snap);
        }
    }

    function test_openingWithoutAskingFirstIsRefused() public {
        Market m = _closedMarket();
        vm.expectRevert(abi.encodeWithSelector(ResolutionModule.NoDrawRequested.selector, address(m)));
        module.openResolution(address(m));
    }

    function test_aDrawCannotBeClaimedBeforeItsBlockIsMined() public {
        Market m = _closedMarket();
        module.requestResolution(address(m));
        uint64 drawBlock = module.drawOf(address(m)).drawBlock;

        vm.roll(drawBlock);
        vm.expectRevert(abi.encodeWithSelector(ResolutionModule.DrawNotReady.selector, drawBlock));
        module.openResolution(address(m));
    }

    /// @dev A seed of zero is a seed every caller knows, which is the whole defect.
    ///      Refused, and asked for again rather than silently sampled from a constant.
    function test_aDrawPastTheBlockhashWindowExpiresAndCanBeAskedForAgain() public {
        Market m = _closedMarket();
        module.requestResolution(address(m));
        uint64 stale = module.drawOf(address(m)).drawBlock;

        vm.roll(uint256(stale) + 300); // blockhash() answers zero this far out
        vm.expectRevert(abi.encodeWithSelector(ResolutionModule.DrawExpired.selector, stale));
        module.openResolution(address(m));

        _openRound1(address(m));
        assertEq(module.committeeOf(address(m)).length, 5, "the re-requested draw did not seat a committee");
    }

    /// @dev Spent draws are deleted. Without that, "ask again" would be a way to hold
    ///      two live draws and open on whichever one suited.
    function test_aDrawIsSpentOnce() public {
        Market m = _closedMarket();
        _openRound1(address(m));
        vm.expectRevert(abi.encodeWithSelector(ResolutionModule.RoundAlreadyOpen.selector, address(m)));
        module.requestResolution(address(m));
    }

    // ── committee shape ───────────────────────────────────────────────────────

    /// @dev FAST shipped as n=1, k=1: one agent deciding alone, on the tier with the
    ///      loosest evidence requirement.
    function test_aCommitteeOfOneIsRefusedByTheBounds() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                ConfigRegistry.ParamOutOfBounds.selector, ConfigKeys.COMMITTEE_FAST, (1 << 8) | 1, 770, 65_535
            )
        );
        config.setParam(ConfigKeys.COMMITTEE_FAST, (1 << 8) | 1);
    }

    /// @dev Inside the bounds, but not a majority: with n=4, k=2 two different answers
    ///      could each clear the threshold and the first to reveal would win.
    function test_aThresholdAtOrBelowHalfIsRefusedAtReadTime() public {
        config.setParam(ConfigKeys.COMMITTEE_VERIFIED, (4 << 8) | 2);
        Market m = _closedMarket();
        module.requestResolution(address(m));
        _rollPastDraw(address(m));
        vm.expectRevert(abi.encodeWithSelector(ResolutionModule.BadCommitteeShape.selector, uint8(4), uint8(2)));
        module.openResolution(address(m));
    }

    function test_theFastTierNowSeatsARealCommittee() public {
        (uint8 n, uint8 k) =
            (uint8(config.params(ConfigKeys.COMMITTEE_FAST) >> 8), uint8(config.params(ConfigKeys.COMMITTEE_FAST)));
        assertEq(n, 5, "FAST is not five");
        assertEq(k, 3, "FAST threshold is not three");
        assertGt(uint256(k) * 2, uint256(n), "FAST threshold is not a majority");
    }

    // ── a stalled dispute is not an overturn ──────────────────────────────────

    function _proposeThenDispute(address griefer) internal returns (Market m, uint256[] memory roundOne) {
        m = _closedMarket();
        _openRound1(address(m));
        _committeeAgrees(address(m), Outcomes.YES);
        roundOne = module.committeeOf(address(m));

        uint256 bond = config.params(ConfigKeys.DISPUTE_BOND);
        _fund(griefer, bond, address(module));
        vm.prank(griefer);
        module.dispute(address(m), keccak256("evidence"));
    }

    /**
     * Round 2 is asked for and then nobody answers it. That is silence, not a reversal.
     *
     * Against the previous code this same sequence took 20% of the stake of all five
     * round-1 resolvers — the CARTEL rate, applied to the members who had been right —
     * and handed the challenger its bond back, so the whole attack cost gas. It was
     * profitable to anyone holding the losing side, because a failed market pays both
     * sides pᵢ where a settled one pays the loser nothing.
     */
    function test_aStalledDisputeDoesNotPunishRoundOneForBeingRight() public {
        address griefer = makeAddr("griefer");
        (Market m, uint256[] memory roundOne) = _proposeThenDispute(griefer);
        _openRound2(address(m)); // drawn, and then nobody votes

        vm.warp(m.settlementDeadline() + 1);
        module.markFailed(address(m));

        assertEq(uint8(m.status()), uint8(IMarket.Status.Failed), "market did not fail");
        for (uint256 i = 0; i < roundOne.length; i++) {
            assertEq(registry_.stakeOf(roundOne[i]), STAKE, "a round-1 member was slashed for a round nobody ran");
            assertEq(registry_.reputationOf(roundOne[i]).resolutionsOverturned, 0, "recorded as overturned");
        }
    }

    /// @dev The bond prices noise, and a challenge that produced no evidence that round
    ///      one was wrong is noise. Refunding it is what made stalling free.
    function test_aStalledDisputeForfeitsTheChallengersBond() public {
        address griefer = makeAddr("griefer");
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        (Market m,) = _proposeThenDispute(griefer);
        _openRound2(address(m));
        uint256 bond = config.params(ConfigKeys.DISPUTE_BOND);
        uint256 noShows = module.committeeOf(address(m)).length;

        vm.warp(m.settlementDeadline() + 1);
        module.markFailed(address(m));

        assertEq(usdc.balanceOf(griefer), 0, "the staller got its bond back");
        // The treasury receives the forfeited bond AND the no-show slashes, which land
        // there too. Both components are named rather than the total asserted loosely:
        // a bond quietly refunded would otherwise hide inside a large enough slash.
        uint256 slashed = noShows * ((STAKE * config.params(ConfigKeys.NO_SHOW_SLASH_BPS)) / 10_000);
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, bond + slashed, "bond and slashes did not both arrive");
    }

    /// @dev The round-2 members who never showed still pay: that much IS a fault,
    ///      whatever the round went on to do.
    function test_aStalledDisputeStillSlashesTheMembersWhoNeverShowed() public {
        address griefer = makeAddr("griefer");
        (Market m,) = _proposeThenDispute(griefer);
        _openRound2(address(m));
        uint256[] memory roundTwo = module.committeeOf(address(m));

        vm.warp(m.settlementDeadline() + 1);
        module.markFailed(address(m));

        uint256 noShowBps = config.params(ConfigKeys.NO_SHOW_SLASH_BPS);
        assertEq(registry_.stakeOf(roundTwo[0]), STAKE - (STAKE * noShowBps) / 10_000, "a no-show kept its stake");
    }

    /**
     * THE FULL THEFT, ATTEMPTED AGAIN. Against the previous code a challenger holding
     * eight of twenty-four resolvers disputed at a block that seated enough of its own
     * agents on the nine-member round two to make the threshold, voted the opposite
     * outcome, and finalized — the market settled on the attacker's answer, the bond
     * came back whole, and round one was slashed for it. It took ONE block of waiting.
     *
     * The draw is now fixed when the dispute is filed, so the scan below is looking for
     * something that no longer exists: whichever block the challenger claims it in, the
     * same nine agents are seated.
     */
    function test_aChallengerCannotShopForTheRoundTwoItWants() public {
        address attacker = makeAddr("attacker");
        (Market m,) = _proposeThenDispute(attacker);

        uint64 drawBlock = module.drawOf(address(m)).drawBlock;
        bytes32 drawHash = keccak256("the hash that block actually had");

        uint256[] memory first;
        for (uint256 attempt = 0; attempt < 40; attempt++) {
            uint256 snap = vm.snapshot();
            vm.roll(uint256(drawBlock) + 1 + attempt);
            vm.setBlockhash(drawBlock, drawHash);
            vm.prank(attacker);
            module.openDisputeRound(address(m));
            uint256[] memory picked = module.committeeOf(address(m));
            if (attempt == 0) {
                first = picked;
            } else {
                for (uint256 i = 0; i < picked.length; i++) {
                    assertEq(picked[i], first[i], "the challenger moved round two by choosing its block");
                }
            }
            vm.revertTo(snap);
        }
    }

    // ── round 2 is slow on purpose ────────────────────────────────────────────

    /// @dev The old rule let a round finalize the instant its last member revealed,
    ///      which meant the members chose the moment the market settled and nobody
    ///      else got to see the tally before it took effect. Round 2 is the last word;
    ///      there is no round 3 behind it.
    function test_roundTwoWaitsOutItsRevealWindowEvenWhenEveryoneHasVoted() public {
        address challenger = makeAddr("challenger");
        (Market m,) = _proposeThenDispute(challenger);
        _openRound2(address(m));
        _committeeAgrees(address(m), Outcomes.NO);

        assertEq(module.roundOf(address(m)).reveals, 9, "not every member revealed");
        vm.expectRevert(ResolutionModule.TooEarly.selector);
        module.finalize(address(m));

        vm.warp(module.roundOf(address(m)).revealDeadline + 1);
        module.finalize(address(m));
        assertEq(m.winningOutcome(), Outcomes.NO, "the reversal did not stand once the window closed");
    }

    // ── the deadline race ─────────────────────────────────────────────────────

    /// @dev A market that can only ever fail is a market built to refund the losing
    ///      side. `settlementDeadline > tradingEnd` was satisfied by one second.
    function test_aMarketMustLeaveRoomToResolveInside() public {
        IMarket.Params memory p = _params();
        p.settlementDeadline = p.tradingEnd + 1;

        Market bad = Market(Clones.clone(address(marketImpl)));
        registry.set(address(bad), true);
        usdc.mintTo(address(this), SEED + DEPOSIT);
        usdc.transfer(address(bad), SEED + DEPOSIT);
        vm.expectRevert(Market.BadDeadlines.selector);
        bad.initialize(address(config), address(shares), p, SEED, DEPOSIT);
    }

    /**
     * A stranger racing `finalize` at the deadline used to be able to throw away an
     * outcome the committee had already reached — and the party motivated to win that
     * race is whoever holds the losing side.
     */
    function test_aProposedMarketSurvivesTheDeadlineUntilItsGraceRunsOut() public {
        Market m = _closedMarket();
        _openRound1(address(m));
        _committeeAgrees(address(m), Outcomes.YES);
        assertEq(uint8(m.status()), uint8(IMarket.Status.Proposed), "round 1 did not propose");

        address stranger = makeAddr("stranger");
        vm.warp(m.settlementDeadline() + 1);

        vm.prank(stranger);
        vm.expectRevert(Market.BadTransition.selector);
        m.fail();

        vm.expectRevert(ResolutionModule.TooEarly.selector);
        module.markFailed(address(m));

        // Inside the grace the committee's answer still wins, and `finalize` is
        // permissionless so anybody at all may carry it out.
        vm.prank(stranger);
        module.finalize(address(m));
        assertEq(uint8(m.status()), uint8(IMarket.Status.Settled), "the verdict did not stand");
        assertEq(m.winningOutcome(), Outcomes.YES, "the wrong outcome was written");
    }

    /// @dev The rescue still exists — it just waits. A proposal that nobody ever
    ///      finalizes must not lock the collateral up forever.
    function test_theRescueStillArrivesOnceTheGraceHasRunOut() public {
        Market m = _closedMarket();
        _openRound1(address(m));
        _committeeAgrees(address(m), Outcomes.YES);

        vm.warp(m.settlementDeadline() + config.params(ConfigKeys.PROPOSED_FAIL_GRACE));
        vm.prank(makeAddr("stranger"));
        m.fail();
        assertEq(uint8(m.status()), uint8(IMarket.Status.Failed), "the rescue never arrived");
    }
}
