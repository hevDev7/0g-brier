// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {AgentRegistry} from "../src/core/AgentRegistry.sol";

/// @notice Upgrade a live AgentRegistry to the one that answers `tokenURI`.
///
/// @dev This upgrade adds NO STORAGE. `tokenURI` and its helpers are views over
///      `_agents`, which is why it is safe to apply to a registry already holding
///      identities and staked funds — there is no layout question to get wrong.
///
///      That claim is checked rather than asserted. Every observable is read before
///      the upgrade and compared after: a layout mistake is silent until somebody
///      asks for old data, so the comparison has to be against something actually
///      read. `metadataRoot` is included because it sits mid-struct, which is exactly
///      where a shift would show up first.
contract UpgradeAgentTokenURI is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(pk);

        string memory path = string.concat("../deployments/", vm.toString(block.chainid), ".json");
        string memory manifest = vm.readFile(path);
        AgentRegistry registry = AgentRegistry(vm.parseJsonAddress(manifest, ".contracts.AgentRegistry"));
        require(registry.owner() == deployer, "UpgradeAgentTokenURI: deployer does not own the registry");

        uint256 agents = registry.nextAgentId();
        uint256 resolvers = registry.resolverCount();
        uint256[] memory stakeBefore = new uint256[](agents);
        address[] memory operatorBefore = new address[](agents);
        bytes32[] memory nameBefore = new bytes32[](agents);
        bytes32[] memory rootBefore = new bytes32[](agents);
        for (uint256 id = 1; id < agents; id++) {
            stakeBefore[id] = registry.stakeOf(id);
            operatorBefore[id] = registry.operatorOf(id);
            nameBefore[id] = registry.nameOf(id);
            rootBefore[id] = registry.metadataRootOf(id);
        }

        vm.startBroadcast(pk);
        AgentRegistry impl = new AgentRegistry();
        registry.upgradeToAndCall(address(impl), "");
        vm.stopBroadcast();

        for (uint256 id = 1; id < agents; id++) {
            require(registry.stakeOf(id) == stakeBefore[id], "stake moved");
            require(registry.operatorOf(id) == operatorBefore[id], "operator moved");
            require(registry.nameOf(id) == nameBefore[id], "name moved");
            require(registry.metadataRootOf(id) == rootBefore[id], "metadataRoot moved");
            // The whole point of the upgrade: a token that rendered as nothing.
            require(bytes(registry.tokenURI(id)).length > 0, "tokenURI still empty");
        }
        require(registry.resolverCount() == resolvers, "the resolver list moved");

        vm.writeJson(vm.toString(address(impl)), path, ".contracts.AgentRegistryImpl");

        console2.log("AgentRegistry impl:", address(impl));
        console2.log("agents checked:    ", agents - 1);
        console2.log("resolvers intact:  ", resolvers);
    }
}
