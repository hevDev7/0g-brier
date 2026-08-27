// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "../helpers/Fixtures.sol";
import {Market} from "../../src/core/Market.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

contract ReentrantBuyer is IERC1155Receiver {
    Market public immutable market;
    bool public armed;

    constructor(Market m) {
        market = m;
    }

    function setArmed(bool v) external {
        armed = v;
    }

    function attack(uint256 amount) external {
        market.buy(1, amount, type(uint256).max, address(this));
    }

    /// @dev Dipanggil di tengah `buy`. Panggilan masuk kedua harus ditolak guard.
    /// @dev `armed` dipadamkan SEBELUM re-entry, dan jumlahnya (10e18) sengaja jauh di atas
    ///      MIN_TRADE_TOKENS: verifikasi manual (menghapus `nonReentrant` sementara) menunjukkan
    ///      jumlah 1e18 dari draf awal adalah debu (< MIN_TRADE_TOKENS) dan revert TradeTooSmall
    ///      terlepas dari guard — vm.expectRevert() tanpa selektor lulus untuk alasan yang SALAH.
    ///      Tanpa memadamkan `armed`, guard yang hilang malah membuat re-entry berulang tanpa
    ///      henti sampai kedalaman panggilan EVM habis — revert lain yang juga menutupi guard.
    ///      Keduanya diperbaiki bersama supaya percobaan re-entry benar-benar hanya satu kali
    ///      dan, bila guard tak ada, akan SUKSES (bukan revert oleh sebab lain) — baru dengan
    ///      begitu `vm.expectRevert()` di bawah murni menguji `nonReentrant`.
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4) {
        if (armed) {
            armed = false;
            market.buy(1, 10e18, type(uint256).max, address(this));
        }
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC1155Receiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}

contract MarketReentrancyTest is Fixtures {
    Market internal m;
    ReentrantBuyer internal attacker;

    function setUp() public {
        _deployBase();
        m = _newMarket(SEED);
        attacker = new ReentrantBuyer(m);
        usdc.mintTo(address(attacker), 10_000_000e6);
        vm.prank(address(attacker));
        usdc.approve(address(m), type(uint256).max);
    }

    function test_reentrantReceiverCannotReenterBuy() public {
        attacker.setArmed(true);
        // Selektor spesifik, bukan expectRevert() kosong: yang terakhir lulus untuk revert
        // APA PUN, termasuk TradeTooSmall yang tak ada hubungannya dengan guard (lihat R25).
        // Market yang sudah hidup kebal terhadap perubahan parameter (minTradeTokens dipotret
        // saat initialize — lihat test_liveMarketIsImmuneToLaterConfigChanges), TAPI batas
        // MIN_TRADE_TOKENS dikunci DeployLib selebar [1, UNBOUNDED]; setParam boleh menaikkan
        // nilainya kapan saja di dalam rentang itu, dan setUp() di sini membuat market BARU tiap
        // uji — jadi default DeployLib yang naik di atas 7.330.600 (biaya re-entry 10e18 ini)
        // langsung terwarisi market baru ini pula. Data revert sampai ke sini utuh: ERC1155Utils
        // menyebarkan ulang alasan asli tanpa modifikasi.
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        attacker.attack(50e18);

        // Kontrol: penerima yang sama, tanpa serangan, berhasil. Ini membuktikan
        // revert di atas memang karena reentrancy, bukan sebab lain.
        attacker.setArmed(false);
        attacker.attack(50e18);
        assertEq(shares.balanceOfOutcome(address(attacker), address(m), 1), 50e18);
    }

    function test_stateUnchangedAfterFailedReentrancy() public {
        uint256[2] memory qBefore = m.qArray();
        uint256 poolBefore = m.poolWad();

        attacker.setArmed(true);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        attacker.attack(50e18);

        assertEq(m.qArray()[1], qBefore[1]);
        assertEq(m.poolWad(), poolBefore);
    }
}
