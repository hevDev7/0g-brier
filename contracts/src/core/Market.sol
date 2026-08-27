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
    error BadLambda();
    error InsufficientSeedShares();
    error CreatorSeedFloor();

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

    /// @dev Satu-satunya tempat rumus harga beli ditulis — dipakai `quoteBuy` DAN `buy` supaya
    ///      keduanya tak bisa diam-diam berbeda formula (kuotasi yang berbohong soal biaya
    ///      sungguhan). Murni kalkulasi: guard (`BadOutcome`/`ZeroAmount`) tetap di pemanggil,
    ///      bukan di sini, karena `outcome` dipakai sebagai indeks array sebelum tervalidasi.
    ///      `buy` memakai `target` untuk menyetel `poolWad`; `quoteBuy` mengabaikannya.
    function _priceBuy(uint8 outcome, uint256 sharesOut)
        internal
        view
        returns (uint256 target, uint256 costTokens, uint256 fee, uint256 tokensIn)
    {
        uint256[2] memory qNew = _q;
        qNew[outcome] += sharesOut;
        target = DPMMath.costUp(qNew); // revert bila melampaui MAX_Q
        costTokens = Math.ceilDiv(target - poolWad, scale);
        fee = (costTokens * feeBps) / 10_000;
        tokensIn = costTokens + fee;
    }

    function quoteBuy(uint8 outcome, uint256 sharesOut) public view returns (uint256 tokensIn, uint256 fee) {
        if (outcome > 1) revert BadOutcome();
        if (sharesOut == 0) revert ZeroAmount();
        (,, fee, tokensIn) = _priceBuy(outcome, sharesOut);
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

        uint256 target;
        uint256 costTokens;
        uint256 fee;
        (target, costTokens, fee, tokensIn) = _priceBuy(outcome, sharesOut);
        if (costTokens < minTradeTokens) revert TradeTooSmall();
        if (tokensIn > maxTokensIn) revert SlippageExceeded(tokensIn, maxTokensIn);

        uint256[2] memory qNew = _q;
        qNew[outcome] += sharesOut;

        // Efek sebelum interaksi: mint ERC-1155 memanggil balik `to`.
        _q = qNew;
        poolWad = target;
        feeAccrued += fee;

        collateral.safeTransferFrom(msg.sender, address(this), tokensIn);
        shares.mint(to, outcome, sharesOut);

        uint256 probAfter = DPMMath.probability(qNew, outcome);
        emit Trade(msg.sender, to, outcome, int256(sharesOut), tokensIn, fee, qNew, probAfter);
    }

    // ── jual ─────────────────────────────────────────────────────────────────

    /// @dev Analog `_priceBuy`: satu-satunya tempat rumus harga jual ditulis — dipakai
    ///      `quoteSell` DAN `sell` supaya keduanya tak bisa diam-diam berbeda formula. Murni
    ///      kalkulasi: guard (`BadOutcome`/`ZeroAmount`) tetap di pemanggil, bukan di sini,
    ///      persis seperti `_priceBuy`, karena `outcome` dipakai sebagai indeks array sebelum
    ///      tervalidasi. Pemeriksaan lantai benih (`SeedFloorBreached`) JUGA sengaja tetap di
    ///      pemanggil (`sell`), bukan di sini: `quoteSell` adalah kuotasi, bukan otoritas, jadi
    ///      boleh menunjukkan angka mentah walau `sharesIn` menembus benih; hanya eksekusi
    ///      sungguhan yang menolaknya, dan urutan pemeriksaannya penting — lihat komentar di
    ///      `sell`. `sell` memakai `target` untuk menyetel `poolWad`; `quoteSell` mengabaikannya.
    function _priceSell(uint8 outcome, uint256 sharesIn)
        internal
        view
        returns (uint256 target, uint256 grossTokens, uint256 fee, uint256 tokensOut)
    {
        uint256[2] memory qNew = _q;
        qNew[outcome] -= sharesIn; // underflow revert bila melampaui pasokan
        target = DPMMath.costUp(qNew);
        grossTokens = (poolWad - target) / scale; // floor: sisa debu tinggal di pool
        fee = (grossTokens * feeBps) / 10_000;
        tokensOut = grossTokens - fee;
    }

    function quoteSell(uint8 outcome, uint256 sharesIn) public view returns (uint256 tokensOut, uint256 fee) {
        if (outcome > 1) revert BadOutcome();
        if (sharesIn == 0) revert ZeroAmount();
        (,, fee, tokensOut) = _priceSell(outcome, sharesIn);
    }

    function sell(uint8 outcome, uint256 sharesIn, uint256 minTokensOut, address to)
        external
        nonReentrant
        returns (uint256 tokensOut)
    {
        _requireExitable(); // sengaja tanpa pemeriksaan pause
        if (outcome > 1) revert BadOutcome();
        if (sharesIn == 0) revert ZeroAmount();

        uint256[2] memory qNew = _q;
        qNew[outcome] -= sharesIn; // underflow revert bila melampaui pasokan

        // Lantai benih: dicek di sini, SEBELUM memanggil `_priceSell`, bukan di dalamnya —
        // supaya selalu mendahului pemeriksaan debu/slippage. Urutan ini bukan kosmetik: untuk
        // outcome yang pasokan tradable-nya kecil atau nol, oversell yang menabrak lantai benih
        // sering JUGA jatuh di bawah MIN_TRADE_TOKENS (lihat `test_creatorCannotSellSeedShares`),
        // dan tanpa urutan ini `TradeTooSmall` akan menutupi sebab revert yang sebenarnya.
        //
        // Bukan sekadar jaring pengaman teoretis — check ini independen dari `shares.burn` di
        // bawah (ia membaca akunting pool sendiri, `_q` vs `_seedSupply`, bukan saldo ERC-1155),
        // dan TEREKSEKUSI sungguhan setiap kali `sharesIn` melampaui seluruh pasokan tradable
        // outcome ini (lihat `test_cannotSellMoreThanOwned`, `test_creatorCannotSellSeedShares`).
        // Lembar seed memang bukan ERC-1155 hari ini — saldo gabungan seluruh pemegang tak
        // pernah melebihi `_q[outcome] - _seedSupply[outcome]`, jadi `burn` di bawah AKAN JUGA
        // menolak oversell sebesar ini seandainya baris ini dihapus — tapi dipertahankan sebagai
        // pernyataan independen: bila suatu saat lembar seed ikut dicetak sebagai ERC-1155 oleh
        // perubahan di masa depan, jalur inilah yang tetap menangkapnya, terlepas dari burn.
        if (qNew[outcome] < _seedSupply[outcome]) revert SeedFloorBreached();

        uint256 target;
        uint256 grossTokens;
        uint256 fee;
        (target, grossTokens, fee, tokensOut) = _priceSell(outcome, sharesIn);
        if (grossTokens < minTradeTokens) revert TradeTooSmall();
        if (tokensOut < minTokensOut) revert SlippageExceeded(tokensOut, minTokensOut);

        // Efek sebelum interaksi: burn ERC-1155 memanggil balik `msg.sender`.
        _q = qNew;
        poolWad = target;
        feeAccrued += fee;

        shares.burn(msg.sender, outcome, sharesIn);
        collateral.safeTransfer(to, tokensOut);

        uint256 probAfter = DPMMath.probability(qNew, outcome);
        emit Trade(msg.sender, to, outcome, -int256(sharesIn), tokensOut, fee, qNew, probAfter);
    }

    // ── likuiditas ───────────────────────────────────────────────────────────

    /// @notice Menambah likuiditas secara proporsional. Tanpa fee: ini bukan
    ///         perdagangan berarah, melainkan penskalaan seluruh market.
    function addLiquidity(uint256 tokensIn, uint256 minSharesOut, address to)
        external
        nonReentrant
        returns (uint256[2] memory minted)
    {
        _requireTradable();
        if (tokensIn == 0) revert ZeroAmount();

        uint256 amountWad = tokensIn * scale;
        uint256 lambdaWad = Math.mulDiv(amountWad, DPMMath.WAD, poolWad);
        if (lambdaWad == 0) revert TradeTooSmall();

        minted[0] = Math.mulDiv(_q[0], lambdaWad, DPMMath.WAD);
        minted[1] = Math.mulDiv(_q[1], lambdaWad, DPMMath.WAD);
        if (minted[0] == 0 || minted[1] == 0) revert TradeTooSmall();

        uint256 smaller = Math.min(minted[0], minted[1]);
        if (smaller < minSharesOut) revert SlippageExceeded(smaller, minSharesOut);

        uint256[2] memory qNew;
        qNew[0] = _q[0] + minted[0];
        qNew[1] = _q[1] + minted[1];

        uint256 target = DPMMath.costUp(qNew);
        uint256 needTokens = Math.ceilDiv(target - poolWad, scale);
        // Terbukti ≤ tokensIn (lihat rencana Task 14); dipertahankan sebagai penjaga eksplisit.
        if (needTokens > tokensIn) revert TradeTooSmall();

        _q = qNew;
        _seedSupply[0] += minted[0];
        _seedSupply[1] += minted[1];
        _seedShares[to][0] += minted[0];
        _seedShares[to][1] += minted[1];
        poolWad = target;

        collateral.safeTransferFrom(msg.sender, address(this), needTokens);
        emit LiquidityChanged(to, int256(lambdaWad), needTokens, qNew);
    }

    /// @notice Menarik likuiditas secara proporsional terhadap `q` SAAT INI.
    /// @param lambdaWad fraksi wad dari q yang ditarik (0 < λ ≤ WAD).
    /// @dev Penarikan tak-proporsional dilarang: itu akan menjadi perdagangan berarah
    ///      tanpa fee. Seed creator tidak pernah bisa ditarik — lantai inilah yang
    ///      menjamin qᵢ > 0 sampai settlement.
    function removeLiquidity(uint256 lambdaWad, uint256 minTokensOut, address to)
        external
        nonReentrant
        returns (uint256 tokensOut)
    {
        _requireExitable(); // sengaja tanpa pemeriksaan pause
        if (lambdaWad == 0 || lambdaWad > DPMMath.WAD) revert BadLambda();

        uint256[2] memory take;
        take[0] = Math.mulDiv(_q[0], lambdaWad, DPMMath.WAD);
        take[1] = Math.mulDiv(_q[1], lambdaWad, DPMMath.WAD);
        if (take[0] == 0 || take[1] == 0) revert TradeTooSmall();

        uint256[2] memory held = _seedShares[msg.sender];
        if (held[0] < take[0] || held[1] < take[1]) revert InsufficientSeedShares();
        if (_seedSupply[0] - take[0] < _creatorSeed[0] || _seedSupply[1] - take[1] < _creatorSeed[1]) {
            revert CreatorSeedFloor();
        }

        uint256[2] memory qNew;
        qNew[0] = _q[0] - take[0];
        qNew[1] = _q[1] - take[1];

        uint256 target = DPMMath.costUp(qNew);
        tokensOut = (poolWad - target) / scale;
        if (tokensOut < minTokensOut) revert SlippageExceeded(tokensOut, minTokensOut);

        _q = qNew;
        _seedSupply[0] -= take[0];
        _seedSupply[1] -= take[1];
        _seedShares[msg.sender][0] -= take[0];
        _seedShares[msg.sender][1] -= take[1];
        poolWad = target;

        collateral.safeTransfer(to, tokensOut);
        emit LiquidityChanged(msg.sender, -int256(lambdaWad), tokensOut, qNew);
    }
}
