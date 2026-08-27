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
/// @notice A single DPM-driven binary prediction market. An EIP-1167 clone, IMMUTABLE:
///         this contract holds user funds and is therefore never upgradeable.
/// @dev The central invariant: `poolWad == DPMMath.costUp(_q)` at every transaction boundary.
///      Enforced by construction — the pool is SET to a target, never accumulated:
///
///        target     = costUp(qNew)
///        buy cost   = target - poolWad
///        sell take  = poolWad - target
///        poolWad    = target
///
///      Every speck of rounding dust is therefore left INSIDE the pool.
contract Market is IMarket, Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── configuration, snapshotted at initialize ─────────────────────────────
    ConfigRegistry public config;
    OutcomeShares public shares;
    IERC20 public collateral;
    uint256 public scale; // 10 ** (18 - collateral decimals)
    address public creator;
    uint256 public creatorAgentId;
    uint64 public tradingEnd;
    uint64 public settlementDeadline;
    uint8 public tier;
    bytes32 public specRoot;
    bytes32 public category;

    /// @dev Snapshotted, not re-read: a market that is already live must not have its rules
    ///      change mid-flight just because governance reset a parameter.
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
    uint256 public feeAccrued; // token units
    uint256 public settlementDeposit; // token units

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
        // Each key is bounded individually by ConfigRegistry ([0, 10_000] apiece), but there
        // is no cross-check there — the two can sum to > 10_000 while each is valid on its
        // own. Checked here, at birth, because a failure at settle/fail/void (a built-in
        // Panic from the underflow in `_distributeFees`) would freeze EVERY market using
        // this ConfigRegistry, not just one.
        if (uint256(creatorFeeShareBps) + uint256(resolverFeeShareBps) > 10_000) {
            revert FeeSharesExceedTotal(creatorFeeShareBps, resolverFeeShareBps);
        }
        settlementDeposit = depositTokens;

        // The factory transfers the collateral IN before calling initialize.
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

        poolWad = DPMMath.costUp(_q); // ≤ seedWad by construction of seedShares
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

    /// @notice The minimum collateral this contract must hold to stay solvent.
    function collateralOwed() public view returns (uint256) {
        return Math.ceilDiv(poolWad, scale) + feeAccrued + settlementDeposit;
    }

    // ── shared guards ────────────────────────────────────────────────────────

    /// @dev ENTRY path: halted by the global pause.
    function _requireTradable() internal view {
        if (status != Status.Open) revert NotOpen();
        if (block.timestamp >= tradingEnd) revert TradingEnded();
        if (config.paused()) revert ProtocolPaused();
    }

    /// @dev EXIT path: deliberately does NOT check the pause. A user must always be able to exit.
    function _requireExitable() internal view {
        if (status != Status.Open) revert NotOpen();
        if (block.timestamp >= tradingEnd) revert TradingEnded();
    }

    // ── buy ──────────────────────────────────────────────────────────────────

    /// @dev The one place the buy price formula is written — used by `quoteBuy` AND `buy` so the
    ///      two cannot silently diverge (a quote that lies about the real cost). Pure
    ///      calculation: the guards (`BadOutcome`/`ZeroAmount`) stay in the caller, not here,
    ///      because `outcome` is used as an array index before it has been validated.
    ///      `buy` uses `target` to set `poolWad`; `quoteBuy` ignores it.
    function _priceBuy(uint8 outcome, uint256 sharesOut)
        internal
        view
        returns (uint256 target, uint256 costTokens, uint256 fee, uint256 tokensIn)
    {
        uint256[2] memory qNew = _q;
        qNew[outcome] += sharesOut;
        target = DPMMath.costUp(qNew); // reverts if it exceeds MAX_Q
        costTokens = Math.ceilDiv(target - poolWad, scale);
        fee = (costTokens * feeBps) / 10_000;
        tokensIn = costTokens + fee;
    }

    function quoteBuy(uint8 outcome, uint256 sharesOut) public view returns (uint256 tokensIn, uint256 fee) {
        if (outcome > 1) revert BadOutcome();
        if (sharesOut == 0) revert ZeroAmount();
        (,, fee, tokensIn) = _priceBuy(outcome, sharesOut);
    }

    /// @notice An estimate of the shares obtained for `tokensIn` (agents think in notional).
    /// @dev Rounded down and not authoritative — `buy` recomputes the real cost, and the
    ///      caller protects itself with `maxTokensIn`.
    function quoteBuySpend(uint8 outcome, uint256 tokensIn) public view returns (uint256 sharesOut, uint256 fee) {
        if (outcome > 1) revert BadOutcome();
        fee = (tokensIn * feeBps) / (10_000 + feeBps);
        uint256 spendWad = (tokensIn - fee) * scale;
        if (spendWad == 0) return (0, fee);
        sharesOut = DPMMath.sharesForSpend(_q, outcome, spendWad);
    }

    /// @dev The first use of `nonReentrant` in this contract. Safe on top of an EIP-1167 clone
    ///      even though the constructor that sets `_status = NOT_ENTERED` never runs: the
    ///      OpenZeppelin guard compares `_status == ENTERED`, not `_status == NOT_ENTERED`, so
    ///      a clone's default zero storage slot already behaves as NOT_ENTERED from the first
    ///      guarded call onward.
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

        // Effects before interactions: the ERC-1155 mint calls back into `to`.
        _q = qNew;
        poolWad = target;
        feeAccrued += fee;

        collateral.safeTransferFrom(msg.sender, address(this), tokensIn);
        shares.mint(to, outcome, sharesOut);

        uint256 probAfter = DPMMath.probability(qNew, outcome);
        emit Trade(msg.sender, to, outcome, int256(sharesOut), tokensIn, fee, qNew, probAfter);
    }

    // ── sell ─────────────────────────────────────────────────────────────────

    /// @dev The analogue of `_priceBuy`: the one place the sell price formula is written — used
    ///      by `quoteSell` AND `sell` so the two cannot silently diverge. Pure calculation: the
    ///      guards (`BadOutcome`/`ZeroAmount`) stay in the caller, not here, exactly as in
    ///      `_priceBuy`, because `outcome` is used as an array index before it has been
    ///      validated. The seed floor check (`SeedFloorBreached`) ALSO stays deliberately in the
    ///      caller (`sell`), not here: `quoteSell` is a quote, not the authority, so it may show
    ///      the raw number even when `sharesIn` cuts into the seed; only real execution rejects
    ///      it, and the order of the checks matters — see the comment in `sell`. `sell` uses
    ///      `target` to set `poolWad`; `quoteSell` ignores it.
    function _priceSell(uint8 outcome, uint256 sharesIn)
        internal
        view
        returns (uint256 target, uint256 grossTokens, uint256 fee, uint256 tokensOut)
    {
        uint256[2] memory qNew = _q;
        qNew[outcome] -= sharesIn; // underflow reverts if it exceeds supply
        target = DPMMath.costUp(qNew);
        grossTokens = (poolWad - target) / scale; // floor: the leftover dust stays in the pool
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
        _requireExitable(); // deliberately no pause check
        if (outcome > 1) revert BadOutcome();
        if (sharesIn == 0) revert ZeroAmount();

        uint256[2] memory qNew = _q;
        qNew[outcome] -= sharesIn; // underflow reverts if it exceeds supply

        // Seed floor: checked here, BEFORE calling `_priceSell` rather than inside it — so that
        // it always precedes the dust/slippage checks. This ordering is not cosmetic: for an
        // outcome whose tradable supply is small or zero, an oversell that hits the seed floor
        // often ALSO falls below MIN_TRADE_TOKENS (see `test_creatorCannotSellSeedShares`), and
        // without this ordering `TradeTooSmall` would mask the real cause of the revert.
        //
        // Not merely a theoretical safety net — this check is independent of the `shares.burn`
        // below (it reads the pool's own accounting, `_q` vs `_seedSupply`, not ERC-1155
        // balances), and it really DOES execute whenever `sharesIn` exceeds this outcome's whole
        // tradable supply (see `test_cannotSellMoreThanOwned`, `test_creatorCannotSellSeedShares`).
        // Seed shares are indeed not ERC-1155 today — the combined balance of every holder never
        // exceeds `_q[outcome] - _seedSupply[outcome]`, so the `burn` below WOULD ALSO reject an
        // oversell of this size were this line removed — but it is kept as an independent
        // statement: should seed shares one day also be minted as ERC-1155 by a future change,
        // this is the path that still catches it, regardless of the burn.
        if (qNew[outcome] < _seedSupply[outcome]) revert SeedFloorBreached();

        uint256 target;
        uint256 grossTokens;
        uint256 fee;
        (target, grossTokens, fee, tokensOut) = _priceSell(outcome, sharesIn);
        if (grossTokens < minTradeTokens) revert TradeTooSmall();
        if (tokensOut < minTokensOut) revert SlippageExceeded(tokensOut, minTokensOut);

        // Effects before interactions: the ERC-1155 burn calls back into `msg.sender`.
        _q = qNew;
        poolWad = target;
        feeAccrued += fee;

        shares.burn(msg.sender, outcome, sharesIn);
        collateral.safeTransfer(to, tokensOut);

        uint256 probAfter = DPMMath.probability(qNew, outcome);
        emit Trade(msg.sender, to, outcome, -int256(sharesIn), tokensOut, fee, qNew, probAfter);
    }

    // ── liquidity ────────────────────────────────────────────────────────────

    /// @notice Adds liquidity proportionally. No fee: this is not a directional trade but a
    ///         scaling of the whole market.
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
        // Proven ≤ tokensIn (see the Task 14 plan); kept as an explicit guard.
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

    /// @notice Withdraws liquidity proportionally to the CURRENT `q`.
    /// @param lambdaWad the wad fraction of q being withdrawn (0 < λ ≤ WAD).
    /// @dev Non-proportional withdrawal is forbidden: it would amount to a directional trade
    ///      with no fee. The creator's seed can never be withdrawn — that floor is what
    ///      guarantees qᵢ > 0 until settlement.
    function removeLiquidity(uint256 lambdaWad, uint256 minTokensOut, address to)
        external
        nonReentrant
        returns (uint256 tokensOut)
    {
        _requireExitable(); // deliberately no pause check
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

    // ── lifecycle ────────────────────────────────────────────────────────────

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

    /// @dev The payout rate is SNAPSHOTTED here so that the first and the last redeemer
    ///      receive the same rate. `_q[outcome]` is guaranteed > 0 by the creator seed floor.
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

    /// @notice No outcome could be established → every party is liquidated at pᵢ.
    function fail() external {
        bool byModule = msg.sender == config.addresses(ConfigKeys.RESOLUTION_MODULE);
        bool pastDeadline = block.timestamp >= settlementDeadline;
        if (!byModule && !pastDeadline) revert BadTransition();
        if (status == Status.Settled || status == Status.Failed || status == Status.Voided) revert BadTransition();

        _snapshotLiquidation();
        _setStatus(Status.Failed);
        _distributeFees(false);
    }

    /// @notice Emergency cancellation by the guardian, only before the market closes.
    ///         The settlement deposit is SLASHED — that is what makes an abusive market
    ///         expensive.
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

    /// @param slashDeposit true on void — the deposit goes to the Treasury, not the resolver pool.
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

    // ── exit ─────────────────────────────────────────────────────────────────

    /// @notice Redeems winning-side shares at the rate snapshotted at settle.
    /// @dev Losing-side shares — tradable and seed alike — are worth nothing and are cleared.
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

    /// @notice The market failed or was voided: every side is paid pᵢ per share.
    /// @dev By the Euler identity Σ pᵢ·qᵢ = C(q), these payouts SHOULD exhaust the pool exactly
    ///      — but `price()` divides by a `cost()` rounded down while `poolWad` is a `costUp()`
    ///      rounded up (see the note in DPMMath.sol), so the sum of two legs EACH rounded down
    ///      can exceed poolWad even though the exact Euler identity equates them over the reals.
    ///      Without the clamp, `poolWad -= payoutWad` could underflow and lock user funds
    ///      permanently — so the payout is always trimmed to the pool that actually remains,
    ///      never assumed to fit.
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

        // The clamp is MANDATORY, not a defensive optimization: confirmed concretely at small q
        // (e.g. q=(2,2): the two floored legs sum to 4, poolWad=costUp([2,2])=3) that the sum
        // of two legs EACH rounded down can exceed poolWad even though the exact Euler identity
        // equates them over the reals (see the dev note above). That regime is unreachable
        // through a real protocol's MIN_SEED (opening q ~7e20), but a revert here means user
        // funds are locked PERMANENTLY — so it must not rest on "unreachable". Trimmed here,
        // BEFORE `tokensOut` is derived, so both the transfer and the pool decrement use the
        // clamped value; the rounding loss falls on the LAST redeemer at small q rather than
        // making them revert.
        if (payoutWad > poolWad) payoutWad = poolWad;

        tokensOut = payoutWad / scale;
        poolWad -= payoutWad;
        if (tokensOut > 0) collateral.safeTransfer(to, tokensOut);
        emit Liquidated(msg.sender, amounts, tokensOut);
    }

    /// @notice Sweeps whatever was never claimed to the Treasury after a long window.
    function sweepUnclaimed() external {
        if (status != Status.Settled && status != Status.Failed && status != Status.Voided) revert BadTransition();
        if (block.timestamp < resolvedAt + config.params(ConfigKeys.SWEEP_UNCLAIMED_AFTER)) revert TooEarly();

        uint256 bal = collateral.balanceOf(address(this));
        if (bal == 0) revert ZeroAmount();
        poolWad = 0;
        collateral.safeTransfer(config.addresses(ConfigKeys.TREASURY), bal);
    }
}
