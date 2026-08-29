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

    // ── resolution (spec §7) ─────────────────────────────────────────────────
    // Windows are per tier because trust and time trade off against each other:
    // the LESS a tier is trusted, the LONGER its dispute window. FAST resolves
    // from an unattested router and gets 24h; VERIFIED has TEE attestation and
    // gets 6h. Reading that backwards — "better evidence deserves more scrutiny
    // time" — inverts the protection.
    bytes32 internal constant COMMIT_WINDOW = keccak256("COMMIT_WINDOW");
    bytes32 internal constant REVEAL_WINDOW = keccak256("REVEAL_WINDOW");
    bytes32 internal constant DISPUTE_WINDOW_FAST = keccak256("DISPUTE_WINDOW_FAST");
    bytes32 internal constant DISPUTE_WINDOW_VERIFIED = keccak256("DISPUTE_WINDOW_VERIFIED");
    bytes32 internal constant DISPUTE_WINDOW_DETERMINISTIC = keccak256("DISPUTE_WINDOW_DETERMINISTIC");
    /// @dev Committee size and threshold, per tier, packed as n * 256 + k.
    bytes32 internal constant COMMITTEE_FAST = keccak256("COMMITTEE_FAST");
    bytes32 internal constant COMMITTEE_VERIFIED = keccak256("COMMITTEE_VERIFIED");
    bytes32 internal constant COMMITTEE_DETERMINISTIC = keccak256("COMMITTEE_DETERMINISTIC");
    bytes32 internal constant COMMITTEE_DISPUTE = keccak256("COMMITTEE_DISPUTE");
    bytes32 internal constant NO_SHOW_SLASH_BPS = keccak256("NO_SHOW_SLASH_BPS");
    bytes32 internal constant DISAGREE_SLASH_BPS = keccak256("DISAGREE_SLASH_BPS");
    bytes32 internal constant OVERTURN_SLASH_BPS = keccak256("OVERTURN_SLASH_BPS");
    bytes32 internal constant DISPUTE_BOND = keccak256("DISPUTE_BOND");
    bytes32 internal constant MIN_RESOLVER_STAKE = keccak256("MIN_RESOLVER_STAKE");
    bytes32 internal constant UNSTAKE_COOLDOWN = keccak256("UNSTAKE_COOLDOWN");

    /// @dev 1 = only a registered Trader agent may buy or sell. Off by default so a
    ///      deployment made before the registry existed is not bricked by an upgrade;
    ///      turning it on is a deliberate governance act.
    bytes32 internal constant REQUIRE_REGISTERED_TRADER = keccak256("REQUIRE_REGISTERED_TRADER");

    // ── addresses ────────────────────────────────────────────────────────────
    bytes32 internal constant MARKET_FACTORY = keccak256("MARKET_FACTORY");
    bytes32 internal constant OUTCOME_SHARES = keccak256("OUTCOME_SHARES");
    bytes32 internal constant TREASURY = keccak256("TREASURY");
    bytes32 internal constant RESOLUTION_MODULE = keccak256("RESOLUTION_MODULE");
    bytes32 internal constant CURATOR_SIGNER = keccak256("CURATOR_SIGNER");
    bytes32 internal constant AGENT_REGISTRY = keccak256("AGENT_REGISTRY");

    /// @dev ERC-8004's registries, which this protocol READS and PUBLISHES TO but does
    ///      not own. They are deployed at the same two addresses on 57 networks
    ///      including 0G, so pointing at them is configuration rather than deployment.
    ///      Unset means the integration is simply off — never a reason to fail.
    bytes32 internal constant ERC8004_IDENTITY = keccak256("ERC8004_IDENTITY");
    bytes32 internal constant ERC8004_REPUTATION = keccak256("ERC8004_REPUTATION");
    /// @dev What resolvers stake, and what slashing takes. Separate from a
    ///      market's collateral on purpose: a market can settle in any allowlisted
    ///      token, while the security of resolution must not vary with which one.
    bytes32 internal constant STAKE_TOKEN = keccak256("STAKE_TOKEN");
}
