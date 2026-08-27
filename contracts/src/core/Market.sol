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
    uint16 public creatorFeeShareBps;
    uint16 public resolverFeeShareBps;

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
    error FeeSharesExceedTotal(uint256 creator, uint256 resolver);
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
    error TradingNotEnded();
    error BadTransition();
    error NotResolutionModule();
    error NotGuardian();
    error NotSettled();
    error NotLiquidatable();
    error NothingToClaim();
    error TooEarly();

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
        creatorFeeShareBps = uint16(config.params(ConfigKeys.CREATOR_FEE_SHARE_BPS));
        resolverFeeShareBps = uint16(config.params(ConfigKeys.RESOLVER_FEE_SHARE_BPS));
        // Tiap kunci dibatasi individual oleh ConfigRegistry ([0, 10_000] masing-masing),
        // tapi tak ada pemeriksaan silang di sana — jumlah keduanya bisa > 10_000 walau
        // keduanya sah sendiri-sendiri. Diperiksa di sini, saat lahir, karena kegagalan di
        // settle/fail/void (Panic bawaan dari underflow `_distributeFees`) akan membekukan
        // SETIAP market yang memakai ConfigRegistry ini, bukan cuma satu.
        if (uint256(creatorFeeShareBps) + uint256(resolverFeeShareBps) > 10_000) {
            revert FeeSharesExceedTotal(creatorFeeShareBps, resolverFeeShareBps);
        }
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

    // ── siklus hidup ─────────────────────────────────────────────────────────

    modifier onlyResolutionModule() {
        if (msg.sender != config.addresses(ConfigKeys.RESOLUTION_MODULE)) revert NotResolutionModule();
        _;
    }

    function close() external {
        if (status != Status.Open) revert BadTransition();
        if (block.timestamp < tradingEnd) revert TradingNotEnded();
        _setStatus(Status.Closed);
    }

    function markProposed() external onlyResolutionModule {
        if (status != Status.Closed && status != Status.Disputed) revert BadTransition();
        _setStatus(Status.Proposed);
    }

    function markDisputed() external onlyResolutionModule {
        if (status != Status.Proposed) revert BadTransition();
        _setStatus(Status.Disputed);
    }

    /// @dev Kurs payout DIPOTRET di sini sehingga penebus pertama dan terakhir
    ///      menerima kurs yang sama. `_q[outcome]` dijamin > 0 oleh lantai seed creator.
    function settle(uint8 outcome) external onlyResolutionModule {
        if (status != Status.Closed && status != Status.Proposed && status != Status.Disputed) revert BadTransition();
        if (outcome > 1) revert BadOutcome();

        winningOutcome = outcome;
        resolvedAt = uint64(block.timestamp);
        payoutPerShareWad = Math.mulDiv(DPMMath.WAD, poolWad, _q[outcome]);

        _setStatus(Status.Settled);
        _distributeFees(false);
        emit Settled(outcome, payoutPerShareWad);
    }

    /// @notice Tidak ada outcome yang bisa ditetapkan → semua pihak dilikuidasi pada pᵢ.
    function fail() external {
        bool byModule = msg.sender == config.addresses(ConfigKeys.RESOLUTION_MODULE);
        bool pastDeadline = block.timestamp >= settlementDeadline;
        if (!byModule && !pastDeadline) revert BadTransition();
        if (status == Status.Settled || status == Status.Failed || status == Status.Voided) revert BadTransition();

        _snapshotLiquidation();
        _setStatus(Status.Failed);
        _distributeFees(false);
    }

    /// @notice Pembatalan darurat oleh guardian, hanya sebelum market ditutup.
    ///         Setoran settlement DISITA — inilah yang membuat market abusif mahal.
    function void(bytes32 reason) external {
        if (msg.sender != config.guardian()) revert NotGuardian();
        if (status != Status.Open) revert BadTransition();

        _snapshotLiquidation();
        _setStatus(Status.Voided);
        _distributeFees(true);
        emit MarketVoided(reason);
    }

    function _snapshotLiquidation() internal {
        resolvedAt = uint64(block.timestamp);
        _liqPerShareWad[0] = DPMMath.price(_q, 0);
        _liqPerShareWad[1] = DPMMath.price(_q, 1);
    }

    function _setStatus(Status next) internal {
        Status prev = status;
        status = next;
        emit StatusChanged(prev, next);
    }

    /// @param slashDeposit true saat void — setoran ke Treasury, bukan ke kas resolver.
    function _distributeFees(bool slashDeposit) internal {
        uint256 fees = feeAccrued;
        uint256 deposit = settlementDeposit;
        feeAccrued = 0;
        settlementDeposit = 0;
        if (fees == 0 && deposit == 0) return;

        address treasuryAddr = config.addresses(ConfigKeys.TREASURY);
        address resolverPool = config.addresses(ConfigKeys.RESOLUTION_MODULE);
        if (resolverPool == address(0)) resolverPool = treasuryAddr;

        uint256 toCreator = (fees * creatorFeeShareBps) / 10_000;
        uint256 resolverFee = (fees * resolverFeeShareBps) / 10_000;
        uint256 toResolvers = slashDeposit ? resolverFee : resolverFee + deposit;
        uint256 toTreasury = fees - toCreator - resolverFee + (slashDeposit ? deposit : 0);

        if (toCreator > 0) collateral.safeTransfer(creator, toCreator);
        if (toResolvers > 0) collateral.safeTransfer(resolverPool, toResolvers);
        if (toTreasury > 0) collateral.safeTransfer(treasuryAddr, toTreasury);
        emit FeesDistributed(toCreator, toResolvers, toTreasury);
    }

    // ── keluar ───────────────────────────────────────────────────────────────

    /// @notice Menebus lembar sisi menang pada kurs yang dipotret saat settle.
    /// @dev Lembar sisi kalah — tradable maupun seed — bernilai nol dan dihapus.
    function redeem(address to) external nonReentrant returns (uint256 tokensOut) {
        if (status != Status.Settled) revert NotSettled();

        uint8 w = winningOutcome;
        uint8 l = w == 0 ? 1 : 0;

        uint256 tradable = shares.balanceOfOutcome(msg.sender, address(this), w);
        uint256 seed = _seedShares[msg.sender][w];
        uint256 amount = tradable + seed;
        if (amount == 0) revert NothingToClaim();

        uint256 payoutWad = Math.mulDiv(amount, payoutPerShareWad, DPMMath.WAD);
        tokensOut = payoutWad / scale;

        _seedShares[msg.sender][w] = 0;
        _seedShares[msg.sender][l] = 0;
        poolWad -= payoutWad;

        if (tradable > 0) shares.burn(msg.sender, w, tradable);
        if (tokensOut > 0) collateral.safeTransfer(to, tokensOut);
        emit Redeemed(msg.sender, amount, tokensOut);
    }

    /// @notice Market gagal atau dibatalkan: setiap sisi dibayar pᵢ per lembar.
    /// @dev Menurut identitas Euler Σ pᵢ·qᵢ = C(q), pembayaran ini SEHARUSNYA persis
    ///      menghabiskan pool — tapi `price()` membagi dengan `cost()` yang dibulatkan ke
    ///      bawah sementara `poolWad` adalah `costUp()` yang dibulatkan ke atas (lihat catatan
    ///      di DPMMath.sol), jadi jumlah dua kaki yang MASING-MASING dibulatkan ke bawah bisa
    ///      melampaui poolWad walau identitas Euler eksak menyamakan keduanya secara real.
    ///      Tanpa clamp, `poolWad -= payoutWad` bisa underflow dan mengunci dana pengguna
    ///      permanen — jadi payout selalu dipotong ke sisa pool yang benar-benar ada, bukan
    ///      diasumsikan selalu pas.
    function liquidate(address to) external nonReentrant returns (uint256 tokensOut) {
        if (status != Status.Failed && status != Status.Voided) revert NotLiquidatable();

        uint256[2] memory amounts;
        uint256 payoutWad;
        for (uint8 i = 0; i < 2; ++i) {
            uint256 tradable = shares.balanceOfOutcome(msg.sender, address(this), i);
            uint256 seed = _seedShares[msg.sender][i];
            amounts[i] = tradable + seed;
            if (amounts[i] == 0) continue;

            payoutWad += Math.mulDiv(amounts[i], _liqPerShareWad[i], DPMMath.WAD);
            if (seed > 0) _seedShares[msg.sender][i] = 0;
            if (tradable > 0) shares.burn(msg.sender, i, tradable);
        }
        if (amounts[0] == 0 && amounts[1] == 0) revert NothingToClaim();

        // Clamp WAJIB, bukan optimisasi defensif: dikonfirmasi konkret pada q kecil (mis.
        // q=(2,2): dua kaki floor berjumlah 4, poolWad=costUp([2,2])=3) bahwa jumlah dua
        // kaki yang MASING-MASING dibulatkan ke bawah bisa melampaui poolWad walau identitas
        // Euler eksak menyamakan keduanya secara real (lihat dev-note di atas). Rezim ini
        // tak terjangkau lewat MIN_SEED protokol nyata (q awal ~7e20), tapi sebuah revert di
        // sini berarti dana pengguna terkunci PERMANEN — jadi tidak boleh bergantung pada
        // "tak terjangkau". Dipotong di sini, SEBELUM `tokensOut` diturunkan, supaya baik
        // transfer maupun pengurangan pool memakai nilai yang sudah diclamp; kerugian
        // pembulatan jatuh ke penebus TERAKHIR pada q kecil, bukan membuatnya revert.
        if (payoutWad > poolWad) payoutWad = poolWad;

        tokensOut = payoutWad / scale;
        poolWad -= payoutWad;
        if (tokensOut > 0) collateral.safeTransfer(to, tokensOut);
        emit Liquidated(msg.sender, amounts, tokensOut);
    }

    /// @notice Menyapu sisa yang tak pernah diklaim ke Treasury setelah jendela panjang.
    function sweepUnclaimed() external {
        if (status != Status.Settled && status != Status.Failed && status != Status.Voided) revert BadTransition();
        if (block.timestamp < resolvedAt + config.params(ConfigKeys.SWEEP_UNCLAIMED_AFTER)) revert TooEarly();

        uint256 bal = collateral.balanceOf(address(this));
        if (bal == 0) revert ZeroAmount();
        poolWad = 0;
        collateral.safeTransfer(config.addresses(ConfigKeys.TREASURY), bal);
    }
}
