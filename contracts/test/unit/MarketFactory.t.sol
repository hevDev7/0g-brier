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
import {MockUSDC} from "../../src/mocks/MockUSDC.sol";

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
        return _signAmounts(p, SEED, DEPOSIT, nonce);
    }

    function _structHash(IMarket.Params memory p, uint256 seedTokens, uint256 depositTokens, uint256 nonce)
        internal
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                factory.MARKET_APPROVAL_TYPEHASH(),
                p.specRoot,
                p.tradingEnd,
                p.settlementDeadline,
                p.tier,
                p.creatorAgentId,
                p.category,
                p.creator,
                p.collateral,
                seedTokens,
                depositTokens,
                nonce
            )
        );
    }

    function _signAmounts(IMarket.Params memory p, uint256 seedTokens, uint256 depositTokens, uint256 nonce)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = factory.hashTypedData(_structHash(p, seedTokens, depositTokens, nonce));
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
        bytes32 structHash = _structHash(p, SEED, DEPOSIT, 1);
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
        // setelah pemilik menyalakan kembali.
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

    /// @dev Approval kurator BUKAN bearer instrument. Front-runner di sini didanai dan
    ///      di-approve PENUH — jadi yang menolaknya benar-benar identitas pemanggil, bukan
    ///      kegagalan transfer — dan approval creator selamat dari percobaan itu.
    function test_onlyApprovedCreatorMayConsumeApproval() public {
        IMarket.Params memory p = _params();
        bytes memory sig = _sign(p, 1);
        _fund(bob, 1_000_000e6, address(factory));

        vm.prank(bob);
        vm.expectRevert(MarketFactory.NotCreator.selector);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);

        vm.prank(creator);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        assertEq(factory.marketCount(), 1);
    }

    /// @dev Kedalaman awal market (parameter `b` DPM) diturunkan seluruhnya dari seed, jadi
    ///      approval yang tidak mengikat seed berarti kurator menyetujui pertanyaannya tapi
    ///      bukan pasarnya. Approval atas SEED tidak boleh bisa dipakai pada MIN_SEED.
    function test_seedAndDepositAreBoundBySignature() public {
        IMarket.Params memory p = _params();
        bytes memory sig = _sign(p, 1); // menandatangani (SEED, DEPOSIT)
        uint256 minSeed = config.params(ConfigKeys.MIN_SEED);
        assertLt(minSeed, SEED);

        vm.prank(creator);
        vm.expectRevert(MarketFactory.BadCuratorSignature.selector);
        factory.createMarket(p, minSeed, DEPOSIT, 1, sig);

        vm.prank(creator);
        vm.expectRevert(MarketFactory.BadCuratorSignature.selector);
        factory.createMarket(p, SEED, DEPOSIT + 1, 1, sig);

        // Bukti bahwa yang ditolak adalah ANGKAnya: pasangan yang persis ditandatangani lolos.
        vm.prank(creator);
        address m = factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        assertEq(usdc.balanceOf(m), SEED + DEPOSIT);
    }

    /// @dev `allowedCollateral` adalah HIMPUNAN, bukan singleton. Dengan dua collateral yang
    ///      sama-sama diizinkan, approval yang tidak mengikat token akan bisa dipakai
    ///      meluncurkan spec yang sama dalam token lain — dengan `scale` dan profil ekonomi
    ///      berbeda. Token kedua di sini SUDAH diizinkan, jadi yang menolak pasti tanda
    ///      tangannya, bukan allowlist.
    function test_collateralIsBoundBySignature() public {
        MockUSDC other = new MockUSDC();
        config.setCollateralAllowed(address(other), true);
        other.mintTo(creator, 1_000_000e6);
        vm.prank(creator);
        other.approve(address(factory), type(uint256).max);

        IMarket.Params memory p = _params(); // collateral = usdc
        bytes memory sig = _sign(p, 1);

        p.collateral = address(other);
        vm.prank(creator);
        vm.expectRevert(MarketFactory.BadCuratorSignature.selector);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);

        p.collateral = address(usdc);
        vm.prank(creator);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        assertEq(factory.marketCount(), 1);
    }

    /// @dev Collateral di luar allowlist ditolak di FACTORY, bukan baru di Market.initialize.
    ///      Catatan kejujuran: revert mengembalikan seluruh state, jadi `marketCount()` dan
    ///      `usedApprovals` di bawah tidak bisa bernilai lain selama jalur ini revert — keduanya
    ///      dipasang sebagai penjaga regresi seandainya penjaga itu suatu saat diganti menjadi
    ///      jalur yang TIDAK revert. Yang membuktikan approval-nya utuh adalah baris terakhir:
    ///      tanda tangan yang SAMA masih bisa dipakai setelah token itu diizinkan.
    function test_unlistedCollateralRejectedAndApprovalSurvives() public {
        MockUSDC other = new MockUSDC();
        other.mintTo(creator, 1_000_000e6);
        vm.prank(creator);
        other.approve(address(factory), type(uint256).max);

        IMarket.Params memory p = _params();
        p.collateral = address(other);
        bytes memory sig = _sign(p, 1);
        bytes32 digest = factory.hashTypedData(_structHash(p, SEED, DEPOSIT, 1));

        vm.prank(creator);
        vm.expectRevert(MarketFactory.CollateralNotAllowed.selector);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        assertEq(factory.marketCount(), 0);
        assertFalse(factory.usedApprovals(digest));

        config.setCollateralAllowed(address(other), true);
        vm.prank(creator);
        address m = factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        assertEq(other.balanceOf(m), SEED + DEPOSIT);
    }

    /// @dev Membuktikan URUTANnya, bukan sekadar adanya penjaga: collateral adalah alamat TANPA
    ///      KODE. Kalau `safeTransferFrom` sempat dipanggil, OZ `Address` akan revert
    ///      `AddressEmptyCode`, bukan `CollateralNotAllowed`. Selector `CollateralNotAllowed()`
    ///      identik dengan milik `Market` (selector dihitung dari tanda tangan), jadi alamat
    ///      tanpa kode inilah yang membedakan "diperiksa di factory" dari "diperiksa di Market".
    function test_collateralCheckedBeforeTouchingToken() public {
        IMarket.Params memory p = _params();
        p.collateral = makeAddr("token yang tidak pernah di-deploy");
        bytes memory sig = _sign(p, 1);

        vm.prank(creator);
        vm.expectRevert(MarketFactory.CollateralNotAllowed.selector);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        assertEq(factory.marketCount(), 0);
    }

    /// @dev Kedua jalur tulis ke `marketImplementation` — dan dua alamat kolaborator lain —
    ///      menolak alamat tanpa kode. Lihat `MarketFactory.NotAContract` untuk mengapa alamat
    ///      tanpa kode berbahaya secara khusus di sini.
    function test_codelessAddressesRejectedOnEveryWritePath() public {
        address ghost = makeAddr("belum di-deploy");
        bytes memory expected = abi.encodeWithSelector(MarketFactory.NotAContract.selector, ghost);

        vm.expectRevert(expected);
        factory.setMarketImplementation(ghost);
        assertEq(factory.marketImplementation(), address(marketImpl));

        // Proxy tanpa data inisialisasi, supaya `initialize` bisa diikat sebagai panggilan
        // eksternal tersendiri alih-alih terkubur di dalam CREATE.
        MarketFactory raw = MarketFactory(address(new ERC1967Proxy(address(new MarketFactory()), "")));

        vm.expectRevert(expected);
        raw.initialize(address(this), ghost, address(shares), address(marketImpl));
        vm.expectRevert(expected);
        raw.initialize(address(this), address(config), ghost, address(marketImpl));
        vm.expectRevert(expected);
        raw.initialize(address(this), address(config), address(shares), ghost);

        raw.initialize(address(this), address(config), address(shares), address(marketImpl));
        assertEq(raw.marketImplementation(), address(marketImpl));
    }

    /// @dev Penjaga terakhir, di titik kloning. `Clones.clone` atas alamat tanpa kode
    ///      menghasilkan proxy minimal yang HIDUP: `Market(clone).initialize(...)` "berhasil"
    ///      secara diam (delegatecall ke ketiadaan mengembalikan sukses + returndata kosong,
    ///      dan initialize tidak punya nilai balik untuk didekode) setelah collateral pengguna
    ///      terlanjur pindah ke clone yang mati permanen. Kedua setter sudah menutup jalur
    ///      normal ke keadaan ini, jadi slot ditulis paksa lewat `vm.store` — `assertEq` di
    ///      bawah memastikan tulisan itu memang mengenai `marketImplementation`, sehingga uji
    ///      ini tidak bisa lulus karena kebetulan menulis slot yang salah.
    function test_createMarketRefusesCodelessImplementation() public {
        address ghost = makeAddr("implementasi hantu");
        vm.store(address(factory), bytes32(uint256(2)), bytes32(uint256(uint160(ghost))));
        assertEq(factory.marketImplementation(), ghost);

        IMarket.Params memory p = _params();
        bytes memory sig = _sign(p, 1);

        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(MarketFactory.NotAContract.selector, ghost));
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        assertEq(factory.marketCount(), 0);
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
