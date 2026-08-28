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

    error TreasuryUnset(uint256 chainId);
    error CuratorSignerUnset(uint256 chainId);

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

        // ── resolution (spec §7.1) ───────────────────────────────────────────
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

        config.setCollateralAllowed(collateral, true);
    }
}
