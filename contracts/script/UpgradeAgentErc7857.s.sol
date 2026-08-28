// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {AgentRegistry} from "../src/core/AgentRegistry.sol";
import {ZgDataVerifier} from "../src/core/ZgDataVerifier.sol";
import {AgentCard} from "../src/core/AgentCard.sol";

/// @notice Upgrade a live AgentRegistry to the one that implements ERC-7857, and
///         deploy the verifier it defers to.
///
/// @dev THIS UPGRADE ADDS STORAGE, which the tokenURI upgrade before it did not. Every
///      new variable is appended after `nameTaken`, the last slot the deployed contract
///      knows about — `verifier`, then four mappings. Appending is the only safe shape:
///      inserting `verifier` where it reads best, up beside `config`, would push
///      `resolvers` down two slots and the committee's list of who can be sampled would
///      come back empty while every call still succeeded.
///
///      NOTHING IS MIGRATED, deliberately. Agents registered before ERC-7857 keep their
///      root in `Agent.metadataRoot`, and `metadataRootOf` reads whichever of the two
///      places a given agent actually uses. A migration loop would have to touch every
///      agent, and an upgrade that half-completes leaves identities with no document at
///      all — the failure it was supposed to prevent.
///
///      The verifier is set in the same broadcast. Between the upgrade landing and the
///      verifier being set, every call that takes a proof reverts `VerifierUnset` —
///      which is the correct answer, but not one to leave standing across two
///      transactions if it can be avoided.
contract UpgradeAgentErc7857 is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(pk);

        string memory path = string.concat("../deployments/", vm.toString(block.chainid), ".json");
        string memory manifest = vm.readFile(path);
        AgentRegistry registry = AgentRegistry(vm.parseJsonAddress(manifest, ".contracts.AgentRegistry"));
        require(registry.owner() == deployer, "UpgradeAgentErc7857: deployer does not own the registry");

        // Read before, compared after. A layout mistake is silent until somebody asks
        // for old data, so the comparison has to be against something actually read —
        // and `metadataRoot` sits mid-struct, exactly where a shift shows up first.
        uint256 agents = registry.nextAgentId();
        uint256 resolvers = registry.resolverCount();
        address[] memory ownerBefore = new address[](agents);
        uint256[] memory stakeBefore = new uint256[](agents);
        address[] memory operatorBefore = new address[](agents);
        bytes32[] memory nameBefore = new bytes32[](agents);
        bytes32[] memory rootBefore = new bytes32[](agents);
        for (uint256 id = 1; id < agents; id++) {
            ownerBefore[id] = registry.ownerOf(id);
            stakeBefore[id] = registry.stakeOf(id);
            operatorBefore[id] = registry.operatorOf(id);
            nameBefore[id] = registry.nameOf(id);
            rootBefore[id] = registry.metadataRootOf(id);
        }

        vm.startBroadcast(pk);
        AgentRegistry impl = new AgentRegistry();
        registry.upgradeToAndCall(address(impl), "");
        ZgDataVerifier verifier = new ZgDataVerifier();
        registry.setVerifier(address(verifier));
        // Rendering left the registry in the same change — see `AgentCard`. Set in the
        // same broadcast, because between the upgrade landing and this call `tokenURI`
        // reverts, and a card that renders nothing is the defect it was written to fix.
        AgentCard card = new AgentCard();
        registry.setCard(address(card));
        vm.stopBroadcast();

        require(registry.nextAgentId() == agents, "the agent counter moved");
        require(registry.resolverCount() == resolvers, "the resolver list moved");
        require(address(registry.verifier()) == address(verifier), "verifier not set");
        require(address(registry.card()) == address(card), "card not set");
        for (uint256 id = 1; id < agents; id++) {
            require(registry.ownerOf(id) == ownerBefore[id], "owner moved");
            require(registry.stakeOf(id) == stakeBefore[id], "stake moved");
            require(registry.operatorOf(id) == operatorBefore[id], "operator moved");
            require(registry.nameOf(id) == nameBefore[id], "name moved");
            require(registry.metadataRootOf(id) == rootBefore[id], "metadataRoot moved");
            require(bytes(registry.tokenURI(id)).length > 0, "tokenURI stopped rendering");
            // An agent from before this upgrade must read as carrying exactly one
            // document — the one it always had — rather than none.
            require(registry.dataHashesOf(id).length == 1, "legacy agent lost its document");
            require(registry.dataHashesOf(id)[0] == rootBefore[id], "the 7857 view disagrees");
        }

        vm.writeJson(vm.toString(address(impl)), path, ".contracts.AgentRegistryImpl");
        vm.writeJson(vm.toString(address(verifier)), path, ".contracts.ZgDataVerifier");
        vm.writeJson(vm.toString(address(card)), path, ".contracts.AgentCard");

        console2.log("AgentRegistry impl:", address(impl));
        console2.log("ZgDataVerifier:    ", address(verifier));
        console2.log("AgentCard:         ", address(card));
        console2.log("agents checked:    ", agents - 1);
    }
}
