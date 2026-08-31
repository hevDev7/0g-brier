// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Agent identity, stake, and reputation (spec §8.5).
/// @dev v1 is ERC-721 plus a plain `metadataRoot`. The ERC-7857 path — encrypted
///      metadata, re-encrypted on transfer, `updateMetadata` verifying proofs — lands
///      in P7. The interface is already in its final shape so that migration is a
///      change of implementation rather than a change of every caller.
interface IAgentRegistry {
    enum Role {
        Creator,
        Curator,
        Resolver,
        Trader
    }

    struct Reputation {
        uint32 marketsCreated;
        uint32 marketsVoided;
        uint32 resolutionsAgreed;
        uint32 resolutionsOverturned;
        int128 realizedPnl;
        uint32 tradesExecuted;
    }

    function resolvers(uint256 index) external view returns (uint256 agentId);
    function resolverCount() external view returns (uint256);
    function operatorOf(uint256 agentId) external view returns (address);
    /// @notice Which agent an operator key acts for. Zero means none.
    /// @dev The ERC-721 owner. `agentOf` maps an OPERATOR key to its agent, which is
    ///      the key that trades and votes; ownership is a different question and a
    ///      different key. Spending an agent's earnings is the owner's right, not
    ///      the operator's — an operator compromised on a trading machine must not
    ///      be able to withdraw.
    function ownerOf(uint256 agentId) external view returns (address);

    function agentOf(address operator) external view returns (uint256);
    function nameOf(uint256 agentId) external view returns (bytes32);
    function nameOfOperator(address operator) external view returns (bytes32);
    function roleOf(uint256 agentId) external view returns (Role);
    function stakeOf(uint256 agentId) external view returns (uint256);
    function reputationOf(uint256 agentId) external view returns (Reputation memory);

    /// @notice Stake that is BOTH bonded and not cooling down — the only stake that
    ///         backs a vote and the only stake that can be slashed.
    function activeStake(uint256 agentId) external view returns (uint256);

    /// @dev Callable only by the ResolutionModule. Slashed stake goes to the treasury.
    function slash(uint256 agentId, uint256 amount, bytes32 reason) external returns (uint256 taken);

    function recordResolution(uint256 agentId, bool agreed, bool overturned) external;
}
