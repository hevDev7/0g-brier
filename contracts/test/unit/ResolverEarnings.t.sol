// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CommitteeFixtures} from "../helpers/CommitteeFixtures.sol";
import {Market} from "../../src/core/Market.sol";
import {ResolutionModule} from "../../src/core/ResolutionModule.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * The resolver pool used to have no exit.
 *
 * `Market._distributeFees` sent 30% of the fee plus the whole settlement deposit
 * to the ResolutionModule, and the module had no function that moved collateral
 * out of itself. The money was not lost — the module is upgradeable — but until
 * this path existed, settling a market earned a reputation record and nothing
 * else, while real collateral piled up at an address that could not spend it.
 *
 * These tests are about who gets paid and who cannot take what is not theirs.
 */
contract ResolverEarningsTest is CommitteeFixtures {
    uint256 internal constant STAKE = 1_000e6;

    function setUp() public {
        _deployBase();
        _deployCommittee(14, STAKE);
    }

    function _settled(uint8 outcome) internal returns (address market) {
        Market m = _closedMarket();
        market = address(m);
        _openRound1(market);
        _committeeAgrees(market, outcome);
        vm.warp(module.roundOf(market).disputeDeadline + 1);
        module.finalize(market);
    }

    // ── who earns ─────────────────────────────────────────────────────────────

    function test_everyResolverThatAgreedIsCreditedAnEqualShare() public {
        address market = _settled(1);
        uint256[] memory members = module.committeeOf(market);

        uint256 first = module.owedTo(members[0]);
        assertGt(first, 0, "an agreeing resolver earned nothing");
        for (uint256 i = 1; i < members.length; i++) {
            // Equal, not proportional. Weighting by stake would pay the largest
            // resolver most for identical work; this is the assertion that keeps
            // the committee from becoming an auction.
            assertEq(module.owedTo(members[i]), first, "shares are not equal");
        }
        assertEq(module.totalOwed(), first * members.length, "the ledger does not sum");
    }

    /**
     * The module must never book more than the market actually sends it. If it
     * did, the last resolver to claim would find the balance short — and would
     * read a solvency bug as somebody else having stolen from them.
     */
    function test_theModuleNeverBooksMoreThanItHolds() public {
        address market = _settled(1);
        uint256 held = IERC20(address(usdc)).balanceOf(address(module));
        assertGe(held, module.totalOwed(), "booked more than arrived");
    }

    function test_aResolverThatDidNotVoteEarnsNothing() public {
        Market m = _closedMarket();
        address market = address(m);
        _openRound1(market);

        uint256[] memory members = module.committeeOf(market);
        // Everyone but the last one turns up. The threshold is three of five, so
        // the market still settles — and the absentee is slashed, not paid.
        for (uint256 i = 0; i < members.length - 1; i++) {
            address op = registry_.operatorOf(members[i]);
            vm.prank(op);
            module.commitVote(
                market,
                members[i],
                _commitment(
                    market,
                    1,
                    keccak256(abi.encode("salt", members[i])),
                    keccak256(abi.encode("receipt", members[i])),
                    op
                )
            );
        }
        vm.warp(module.roundOf(market).commitDeadline + 1);
        for (uint256 i = 0; i < members.length - 1; i++) {
            address op = registry_.operatorOf(members[i]);
            vm.prank(op);
            module.revealVote(
                market,
                members[i],
                1,
                keccak256(abi.encode("salt", members[i])),
                keccak256(abi.encode("receipt", members[i]))
            );
        }
        vm.warp(module.roundOf(market).disputeDeadline + 1);
        module.finalize(market);

        assertEq(module.owedTo(members[members.length - 1]), 0, "a no-show was paid");
        assertGt(module.owedTo(members[0]), 0, "an attendee was not paid");
    }

    // ── taking it ─────────────────────────────────────────────────────────────

    function test_theOwnerTakesTheEarningsAndCannotTakeThemTwice() public {
        address market = _settled(1);
        uint256 agentId = module.committeeOf(market)[0];
        address owner_ = registry_.ownerOf(agentId);
        uint256 amount = module.owedTo(agentId);

        uint256 before_ = usdc.balanceOf(owner_);
        vm.prank(owner_);
        module.claim(agentId, owner_);

        assertEq(usdc.balanceOf(owner_) - before_, amount, "the money did not arrive");
        assertEq(module.owedTo(agentId), 0, "the balance survived the claim");

        vm.prank(owner_);
        vm.expectRevert(abi.encodeWithSelector(ResolutionModule.NothingOwed.selector, agentId));
        module.claim(agentId, owner_);
    }

    /**
     * The operator votes; the OWNER is paid. An operator key lives on a machine
     * that trades unattended, and one stolen from there must not be able to
     * withdraw the stake's earnings as well.
     */
    function test_theOperatorCannotSpendWhatTheOwnerOwns() public {
        address market = _settled(1);
        uint256 agentId = module.committeeOf(market)[0];
        address operator = registry_.operatorOf(agentId);
        vm.assume(operator != registry_.ownerOf(agentId));

        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(ResolutionModule.NotOwed.selector, agentId));
        module.claim(agentId, operator);
    }

    // ── the residue ───────────────────────────────────────────────────────────

    /**
     * `sweepUnallocated` exists for the remainder of an uneven split and for the
     * deposit of a market nobody judged. It must not be able to reach a
     * resolver's earnings, and the check is unconditional rather than a matter
     * of governance restraint.
     */
    function test_governanceCannotSweepWhatResolversAreOwed() public {
        address market = _settled(1);
        uint256 owed = module.totalOwed();
        assertGt(owed, 0, "nothing was owed, so nothing is being protected");

        uint256 held = usdc.balanceOf(address(module));
        uint256 free = held - owed;

        vm.expectRevert(abi.encodeWithSelector(ResolutionModule.WouldTouchEarnings.selector, free + 1, free));
        module.sweepUnallocated(address(usdc), address(this), free + 1);

        // Everything above the ledger is fair game.
        module.sweepUnallocated(address(usdc), address(this), free);
        assertEq(usdc.balanceOf(address(module)), owed, "the sweep took earnings");
    }

    function test_whatWasSweptDoesNotStopAResolverBeingPaid() public {
        address market = _settled(1);
        uint256 agentId = module.committeeOf(market)[0];
        uint256 free = usdc.balanceOf(address(module)) - module.totalOwed();
        if (free > 0) module.sweepUnallocated(address(usdc), address(this), free);

        address owner_ = registry_.ownerOf(agentId);
        uint256 amount = module.owedTo(agentId);
        vm.prank(owner_);
        module.claim(agentId, owner_);
        assertEq(usdc.balanceOf(owner_), amount, "a swept module could not pay");
    }
}
