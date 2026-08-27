// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ConfigRegistry} from "../src/core/ConfigRegistry.sol";
import {ConfigKeys} from "../src/core/ConfigKeys.sol";

/// @title DeployLib
/// @notice Protocol defaults from spec §17. Kept separate from the broadcast script so
///         they can be tested directly without broadcasting a transaction.
library DeployLib {
    uint128 internal constant UNBOUNDED = type(uint128).max;

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
