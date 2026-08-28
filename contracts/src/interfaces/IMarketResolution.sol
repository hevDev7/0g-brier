// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The part of Market that the resolution module drives.
///         Narrow on purpose, like IMarketRegistry: the module needs to move a market
///         through its terminal transitions and nothing else, and an interface that
///         also carried `buy` or `redeem` would suggest otherwise.
/// @dev `void` is absent because it is the guardian's, not the module's.
interface IMarketResolution {
    function markProposed() external;
    function markDisputed() external;
    function settle(uint8 outcome) external;
    function fail() external;
}
