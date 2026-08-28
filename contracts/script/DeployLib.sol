// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ConfigRegistry} from "../src/core/ConfigRegistry.sol";
import {ConfigKeys} from "../src/core/ConfigKeys.sol";

/// @title DeployLib
/// @notice Protocol defaults from spec §17. Kept separate from the broadcast script so
///         they can be tested directly without broadcasting a transaction.
library DeployLib {
    uint128 internal constant UNBOUNDED = type(uint128).max;

    /// @dev The local anvil chain. The only chain where an unset operational address may fall
    ///      back to the deployer's own key.
    uint256 internal constant LOCAL_CHAIN_ID = 31337;
    uint256 internal constant GALILEO_CHAIN_ID = 16602;
    uint256 internal constant MAINNET_CHAIN_ID = 16661;

    /// @notice Every key a deployment answers to, resolved in one place so that no
    ///         chain can be given fewer of them than it needs.
    struct Roles {
        /// @dev Becomes the timelock's proposer and executor. Intended to be a
        ///      multisig; nothing here can check that it is one, which is why the
        ///      distinctness rules below matter.
        address governance;
        /// @dev A single key by design (spec §13.3). It may `pause()` and `void()` a
        ///      market that has not closed, and nothing else — it cannot move funds and
        ///      cannot change an outcome. Fast action needs one signature.
        address guardian;
        address treasury;
        address curatorSigner;
    }

    error TreasuryUnset(uint256 chainId);
    error CuratorSignerUnset(uint256 chainId);
    error GovernanceUnset(uint256 chainId);
    error GuardianUnset(uint256 chainId);
    error RoleHeldByDeployer(uint256 chainId, bytes32 role);
    error RolesNotDistinct(bytes32 a, bytes32 b);

    /// @notice Resolves TREASURY and CURATOR_SIGNER, refusing to invent them off-chain.
    ///
    /// @dev The deploy script used to point both at the deployer unconditionally, while
    ///      writing `deployments/<chainId>.json` for whatever chain it happened to be run
    ///      against. On anvil that is a convenience; on Galileo or mainnet it silently makes
    ///      one EOA the protocol treasury AND the only key that can approve a market — the two
    ///      addresses a real deployment most needs to be deliberate about, set by accident.
    ///
    ///      Pure, and takes the chain id as an argument, so the policy can be tested directly
    ///      rather than only observed by running the script against a chain.
    /// @notice The categories a market may be created under (spec §5.2).
    ///
    /// @dev These six, and not a longer list, because the spec names six. Adding a
    ///      seventh is one `addCategory` call by governance — a parameter change, not
    ///      a code change — which is the reason the list lives in the registry at all.
    ///
    ///      Order is permanent once set: the index is the bit an agent's
    ///      `allowedCategories` policy sets, so reordering would silently repoint every
    ///      policy already granted.
    function applyCategories(ConfigRegistry config) internal {
        config.addCategory("crypto");
        config.addCategory("politics");
        config.addCategory("sports");
        config.addCategory("economics");
        config.addCategory("science");
        config.addCategory("culture");
    }

    /// @notice The resolution parameters, separated from `applyDefaults` so that a
    ///         registry deployed BEFORE the committee existed can be brought up to date
    ///         without redeploying it.
    /// @dev Bounds lock the first time they are set, so this can only run once against a
    ///      given registry — which is the intended shape: parameters move afterwards,
    ///      their limits do not.
    function applyResolutionDefaults(ConfigRegistry config) internal {
        // The committee shapes come straight from the tier table and are packed as
        // n * 256 + k so that a size and its threshold cannot be changed out of step.
        config.setBounds(ConfigKeys.COMMIT_WINDOW, 60, 7 days);
        config.setBounds(ConfigKeys.REVEAL_WINDOW, 60, 7 days);
        config.setBounds(ConfigKeys.DISPUTE_WINDOW_FAST, 60, 30 days);
        config.setBounds(ConfigKeys.DISPUTE_WINDOW_VERIFIED, 60, 30 days);
        config.setBounds(ConfigKeys.DISPUTE_WINDOW_DETERMINISTIC, 60, 30 days);
        config.setBounds(ConfigKeys.COMMITTEE_FAST, 257, 65_535);
        config.setBounds(ConfigKeys.COMMITTEE_VERIFIED, 257, 65_535);
        config.setBounds(ConfigKeys.COMMITTEE_DETERMINISTIC, 257, 65_535);
        config.setBounds(ConfigKeys.COMMITTEE_DISPUTE, 257, 65_535);
        // Slash rates are POLICY, and the bounds are what stops a later parameter
        // change from turning a mild penalty into confiscation. Disagreeing with the
        // majority is not misconduct, so it is capped lowest; being overturned by a
        // fresh committee is what a cartel looks like, so it is capped highest.
        config.setBounds(ConfigKeys.NO_SHOW_SLASH_BPS, 0, 2_000);
        config.setBounds(ConfigKeys.DISAGREE_SLASH_BPS, 0, 1_000);
        config.setBounds(ConfigKeys.OVERTURN_SLASH_BPS, 0, 5_000);
        config.setBounds(ConfigKeys.DISPUTE_BOND, 0, UNBOUNDED);
        config.setBounds(ConfigKeys.MIN_RESOLVER_STAKE, 1, UNBOUNDED);
        config.setBounds(ConfigKeys.UNSTAKE_COOLDOWN, 1 hours, 30 days);
        // A switch, so its bounds are a switch. Left OFF: markets already created are
        // immutable clones that will never receive the check, so switching it on
        // unconditionally would enforce identity on new markets and not on old ones
        // while appearing to enforce it everywhere.
        config.setBounds(ConfigKeys.REQUIRE_REGISTERED_TRADER, 0, 1);

        config.setParam(ConfigKeys.COMMIT_WINDOW, 1 hours);
        config.setParam(ConfigKeys.REVEAL_WINDOW, 1 hours);
        // Lower trust, LONGER window. FAST resolves from an unattested router and gets
        // the most time to be challenged; VERIFIED carries TEE attestation and gets the
        // least. Reading this the other way round removes protection exactly where it
        // is needed most.
        config.setParam(ConfigKeys.DISPUTE_WINDOW_FAST, 24 hours);
        config.setParam(ConfigKeys.DISPUTE_WINDOW_VERIFIED, 6 hours);
        config.setParam(ConfigKeys.DISPUTE_WINDOW_DETERMINISTIC, 2 hours);
        config.setParam(ConfigKeys.COMMITTEE_FAST, (1 << 8) | 1);
        config.setParam(ConfigKeys.COMMITTEE_VERIFIED, (5 << 8) | 3);
        config.setParam(ConfigKeys.COMMITTEE_DETERMINISTIC, (3 << 8) | 2);
        config.setParam(ConfigKeys.COMMITTEE_DISPUTE, (9 << 8) | 5);
        config.setParam(ConfigKeys.NO_SHOW_SLASH_BPS, 500);
        config.setParam(ConfigKeys.DISAGREE_SLASH_BPS, 100);
        config.setParam(ConfigKeys.OVERTURN_SLASH_BPS, 2_000);
        config.setParam(ConfigKeys.DISPUTE_BOND, 50e6);
        config.setParam(ConfigKeys.MIN_RESOLVER_STAKE, 100e6);
        config.setParam(ConfigKeys.UNSTAKE_COOLDOWN, 7 days);
        config.setParam(ConfigKeys.REQUIRE_REGISTERED_TRADER, 0);
    }

    function resolveOperationalAddresses(uint256 chainId, address treasury, address curatorSigner, address deployer)
        internal
        pure
        returns (address, address)
    {
        if (chainId == LOCAL_CHAIN_ID) {
            return
                (treasury == address(0) ? deployer : treasury, curatorSigner == address(0) ? deployer : curatorSigner);
        }
        if (treasury == address(0)) revert TreasuryUnset(chainId);
        if (curatorSigner == address(0)) revert CuratorSignerUnset(chainId);
        return (treasury, curatorSigner);
    }

    /// @notice Resolve every role for a chain, and refuse the ones that must not ship.
    ///
    /// @dev The rules get stricter as the chain gets more real, because the same
    ///      arrangement means different things on each:
    ///
    ///      - 31337: the deployer fills every role. It is a throwaway chain and a
    ///        second key would only be ceremony.
    ///      - Any other TESTNET: every role must be named. They MAY coincide — a
    ///        testnet lifecycle often wants one key driving everything — but naming
    ///        them forces the choice to be deliberate rather than defaulted.
    ///      - MAINNET: every role must be named, none may be the deployer, and
    ///        governance must differ from the guardian. The guardian exists precisely
    ///        so that fast action does not need the key that can change the rules; one
    ///        key holding both is the arrangement this function exists to refuse.
    ///
    ///      Pure, and takes the chain id as an argument, so the policy can be tested
    ///      without deploying anything.
    function resolveRoles(uint256 chainId, Roles memory r, address deployer) internal pure returns (Roles memory) {
        if (chainId == LOCAL_CHAIN_ID) {
            return Roles({
                governance: r.governance == address(0) ? deployer : r.governance,
                guardian: r.guardian == address(0) ? deployer : r.guardian,
                treasury: r.treasury == address(0) ? deployer : r.treasury,
                curatorSigner: r.curatorSigner == address(0) ? deployer : r.curatorSigner
            });
        }

        if (r.governance == address(0)) revert GovernanceUnset(chainId);
        if (r.guardian == address(0)) revert GuardianUnset(chainId);
        if (r.treasury == address(0)) revert TreasuryUnset(chainId);
        if (r.curatorSigner == address(0)) revert CuratorSignerUnset(chainId);

        if (chainId == MAINNET_CHAIN_ID) {
            if (r.governance == deployer) revert RoleHeldByDeployer(chainId, "GOVERNANCE");
            if (r.guardian == deployer) revert RoleHeldByDeployer(chainId, "GUARDIAN");
            if (r.treasury == deployer) revert RoleHeldByDeployer(chainId, "TREASURY");
            if (r.curatorSigner == deployer) revert RoleHeldByDeployer(chainId, "CURATOR_SIGNER");
            // The one pair that must not be the same address. A guardian that is also
            // governance can pause the protocol AND rewrite the rules under it, which
            // is the concentration the separation exists to prevent.
            if (r.governance == r.guardian) revert RolesNotDistinct("GOVERNANCE", "GUARDIAN");
        }
        return r;
    }

    function applyDefaults(ConfigRegistry config, address collateral) internal {
        // Bounds are set first and locked forever; the values follow.
        config.setBounds(ConfigKeys.FEE_BPS, 0, 300); // 3.00% ceiling
        config.setBounds(ConfigKeys.CREATOR_FEE_SHARE_BPS, 0, 10_000);
        config.setBounds(ConfigKeys.RESOLVER_FEE_SHARE_BPS, 0, 10_000);
        config.setBounds(ConfigKeys.MIN_SEED, 1e6, UNBOUNDED);
        config.setBounds(ConfigKeys.MIN_SETTLEMENT_DEPOSIT, 1e6, UNBOUNDED);
        config.setBounds(ConfigKeys.MIN_TRADE_TOKENS, 1, UNBOUNDED);
        config.setBounds(ConfigKeys.SWEEP_UNCLAIMED_AFTER, 180 days, 3650 days);

        config.setParam(ConfigKeys.FEE_BPS, 100);
        config.setParam(ConfigKeys.CREATOR_FEE_SHARE_BPS, 4000);
        config.setParam(ConfigKeys.RESOLVER_FEE_SHARE_BPS, 3000);
        config.setParam(ConfigKeys.MIN_SEED, 100e6);
        config.setParam(ConfigKeys.MIN_SETTLEMENT_DEPOSIT, 20e6);
        config.setParam(ConfigKeys.MIN_TRADE_TOKENS, 1e6);
        config.setParam(ConfigKeys.SWEEP_UNCLAIMED_AFTER, 365 days);

        applyResolutionDefaults(config);
        applyCategories(config);

        config.setCollateralAllowed(collateral, true);
    }
}
