// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IMarket {
    /// @dev Closed/Proposed/Disputed are non-trading states: `q` is frozen so the
    ///      payout cannot be shifted while the committee is still deliberating.
    enum Status {
        Open,
        Closed,
        Proposed,
        Disputed,
        Settled,
        Failed,
        Voided
    }

    struct Params {
        address collateral;
        address creator;
        uint256 creatorAgentId;
        uint64 tradingEnd;
        uint64 settlementDeadline;
        uint8 tier; // 0=FAST 1=VERIFIED 2=DETERMINISTIC
        bytes32 specRoot; // 0G Storage Merkle root for the MarketSpec
        bytes32 category;
    }

    /// @dev qAfter and probAfter are included so that an indexer can reconstruct the
    ///      probability curve without a single historical eth_call.
    event Trade(
        address indexed trader,
        address indexed recipient,
        uint8 indexed outcome,
        int256 sharesDelta,
        uint256 tokens,
        uint256 fee,
        uint256[2] qAfter,
        uint256 probAfter
    );

    event LiquidityChanged(address indexed provider, int256 lambdaWad, uint256 tokens, uint256[2] qAfter);
    event StatusChanged(Status indexed from, Status indexed to);
    event Settled(uint8 indexed outcome, uint256 payoutPerShareWad);
    event Redeemed(address indexed account, uint256 shares, uint256 tokensOut);
    event Liquidated(address indexed account, uint256[2] shares, uint256 tokensOut);
    event FeesDistributed(uint256 toCreator, uint256 toResolvers, uint256 toTreasury);
    event MarketVoided(bytes32 reason);
}
