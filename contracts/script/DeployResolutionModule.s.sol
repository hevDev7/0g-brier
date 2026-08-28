// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ConfigRegistry} from "../src/core/ConfigRegistry.sol";
import {ConfigKeys} from "../src/core/ConfigKeys.sol";
import {ResolutionModule} from "../src/core/ResolutionModule.sol";

/// @notice Adds a ResolutionModule to a deployment that already exists, and points the
///         registry at it. Nothing standing is redeployed or upgraded.
///
/// @dev This is only possible because `Market.onlyResolutionModule` reads
///      `config.addresses(RESOLUTION_MODULE)` at CALL time rather than snapshotting it at
///      initialize. Every market already created — non-upgradeable clones, every one —
///      starts accepting the new module the moment this script's `setAddress` lands.
///
///      Run against an existing manifest:
///        forge script script/DeployResolutionModule.s.sol --rpc-url $RPC --broadcast
contract DeployResolutionModule is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(pk);

        string memory manifestPath = string.concat("../deployments/", vm.toString(block.chainid), ".json");
        string memory manifest = vm.readFile(manifestPath);
        address configAddr = vm.parseJsonAddress(manifest, ".contracts.ConfigRegistry");
        ConfigRegistry config = ConfigRegistry(configAddr);

        // Read before broadcasting, so a wrong key fails without spending anything. Only the
        // registry's owner can point RESOLUTION_MODULE anywhere, and a script that deployed a
        // module it could not then wire in would leave an orphan on chain.
        require(config.owner() == deployer, "DeployResolutionModule: deployer does not own ConfigRegistry");
        require(
            config.addresses(ConfigKeys.MARKET_FACTORY) != address(0),
            "DeployResolutionModule: MARKET_FACTORY unset - the module checks markets against it"
        );

        // `RESOLVER` defaults to the deployer, which is right for a testnet and wrong for
        // anything else: a resolver key signs a settlement for every market, and it should
        // not also be the key that can replace this contract.
        address resolver = vm.envOr("RESOLVER", deployer);

        vm.startBroadcast(pk);

        ResolutionModule impl = new ResolutionModule();
        ResolutionModule module = ResolutionModule(
            address(
                new ERC1967Proxy(address(impl), abi.encodeCall(ResolutionModule.initialize, (deployer, configAddr)))
            )
        );
        module.setResolver(resolver, true);
        config.setAddress(ConfigKeys.RESOLUTION_MODULE, address(module));

        vm.stopBroadcast();

        // Written key by key rather than by re-serialising the manifest: everything else in
        // that file describes contracts this script did not touch, and rewriting it wholesale
        // is how a deployment record quietly loses an address.
        vm.writeJson(vm.toString(address(module)), manifestPath, ".contracts.ResolutionModule");
        vm.writeJson(vm.toString(address(impl)), manifestPath, ".contracts.ResolutionModuleImpl");

        console2.log("ResolutionModule (proxy):", address(module));
        console2.log("ResolutionModule impl:   ", address(impl));
        console2.log("Resolver:                ", resolver);
        console2.log("RESOLUTION_MODULE now:   ", config.addresses(ConfigKeys.RESOLUTION_MODULE));
    }
}
