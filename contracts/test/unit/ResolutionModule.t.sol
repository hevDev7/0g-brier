// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Fixtures} from "../helpers/Fixtures.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";
import {IMarket} from "../../src/interfaces/IMarket.sol";
import {Market} from "../../src/core/Market.sol";
import {ResolutionModule} from "../../src/core/ResolutionModule.sol";

/// @dev Nothing here settles a market by pranking an EOA, which is how every other test in
///      this suite reaches `onlyResolutionModule`. The point of this contract is that the
///      resolution module is a CONTRACT that anchors a receipt on its way through, so the
///      module is wired in as the real `RESOLUTION_MODULE` and driven from outside.
contract ResolutionModuleTest is Fixtures {
    ResolutionModule internal module;
    address internal resolver = makeAddr("resolver");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant RECEIPT = keccak256("a settlement receipt on 0G Storage");

    function setUp() public {
        _deployBase();

        ResolutionModule impl = new ResolutionModule();
        module = ResolutionModule(
            address(
                new ERC1967Proxy(
                    address(impl), abi.encodeCall(ResolutionModule.initialize, (address(this), address(config)))
                )
            )
        );

        // The two config writes that are the whole of "option A" on a live chain: point
        // the market's resolution gate at this contract, and give it a factory to check
        // markets against. `_deployBase` leaves MARKET_FACTORY unset, and the stub
        // registry is what plays that part throughout this suite.
        config.setAddress(ConfigKeys.RESOLUTION_MODULE, address(module));
        config.setAddress(ConfigKeys.MARKET_FACTORY, address(registry));
        module.setResolver(resolver, true);
    }

    function _closedMarket() internal returns (Market m) {
        m = _newMarket(SEED);
        vm.warp(block.timestamp + TRADING_WINDOW + 1);
        m.close();
    }

    // ── the record, and the transition, as one thing ──────────────────────────

    function test_settleAnchorsTheReceiptAndSettlesTheMarket() public {
        Market m = _closedMarket();

        vm.prank(resolver);
        module.settle(address(m), 1, RECEIPT);

        (bytes32 root, address who) = module.resolutionOf(address(m));
        assertEq(root, RECEIPT, "receipt root not anchored");
        assertEq(who, resolver, "resolver not recorded");
        assertEq(uint8(m.status()), uint8(IMarket.Status.Settled), "market not settled");
        assertEq(m.winningOutcome(), 1, "wrong winner");
    }

    function test_failAnchorsItsOwnReceipt() public {
        Market m = _closedMarket();
        bytes32 why = keccak256("no source could answer the question");

        vm.prank(resolver);
        module.fail(address(m), why);

        (bytes32 root,) = module.resolutionOf(address(m));
        assertEq(root, why, "a failure needs its evidence too");
        assertEq(uint8(m.status()), uint8(IMarket.Status.Failed), "market not failed");
    }

    /// @dev What makes `resolutionOf` trustworthy: an anchored receipt always describes a
    ///      transition that actually happened. `settle` on an OPEN market is a bad
    ///      transition, the market rejects it, and the record must go with it — a receipt
    ///      for a settlement that never happened is worse than no receipt at all.
    ///
    ///      It holds today because the whole call reverts. The test is here for the day
    ///      someone wraps the market call in a try/catch to "handle" a failure gracefully,
    ///      which would leave exactly that record behind.
    function test_aRejectedTransitionLeavesNoRecord() public {
        Market m = _newMarket(SEED); // still Open
        address market = address(m);

        vm.prank(resolver);
        vm.expectRevert(Market.BadTransition.selector);
        module.settle(market, 1, RECEIPT);

        (bytes32 root, address who) = module.resolutionOf(market);
        assertEq(root, bytes32(0), "a reverted settlement left a receipt behind");
        assertEq(who, address(0), "a reverted settlement left a resolver behind");
    }

    // ── the two guards on what may be recorded ────────────────────────────────

    /// @dev The defect this contract was built to prevent: a root that commits to a
    ///      document which cannot exist. `specRoot` shipped that way once.
    function test_anEmptyReceiptRootIsRefused() public {
        Market m = _closedMarket();
        address market = address(m);

        vm.prank(resolver);
        vm.expectRevert(ResolutionModule.EmptyReceipt.selector);
        module.settle(market, 1, bytes32(0));

        assertEq(uint8(m.status()), uint8(IMarket.Status.Closed), "the market moved anyway");
    }

    function test_anAddressTheFactoryDoesNotKnowIsRefused() public {
        // A contract that would happily accept `settle()` and do nothing, which is exactly
        // what the factory check exists to keep out of the record.
        ImpostorMarket impostor = new ImpostorMarket();
        address fake = address(impostor);

        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(ResolutionModule.NotAMarket.selector, fake));
        module.settle(fake, 1, RECEIPT);
    }

    // ── who may do it ─────────────────────────────────────────────────────────

    function test_onlyAResolverMayDriveAnyTransition() public {
        Market m = _closedMarket();
        address market = address(m);

        vm.startPrank(stranger);
        vm.expectRevert(ResolutionModule.NotResolver.selector);
        module.settle(market, 1, RECEIPT);
        vm.expectRevert(ResolutionModule.NotResolver.selector);
        module.fail(market, RECEIPT);
        vm.expectRevert(ResolutionModule.NotResolver.selector);
        module.markProposed(market);
        vm.expectRevert(ResolutionModule.NotResolver.selector);
        module.markDisputed(market);
        vm.stopPrank();
    }

    /// @dev A resolver signs many transactions; an owner can replace this contract. The
    ///      test is here so the two roles cannot quietly become one.
    function test_aResolverIsNotAnOwner() public {
        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, resolver));
        module.setResolver(stranger, true);
    }

    function test_theOwnerCanRevokeAResolver() public {
        Market m = _closedMarket();
        address market = address(m);

        module.setResolver(resolver, false);

        vm.prank(resolver);
        vm.expectRevert(ResolutionModule.NotResolver.selector);
        module.settle(market, 1, RECEIPT);
    }

    // ── the intermediate transitions anchor nothing ───────────────────────────

    function test_aProposalIsNotYetADecisionAndAnchorsNoReceipt() public {
        Market m = _closedMarket();

        vm.startPrank(resolver);
        module.markProposed(address(m));
        (bytes32 afterPropose,) = module.resolutionOf(address(m));
        assertEq(afterPropose, bytes32(0), "a proposal anchored a receipt");

        module.markDisputed(address(m));
        (bytes32 afterDispute,) = module.resolutionOf(address(m));
        assertEq(afterDispute, bytes32(0), "a dispute anchored a receipt");

        // …and the decision that follows the dispute does anchor one.
        module.settle(address(m), 0, RECEIPT);
        vm.stopPrank();

        (bytes32 finalRoot,) = module.resolutionOf(address(m));
        assertEq(finalRoot, RECEIPT, "the decision anchored nothing");
        assertEq(m.winningOutcome(), 0, "outcome 0 is a winner, not an absence");
    }

    // ── upgrade authorization ─────────────────────────────────────────────────

    /// @dev The receipts accumulate in THIS contract's storage, which is the reason it is
    ///      upgradeable rather than swappable: replacing the address would strand them.
    ///      That makes who may upgrade it a question about the records, not just the code.
    function test_onlyTheOwnerMayUpgrade() public {
        // Hoisted out of the call below. `new` is a CREATE, and `vm.expectRevert` binds to
        // the very next external call — inline, the CREATE would consume it and the test
        // would pass without ever reaching the upgrade.
        ResolutionModule next = new ResolutionModule();
        address nextAddr = address(next);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        module.upgradeToAndCall(nextAddr, "");

        module.upgradeToAndCall(nextAddr, "");
    }
}

/// @dev Accepts every call the module makes and does nothing with any of them.
contract ImpostorMarket {
    function settle(uint8) external {}
    function fail() external {}
    function markProposed() external {}
    function markDisputed() external {}
}
