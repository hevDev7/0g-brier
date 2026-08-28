// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ConfigRegistry} from "../src/core/ConfigRegistry.sol";
import {ConfigKeys} from "../src/core/ConfigKeys.sol";
import {AgentRegistry} from "../src/core/AgentRegistry.sol";
import {ResolutionModule} from "../src/core/ResolutionModule.sol";

/// @notice Upgrade a live ResolutionModule from the receipt-anchoring version to the
///         committee, and give it the AgentRegistry it now needs.
///
/// @dev The reason the module was made upgradeable rather than replaceable: the receipts
///      already anchored for markets settled before the committee existed live in ITS
///      storage, and swapping the address would strand every one of them. This script
///      reads one back afterwards to prove they survived, because a storage-layout
///      mistake is silent until someone asks for old data.
contract UpgradeResolutionModule is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(pk);

        string memory path = string.concat("../deployments/", vm.toString(block.chainid), ".json");
        string memory manifest = vm.readFile(path);
        ConfigRegistry config = ConfigRegistry(vm.parseJsonAddress(manifest, ".contracts.ConfigRegistry"));
        ResolutionModule module = ResolutionModule(vm.parseJsonAddress(manifest, ".contracts.ResolutionModule"));
        address collateral = vm.parseJsonAddress(manifest, ".contracts.MockUSDC");

        require(module.owner() == deployer, "Upgrade: deployer does not own the module");
        require(config.owner() == deployer, "Upgrade: deployer does not own the registry");

        // Read a receipt BEFORE, so the check afterwards is against something observed
        // rather than something assumed.
        address witness = vm.envOr("WITNESS_MARKET", address(0));
        bytes32 receiptBefore;
        if (witness != address(0)) (receiptBefore,) = module.resolutionOf(witness);

        vm.startBroadcast(pk);

        ResolutionModule impl = new ResolutionModule();
        module.upgradeToAndCall(address(impl), "");

        AgentRegistry regImpl = new AgentRegistry();
        AgentRegistry registry = AgentRegistry(
            address(
                new ERC1967Proxy(
                    address(regImpl), abi.encodeCall(AgentRegistry.initialize, (deployer, address(config)))
                )
            )
        );
        config.setAddress(ConfigKeys.AGENT_REGISTRY, address(registry));
        config.setAddress(ConfigKeys.STAKE_TOKEN, collateral);

        vm.stopBroadcast();

        if (witness != address(0)) {
            (bytes32 receiptAfter,) = module.resolutionOf(witness);
            require(receiptAfter == receiptBefore, "Upgrade: an anchored receipt did not survive");
            console2.log("receipt preserved for", witness);
            console2.logBytes32(receiptAfter);
        }

        vm.writeJson(vm.toString(address(impl)), path, ".contracts.ResolutionModuleImpl");
        vm.writeJson(vm.toString(address(registry)), path, ".contracts.AgentRegistry");
        vm.writeJson(vm.toString(address(regImpl)), path, ".contracts.AgentRegistryImpl");

        console2.log("ResolutionModule impl:", address(impl));
        console2.log("AgentRegistry:        ", address(registry));
    }
}
