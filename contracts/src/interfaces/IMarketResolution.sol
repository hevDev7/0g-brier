// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The part of Market that the resolution module drives.
///         Narrow on purpose, like IMarketRegistry: the module needs to move a market
///         through its terminal transitions and nothing else, and an interface that
///         also carried `buy` or `redeem` would suggest otherwise.
/// @dev `void` is absent because it is the guardian's, not the module's.
interface IMarketResolution {
    /// @dev Read so the module can refuse to open a resolution for a market that has
    ///      not closed, and refuse to finalize one that has already moved on.
    function status() external view returns (uint8);
    function tier() external view returns (uint8);
    function settlementDeadline() external view returns (uint64);
    function markProposed() external;
    function markDisputed() external;
    /// @dev Read by the module BEFORE it calls `settle`, which zeroes them. This is
    ///      how the resolver pool learns what it is about to be paid and for which
    ///      market — the transfer that follows carries no such information.
    function collateral() external view returns (address);
    function feeAccrued() external view returns (uint256);
    function settlementDeposit() external view returns (uint256);
    function resolverFeeShareBps() external view returns (uint16);

    function settle(uint8 outcome) external;
    function fail() external;
}
