// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ConfigRegistry} from "./ConfigRegistry.sol";
import {ConfigKeys} from "./ConfigKeys.sol";
import {OutcomeShares} from "./OutcomeShares.sol";
import {Market} from "./Market.sol";
import {IMarket} from "../interfaces/IMarket.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";

/// @title MarketFactory
/// @notice Mencetak clone Market dan menjadi registry yang dipercaya OutcomeShares.
/// @dev Pembuatan market menuntut approval EIP-712 dari agent Kurator. Di P1
///      penanda tangan adalah satu alamat di ConfigRegistry; P2 menggantinya dengan
///      pencarian di AgentRegistry tanpa mengubah bentuk tanda tangan.
///
///      Kontrak ini upgradeable (UUPS) karena ia koordinator, bukan brankas: ia tidak
///      pernah memegang dana pengguna — collateral mengalir langsung dari pembuat ke
///      clone. Market sendiri sengaja TIDAK upgradeable.
contract MarketFactory is Initializable, Ownable2StepUpgradeable, UUPSUpgradeable, EIP712Upgradeable, IMarketRegistry {
    using SafeERC20 for IERC20;

    /// @dev Kurator menyetujui market yang LENGKAP, bukan sebagian: seluruh identitas spec
    ///      DAN seluruh profil ekonominya ikut ditandatangani.
    ///
    ///      `collateral` ada di sini karena `ConfigRegistry.allowedCollateral` adalah HIMPUNAN,
    ///      bukan singleton — begitu tata kelola mengizinkan collateral kedua, approval yang
    ///      tidak mengikat token akan bisa dipakai meluncurkan spec yang sama dalam token lain,
    ///      dengan `scale` berbeda (Market menerima desimal apa pun ≤ 18) dan profil ekonomi
    ///      berbeda pula. `seedTokens`/`depositTokens` ada di sini karena kedalaman awal market
    ///      (parameter `b` DPM) diturunkan seluruhnya dari seed: approval yang tidak mengikat
    ///      seed berarti kurator menyetujui pertanyaannya tapi bukan pasarnya.
    ///
    ///      Menandatangani semua bidang saja tidak cukup — front-runner masih bisa memutar ulang
    ///      payload yang PERSIS disetujui untuk membakar nonce sekali-pakai itu dan membuat
    ///      transaksi creator sendiri revert. Karena itu `createMarket` juga menuntut
    ///      `msg.sender == p.creator`; keduanya diperlukan, tidak ada yang menggantikan yang lain.
    bytes32 public constant MARKET_APPROVAL_TYPEHASH = keccak256(
        "MarketApproval(bytes32 specRoot,uint64 tradingEnd,uint64 settlementDeadline,uint8 tier,uint256 creatorAgentId,bytes32 category,address creator,address collateral,uint256 seedTokens,uint256 depositTokens,uint256 nonce)"
    );

    ConfigRegistry public config;
    OutcomeShares public shares;
    address public marketImplementation;

    mapping(address => bool) public isMarket;
    mapping(bytes32 => bool) public usedApprovals;
    address[] internal _markets;

    error BadCuratorSignature();
    error ApprovalAlreadyUsed();
    error ProtocolPaused();
    error ZeroAddress();
    error NotCreator();
    error CollateralNotAllowed();
    /// @dev Alamat tanpa kode. Bukan sekadar kerapian: `Clones.clone` atas alamat tanpa kode
    ///      menghasilkan proxy minimal yang HIDUP, dan `delegatecall`-nya mengembalikan sukses
    ///      dengan returndata kosong. `Market(market).initialize(...)` tidak punya nilai balik,
    ///      jadi pemeriksaan `extcodesize` Solidity lolos (ia memeriksa clone-nya, yang memang
    ///      berkode) dan tidak ada apa pun untuk didekode — panggilan itu "berhasil" secara diam
    ///      setelah collateral pengguna terlanjur pindah ke clone yang mati permanen.
    error NotAContract(address account);

    event MarketCreated(
        address indexed market,
        address indexed creator,
        uint256 indexed creatorAgentId,
        bytes32 specRoot,
        uint256 seed,
        uint8 tier
    );
    event MarketImplementationSet(address indexed implementation);

    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address config_, address shares_, address marketImpl_) external initializer {
        if (config_ == address(0) || shares_ == address(0) || marketImpl_ == address(0)) revert ZeroAddress();
        _requireContract(config_);
        _requireContract(shares_);
        _requireContract(marketImpl_);
        __Ownable_init(owner_);
        __Ownable2Step_init();
        __UUPSUpgradeable_init();
        __EIP712_init("0G-Delphi", "1");
        config = ConfigRegistry(config_);
        shares = OutcomeShares(shares_);
        marketImplementation = marketImpl_;
        emit MarketImplementationSet(marketImpl_);
    }

    function setMarketImplementation(address impl) external onlyOwner {
        if (impl == address(0)) revert ZeroAddress();
        _requireContract(impl);
        marketImplementation = impl;
        emit MarketImplementationSet(impl);
    }

    /// @dev `<address>.code.length` dikompilasi menjadi EXTCODESIZE, bukan penyalinan kode.
    function _requireContract(address account) internal view {
        if (account.code.length == 0) revert NotAContract(account);
    }

    /// @notice Diekspos agar penanda tangan off-chain (agent Kurator) dapat menghitung
    ///         digest yang sama persis tanpa menebak domain separator.
    function hashTypedData(bytes32 structHash) external view returns (bytes32) {
        return _hashTypedDataV4(structHash);
    }

    /// @dev Berdiri sebagai fungsi sendiri, bukan inline di `createMarket`: sebelas bidang plus
    ///      typehash melampaui kedalaman stack EVM pada profil default (tanpa via_ir), dan
    ///      frame terpisah adalah cara yang tidak mengorbankan apa pun untuk mengatasinya.
    function _approvalDigest(IMarket.Params calldata p, uint256 seedTokens, uint256 depositTokens, uint256 nonce)
        internal
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    MARKET_APPROVAL_TYPEHASH,
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
            )
        );
    }

    function createMarket(
        IMarket.Params calldata p,
        uint256 seedTokens,
        uint256 depositTokens,
        uint256 nonce,
        bytes calldata curatorSig
    ) external returns (address market) {
        if (config.paused()) revert ProtocolPaused();
        // Approval kurator bukan bearer instrument: hanya creator yang disetujui yang boleh
        // memakainya. Tanpa ini, siapa pun yang mengintai mempool bisa memutar ulang payload
        // yang persis disetujui, membakar nonce sekali-pakai itu, dan membuat transaksi creator
        // sendiri revert `ApprovalAlreadyUsed` — DoS atas alur peluncuran terkurasi yang setiap
        // percobaan ulangnya menuntut tanda tangan kurator baru.
        if (msg.sender != p.creator) revert NotCreator();
        // Diperiksa DI SINI, sebelum satu pun panggilan keluar. Market.initialize memeriksanya
        // lagi di ujung, tapi menunda pemeriksaan sampai ke sana berarti factory memanggil
        // `safeTransferFrom` pada alamat pilihan pemanggil sementara `usedApprovals`, `isMarket`,
        // dan `_markets` sudah tertulis. Biayanya satu SLOAD; imbalannya nol panggilan sewenang.
        if (!config.allowedCollateral(p.collateral)) revert CollateralNotAllowed();

        bytes32 digest = _approvalDigest(p, seedTokens, depositTokens, nonce);
        if (usedApprovals[digest]) revert ApprovalAlreadyUsed();
        // Digest EIP-712 sudah mengikat chainId DAN alamat factory ini, jadi satu approval
        // tidak bisa dipindah ke chain lain atau ke factory lain. `ECDSA.recover` di sini
        // sengaja varian yang REVERT untuk tanda tangan cacat, bukan `tryRecover`: ia tidak
        // pernah mengembalikan address(0), sehingga CURATOR_SIGNER yang belum disetel
        // (address(0)) tidak bisa dicocokkan oleh tanda tangan apa pun.
        if (ECDSA.recover(digest, curatorSig) != config.addresses(ConfigKeys.CURATOR_SIGNER)) {
            revert BadCuratorSignature();
        }
        usedApprovals[digest] = true;

        // Penjaga KETIGA atas invarian yang sama (dua lainnya di `initialize` dan
        // `setMarketImplementation`), dan yang ini tidak redundan: kontrak ini UUPS, jadi upgrade
        // yang menggeser layout storage bisa meninggalkan slot ini berisi sampah tanpa pernah
        // melewati kedua setter itu. Satu EXTCODESIZE dingin (~2600 gas atas operasi ~800k)
        // mengubah kehilangan dana pengguna yang senyap menjadi revert.
        address impl = marketImplementation;
        _requireContract(impl);

        market = Clones.clone(impl);
        // Registrasi mendahului initialize sebagai sikap DEFENSIF, bukan karena initialize
        // membutuhkannya: `Market.initialize` tidak pernah menyentuh OutcomeShares (ia murni
        // menulis storage). Yang membutuhkannya adalah setiap trade sesudahnya — jadi urutan ini
        // menjaga agar tidak ada jendela di mana market sudah hidup tapi belum terdaftar,
        // seandainya initialize suatu saat ikut mencetak sesuatu.
        isMarket[market] = true;
        _markets.push(market);

        IERC20(p.collateral).safeTransferFrom(msg.sender, market, seedTokens + depositTokens);
        Market(market).initialize(address(config), address(shares), p, seedTokens, depositTokens);

        emit MarketCreated(market, p.creator, p.creatorAgentId, p.specRoot, seedTokens, p.tier);
    }

    function marketCount() external view returns (uint256) {
        return _markets.length;
    }

    function marketAt(uint256 index) external view returns (address) {
        return _markets[index];
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
