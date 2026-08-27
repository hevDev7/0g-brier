// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC
/// @notice Collateral uji 6 desimal untuk 0G-Delphi. HANYA testnet/lokal.
/// @dev Sengaja 6 desimal, bukan 18: lapisan normalisasi desimal harus dilewati
///      setiap uji sejak hari pertama, agar bug penskalaan tidak muncul pertama kali
///      saat berpindah ke stablecoin sungguhan di mainnet.
contract MockUSDC is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 10_000e6;
    uint256 public constant FAUCET_COOLDOWN = 1 days;

    mapping(address => uint256) public lastClaim;

    error FaucetCooldown(uint256 availableAt);

    constructor() ERC20("0G-Delphi Mock USD", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function claim() external {
        uint256 last = lastClaim[msg.sender];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) {
            revert FaucetCooldown(last + FAUCET_COOLDOWN);
        }
        lastClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Cetak tanpa batas — hanya untuk penyiapan uji dan seeding demo.
    function mintTo(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
