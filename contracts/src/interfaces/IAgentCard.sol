// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAgentRegistry} from "./IAgentRegistry.sol";

/// @notice Renders an agent identity as an ERC-721 metadata URI.
/// @dev Handed everything it renders rather than reading it, so the renderer holds no
///      state and swapping one cannot lose an identity.
interface IAgentCard {
    function render(uint256 agentId, bytes32 name, IAgentRegistry.Role role, address operator, bytes32 metadataRoot)
        external
        pure
        returns (string memory);
}
