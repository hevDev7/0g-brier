// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "../helpers/Fixtures.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ConfigRegistry} from "../../src/core/ConfigRegistry.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";
import {MarketFactory} from "../../src/core/MarketFactory.sol";
import {Market} from "../../src/core/Market.sol";
import {OutcomeShares} from "../../src/core/OutcomeShares.sol";

/// @title UpgradeAuthorizationTest
/// @notice The two UUPS contracts, and who is allowed to replace their logic.
///
/// @dev This file exists because a grep for `upgradeToAndCall|_authorizeUpgrade|UUPSUnauthorized`
///      across `test/` returned nothing at all. Both `ConfigRegistry` and `MarketFactory` carry
///      `_authorizeUpgrade(address) internal override onlyOwner {}` — an empty body whose entire
///      content is its modifier, which is exactly the kind of line that survives a refactor
///      after losing its meaning.
///
///      The stake is not symmetric with the rest of the system. `MarketFactory` is the sole
///      registry `OutcomeShares` trusts (`onlyMarket` asks it, and nothing else), so an
///      unauthorized upgrade there is not a degraded feature — it is the ability to mint any
///      outcome id on any market. `ConfigRegistry` is the sole source of every parameter and
///      address the markets read.
///
///      `Market` and `OutcomeShares` are deliberately absent from this file: they hold funds
///      and are not upgradeable at all. `test_marketHasNoUpgradePath` pins that down, so this
///      file also fails if either ever grows one.
contract UpgradeAuthorizationTest is Fixtures {
    /// @dev ERC-1967 implementation slot: keccak256("eip1967.proxy.implementation") - 1.
    bytes32 internal constant IMPL_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    MarketFactory internal factory;
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        _deployBase();
        _freshShares();

        MarketFactory impl = new MarketFactory();
        factory = MarketFactory(
            address(
                new ERC1967Proxy(
                    address(impl),
                    abi.encodeCall(
                        MarketFactory.initialize, (address(this), address(config), address(shares), address(marketImpl))
                    )
                )
            )
        );
        _useFactoryAsRegistry(address(factory));
    }

    function _implementationOf(address proxy) internal view returns (address) {
        return address(uint160(uint256(vm.load(proxy, IMPL_SLOT))));
    }

    // ── MarketFactory ────────────────────────────────────────────────────────

    function test_strangerCannotUpgradeMarketFactory() public {
        address next = address(new MarketFactory());
        address before = _implementationOf(address(factory));

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, stranger));
        factory.upgradeToAndCall(next, "");

        assertEq(_implementationOf(address(factory)), before, "the implementation must not have moved");
    }

    /// @dev The positive half. Without it, the test above would pass just as well against a
    ///      factory whose upgrade path is broken for everyone — which proves nothing about
    ///      authorization.
    function test_ownerCanUpgradeMarketFactory() public {
        address next = address(new MarketFactory());
        assertTrue(_implementationOf(address(factory)) != next, "precondition: a genuinely different implementation");

        factory.upgradeToAndCall(next, "");

        assertEq(_implementationOf(address(factory)), next);
        // State survives the upgrade: the proxy's storage is the same storage.
        assertEq(address(factory.config()), address(config));
        assertEq(address(factory.shares()), address(shares));
    }

    /// @dev `OutcomeShares.onlyMarket` consults this factory and nothing else, so an upgrade
    ///      that changed `isMarket` would be a licence to mint. The guard is checked here on
    ///      the live path rather than assumed from the modifier.
    function test_upgradedFactoryIsStillTheOnlyRegistryOutcomeSharesTrusts() public {
        factory.upgradeToAndCall(address(new MarketFactory()), "");
        assertEq(address(shares.registry()), address(factory), "the registry pointer is not part of the upgrade");
    }

    // ── ConfigRegistry ───────────────────────────────────────────────────────

    function test_strangerCannotUpgradeConfigRegistry() public {
        address next = address(new ConfigRegistry());
        address before = _implementationOf(address(config));

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, stranger));
        config.upgradeToAndCall(next, "");

        assertEq(_implementationOf(address(config)), before);
    }

    function test_ownerCanUpgradeConfigRegistry() public {
        address next = address(new ConfigRegistry());
        config.upgradeToAndCall(next, "");
        assertEq(_implementationOf(address(config)), next);
        // The locked bounds are storage, not code, so they outlive the implementation.
        (uint128 lo, uint128 hi, bool locked) = config.bounds(ConfigKeys.FEE_BPS);
        assertEq(lo, 0);
        assertEq(hi, 300);
        assertTrue(locked, "the fee ceiling survives an upgrade");
    }

    /// @dev The guardian is a fast-action key, deliberately weaker than the owner: it may
    ///      `pause()` and `void()`, and nothing else. Upgrading is the sharpest thing anyone
    ///      can do to this system, so it must be outside that key's reach.
    function test_guardianCannotUpgradeConfigRegistry() public {
        address next = address(new ConfigRegistry());
        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, guardian));
        config.upgradeToAndCall(next, "");
    }

    // ── the implementations themselves ───────────────────────────────────────

    /// @dev UUPS puts the upgrade entry point in the logic contract, so the logic contract is
    ///      itself callable. `onlyProxy` is what stops someone taking ownership of a bare
    ///      implementation and upgrading it — which for a UUPS contract can brick every proxy
    ///      pointing at it if the new logic self-destructs or drops `_authorizeUpgrade`.
    function test_implementationsRejectDirectUpgradeCalls() public {
        // Every CREATE is hoisted out of the argument lists below. `vm.expectRevert` binds to
        // the very next external call and a `new` IS one, so an inline `new MarketFactory()`
        // silently eats the expectation and the assertion then fires against a CREATE that
        // succeeded. This project has paid for that lesson twice already (see CLAUDE.md).
        MarketFactory factoryImpl = new MarketFactory();
        address nextFactory = address(new MarketFactory());
        ConfigRegistry configImpl = new ConfigRegistry();
        address nextConfig = address(new ConfigRegistry());

        vm.expectRevert(UUPSUpgradeable.UUPSUnauthorizedCallContext.selector);
        factoryImpl.upgradeToAndCall(nextFactory, "");

        vm.expectRevert(UUPSUpgradeable.UUPSUnauthorizedCallContext.selector);
        configImpl.upgradeToAndCall(nextConfig, "");
    }

    /// @dev Both constructors call `_disableInitializers()`. Without it, anyone could
    ///      initialize the bare implementation, become its owner, and reach the path above.
    function test_implementationsCannotBeInitialized() public {
        MarketFactory factoryImpl = new MarketFactory();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        factoryImpl.initialize(stranger, address(config), address(shares), address(marketImpl));

        ConfigRegistry configImpl = new ConfigRegistry();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        configImpl.initialize(stranger, stranger);
    }

    // ── the contracts that hold funds have no upgrade path at all ────────────

    /// @dev Not a stylistic preference (spec §6.1): a contract holding user funds is never
    ///      upgradeable. `Market` is an EIP-1167 clone of a fixed implementation and
    ///      `OutcomeShares` is a plain singleton, so neither has an ERC-1967 implementation
    ///      slot to move. Asserting the slot is empty is what makes this a test rather than a
    ///      comment.
    function test_fundHoldingContractsHaveNoUpgradePath() public {
        Market m = _newMarket(SEED);
        assertEq(vm.load(address(m), IMPL_SLOT), bytes32(0), "a Market clone has no ERC-1967 implementation slot");
        assertEq(vm.load(address(shares), IMPL_SLOT), bytes32(0), "OutcomeShares has no ERC-1967 implementation slot");
    }
}
