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
import {AgentRegistry} from "../src/core/AgentRegistry.sol";
import {ZgDataVerifier} from "../src/core/ZgDataVerifier.sol";
import {AgentCard} from "../src/core/AgentCard.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {DeployLib} from "./DeployLib.sol";

/// @notice Deploys the protocol: collateral, ConfigRegistry, OutcomeShares, the Market
///         implementation, MarketFactory, AgentRegistry and ResolutionModule, plus a
///         TimelockController that governs the upgradeable ones.
///
/// @dev Two refusals are built in, and both exist because of what the live testnet
///      deployment looks like — one key holding every role.
///
///      ROLES: `DeployLib.resolveRoles` refuses a mainnet deployment where any role is
///      the deployer's, or where the guardian is also governance. See DeployRoles.t.sol.
///
///      COLLATERAL: MockUSDC has an open `mintTo`. It is deployed on a testnet and
///      NEVER on mainnet, where `COLLATERAL` must name a real token. A mock stablecoin
///      on mainnet is not a smaller version of the real thing; it is a market whose
///      collateral anyone can print.
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
        address agentRegistry;
        address agentRegistryImpl;
        address zgDataVerifier;
        address agentCard;
        address timelock;
        uint256 fromBlock;
    }

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(pk);

        // Resolved BEFORE broadcasting, so a misconfigured deployment fails without having
        // sent a single transaction. On mainnet this is what refuses a deployer who kept
        // every role for itself — see DeployRoles.t.sol.
        DeployLib.Roles memory roles = DeployLib.resolveRoles(
            block.chainid,
            DeployLib.Roles({
                governance: _address("GOVERNANCE"),
                guardian: _address("GUARDIAN"),
                treasury: _address("TREASURY"),
                curatorSigner: _address("CURATOR_SIGNER")
            }),
            deployer
        );

        // Accumulated into the manifest as we go, rather than into a dozen locals. Past
        // about eight addresses `run` exhausts the EVM stack, and long before that a wall
        // of same-typed names stops being readable.
        Manifest memory m;
        // A LOWER BOUND on the deployment block, not the block itself: a forge script sends
        // its broadcast after the body has run, so nothing here can observe the block the
        // contracts actually land in. Lower is the safe direction — an indexer that
        // backfills from too early only wastes time, whereas one that starts too late
        // misses events permanently.
        m.fromBlock = block.number;

        vm.startBroadcast(pk);

        m.usdc = _collateral();
        m.configImpl = address(new ConfigRegistry());
        // The DEPLOYER owns the registry through the rest of this script, because every
        // `setParam` and `setAddress` below is owner-gated. Ownership is handed to the
        // timelock at the end, once there is nothing left to configure.
        ConfigRegistry config = ConfigRegistry(
            address(
                new ERC1967Proxy(m.configImpl, abi.encodeCall(ConfigRegistry.initialize, (deployer, roles.guardian)))
            )
        );
        m.configProxy = address(config);
        DeployLib.applyDefaults(config, m.usdc);
        _applyMoneyOverrides(config);

        m.outcomeShares = address(new OutcomeShares("https://brier.0g/{id}.json"));
        m.marketImplementation = address(new Market());
        m.marketFactory = _deployFactory(config, deployer, m);

        config.setAddress(ConfigKeys.MARKET_FACTORY, m.marketFactory);
        config.setAddress(ConfigKeys.OUTCOME_SHARES, m.outcomeShares);
        config.setAddress(ConfigKeys.TREASURY, roles.treasury);
        config.setAddress(ConfigKeys.CURATOR_SIGNER, roles.curatorSigner);
        config.setAddress(ConfigKeys.STAKE_TOKEN, m.usdc);
        _wireErc8004(config);

        // After MARKET_FACTORY, not before: the module checks every market it records
        // against the factory, and initialising it into a registry that cannot answer
        // `isMarket` would leave it unable to anchor anything.
        (m.agentRegistry, m.agentRegistryImpl, m.zgDataVerifier, m.agentCard) = _deployAgentRegistry(config, deployer);
        (m.resolutionModule, m.resolutionModuleImpl) = _deployResolutionModule(config, deployer);
        m.timelock = _handOver(config, deployer, roles.governance, m.agentRegistry, m.resolutionModule);

        vm.stopBroadcast();

        _writeManifest(m);
        _report(m, roles);
    }

    /// @dev The order binds: MarketFactory SNAPSHOTS the OutcomeShares address at
    ///      initialize, while `setRegistry` needs the factory and can be called only ONCE
    ///      in its lifetime, by its deployer. Shares is born first, the factory follows,
    ///      and then the loop is closed.
    function _deployFactory(ConfigRegistry config, address deployer, Manifest memory m)
        internal
        returns (address factory)
    {
        m.marketFactoryImpl = address(new MarketFactory());
        factory = address(
            new ERC1967Proxy(
                m.marketFactoryImpl,
                abi.encodeCall(
                    MarketFactory.initialize, (deployer, address(config), m.outcomeShares, m.marketImplementation)
                )
            )
        );
        OutcomeShares(m.outcomeShares).setRegistry(factory);
    }

    function _report(Manifest memory m, DeployLib.Roles memory roles) internal pure {
        console2.log("ConfigRegistry (proxy):", m.configProxy);
        console2.log("OutcomeShares:         ", m.outcomeShares);
        console2.log("MarketFactory (proxy): ", m.marketFactory);
        console2.log("AgentRegistry:         ", m.agentRegistry);
        console2.log("ZgDataVerifier:        ", m.zgDataVerifier);
        console2.log("AgentCard:             ", m.agentCard);
        console2.log("ResolutionModule:      ", m.resolutionModule);
        console2.log("Collateral:            ", m.usdc);
        console2.log("Timelock:              ", m.timelock);
        console2.log("Governance:            ", roles.governance);
        console2.log("Guardian:              ", roles.guardian);
        console2.log("Treasury:              ", roles.treasury);
        console2.log("Curator signer:        ", roles.curatorSigner);
    }

    /// @dev Split out of `run` because `run` had run out of stack slots, and it earns its
    ///      place: the deployer is made the first resolver here, which is right for anvil
    ///      and for a testnet and wrong beyond them. A resolver key signs a settlement for
    ///      every market; it should not also be the key that can replace this contract.
    ///      Pass RESOLVER to separate them.
    /// @notice Read an address, and refuse anything that is not one.
    ///
    /// @dev `vm.envOr(name, address(0))` returns the ZERO ADDRESS for a value it
    ///      cannot parse — silently, with no distinction between "unset" and
    ///      "wrong shape". The deploy would then stop with `GovernanceUnset`, which
    ///      sends someone hunting for a value that is sitting right there and
    ///      malformed.
    ///
    ///      The case worth catching by name is a PRIVATE KEY pasted where an address
    ///      belongs. Four of the five things in `.env` are addresses and only the
    ///      deployer's is a key, so the mistake is an easy one — and it ends with a
    ///      key written into a file while the error message talks about something
    ///      else entirely.
    function _address(string memory name) internal view returns (address) {
        string memory raw = vm.envOr(name, string(""));
        bytes memory b = bytes(raw);
        if (b.length == 0) return address(0);
        if (b.length == 66) {
            revert(
                string.concat(
                    "Deploy: ",
                    name,
                    " looks like a PRIVATE KEY (32 bytes). It wants an ADDRESS (20 bytes). ",
                    "Only DEPLOYER_KEY is a private key. Rotate whatever you just pasted."
                )
            );
        }
        if (b.length != 42) {
            revert(string.concat("Deploy: ", name, " is not an address - expected 0x plus 40 hex characters"));
        }
        return vm.parseAddress(raw);
    }

    /**
     * Point the config at ERC-8004's registries, when the deployment wants them.
     *
     * THIS WAS ONLY EVER DONE BY AN UPGRADE SCRIPT, and that is why it is here now.
     * `UpgradeErc8004.s.sol` wired the live testnet after the fact, so the addresses
     * existed there and nowhere else — and every FRESH deployment, which is what
     * mainnet will be, was born with the integration silently off. The symptom is
     * not a revert at deploy time but a `linkErc8004` that fails much later with
     * `Erc8004RegistryUnset`, long after anyone would think to look at the deploy.
     *
     * OPTIONAL, deliberately. `ResolutionModule._publish` declines when the registry
     * is unset rather than failing a settlement, so a deployment without 8004 is a
     * real configuration and not a broken one. What is refused is an address that
     * holds no code: that is a typo, not a decision, and it would fail later in the
     * same invisible way.
     *
     * The two registries sit at the same addresses on every network that has them,
     * so this is configuration rather than deployment — which is exactly why it can
     * be passed in rather than deployed here.
     */
    /// @dev Reverts unless `target` holds code AND answers a call. See the note in
    ///      `_wireErc8004`: an uninitialised proxy has code and answers nothing.
    function _requireLive(address target, string memory name) internal view {
        require(target.code.length > 0, string.concat("Deploy: ", name, " has no code on this chain"));
        (bool ok, bytes memory out) = target.staticcall(abi.encodeWithSignature("name()"));
        require(
            ok && out.length > 0,
            string.concat("Deploy: ", name, " has code but does not answer; an uninitialised proxy?")
        );
    }

    function _wireErc8004(ConfigRegistry config) internal {
        address identity = vm.envOr("ERC8004_IDENTITY", address(0));
        address reputation = vm.envOr("ERC8004_REPUTATION", address(0));
        if (identity == address(0) && reputation == address(0)) {
            console2.log("ERC-8004:            not configured (publishing is off)");
            return;
        }
        // CODE IS NOT ENOUGH, and 0G mainnet is the reason. Both canonical
        // ERC-8004 addresses hold an ERC-1967 proxy there whose implementation
        // slot is empty: 130 bytes of bytecode, `code.length > 0` perfectly
        // satisfied, and every call through it reverts. A deployment wired to
        // that would pass here and then fail at `linkErc8004`, which is exactly
        // the shape of failure this whole function was added to prevent.
        //
        // So the registry has to ANSWER, not merely exist. `name()` is the
        // cheapest question that proves something is behind the address — on
        // Galileo it returns "AgentIdentity"; on a proxy pointing at nothing it
        // reverts.
        _requireLive(identity, "ERC8004_IDENTITY");
        _requireLive(reputation, "ERC8004_REPUTATION");
        config.setAddress(ConfigKeys.ERC8004_IDENTITY, identity);
        config.setAddress(ConfigKeys.ERC8004_REPUTATION, reputation);
        console2.log("ERC8004_IDENTITY:   ", identity);
        console2.log("ERC8004_REPUTATION: ", reputation);
    }

    /// @notice The collateral a market settles in.
    ///
    /// @dev MockUSDC has an open `mintTo` and is deployed ONLY where that is harmless.
    ///      On mainnet `COLLATERAL` must name a real token: a mock stablecoin there is
    ///      not a smaller version of the real thing, it is a market whose collateral
    ///      anyone can print at will.
    function _collateral() internal returns (address) {
        address supplied = vm.envOr("COLLATERAL", address(0));
        if (block.chainid == DeployLib.MAINNET_CHAIN_ID) {
            require(supplied != address(0), "Deploy: COLLATERAL must name a real token on mainnet");
            require(supplied.code.length > 0, "Deploy: COLLATERAL has no code");
            return supplied;
        }
        if (supplied != address(0)) return supplied;
        return address(new MockUSDC());
    }

    /**
     * @dev The registry is not usable the moment it is minted: it defers `tokenURI` to
     *      a renderer and every ERC-7857 proof to a verifier, and BOTH revert while
     *      unset. That is the right behaviour — an unset renderer returning "" is the
     *      blank card the renderer exists to fix, and a missing verifier waving proofs
     *      through would make the standard's guarantee worthless. It also means a
     *      deployment that forgot either would look complete and answer nothing, so
     *      they are wired here rather than left to a follow-up transaction.
     */
    function _deployAgentRegistry(ConfigRegistry config, address deployer)
        internal
        returns (address registry, address implementation, address verifier, address card)
    {
        AgentRegistry impl = new AgentRegistry();
        AgentRegistry deployed = AgentRegistry(
            address(
                new ERC1967Proxy(address(impl), abi.encodeCall(AgentRegistry.initialize, (deployer, address(config))))
            )
        );
        config.setAddress(ConfigKeys.AGENT_REGISTRY, address(deployed));

        ZgDataVerifier v = new ZgDataVerifier();
        AgentCard c = new AgentCard();
        deployed.setVerifier(address(v));
        deployed.setCard(address(c));

        return (address(deployed), address(impl), address(v), address(c));
    }

    /// @notice Put the upgradeable contracts under a timelock and start handing them over.
    ///
    /// @dev The timelock is the ADMIN of every upgrade path, which is what stops one key
    ///      being able to replace the logic under a live market (spec §13.3). Governance
    ///      proposes and executes; nobody holds the timelock's own admin role, so its
    ///      delay cannot be lowered by whoever happens to hold a key.
    ///
    ///      `transferOwnership` here is the FIRST half of a two-step handover. Ownership
    ///      does not move until governance calls `acceptOwnership` through the timelock,
    ///      and that is deliberate: a one-step transfer to a wrong address is
    ///      unrecoverable, and these contracts are the ones you least want to lose. Until
    ///      that acceptance lands, the deployer still owns them — a real window, and the
    ///      script says so rather than implying the job is finished.
    function _handOver(
        ConfigRegistry config,
        address deployer,
        address governance,
        address agentRegistry,
        address resolutionModule
    ) internal returns (address) {
        if (block.chainid == DeployLib.LOCAL_CHAIN_ID) {
            console2.log("Timelock:               skipped on 31337 (the deployer keeps ownership)");
            return address(0);
        }

        address[] memory proposers = new address[](1);
        address[] memory executors = new address[](1);
        proposers[0] = governance;
        executors[0] = governance;
        // admin = address(0): nobody can shorten the delay or grant themselves a role.
        TimelockController timelock =
            new TimelockController(vm.envOr("TIMELOCK_DELAY", uint256(48 hours)), proposers, executors, address(0));

        config.transferOwnership(address(timelock));
        MarketFactory(config.addresses(ConfigKeys.MARKET_FACTORY)).transferOwnership(address(timelock));
        AgentRegistry(agentRegistry).transferOwnership(address(timelock));
        ResolutionModule(resolutionModule).transferOwnership(address(timelock));

        console2.log("");
        console2.log("HANDOVER IS NOT COMPLETE. Ownership is PENDING on four contracts.");
        console2.log("Governance must schedule and execute acceptOwnership() on each,");
        console2.log("through the timelock, before the deployer stops being able to");
        console2.log("change parameters. Deployer still in control until then:", deployer);
        return address(timelock);
    }

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
        // The direct-settlement bypass, and it stays EMPTY unless someone asks for it.
        //
        // It used to default to the deployer, which quietly contradicted the contract's
        // own claim that the allowlist is empty until an owner fills it — and put a key
        // that can settle any market to any outcome into every deployment, including
        // mainnet, without anyone choosing that.
        //
        // On 31337 the deployer is filled in regardless, because a local demo has no
        // committee to stake and nothing to protect.
        address resolver = vm.envOr("RESOLVER", address(0));
        if (block.chainid == DeployLib.LOCAL_CHAIN_ID && resolver == address(0)) resolver = deployer;
        if (resolver != address(0)) {
            require(block.chainid != DeployLib.MAINNET_CHAIN_ID, "Deploy: no direct-settlement resolver on mainnet");
            deployed.setResolver(resolver, true);
        }
        config.setAddress(ConfigKeys.RESOLUTION_MODULE, address(deployed));
        return (address(deployed), address(impl));
    }

    /// @notice The money parameters an operator may choose at deploy time, in the
    ///         collateral's own base units. Zero means "keep the default".
    struct Money {
        uint256 stake;
        uint256 bond;
        uint256 seed;
        uint256 deposit;
        uint256 minTrade;
    }

    /// @notice Let the operator choose the money parameters at deploy time.
    /// @dev The defaults are 100/50/100/20/1 WHOLE TOKENS of the collateral, which is
    ///      the right long-run policy and the wrong launch cost: fourteen resolvers at
    ///      a hundred-token stake lock 2,800 of them before a single market exists.
    ///
    ///      These could be set with `setParam` after the deploy — the deployer owns the
    ///      registry until the cliff — but then there is a window in which the registry
    ///      says one thing and the operator means another, and a step that can be
    ///      forgotten. Setting them in the same broadcast removes both.
    ///
    ///      Values are in the collateral's OWN BASE UNITS: one W0G is
    ///      1000000000000000000. The wrapper echoes them back in whole tokens before it
    ///      broadcasts, so a wrong exponent is something you SEE rather than something
    ///      you discover.
    function _applyMoneyOverrides(ConfigRegistry config) internal {
        _applyMoney(config, _moneyFromEnv());
    }

    /// @dev Reading the environment is kept apart from applying the values, and not for
    ///      tidiness. `vm.setEnv` mutates the PROCESS environment, which every test
    ///      running in parallel shares, so a test that set a variable was seen by tests
    ///      that never set one — five of them failed on values they had not chosen.
    ///      Values arrive as an argument; only this function touches the environment.
    function _moneyFromEnv() internal view returns (Money memory m) {
        m.stake = vm.envOr("MIN_RESOLVER_STAKE", uint256(0));
        m.bond = vm.envOr("DISPUTE_BOND", uint256(0));
        m.seed = vm.envOr("MIN_SEED", uint256(0));
        m.deposit = vm.envOr("MIN_SETTLEMENT_DEPOSIT", uint256(0));
        m.minTrade = vm.envOr("MIN_TRADE_TOKENS", uint256(0));
    }

    /// @dev `setParam` enforces the bounds, which `applyDefaults` already locked at one
    ///      whole token. The floor cannot be argued away here.
    function _applyMoney(ConfigRegistry config, Money memory m) internal {
        if (m.stake != 0) config.setParam(ConfigKeys.MIN_RESOLVER_STAKE, m.stake);
        if (m.bond != 0) config.setParam(ConfigKeys.DISPUTE_BOND, m.bond);
        if (m.seed != 0) config.setParam(ConfigKeys.MIN_SEED, m.seed);
        if (m.deposit != 0) config.setParam(ConfigKeys.MIN_SETTLEMENT_DEPOSIT, m.deposit);
        if (m.minTrade != 0) config.setParam(ConfigKeys.MIN_TRADE_TOKENS, m.minTrade);

        // A minimum trade at or above the seed forbids every trade smaller than the
        // entire book. The market still functions and the bounds still pass, which is
        // exactly why this has to be checked here: nothing else would notice, and the
        // first trader would meet a floor as large as the liquidity they were quoting
        // against. Lowering MIN_SEED and forgetting MIN_TRADE_TOKENS is the natural way
        // to arrive here.
        require(
            config.params(ConfigKeys.MIN_TRADE_TOKENS) < config.params(ConfigKeys.MIN_SEED),
            "Deploy: MIN_TRADE_TOKENS is not below MIN_SEED, so no trade smaller than the whole book would be allowed"
        );
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
        vm.serializeAddress(contractsKey, "ResolutionModule", m.resolutionModule);
        vm.serializeAddress(contractsKey, "AgentRegistryImpl", m.agentRegistryImpl);
        vm.serializeAddress(contractsKey, "AgentRegistry", m.agentRegistry);
        vm.serializeAddress(contractsKey, "ZgDataVerifier", m.zgDataVerifier);
        vm.serializeAddress(contractsKey, "AgentCard", m.agentCard);
        string memory contractsJson = vm.serializeAddress(contractsKey, "Timelock", m.timelock);

        string memory root = "manifest";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "deploymentBlock", m.fromBlock);
        vm.serializeUint(root, "deployedAt", block.timestamp);
        string memory out = vm.serializeString(root, "contracts", contractsJson);

        vm.writeJson(out, string.concat("../deployments/", vm.toString(block.chainid), ".json"));
    }
}
