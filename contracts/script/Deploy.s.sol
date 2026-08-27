// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ConfigRegistry} from "../src/core/ConfigRegistry.sol";
import {ConfigKeys} from "../src/core/ConfigKeys.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {OutcomeShares} from "../src/core/OutcomeShares.sol";
import {Market} from "../src/core/Market.sol";
import {MarketFactory} from "../src/core/MarketFactory.sol";
import {DeployLib} from "./DeployLib.sol";

/// @notice Deploy P0+P1: MockUSDC, ConfigRegistry, OutcomeShares, implementasi Market,
///         dan MarketFactory (keduanya di balik ERC1967Proxy) + parameter bawaan.
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

        // Urutannya mengikat: MarketFactory MEMOTRET alamat OutcomeShares saat initialize,
        // sementara `setRegistry` OutcomeShares butuh alamat factory dan hanya bisa dipanggil
        // SEKALI seumur hidup oleh deployer-nya. Jadi shares lahir dulu, factory menyusul,
        // lalu lingkarannya ditutup.
        OutcomeShares sharesContract = new OutcomeShares("https://delphi.0g/{id}.json");
        Market marketImpl = new Market();

        MarketFactory factoryImpl = new MarketFactory();
        MarketFactory factory = MarketFactory(
            address(
                new ERC1967Proxy(
                    address(factoryImpl),
                    abi.encodeCall(
                        MarketFactory.initialize,
                        (deployer, address(config), address(sharesContract), address(marketImpl))
                    )
                )
            )
        );
        sharesContract.setRegistry(address(factory));
        config.setAddress(ConfigKeys.MARKET_FACTORY, address(factory));
        config.setAddress(ConfigKeys.OUTCOME_SHARES, address(sharesContract));
        config.setAddress(ConfigKeys.TREASURY, deployer);
        config.setAddress(ConfigKeys.CURATOR_SIGNER, deployer);

        vm.stopBroadcast();

        _writeManifest(
            address(config),
            address(impl),
            address(sharesContract),
            address(marketImpl),
            address(factory),
            address(usdc)
        );

        console2.log("ConfigRegistry (proxy):", address(config));
        console2.log("OutcomeShares:         ", address(sharesContract));
        console2.log("MarketFactory (proxy): ", address(factory));
        console2.log("MockUSDC:              ", address(usdc));
    }

    function _writeManifest(
        address configProxy,
        address configImpl,
        address outcomeShares,
        address marketImplementation,
        address marketFactory,
        address usdc
    ) internal {
        string memory contractsKey = "contracts";
        vm.serializeAddress(contractsKey, "ConfigRegistry", configProxy);
        vm.serializeAddress(contractsKey, "ConfigRegistryImpl", configImpl);
        vm.serializeAddress(contractsKey, "OutcomeShares", outcomeShares);
        vm.serializeAddress(contractsKey, "MarketImplementation", marketImplementation);
        vm.serializeAddress(contractsKey, "MarketFactory", marketFactory);
        string memory contractsJson = vm.serializeAddress(contractsKey, "MockUSDC", usdc);

        string memory root = "manifest";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "deploymentBlock", block.number);
        vm.serializeUint(root, "deployedAt", block.timestamp);
        string memory out = vm.serializeString(root, "contracts", contractsJson);

        vm.writeJson(out, string.concat("../deployments/", vm.toString(block.chainid), ".json"));
    }
}
