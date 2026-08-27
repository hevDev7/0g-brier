// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";

/// @title OutcomeShares
/// @notice Posisi outcome tradable untuk seluruh market 0G-Delphi.
/// @dev Otorisasi bersifat aritmetika, bukan administratif: `id` diturunkan dari
///      alamat market, dan mint/burn menurunkannya dari `msg.sender`. Sebuah market
///      karena itu tidak punya representasi untuk id market lain — tidak ada daftar
///      izin per-market yang bisa salah konfigurasi.
///
///      Lembar seed TIDAK ada di sini. Lembar seed tidak transferable dan dicatat
///      di dalam Market masing-masing (lihat §6.3 spec).
contract OutcomeShares is ERC1155 {
    address public immutable deployer;
    IMarketRegistry public registry;

    error NotMarket();
    error RegistryAlreadySet();
    error NotDeployer();
    error BadOutcome();

    event RegistrySet(address indexed registry);

    constructor(string memory uri_) ERC1155(uri_) {
        deployer = msg.sender;
    }

    /// @dev Dipasang sekali setelah MarketFactory di-deploy, lalu tidak bisa diubah.
    function setRegistry(address registry_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (address(registry) != address(0)) revert RegistryAlreadySet();
        registry = IMarketRegistry(registry_);
        emit RegistrySet(registry_);
    }

    function idFor(address market, uint8 outcome) public pure returns (uint256) {
        if (outcome > 1) revert BadOutcome();
        return (uint256(uint160(market)) << 8) | uint256(outcome);
    }

    function marketOf(uint256 id) public pure returns (address) {
        // Truncation ke uint160 aman: untuk id hasil idFor(), bit di atas posisi 168 selalu
        // nol (alamat 160-bit digeser 8 bit muat dalam 168 bit). Untuk id sembarang, ini
        // murni decoder pure tanpa jalur keamanan yang bergantung padanya.
        // forge-lint: disable-next-line(unsafe-typecast)
        return address(uint160(id >> 8));
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
