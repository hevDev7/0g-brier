// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ConfigRegistry} from "../src/core/ConfigRegistry.sol";
import {ConfigKeys} from "../src/core/ConfigKeys.sol";
import {DeployLib} from "./DeployLib.sol";

/// @notice Set the resolution parameters on a registry deployed before P2 existed.
/// @dev Bounds lock on first write, so this runs once per registry. Nothing is
///      redeployed: `ConfigRegistry` was always meant to be where policy lives.
contract ApplyResolutionParams is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_KEY");
        string memory manifest = vm.readFile(string.concat("../deployments/", vm.toString(block.chainid), ".json"));
        ConfigRegistry config = ConfigRegistry(vm.parseJsonAddress(manifest, ".contracts.ConfigRegistry"));
        require(config.owner() == vm.addr(pk), "ApplyResolutionParams: deployer does not own the registry");

        // The stake and the bond are denominated in the stake token, so their scale is
        // the stake token's own. Reading it from the registry rather than an argument
        // means this script cannot be run against a registry with a different collateral
        // than the one whose decimals it used.
        address stakeToken = config.addresses(ConfigKeys.STAKE_TOKEN);
        require(stakeToken != address(0), "ApplyResolutionParams: STAKE_TOKEN is unset on this registry");

        vm.startBroadcast(pk);
        DeployLib.applyResolutionDefaults(config, DeployLib.unitOf(stakeToken));
        vm.stopBroadcast();

        console2.log("MIN_RESOLVER_STAKE ", config.params(ConfigKeys.MIN_RESOLVER_STAKE));
        console2.log("COMMITTEE_VERIFIED ", config.params(ConfigKeys.COMMITTEE_VERIFIED));
        console2.log("COMMIT_WINDOW      ", config.params(ConfigKeys.COMMIT_WINDOW));
        console2.log("REVEAL_WINDOW      ", config.params(ConfigKeys.REVEAL_WINDOW));
        console2.log("DISPUTE_VERIFIED   ", config.params(ConfigKeys.DISPUTE_WINDOW_VERIFIED));
    }
}
