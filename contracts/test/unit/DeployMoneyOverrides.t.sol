// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ConfigRegistry} from "../../src/core/ConfigRegistry.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";
import {DeployLib} from "../../script/DeployLib.sol";
import {Deploy} from "../../script/Deploy.s.sol";

/// @dev 18 decimals, as W0G and every wrapped native token reports.
contract W0G is ERC20 {
    constructor() ERC20("Wrapped 0G", "W0G") {}
}

/// @dev `_applyMoneyOverrides` is internal, which is right — nothing outside the
///      deploy should reach it. Inheriting is how a test reaches it without
///      widening the surface for everyone else.
contract DeployHarness is Deploy {
    function applyMoney(ConfigRegistry config, Money memory m) external {
        _applyMoney(config, m);
    }

    /// @dev The registry is Ownable2Step, so the harness has to take ownership the
    ///      same way the real deployer does before it can set a parameter.
    function acceptRegistry(ConfigRegistry config) external {
        config.acceptOwnership();
    }
}

/**
 * The money parameters are policy, and the launch cost of getting them wrong is
 * concrete: fourteen resolvers at the hundred-token default lock 2,800 W0G before a
 * single market exists. These pin the mechanism that lets an operator choose.
 */
contract DeployMoneyOverridesTest is Test {
    ConfigRegistry internal config;
    DeployHarness internal harness;
    uint256 internal constant W = 1e18;

    /// @dev Zero everywhere is what an operator who sets nothing produces.
    function _none() internal pure returns (Deploy.Money memory) {
        return Deploy.Money({stake: 0, bond: 0, seed: 0, deposit: 0, minTrade: 0});
    }

    function setUp() public {
        ConfigRegistry impl = new ConfigRegistry();
        config = ConfigRegistry(
            address(
                new ERC1967Proxy(
                    address(impl), abi.encodeCall(ConfigRegistry.initialize, (address(this), address(this)))
                )
            )
        );
        DeployLib.applyDefaults(config, address(new W0G()));
        harness = new DeployHarness();
        // `setParam` is owner-gated, and in a real deploy the script IS the owner.
        // Two-step, because that is what the registry does.
        config.transferOwnership(address(harness));
        harness.acceptRegistry(config);
    }

    function test_unsetLeavesEveryDefaultAlone() public {
        harness.applyMoney(config, _none());
        assertEq(config.params(ConfigKeys.MIN_RESOLVER_STAKE), 100 * W, "stake");
        assertEq(config.params(ConfigKeys.DISPUTE_BOND), 50 * W, "bond");
        assertEq(config.params(ConfigKeys.MIN_SEED), 100 * W, "seed");
        assertEq(config.params(ConfigKeys.MIN_SETTLEMENT_DEPOSIT), 20 * W, "deposit");
        assertEq(config.params(ConfigKeys.MIN_TRADE_TOKENS), 1 * W, "trade");
    }

    function test_theLaunchConfiguration() public {
        // What a launch that is demonstrating the protocol rather than holding real
        // open interest actually wants: the roster costs 28 W0G instead of 2,800.
        harness.applyMoney(config, Deploy.Money({stake: W, bond: W, seed: W, deposit: W, minTrade: W / 100}));

        assertEq(config.params(ConfigKeys.MIN_RESOLVER_STAKE), 1 * W, "stake");
        assertEq(config.params(ConfigKeys.DISPUTE_BOND), 1 * W, "bond");
        assertEq(config.params(ConfigKeys.MIN_SEED), 1 * W, "seed");
        assertEq(config.params(ConfigKeys.MIN_SETTLEMENT_DEPOSIT), 1 * W, "deposit");
        assertEq(config.params(ConfigKeys.MIN_TRADE_TOKENS), W / 100, "trade");

        // The number the whole exercise was about.
        assertEq(config.params(ConfigKeys.MIN_RESOLVER_STAKE) * 2 * 14, 28 * W, "a roster of fourteen");
    }

    function test_overridingOneLeavesTheRest() public {
        Deploy.Money memory m = _none();
        m.stake = W;
        harness.applyMoney(config, m);
        assertEq(config.params(ConfigKeys.MIN_RESOLVER_STAKE), 1 * W, "stake moved");
        assertEq(config.params(ConfigKeys.MIN_SEED), 100 * W, "seed untouched");
        assertEq(config.params(ConfigKeys.DISPUTE_BOND), 50 * W, "bond untouched");
    }

    function test_aMinimumTradeAtTheSeedIsRefused() public {
        // Lowering the seed and forgetting the trade floor is the natural way to
        // arrive here, and nothing else in the stack would notice: the bounds pass,
        // the market deploys, and the first trader meets a floor as large as the
        // entire book they were quoting against.
        Deploy.Money memory m = _none();
        m.seed = W; // MIN_TRADE_TOKENS keeps its 1 W0G default, which now equals the seed.
        ConfigRegistry c = config;
        vm.expectRevert(
            bytes(
                "Deploy: MIN_TRADE_TOKENS is not below MIN_SEED, so no trade smaller than the whole book would be allowed"
            )
        );
        harness.applyMoney(c, m);
    }

    function test_aMinimumTradeBelowTheSeedIsAllowed() public {
        harness.applyMoney(config, Deploy.Money({stake: 0, bond: 0, seed: W, deposit: 0, minTrade: W - 1}));
        assertEq(config.params(ConfigKeys.MIN_TRADE_TOKENS), W - 1);
    }

    function test_aValueBelowTheLockedBoundIsRefusedByTheRegistry() public {
        // Bounds were locked by applyDefaults at one whole token. The registry is what
        // enforces that, not this script — so the floor cannot be argued away here.
        Deploy.Money memory m = _none();
        m.seed = 1;
        ConfigRegistry c = config;
        vm.expectRevert();
        harness.applyMoney(c, m);
    }
}
