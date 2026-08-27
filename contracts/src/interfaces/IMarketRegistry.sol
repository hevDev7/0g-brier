// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The part of MarketFactory that OutcomeShares needs to know about.
///         This narrow interface breaks the circular dependency between the two.
interface IMarketRegistry {
    function isMarket(address candidate) external view returns (bool);
}
