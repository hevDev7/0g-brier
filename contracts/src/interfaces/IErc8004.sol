// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The slice of ERC-8004's IdentityRegistry this protocol reads.
/// @dev Deployed at 0x8004A818… on every testnet and 0x8004A169… on every mainnet the
///      8004 team has published, 0G among them. This declares only what is called;
///      importing their contracts would pull an upgradeable ERC-721 into a build that
///      never deploys one.
interface IErc8004Identity {
    function ownerOf(uint256 agentId) external view returns (address);
    function getAgentWallet(uint256 agentId) external view returns (address);
}

/// @notice The slice of ERC-8004's ReputationRegistry this protocol writes to.
interface IErc8004Reputation {
    /// @dev Reverts if the caller is the agent's owner or operator — self-feedback is
    ///      refused by the registry itself, which is why a protocol contract, and never
    ///      the resolver, is the one that publishes.
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;
}
