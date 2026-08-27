// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ConfigKeys
/// @notice Canonical keys for ConfigRegistry. No magic numbers in any other contract.
library ConfigKeys {
    // ── parameters (uint256) ─────────────────────────────────────────────────
    bytes32 internal constant FEE_BPS = keccak256("FEE_BPS");
    bytes32 internal constant CREATOR_FEE_SHARE_BPS = keccak256("CREATOR_FEE_SHARE_BPS");
    bytes32 internal constant RESOLVER_FEE_SHARE_BPS = keccak256("RESOLVER_FEE_SHARE_BPS");
    bytes32 internal constant MIN_SEED = keccak256("MIN_SEED");
    bytes32 internal constant MIN_SETTLEMENT_DEPOSIT = keccak256("MIN_SETTLEMENT_DEPOSIT");
    bytes32 internal constant MIN_TRADE_TOKENS = keccak256("MIN_TRADE_TOKENS");
    bytes32 internal constant SWEEP_UNCLAIMED_AFTER = keccak256("SWEEP_UNCLAIMED_AFTER");

    // ── addresses ────────────────────────────────────────────────────────────
    bytes32 internal constant MARKET_FACTORY = keccak256("MARKET_FACTORY");
    bytes32 internal constant OUTCOME_SHARES = keccak256("OUTCOME_SHARES");
    bytes32 internal constant TREASURY = keccak256("TREASURY");
    bytes32 internal constant RESOLUTION_MODULE = keccak256("RESOLUTION_MODULE");
    bytes32 internal constant CURATOR_SIGNER = keccak256("CURATOR_SIGNER");
}
