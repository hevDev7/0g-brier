// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {AgentRegistry} from "../src/core/AgentRegistry.sol";
import {ResolutionModule} from "../src/core/ResolutionModule.sol";
import {ConfigRegistry} from "../src/core/ConfigRegistry.sol";
import {ConfigKeys} from "../src/core/ConfigKeys.sol";

/// @notice Point this deployment at ERC-8004's registries and upgrade the two contracts
///         that talk to them.
///
/// @dev ERC-8004 is deployed at ONE pair of addresses across 57 networks, 0G among them,
///      so this is configuration rather than deployment — nothing here creates a
///      registry, and the ones it names are owned by somebody else entirely. That is the
///      point: a reputation signal readable only inside the system that produced it is
///      not much of a signal.
///
///      The addresses are checked for CODE before being written. A config pointer to an
///      empty address would make `linkErc8004` revert on a `ownerOf` call to nothing,
///      and would make the module's publication silently do nothing forever — one loud,
///      one silent, both avoidable with two `extcodesize` reads.
contract UpgradeErc8004 is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(pk);

        string memory path = string.concat("../deployments/", vm.toString(block.chainid), ".json");
        string memory manifest = vm.readFile(path);
        AgentRegistry registry = AgentRegistry(vm.parseJsonAddress(manifest, ".contracts.AgentRegistry"));
        ResolutionModule module = ResolutionModule(vm.parseJsonAddress(manifest, ".contracts.ResolutionModule"));
        ConfigRegistry config = ConfigRegistry(vm.parseJsonAddress(manifest, ".contracts.ConfigRegistry"));

        require(registry.owner() == deployer, "UpgradeErc8004: deployer does not own the registry");
        require(module.owner() == deployer, "UpgradeErc8004: deployer does not own the module");

        address identity = vm.envAddress("ERC8004_IDENTITY");
        address reputation = vm.envAddress("ERC8004_REPUTATION");
        require(identity.code.length > 0, "UpgradeErc8004: ERC8004_IDENTITY has no code on this chain");
        require(reputation.code.length > 0, "UpgradeErc8004: ERC8004_REPUTATION has no code on this chain");

        uint256 agents = registry.nextAgentId();
        bytes32[] memory rootBefore = new bytes32[](agents);
        address[] memory ownerBefore = new address[](agents);
        for (uint256 id = 1; id < agents; id++) {
            rootBefore[id] = registry.metadataRootOf(id);
            ownerBefore[id] = registry.ownerOf(id);
        }

        vm.startBroadcast(pk);
        registry.upgradeToAndCall(address(new AgentRegistry()), "");
        module.upgradeToAndCall(address(new ResolutionModule()), "");
        config.setAddress(ConfigKeys.ERC8004_IDENTITY, identity);
        config.setAddress(ConfigKeys.ERC8004_REPUTATION, reputation);
        vm.stopBroadcast();

        require(config.addresses(ConfigKeys.ERC8004_IDENTITY) == identity, "identity not set");
        require(config.addresses(ConfigKeys.ERC8004_REPUTATION) == reputation, "reputation not set");
        require(registry.nextAgentId() == agents, "the agent counter moved");
        for (uint256 id = 1; id < agents; id++) {
            require(registry.metadataRootOf(id) == rootBefore[id], "metadataRoot moved");
            require(registry.ownerOf(id) == ownerBefore[id], "owner moved");
            require(registry.erc8004Of(id) == 0, "a link appeared from nowhere");
        }

        console2.log("ERC8004_IDENTITY:  ", identity);
        console2.log("ERC8004_REPUTATION:", reputation);
        console2.log("agents checked:    ", agents - 1);
    }
}
