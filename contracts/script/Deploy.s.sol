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
import {ResolutionModule} from "../src/core/ResolutionModule.sol";
import {DeployLib} from "./DeployLib.sol";

/// @notice Deploys P0+P1: MockUSDC, ConfigRegistry, OutcomeShares, the Market implementation,
///         and MarketFactory (both behind an ERC1967Proxy) + the default parameters.
contract Deploy is Script {
    /// @dev Grouped rather than passed positionally. Ten bare addresses in a row exhausts
    ///      the EVM stack ("stack too deep"), and well before that it stops being possible
    ///      to tell at the call site which address is which.
    struct Manifest {
        address configProxy;
        address configImpl;
        address outcomeShares;
        address marketImplementation;
        address marketFactory;
        address marketFactoryImpl;
        address usdc;
        address resolutionModule;
        address resolutionModuleImpl;
        uint256 fromBlock;
    }

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(pk);

        // Resolved BEFORE broadcasting, so a misconfigured non-local deployment fails without
        // having sent a single transaction. See `DeployLib.resolveOperationalAddresses`.
        (address treasury, address curatorSigner) = DeployLib.resolveOperationalAddresses(
            block.chainid, vm.envOr("TREASURY", address(0)), vm.envOr("CURATOR_SIGNER", address(0)), deployer
        );

        // A LOWER BOUND on the deployment block, not the block itself: a forge script sends its
        // broadcast after the body has run, so nothing here can observe the block the contracts
        // actually land in. Lower is the safe direction — an indexer that backfills from too
        // early only wastes time, whereas one that starts too late misses events permanently.
        // On a fresh anvil this is 0, which is a correct if uninformative lower bound.
        uint256 fromBlock = block.number;

        vm.startBroadcast(pk);

        MockUSDC usdc = new MockUSDC();

        ConfigRegistry impl = new ConfigRegistry();
        ConfigRegistry config = ConfigRegistry(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(ConfigRegistry.initialize, (deployer, deployer))))
        );
        DeployLib.applyDefaults(config, address(usdc));

        // The order binds: MarketFactory SNAPSHOTS the OutcomeShares address at initialize,
        // while OutcomeShares' `setRegistry` needs the factory address and can be called only
        // ONCE in its lifetime, by its deployer. So shares is born first, the factory follows,
        // and then the loop is closed.
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
        config.setAddress(ConfigKeys.TREASURY, treasury);
        config.setAddress(ConfigKeys.CURATOR_SIGNER, curatorSigner);

        // After MARKET_FACTORY, not before: the module checks every market it records
        // against the factory, and initialising it into a registry that cannot answer
        // `isMarket` would leave it unable to anchor anything.
        (address resolutionModule, address resolutionImpl) = _deployResolutionModule(config, deployer);

        vm.stopBroadcast();

        _writeManifest(
            Manifest({
                configProxy: address(config),
                configImpl: address(impl),
                outcomeShares: address(sharesContract),
                marketImplementation: address(marketImpl),
                marketFactory: address(factory),
                marketFactoryImpl: address(factoryImpl),
                usdc: address(usdc),
                resolutionModule: resolutionModule,
                resolutionModuleImpl: resolutionImpl,
                fromBlock: fromBlock
            })
        );

        console2.log("ConfigRegistry (proxy):", address(config));
        console2.log("OutcomeShares:         ", address(sharesContract));
        console2.log("MarketFactory (proxy): ", address(factory));
        console2.log("MockUSDC:              ", address(usdc));
        console2.log("Treasury:              ", treasury);
        console2.log("Curator signer:        ", curatorSigner);
        console2.log("ResolutionModule:      ", resolutionModule);
    }

    /// @dev Split out of `run` because `run` had run out of stack slots, and it earns its
    ///      place: the deployer is made the first resolver here, which is right for anvil
    ///      and for a testnet and wrong beyond them. A resolver key signs a settlement for
    ///      every market; it should not also be the key that can replace this contract.
    ///      Pass RESOLVER to separate them.
    function _deployResolutionModule(ConfigRegistry config, address deployer)
        internal
        returns (address module, address implementation)
    {
        ResolutionModule impl = new ResolutionModule();
        ResolutionModule deployed = ResolutionModule(
            address(
                new ERC1967Proxy(
                    address(impl), abi.encodeCall(ResolutionModule.initialize, (deployer, address(config)))
                )
            )
        );
        deployed.setResolver(vm.envOr("RESOLVER", deployer), true);
        config.setAddress(ConfigKeys.RESOLUTION_MODULE, address(deployed));
        return (address(deployed), address(impl));
    }

    function _writeManifest(Manifest memory m) internal {
        string memory contractsKey = "contracts";
        vm.serializeAddress(contractsKey, "ConfigRegistry", m.configProxy);
        vm.serializeAddress(contractsKey, "ConfigRegistryImpl", m.configImpl);
        vm.serializeAddress(contractsKey, "OutcomeShares", m.outcomeShares);
        vm.serializeAddress(contractsKey, "MarketImplementation", m.marketImplementation);
        vm.serializeAddress(contractsKey, "MarketFactory", m.marketFactory);
        // The implementation address behind the UUPS proxy — exactly what an upgrade operation
        // needs, mirroring ConfigRegistryImpl.
        vm.serializeAddress(contractsKey, "MarketFactoryImpl", m.marketFactoryImpl);
        vm.serializeAddress(contractsKey, "MockUSDC", m.usdc);
        vm.serializeAddress(contractsKey, "ResolutionModuleImpl", m.resolutionModuleImpl);
        string memory contractsJson = vm.serializeAddress(contractsKey, "ResolutionModule", m.resolutionModule);

        string memory root = "manifest";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "deploymentBlock", m.fromBlock);
        vm.serializeUint(root, "deployedAt", block.timestamp);
        string memory out = vm.serializeString(root, "contracts", contractsJson);

        vm.writeJson(out, string.concat("../deployments/", vm.toString(block.chainid), ".json"));
    }
}
