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

    /// @dev Bidang yang ditandatangani adalah IDENTITAS market yang disetujui kurator.
    ///      Yang SENGAJA di luar tanda tangan dan karenanya dipilih pemanggil: `collateral`
    ///      (dibatasi allowlist ConfigRegistry, diperiksa Market.initialize) serta
    ///      `seedTokens`/`depositTokens` (dibatasi bawah oleh MIN_SEED dan
    ///      MIN_SETTLEMENT_DEPOSIT). Konsekuensinya, siapa pun yang memegang approval bisa
    ///      memakainya dengan seed seminimum mungkin — tapi ia membayar sendiri seluruh
    ///      seed itu sementara lembar seed-nya jatuh ke `p.creator` yang ditandatangani,
    ///      jadi biayanya ditanggung penyerang dan tidak ada dana yang berpindah salah alamat.
    bytes32 public constant MARKET_APPROVAL_TYPEHASH = keccak256(
        "MarketApproval(bytes32 specRoot,uint64 tradingEnd,uint64 settlementDeadline,uint8 tier,uint256 creatorAgentId,bytes32 category,address creator,uint256 nonce)"
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
        marketImplementation = impl;
        emit MarketImplementationSet(impl);
    }

    /// @notice Diekspos agar penanda tangan off-chain (agent Kurator) dapat menghitung
    ///         digest yang sama persis tanpa menebak domain separator.
    function hashTypedData(bytes32 structHash) external view returns (bytes32) {
        return _hashTypedDataV4(structHash);
    }

    function createMarket(
        IMarket.Params calldata p,
        uint256 seedTokens,
        uint256 depositTokens,
        uint256 nonce,
        bytes calldata curatorSig
    ) external returns (address market) {
        if (config.paused()) revert ProtocolPaused();

        bytes32 digest = _hashTypedDataV4(
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
                    nonce
                )
            )
        );
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

        market = Clones.clone(marketImplementation);
        // Registrasi HARUS mendahului initialize: Market memancarkan event dan,
        // sejak trade pertama, memanggil OutcomeShares yang menanyakan registry ini.
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
