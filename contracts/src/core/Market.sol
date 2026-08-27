// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {DPMMath} from "../math/DPMMath.sol";
import {ConfigRegistry} from "./ConfigRegistry.sol";
import {ConfigKeys} from "./ConfigKeys.sol";
import {OutcomeShares} from "./OutcomeShares.sol";
import {IMarket} from "../interfaces/IMarket.sol";

/// @title Market
/// @notice Satu market prediksi biner bermesin DPM. Clone EIP-1167, IMMUTABLE:
///         kontrak ini memegang dana pengguna dan karena itu tidak pernah upgradeable.
/// @dev Invarian pusat: `poolWad == DPMMath.costUp(_q)` pada setiap batas transaksi.
///      Ditegakkan by construction — pool DISETEL ke target, tidak pernah diakumulasi:
///
///        target      = costUp(qBaru)
///        biaya beli  = target - poolWad
///        hasil jual  = poolWad - target
///        poolWad     = target
///
///      Setiap debu pembulatan karenanya tertinggal DI DALAM pool.
contract Market is IMarket, Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── konfigurasi, dipotret saat initialize ────────────────────────────────
    ConfigRegistry public config;
    OutcomeShares public shares;
    IERC20 public collateral;
    uint256 public scale; // 10 ** (18 - desimal collateral)
    address public creator;
    uint256 public creatorAgentId;
    uint64 public tradingEnd;
    uint64 public settlementDeadline;
    uint8 public tier;
    bytes32 public specRoot;
    bytes32 public category;

    /// @dev Dipotret, bukan dibaca ulang: market yang sudah hidup tidak boleh berubah
    ///      aturannya di tengah jalan hanya karena tata kelola menyetel ulang parameter.
    uint16 public feeBps;
    uint256 public minTradeTokens;

    // ── state ────────────────────────────────────────────────────────────────
    uint256[2] internal _q;
    uint256[2] internal _seedSupply;
    uint256[2] internal _creatorSeed;
    mapping(address => uint256[2]) internal _seedShares;

    uint256 public poolWad;
    uint256 public feeAccrued; // satuan token
    uint256 public settlementDeposit; // satuan token

    Status public status;
    uint8 public winningOutcome;
    uint64 public resolvedAt;
    uint256 public payoutPerShareWad;
    uint256[2] internal _liqPerShareWad;

    error CollateralNotAllowed();
    error UnsupportedDecimals();
    error SeedTooSmall();
    error DepositTooSmall();
    error BadDeadlines();
    error CollateralNotReceived();
    error BadOutcome();
    error ZeroAmount();
    error NotOpen();
    error TradingEnded();
    error ProtocolPaused();
    error TradeTooSmall();
    error SlippageExceeded(uint256 actual, uint256 limit);
    error SeedFloorBreached();

    constructor() {
        _disableInitializers();
    }

    function initialize(address config_, address shares_, Params calldata p, uint256 seedTokens, uint256 depositTokens)
        external
        initializer
    {
        config = ConfigRegistry(config_);
        shares = OutcomeShares(shares_);

        if (!config.allowedCollateral(p.collateral)) revert CollateralNotAllowed();
        if (p.tradingEnd <= block.timestamp || p.settlementDeadline <= p.tradingEnd) revert BadDeadlines();
        if (seedTokens < config.params(ConfigKeys.MIN_SEED)) revert SeedTooSmall();
        if (depositTokens < config.params(ConfigKeys.MIN_SETTLEMENT_DEPOSIT)) revert DepositTooSmall();

        uint8 dec = IERC20Metadata(p.collateral).decimals();
        if (dec > 18) revert UnsupportedDecimals();

        collateral = IERC20(p.collateral);
        scale = 10 ** (18 - dec);
        creator = p.creator;
        creatorAgentId = p.creatorAgentId;
        tradingEnd = p.tradingEnd;
        settlementDeadline = p.settlementDeadline;
        tier = p.tier;
        specRoot = p.specRoot;
        category = p.category;

        feeBps = uint16(config.params(ConfigKeys.FEE_BPS));
        minTradeTokens = config.params(ConfigKeys.MIN_TRADE_TOKENS);
        settlementDeposit = depositTokens;

        // Factory mentransfer collateral MASUK sebelum memanggil initialize.
        if (collateral.balanceOf(address(this)) < seedTokens + depositTokens) revert CollateralNotReceived();

        uint256 seedWad = seedTokens * scale;
        uint256 s = DPMMath.seedShares(seedWad);
        if (s == 0) revert SeedTooSmall();

        _q[0] = s;
        _q[1] = s;
        _seedSupply[0] = s;
        _seedSupply[1] = s;
        _creatorSeed[0] = s;
        _creatorSeed[1] = s;
        _seedShares[p.creator][0] = s;
        _seedShares[p.creator][1] = s;

        poolWad = DPMMath.costUp(_q); // ≤ seedWad menurut konstruksi seedShares
        status = Status.Open;

        emit StatusChanged(Status.Open, Status.Open);
        emit LiquidityChanged(p.creator, int256(DPMMath.WAD), seedTokens, _q);
    }

    // ── view ─────────────────────────────────────────────────────────────────

    function qArray() external view returns (uint256[2] memory) {
        return _q;
    }

    function seedSupply() external view returns (uint256[2] memory) {
        return _seedSupply;
    }

    function creatorSeed() external view returns (uint256[2] memory) {
        return _creatorSeed;
    }

    function seedSharesOf(address account) external view returns (uint256[2] memory) {
        return _seedShares[account];
    }

    function liqPerShare() external view returns (uint256[2] memory) {
        return _liqPerShareWad;
    }

    function probability(uint8 outcome) external view returns (uint256) {
        return DPMMath.probability(_q, outcome);
    }

    function marginalPrice(uint8 outcome) external view returns (uint256) {
        return DPMMath.price(_q, outcome);
    }

    /// @notice Collateral minimum yang harus dipegang kontrak agar tetap solven.
    function collateralOwed() public view returns (uint256) {
        return Math.ceilDiv(poolWad, scale) + feeAccrued + settlementDeposit;
    }

    // ── penjaga bersama ──────────────────────────────────────────────────────

    /// @dev Jalur MASUK: dihentikan oleh pause global.
    function _requireTradable() internal view {
        if (status != Status.Open) revert NotOpen();
        if (block.timestamp >= tradingEnd) revert TradingEnded();
        if (config.paused()) revert ProtocolPaused();
    }

    /// @dev Jalur KELUAR: sengaja TIDAK memeriksa pause. Pengguna harus selalu bisa keluar.
    function _requireExitable() internal view {
        if (status != Status.Open) revert NotOpen();
        if (block.timestamp >= tradingEnd) revert TradingEnded();
    }

    // ── beli ─────────────────────────────────────────────────────────────────

    function quoteBuy(uint8 outcome, uint256 sharesOut) public view returns (uint256 tokensIn, uint256 fee) {
        if (outcome > 1) revert BadOutcome();
        if (sharesOut == 0) revert ZeroAmount();
        uint256[2] memory qNew = _q;
        qNew[outcome] += sharesOut;
        uint256 costTokens = Math.ceilDiv(DPMMath.costUp(qNew) - poolWad, scale);
        fee = (costTokens * feeBps) / 10_000;
        tokensIn = costTokens + fee;
    }

    /// @notice Taksiran lembar yang didapat untuk `tokensIn` (agent berpikir dalam nominal).
    /// @dev Dibulatkan ke bawah dan tidak otoritatif — `buy` menghitung ulang biaya
    ///      sebenarnya, dan pemanggil melindungi diri lewat `maxTokensIn`.
    function quoteBuySpend(uint8 outcome, uint256 tokensIn) public view returns (uint256 sharesOut, uint256 fee) {
        if (outcome > 1) revert BadOutcome();
        fee = (tokensIn * feeBps) / (10_000 + feeBps);
        uint256 spendWad = (tokensIn - fee) * scale;
        if (spendWad == 0) return (0, fee);
        sharesOut = DPMMath.sharesForSpend(_q, outcome, spendWad);
    }

    /// @dev Pemakaian pertama `nonReentrant` di kontrak ini. Aman di atas clone EIP-1167
    ///      walau constructor yang menyetel `_status = NOT_ENTERED` tidak pernah berjalan:
    ///      guard OpenZeppelin membandingkan `_status == ENTERED`, bukan `_status == NOT_ENTERED`,
    ///      jadi slot storage nol bawaan clone sudah berperilaku seperti NOT_ENTERED sejak
    ///      panggilan pertama yang dijaga.
    function buy(uint8 outcome, uint256 sharesOut, uint256 maxTokensIn, address to)
        external
        nonReentrant
        returns (uint256 tokensIn)
    {
        _requireTradable();
        if (outcome > 1) revert BadOutcome();
        if (sharesOut == 0) revert ZeroAmount();

        uint256[2] memory qNew = _q;
        qNew[outcome] += sharesOut;

        uint256 target = DPMMath.costUp(qNew); // revert bila melampaui MAX_Q
        uint256 costTokens = Math.ceilDiv(target - poolWad, scale);
        if (costTokens < minTradeTokens) revert TradeTooSmall();

        uint256 fee = (costTokens * feeBps) / 10_000;
        tokensIn = costTokens + fee;
        if (tokensIn > maxTokensIn) revert SlippageExceeded(tokensIn, maxTokensIn);

        // Efek sebelum interaksi: mint ERC-1155 memanggil balik `to`.
        _q = qNew;
        poolWad = target;
        feeAccrued += fee;

        collateral.safeTransferFrom(msg.sender, address(this), tokensIn);
        shares.mint(to, outcome, sharesOut);

        uint256 probAfter = DPMMath.probability(qNew, outcome);
        emit Trade(msg.sender, to, outcome, int256(sharesOut), tokensIn, fee, qNew, probAfter);
    }
}
