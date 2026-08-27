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

        config.setCollateralAllowed(collateral, true);
    }
}
