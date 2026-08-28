// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";

/// @title OutcomeShares
/// @notice Tradable outcome positions for every Brier market.
/// @dev Authorization here is arithmetic, not administrative: `id` is derived from
///      the market address, and mint/burn derive it from `msg.sender`. A market
///      therefore has no way to name another market's id — there is no per-market
///      permission list that could be misconfigured.
///
///      Seed shares do NOT live here. Seed shares are non-transferable and are
///      recorded inside each Market (see spec §6.3).
contract OutcomeShares is ERC1155 {
    /// @dev Width in bits of the outcome in the id scheme: id = uint160(market) << OUTCOME_BITS | outcome.
    ///      idFor restricts outcome to {0,1}, so one byte is far more room than needed;
    ///      used in idFor AND marketOf so the two cannot drift out of sync.
    uint256 private constant OUTCOME_BITS = 8;

    address public immutable deployer;
    IMarketRegistry public registry;

    error NotMarket();
    error RegistryAlreadySet();
    error ZeroRegistry();
    error NotDeployer();
    error BadOutcome();

    event RegistrySet(address indexed registry);

    constructor(string memory uri_) ERC1155(uri_) {
        deployer = msg.sender;
    }

    /// @dev Set once after MarketFactory is deployed, and immutable thereafter.
    function setRegistry(address registry_) external {
        if (msg.sender != deployer) revert NotDeployer();
        // unset and "set to address(0)" share the same storage value (0), so address(0)
        // must be rejected explicitly here — otherwise the guard below cannot tell
        // "never set" from "set to zero", and an address(0) call that slips through
        // silently consumes this one-shot key.
        if (registry_ == address(0)) revert ZeroRegistry();
        if (address(registry) != address(0)) revert RegistryAlreadySet();
        registry = IMarketRegistry(registry_);
        emit RegistrySet(registry_);
    }

    function idFor(address market, uint8 outcome) public pure returns (uint256) {
        if (outcome > 1) revert BadOutcome();
        return (uint256(uint160(market)) << OUTCOME_BITS) | uint256(outcome);
    }

    function marketOf(uint256 id) public pure returns (address) {
        // Truncation to uint160 is safe: for an id produced by idFor(), every bit above
        // position 168 is zero (a 160-bit address shifted OUTCOME_BITS (8) bits fits in
        // 168 bits). For an arbitrary id this is a pure decoder with no security path
        // depending on it.
        // forge-lint: disable-next-line(unsafe-typecast)
        return address(uint160(id >> OUTCOME_BITS));
    }

    function balanceOfOutcome(address account, address market, uint8 outcome) external view returns (uint256) {
        return balanceOf(account, idFor(market, outcome));
    }

    function mint(address to, uint8 outcome, uint256 amount) external onlyMarket {
        _mint(to, idFor(msg.sender, outcome), amount, "");
    }

    function burn(address from, uint8 outcome, uint256 amount) external onlyMarket {
        _burn(from, idFor(msg.sender, outcome), amount);
    }

    modifier onlyMarket() {
        if (address(registry) == address(0) || !registry.isMarket(msg.sender)) revert NotMarket();
        _;
    }
}
