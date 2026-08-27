// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IMarket {
    /// @dev Closed/Proposed/Disputed adalah keadaan tanpa perdagangan: `q` dibekukan
    ///      agar payout tidak bisa digeser saat komite sedang menilai.
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
        bytes32 specRoot; // root Merkle 0G Storage untuk MarketSpec
        bytes32 category;
    }

    /// @dev qAfter dan probAfter disertakan supaya indexer bisa merekonstruksi kurva
    ///      probabilitas tanpa satu pun eth_call historis.
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
