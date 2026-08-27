// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "../helpers/Fixtures.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {MarketFactory} from "../../src/core/MarketFactory.sol";
import {Market} from "../../src/core/Market.sol";
import {OutcomeShares} from "../../src/core/OutcomeShares.sol";
import {IMarket} from "../../src/interfaces/IMarket.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";

contract MarketFactoryTest is Fixtures {
    MarketFactory internal factory;
    uint256 internal curatorPk = 0xC0FFEE;
    address internal curator;

    function setUp() public {
        _deployBase();
        curator = vm.addr(curatorPk);

        // Urutan ini mencerminkan Deploy.s.sol dan TIDAK bisa dibalik:
        //   shares bersih → factory (memotret alamat shares) → shares.setRegistry(factory).
        // `_deployBase` sudah memakai kunci sekali-pakai `setRegistry` untuk StubMarketRegistry,
        // jadi instance itu tidak akan pernah bisa dialihkan ke factory sungguhan; `_freshShares`
        // memulai dari instance kosong. Sebaliknya factory tidak bisa lahir belakangan tanpa
        // membuat `shares` yang dipotretnya basi — lihat catatan di Fixtures.
        _freshShares();

        MarketFactory impl = new MarketFactory();
        factory = MarketFactory(
            address(
                new ERC1967Proxy(
                    address(impl),
                    abi.encodeCall(
                        MarketFactory.initialize, (address(this), address(config), address(shares), address(marketImpl))
                    )
                )
            )
        );
        config.setAddress(ConfigKeys.MARKET_FACTORY, address(factory));
        config.setAddress(ConfigKeys.CURATOR_SIGNER, curator);
        _useFactoryAsRegistry(address(factory));

        _fund(creator, 1_000_000e6, address(factory));
    }

    /// @dev MELAKUKAN dua panggilan eksternal ke factory (`MARKET_APPROVAL_TYPEHASH` dan
    ///      `hashTypedData`). Karena itu tidak pernah boleh dievaluasi sebagai argumen inline
    ///      dari panggilan yang sudah dipasangi `vm.prank`/`vm.expectRevert`: cheatcode itu
    ///      mengikat panggilan eksternal BERIKUTNYA secara harfiah, dan yang berikutnya akan
    ///      menjadi view call di sini, bukan `createMarket`. Setiap uji di bawah menghitung
    ///      tanda tangannya ke variabel lokal LEBIH DULU.
    function _sign(IMarket.Params memory p, uint256 nonce) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                factory.MARKET_APPROVAL_TYPEHASH(),
                p.specRoot,
                p.tradingEnd,
                p.settlementDeadline,
                p.tier,
                p.creatorAgentId,
                p.category,
                p.creator,
                nonce
            )
        );
        bytes32 digest = factory.hashTypedData(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(curatorPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_createMarketDeploysCloneAndSeedsIt() public {
        IMarket.Params memory p = _params();
        bytes memory sig = _sign(p, 1);

        // topic1 (alamat market) belum bisa diketahui sebelum clone dibuat; sisanya diperiksa
        // penuh karena indexer membangun ulang katalog market hanya dari event ini.
        vm.expectEmit(false, true, true, true, address(factory));
        emit MarketFactory.MarketCreated(address(0), creator, p.creatorAgentId, p.specRoot, SEED, p.tier);
        vm.prank(creator);
        address addr = factory.createMarket(p, SEED, DEPOSIT, 1, sig);

        Market m = Market(addr);
        assertTrue(factory.isMarket(addr));
        assertEq(factory.marketCount(), 1);
        assertEq(factory.marketAt(0), addr);
        assertEq(uint8(m.status()), uint8(IMarket.Status.Open));
        assertEq(m.probability(0), 5e17);
        assertEq(usdc.balanceOf(addr), SEED + DEPOSIT);
        assertEq(m.creator(), creator);
        // Market harus menunjuk instance shares yang benar-benar mempercayai factory ini.
        assertEq(address(m.shares()), address(shares));
    }

    function test_marketCanMintSharesOnlyAfterRegistration() public {
        IMarket.Params memory p = _params();
        bytes memory sig = _sign(p, 1);
        vm.prank(creator);
        Market m = Market(factory.createMarket(p, SEED, DEPOSIT, 1, sig));

        _fund(alice, 100_000e6, address(m));
        vm.prank(alice);
        m.buy(1, 50e18, type(uint256).max, alice);
        assertEq(shares.balanceOfOutcome(alice, address(m), 1), 50e18);

        // Sisi "ONLY": clone dengan bytecode identik yang TIDAK lewat factory tidak boleh
        // bisa mencetak apa pun. Otorisasi bergantung pada registry, bukan pada bytecode.
        // `Clones.clone` adalah CREATE dan pendanaan adalah panggilan eksternal — semuanya
        // sengaja diselesaikan SEBELUM `vm.expectRevert` dipasang.
        Market rogue = Market(Clones.clone(address(marketImpl)));
        usdc.mintTo(address(rogue), SEED + DEPOSIT);
        rogue.initialize(address(config), address(shares), p, SEED, DEPOSIT);
        assertFalse(factory.isMarket(address(rogue)));
        _fund(bob, 100_000e6, address(rogue));

        vm.prank(bob);
        vm.expectRevert(OutcomeShares.NotMarket.selector);
        rogue.buy(1, 50e18, type(uint256).max, bob);
    }

    function test_wrongSignerRejected() public {
        IMarket.Params memory p = _params();
        bytes32 structHash = keccak256(
            abi.encode(
                factory.MARKET_APPROVAL_TYPEHASH(),
                p.specRoot,
                p.tradingEnd,
                p.settlementDeadline,
                p.tier,
                p.creatorAgentId,
                p.category,
                p.creator,
                uint256(1)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBADBAD, factory.hashTypedData(structHash));
        bytes memory forged = abi.encodePacked(r, s, v);
        bytes memory genuine = _sign(p, 1);

        vm.prank(creator);
        vm.expectRevert(MarketFactory.BadCuratorSignature.selector);
        factory.createMarket(p, SEED, DEPOSIT, 1, forged);

        // Bukti bahwa yang ditolak adalah PENANDA TANGANnya, bukan parameter atau nonce:
        // payload yang sama persis lolos begitu kurator sungguhan yang menandatangani.
        vm.prank(creator);
        factory.createMarket(p, SEED, DEPOSIT, 1, genuine);
        assertEq(factory.marketCount(), 1);
    }

    /// @dev Tanda tangan yang sudah dipakai tidak boleh bisa dipakai ulang.
    function test_approvalCannotBeReplayed() public {
        IMarket.Params memory p = _params();
        bytes memory sig = _sign(p, 1);
        bytes memory sigNonceTwo = _sign(p, 2);

        vm.startPrank(creator);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        vm.expectRevert(MarketFactory.ApprovalAlreadyUsed.selector);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        // Bukti bahwa yang menolak adalah PEMAKAIAN ULANGnya, bukan params kembar: approval
        // baru atas params yang sama persis tetap lolos.
        factory.createMarket(p, SEED, DEPOSIT, 2, sigNonceTwo);
        vm.stopPrank();

        assertEq(factory.marketCount(), 2);
    }

    /// @dev Mengubah satu bidang saja membuat tanda tangan tidak sah — kurator
    ///      menyetujui market TERTENTU, bukan memberi izin umum.
    function test_tamperedParamsRejected() public {
        IMarket.Params memory p = _params();
        bytes memory sig = _sign(p, 1);
        p.tier = 0;

        vm.prank(creator);
        vm.expectRevert(MarketFactory.BadCuratorSignature.selector);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);

        // Bukti bahwa yang ditolak adalah PERUBAHANnya: tanda tangan yang sama lolos
        // begitu bidang itu dikembalikan.
        p.tier = 1;
        vm.prank(creator);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        assertEq(factory.marketCount(), 1);
    }

    function test_createMarketBlockedWhilePaused() public {
        IMarket.Params memory p = _params();
        bytes memory sig = _sign(p, 1);

        vm.prank(guardian);
        config.pause();
        vm.prank(creator);
        vm.expectRevert(MarketFactory.ProtocolPaused.selector);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);

        // Bukti bahwa yang menolak adalah PAUSE-nya, bukan tanda tangan: sig yang sama lolos
        // setelah pemilik menyalakan kembali — sekaligus membuktikan percobaan yang gagal
        // tidak diam-diam menghanguskan approval sekali-pakai itu.
        config.unpause();
        vm.prank(creator);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        assertEq(factory.marketCount(), 1);
    }

    function test_onlyOwnerCanSwapImplementation() public {
        Market next = new Market();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, alice));
        factory.setMarketImplementation(address(next));
        assertEq(factory.marketImplementation(), address(marketImpl));

        factory.setMarketImplementation(address(next));
        assertEq(factory.marketImplementation(), address(next));
    }

    /// @dev Domain EIP-712 adalah kontrak antara penanda tangan off-chain (agent Kurator)
    ///      dan verifikasi on-chain. Digest dihitung ulang di sini dari nol supaya salah
    ///      ketik pada name/version tidak bisa lolos diam-diam dan mematikan seluruh
    ///      alur pembuatan market di produksi.
    function test_typedDataDigestMatchesEip712() public view {
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = factory.eip712Domain();
        assertEq(name, "0G-Delphi");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(verifying, address(factory));

        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("0G-Delphi")),
                keccak256(bytes("1")),
                block.chainid,
                address(factory)
            )
        );
        bytes32 structHash = keccak256("struct apa saja");
        assertEq(factory.hashTypedData(structHash), keccak256(abi.encodePacked(hex"1901", domainSeparator, structHash)));
    }
}
