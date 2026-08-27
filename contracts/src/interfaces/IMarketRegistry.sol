// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Bagian dari MarketFactory yang perlu diketahui OutcomeShares.
///         Antarmuka sempit ini memutus ketergantungan melingkar antara keduanya.
interface IMarketRegistry {
    function isMarket(address candidate) external view returns (bool);
}
