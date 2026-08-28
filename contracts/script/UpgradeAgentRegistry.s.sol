// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {AgentRegistry} from "../src/core/AgentRegistry.sol";
import {IAgentRegistry} from "../src/interfaces/IAgentRegistry.sol";

/// @notice Upgrade a live AgentRegistry to the one that carries names and a reverse
///         index, then repair what an appended field cannot fill in by itself.
///
/// @dev The new storage is APPENDED — `agentOf` at slot 6, `nameTaken` at 7, and the
///      struct's `name` after `cooldownEnds`. Slots 0 through 5 are untouched, which
///      was checked against the deployed contract first: an earlier draft put `name`
///      in the middle of the struct and would have read 600 mUSDC of live stake as a
///      keccak hash.
///
///      Appending leaves two gaps that only a migration can close. Every agent
///      registered before this reads `name == 0`, and `agentOf` is empty for every
///      operator — so no existing key could be traced back to its agent. This walks
///      the agents it can see and fixes both.
contract UpgradeAgentRegistry is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(pk);

        string memory path = string.concat("../deployments/", vm.toString(block.chainid), ".json");
        string memory manifest = vm.readFile(path);
        AgentRegistry registry = AgentRegistry(vm.parseJsonAddress(manifest, ".contracts.AgentRegistry"));
        require(registry.owner() == deployer, "UpgradeAgentRegistry: deployer does not own the registry");

        // Observed before, compared after. A layout mistake is silent until someone
        // asks for old data, so the check has to be against something read, not hoped.
        uint256 agents = registry.nextAgentId();
        uint256 resolvers = registry.resolverCount();
        uint256[] memory stakeBefore = new uint256[](agents);
        address[] memory operators = new address[](agents);
        for (uint256 id = 1; id < agents; id++) {
            stakeBefore[id] = registry.stakeOf(id);
            operators[id] = registry.operatorOf(id);
        }

        vm.startBroadcast(pk);
        AgentRegistry impl = new AgentRegistry();
        registry.upgradeToAndCall(address(impl), "");

        for (uint256 id = 1; id < agents; id++) {
            require(registry.stakeOf(id) == stakeBefore[id], "UpgradeAgentRegistry: stake did not survive");
            // Re-pointing an operator at itself is what populates `agentOf` — the
            // mapping is new and empty, so until this runs no live key can be traced
            // back to the agent it acts for.
            if (operators[id] != address(0)) {
                uint256 claimed = registry.agentOf(operators[id]);
                if (claimed == 0) {
                    registry.setOperator(id, operators[id]);
                } else if (claimed != id) {
                    // The OLD contract allowed two agents to share an operator; the new
                    // one does not, and the reverse index can only point one way. The
                    // first agent walked wins, and the rest are left untraceable — so
                    // say which, rather than skipping in silence. A key that trades will
                    // be attributed to `claimed`, not to `id`.
                    console2.log("COLLISION: operator claimed by another agent");
                    console2.log("  operator", operators[id]);
                    console2.log("  claimed by", claimed);
                    console2.log("  untraceable", id);
                }
            }
            // A name every agent lacks, because the field did not exist when they
            // registered. Provisional and renameable; better than anonymous.
            if (registry.nameOf(id) == bytes32(0)) {
                registry.setName(id, _provisionalName(registry.roleOf(id), id));
            }
        }
        vm.stopBroadcast();

        require(registry.resolverCount() == resolvers, "UpgradeAgentRegistry: the resolver list moved");
        vm.writeJson(vm.toString(address(impl)), path, ".contracts.AgentRegistryImpl");

        console2.log("AgentRegistry impl:", address(impl));
        console2.log("agents migrated:   ", agents - 1);
        console2.log("resolvers intact:  ", registry.resolverCount());
    }

    function _provisionalName(IAgentRegistry.Role role, uint256 id) internal pure returns (bytes32) {
        string memory prefix = role == IAgentRegistry.Role.Resolver
            ? "resolver-"
            : role == IAgentRegistry.Role.Trader
                ? "trader-"
                : role == IAgentRegistry.Role.Curator ? "curator-" : "creator-";
        return bytes32(abi.encodePacked(prefix, vm.toString(id)));
    }
}
