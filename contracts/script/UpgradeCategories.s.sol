// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ConfigRegistry} from "../src/core/ConfigRegistry.sol";
import {ConfigKeys} from "../src/core/ConfigKeys.sol";
import {MarketFactory} from "../src/core/MarketFactory.sol";
import {DeployLib} from "./DeployLib.sol";

/// @notice Bring a live deployment up to the category registry: upgrade
///         ConfigRegistry so it can hold categories, register the six the spec names,
///         and upgrade MarketFactory so it refuses the ones nobody registered.
///
/// @dev Both are UUPS and the new storage is APPENDED — `categoryIndex` and
///      `categories` take slots 5 and 6, which read zero on chain today. That was
///      checked against the live contract before this was written, because a layout
///      mistake here would silently corrupt `guardian` and `paused`.
///
///      The order matters: the factory's guard reads the registry, so registering the
///      categories BEFORE the factory can reject anything means no window where a
///      legitimate creation is refused.
contract UpgradeCategories is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(pk);

        string memory path = string.concat("../deployments/", vm.toString(block.chainid), ".json");
        string memory manifest = vm.readFile(path);
        ConfigRegistry config = ConfigRegistry(vm.parseJsonAddress(manifest, ".contracts.ConfigRegistry"));
        MarketFactory factory = MarketFactory(vm.parseJsonAddress(manifest, ".contracts.MarketFactory"));

        require(config.owner() == deployer, "UpgradeCategories: deployer does not own the registry");
        require(factory.owner() == deployer, "UpgradeCategories: deployer does not own the factory");

        // Read something that must survive, so the check afterwards is against an
        // observation rather than a hope.
        address treasuryBefore = config.addresses(ConfigKeys.TREASURY);
        address guardianBefore = config.guardian();

        vm.startBroadcast(pk);

        ConfigRegistry configImpl = new ConfigRegistry();
        config.upgradeToAndCall(address(configImpl), "");
        DeployLib.applyCategories(config);

        MarketFactory factoryImpl = new MarketFactory();
        factory.upgradeToAndCall(address(factoryImpl), "");

        vm.stopBroadcast();

        require(config.guardian() == guardianBefore, "UpgradeCategories: guardian did not survive");
        require(config.addresses(ConfigKeys.TREASURY) == treasuryBefore, "UpgradeCategories: treasury did not survive");
        require(config.categoryCount() == 6, "UpgradeCategories: categories did not register");

        vm.writeJson(vm.toString(address(configImpl)), path, ".contracts.ConfigRegistryImpl");
        vm.writeJson(vm.toString(address(factoryImpl)), path, ".contracts.MarketFactoryImpl");

        console2.log("ConfigRegistry impl:", address(configImpl));
        console2.log("MarketFactory impl: ", address(factoryImpl));
        console2.log("categories:         ", config.categoryCount());
        console2.log("guardian preserved: ", config.guardian());
    }
}
