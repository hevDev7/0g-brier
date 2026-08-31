// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ConfigRegistry} from "../../src/core/ConfigRegistry.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";
import {OutcomeShares} from "../../src/core/OutcomeShares.sol";
import {IMarketRegistry} from "../../src/interfaces/IMarketRegistry.sol";
import {IMarket} from "../../src/interfaces/IMarket.sol";
import {Market} from "../../src/core/Market.sol";
import {MockUSDC} from "../../src/mocks/MockUSDC.sol";
import {DeployLib} from "../../script/DeployLib.sol";

contract StubMarketRegistry is IMarketRegistry {
    mapping(address => bool) internal _markets;

    function set(address m, bool v) external {
        _markets[m] = v;
    }

    function isMarket(address m) external view returns (bool) {
        return _markets[m];
    }
}

abstract contract Fixtures is Test {
    ConfigRegistry internal config;
    MockUSDC internal usdc;
    OutcomeShares internal shares;
    StubMarketRegistry internal registry;
    Market internal marketImpl;

    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal treasury = makeAddr("treasury");
    address internal resolutionModule = makeAddr("resolutionModule");
    address internal guardian = makeAddr("guardian");

    uint256 internal constant SEED = 1_000e6;
    uint256 internal constant DEPOSIT = 20e6;
    uint64 internal constant TRADING_WINDOW = 7 days;
    /// @dev Wider than `MIN_SETTLEMENT_WINDOW` (3 days). The fixture used to leave one
    ///      day, which `Market.initialize` now refuses: a market whose deadline falls
    ///      before its own committee can finish is one that can only ever fail.
    uint64 internal constant SETTLEMENT_WINDOW = 4 days;

    function _deployBase() internal {
        usdc = new MockUSDC();
        shares = new OutcomeShares("");
        registry = new StubMarketRegistry();
        shares.setRegistry(address(registry));

        ConfigRegistry impl = new ConfigRegistry();
        config = ConfigRegistry(
            address(
                new ERC1967Proxy(address(impl), abi.encodeCall(ConfigRegistry.initialize, (address(this), guardian)))
            )
        );
        DeployLib.applyDefaults(config, address(usdc));
        config.setAddress(ConfigKeys.TREASURY, treasury);
        config.setAddress(ConfigKeys.RESOLUTION_MODULE, resolutionModule);
        config.setAddress(ConfigKeys.OUTCOME_SHARES, address(shares));

        marketImpl = new Market();
        vm.warp(1_800_000_000); // a stable timestamp, far away from zero
    }

    function _params() internal view returns (IMarket.Params memory p) {
        p.collateral = address(usdc);
        p.creator = creator;
        p.creatorAgentId = 1;
        p.tradingEnd = uint64(block.timestamp) + TRADING_WINDOW;
        p.settlementDeadline = uint64(block.timestamp) + TRADING_WINDOW + SETTLEMENT_WINDOW;
        p.tier = 1;
        p.specRoot = keccak256("spec");
        p.category = bytes32("crypto");
    }

    /// @dev Mirrors exactly what MarketFactory does in Task 17:
    ///      clone → transfer the collateral IN → initialize.
    function _newMarket(uint256 seedTokens) internal returns (Market m) {
        m = Market(Clones.clone(address(marketImpl)));
        registry.set(address(m), true);
        usdc.mintTo(address(this), seedTokens + DEPOSIT);
        usdc.transfer(address(m), seedTokens + DEPOSIT);
        m.initialize(address(config), address(shares), _params(), seedTokens, DEPOSIT);
    }

    /// @dev `OutcomeShares.setRegistry` is a one-shot key and `_deployBase` has already spent
    ///      it on StubMarketRegistry — that instance can NEVER be redirected to a real
    ///      MarketFactory (`RegistryAlreadySet`). A test that uses the real factory therefore
    ///      starts from a clean instance.
    ///
    ///      The registry is deliberately left unset here: the order must follow Deploy.s.sol —
    ///      shares → factory → setRegistry — because MarketFactory SNAPSHOTS the shares address
    ///      at `initialize` and never re-reads it. Reversing the order yields a factory pointing
    ///      at the old shares while the test inspects the new one: the market is born
    ///      successfully and then fails `NotMarket` on the first trade.
    ///
    ///      Only the deployer may call `setRegistry`, so this instance must be deployed by the
    ///      same test contract that calls `_useFactoryAsRegistry`.
    ///
    ///      MUTUALLY EXCLUSIVE WITH `_newMarket`: this pair replaces `shares` while
    ///      `StubMarketRegistry` still points at the first instance, so a market built by
    ///      `_newMarket` is registered in a registry the NEW `shares` does not trust. A test
    ///      that mixes the two fails `NotMarket` on the first trade for a deeply unobvious
    ///      reason. Pick one per test contract: `_newMarket` (stub) OR the real factory.
    function _freshShares() internal {
        shares = new OutcomeShares("");
        config.setAddress(ConfigKeys.OUTCOME_SHARES, address(shares));
    }

    /// @dev Closes the loop opened by `_freshShares`: from this point on OutcomeShares trusts
    ///      only markets genuinely born from the factory.
    function _useFactoryAsRegistry(address factory_) internal {
        shares.setRegistry(factory_);
    }

    function _fund(address who, uint256 amount, address spender) internal {
        usdc.mintTo(who, amount);
        vm.prank(who);
        usdc.approve(spender, type(uint256).max);
    }
}
