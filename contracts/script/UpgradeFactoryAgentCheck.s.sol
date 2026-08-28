// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {MarketFactory} from "../src/core/MarketFactory.sol";
import {ConfigRegistry} from "../src/core/ConfigRegistry.sol";
import {ConfigKeys} from "../src/core/ConfigKeys.sol";
import {Market} from "../src/core/Market.sol";

/// @notice Upgrade a live MarketFactory to the one that verifies `creatorAgentId`.
///
/// @dev This upgrade adds NO STORAGE. `_requireAgentBelongsTo` is a view over the
///      AgentRegistry reached through ConfigRegistry, so there is no layout question
///      to get wrong on a factory that already holds `usedApprovals`, `isMarket` and
///      `_markets`.
///
///      That claim is checked rather than asserted. Every market the factory has ever
///      minted is read back afterwards, because a layout mistake is silent until
///      somebody asks for old data — and `_markets` is exactly the array a shift would
///      corrupt. `usedApprovals` is not enumerable, so the nonce ledger is checked
///      indirectly: each market's own `creator` and `specRoot` must survive, which they
///      only can if the mapping around them did too.
///
///      AGENT_REGISTRY MUST BE SET FIRST. After this upgrade a market claiming any
///      non-zero `creatorAgentId` reverts with `AgentRegistryUnset` where the registry
///      address is zero — which would take market creation with it. The script refuses
///      to broadcast rather than discover that afterwards.
contract UpgradeFactoryAgentCheck is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(pk);

        string memory path = string.concat("../deployments/", vm.toString(block.chainid), ".json");
        string memory manifest = vm.readFile(path);
        MarketFactory factory = MarketFactory(vm.parseJsonAddress(manifest, ".contracts.MarketFactory"));
        ConfigRegistry config = ConfigRegistry(vm.parseJsonAddress(manifest, ".contracts.ConfigRegistry"));
        require(factory.owner() == deployer, "UpgradeFactoryAgentCheck: deployer does not own the factory");

        address registry = config.addresses(ConfigKeys.AGENT_REGISTRY);
        require(registry != address(0), "UpgradeFactoryAgentCheck: set AGENT_REGISTRY before upgrading");

        uint256 count = factory.marketCount();
        address[] memory before = new address[](count);
        address[] memory creators = new address[](count);
        bytes32[] memory roots = new bytes32[](count);
        for (uint256 i = 0; i < count; i++) {
            before[i] = factory.marketAt(i);
            creators[i] = Market(before[i]).creator();
            roots[i] = Market(before[i]).specRoot();
        }

        vm.startBroadcast(pk);
        MarketFactory impl = new MarketFactory();
        factory.upgradeToAndCall(address(impl), "");
        vm.stopBroadcast();

        require(factory.marketCount() == count, "the market list moved");
        for (uint256 i = 0; i < count; i++) {
            require(factory.marketAt(i) == before[i], "a market moved in the list");
            require(factory.isMarket(before[i]), "a market lost its registration");
            require(Market(before[i]).creator() == creators[i], "creator moved");
            require(Market(before[i]).specRoot() == roots[i], "specRoot moved");
        }

        vm.writeJson(vm.toString(address(impl)), path, ".contracts.MarketFactoryImpl");

        console2.log("MarketFactory impl:", address(impl));
        console2.log("markets intact:    ", count);
        console2.log("agent registry:    ", registry);
    }
}
