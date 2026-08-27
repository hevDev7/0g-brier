// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ConfigRegistry} from "../src/core/ConfigRegistry.sol";
import {ConfigKeys} from "../src/core/ConfigKeys.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {DeployLib} from "./DeployLib.sol";

/// @notice Deploy P0: MockUSDC + ConfigRegistry (di balik ERC1967Proxy) + parameter bawaan.
///         Task 16 memperluas skrip ini dengan OutcomeShares, Market impl, dan MarketFactory.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        MockUSDC usdc = new MockUSDC();

        ConfigRegistry impl = new ConfigRegistry();
        ConfigRegistry config = ConfigRegistry(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(ConfigRegistry.initialize, (deployer, deployer))))
        );
        DeployLib.applyDefaults(config, address(usdc));

        vm.stopBroadcast();

        _writeManifest(address(config), address(impl), address(usdc));

        console2.log("ConfigRegistry (proxy):", address(config));
        console2.log("MockUSDC:              ", address(usdc));
    }

    function _writeManifest(address configProxy, address configImpl, address usdc) internal {
        string memory contractsKey = "contracts";
        vm.serializeAddress(contractsKey, "ConfigRegistry", configProxy);
        vm.serializeAddress(contractsKey, "ConfigRegistryImpl", configImpl);
        string memory contractsJson = vm.serializeAddress(contractsKey, "MockUSDC", usdc);

        string memory root = "manifest";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "deploymentBlock", block.number);
        vm.serializeUint(root, "deployedAt", block.timestamp);
        string memory out = vm.serializeString(root, "contracts", contractsJson);

        vm.writeJson(out, string.concat("../deployments/", vm.toString(block.chainid), ".json"));
    }
}
