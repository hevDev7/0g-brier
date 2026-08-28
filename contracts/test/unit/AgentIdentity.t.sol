// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CommitteeFixtures} from "../helpers/CommitteeFixtures.sol";
import {AgentRegistry} from "../../src/core/AgentRegistry.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";
import {IAgentRegistry} from "../../src/interfaces/IAgentRegistry.sol";
import {Market} from "../../src/core/Market.sol";

/// @dev A `Trade` event carries `msg.sender` and nothing else. Everything here exists
///      so that a leaderboard can turn that address into a name — and so that the name
///      it shows means one agent rather than whoever happened to type it.
contract AgentIdentityTest is CommitteeFixtures {
    address internal trader = makeAddr("traderOperator");
    address internal other = makeAddr("otherOperator");
    uint256 internal traderId;

    function setUp() public {
        _deployBase();
        _deployCommittee(3, 1_000e6);
        traderId = registry_.register(IAgentRegistry.Role.Trader, trader, "Nostradamus", keccak256("persona"));
    }

    // ── identity ──────────────────────────────────────────────────────────────

    function test_anAgentHasANameThatResolvesWithoutFetchingAnything() public view {
        assertEq(registry_.nameOf(traderId), "Nostradamus", "no name on chain");
        // The point of it being on chain: a leaderboard resolves this in the same read
        // it already makes, with nothing to fetch and nothing to fail.
        assertEq(registry_.nameOfOperator(trader), "Nostradamus", "cannot go from a key to a name");
    }

    function test_aTradeCanBeAttributedBackwardsFromTheKeyThatSignedIt() public view {
        assertEq(registry_.agentOf(trader), traderId, "no reverse index");
        assertEq(registry_.agentOf(other), 0, "an unknown key claimed an agent");
        assertEq(registry_.nameOfOperator(other), bytes32(0), "an unknown key claimed a name");
    }

    /// @dev Two agents called "Nostradamus" is worse than two addresses: the reader
    ///      believes they can tell them apart.
    function test_aNameCanOnlyBeTakenOnce() public {
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.NameTaken.selector, bytes32("Nostradamus")));
        registry_.register(IAgentRegistry.Role.Trader, other, "Nostradamus", bytes32(0));
    }

    function test_anAgentCannotBeAnonymous() public {
        vm.expectRevert(AgentRegistry.NameEmpty.selector);
        registry_.register(IAgentRegistry.Role.Trader, other, bytes32(0), bytes32(0));
    }

    /// @dev One key, one agent. Two would make every trade it signed ambiguous.
    function test_oneKeyCannotActForTwoAgents() public {
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.OperatorAlreadyActs.selector, trader, traderId));
        registry_.register(IAgentRegistry.Role.Trader, trader, "Impostor", bytes32(0));
    }

    /// @dev The one thing a rotation is for: the retired key stops being that agent.
    function test_rotatingTheOperatorRetiresTheOldKey() public {
        registry_.setOperator(traderId, other);
        assertEq(registry_.agentOf(other), traderId, "the new key does not act for the agent");
        assertEq(registry_.agentOf(trader), 0, "the retired key still acts for the agent");
        assertEq(registry_.nameOfOperator(trader), bytes32(0), "a retired key kept the name");
    }

    // ── the trading gate ──────────────────────────────────────────────────────

    function _tradableMarket() internal returns (Market m) {
        m = _newMarket(SEED);
        config.setAddress(ConfigKeys.AGENT_REGISTRY, address(registry_));
    }

    function test_tradingIsUngatedUntilGovernanceSwitchesItOn() public {
        Market m = _tradableMarket();
        _fund(alice, 10_000e6, address(m));
        vm.prank(alice);
        m.buy(1, 10e18, 10_000e6, alice); // alice is nobody's agent, and that is fine
        assertGt(shares.balanceOfOutcome(alice, address(m), 1), 0, "an ungated trade was refused");
    }

    function test_onceOnOnlyARegisteredTraderMayBuyOrSell() public {
        Market m = _tradableMarket();
        config.setParam(ConfigKeys.REQUIRE_REGISTERED_TRADER, 1);
        address market = address(m);

        _fund(alice, 10_000e6, market);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Market.UnregisteredTrader.selector, alice));
        m.buy(1, 10e18, 10_000e6, alice);

        _fund(trader, 10_000e6, market);
        vm.prank(trader);
        m.buy(1, 10e18, 10_000e6, trader);
        assertGt(shares.balanceOfOutcome(trader, market, 1), 0, "a registered trader was refused");
    }

    /// @dev A resolver holding a position in a market it may be sampled to judge is the
    ///      conflict the roles exist to separate. Registering is not enough; the role
    ///      has to be the one that trades.
    function test_aResolverMayNotTradeOnItsResolverIdentity() public {
        Market m = _tradableMarket();
        config.setParam(ConfigKeys.REQUIRE_REGISTERED_TRADER, 1);
        address market = address(m);
        address resolverOp = operators[0];

        _fund(resolverOp, 10_000e6, market);
        // Hoisted, and it has to be. `registry_.agentOf` is an EXTERNAL call, and
        // inline in the argument list it consumes the prank — the buy then arrives
        // from the test contract and reverts UnregisteredTrader instead. The same
        // shape as the `vm.expectRevert` trap this repo has paid for three times.
        uint256 resolverAgent = registry_.agentOf(resolverOp);
        vm.prank(resolverOp);
        vm.expectRevert(abi.encodeWithSelector(Market.NotATrader.selector, resolverOp, resolverAgent));
        m.buy(1, 10e18, 10_000e6, resolverOp);
    }

    /// @dev Selling is a trade — it moves the price — so it is gated. Redeeming and
    ///      liquidating are exits, and an exit must never depend on an identity that
    ///      might have been retired since the position was opened.
    function test_theGateStopsSellingButNeverStopsAnExit() public {
        Market m = _tradableMarket();
        address market = address(m);
        _fund(trader, 100_000e6, market);
        vm.prank(trader);
        m.buy(1, 100e18, 100_000e6, trader);

        config.setParam(ConfigKeys.REQUIRE_REGISTERED_TRADER, 1);
        registry_.setOperator(traderId, other); // the trader's key is retired mid-position

        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(Market.UnregisteredTrader.selector, trader));
        m.sell(1, 10e18, 0, trader);

        // …but the exit still works.
        vm.warp(block.timestamp + TRADING_WINDOW + 1);
        m.close();
        // `_deployCommittee` repointed RESOLUTION_MODULE at the module CONTRACT, so
        // the fixture's EOA is no longer who the market listens to.
        vm.prank(address(module));
        m.settle(1);
        vm.prank(trader);
        uint256 out = m.redeem(trader);
        assertGt(out, 0, "an exit was blocked by an identity check");
    }
}
