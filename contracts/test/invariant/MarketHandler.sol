// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Market} from "../../src/core/Market.sol";
import {MockUSDC} from "../../src/mocks/MockUSDC.sol";
import {OutcomeShares} from "../../src/core/OutcomeShares.sol";
import {ConfigRegistry} from "../../src/core/ConfigRegistry.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";
import {DPMMath} from "../../src/math/DPMMath.sol";
import {IMarket} from "../../src/interfaces/IMarket.sol";
import {InvariantBounds} from "../helpers/InvariantBounds.sol";

/// @title MarketHandler
/// @notice Runs BOUNDED random actions against a single Market and records ghost variables
///         for the INV-1..10 conservation checks.
///
/// @dev Four design decisions that keep this suite from being decorative:
///
///      1. **Every action uses the contract's own QUOTE as its precondition.** `quoteBuy` and
///         `buy` share the same `_priceBuy` (as do `quoteSell`/`sell`), so the two cannot
///         differ in formula. If the quote passes, execution MUST land. Actions that clear
///         every precondition are counted in `gatedActions`; those that really land in
///         `landedActions`; the difference is recorded in `unexpectedReverts`, and
///         `invariant_handlerCallsLandAsPredicted` demands that difference be ZERO. A handler
///         that spends its run reverting is visible immediately rather than passing quietly.
///
///      2. **Sizes scale to the live state, not to constants.** A fixed buy/deposit range
///         becomes dust (always `TradeTooSmall`) on a large market and an extreme shock on a
///         small one; either way the run explores nothing.
///
///      3. **The handler NEVER asserts on its own.** `foundry.toml` uses
///         `fail_on_revert = false`; a failing `assert` inside the handler reverts and is then
///         SWALLOWED by the runner, and the run passes for the wrong reason (verified
///         experimentally before this file was written: 10 calls, 10 reverts, suite green).
///         Every violation is therefore written to a ghost counter (`inv5Violations`,
///         `inv9Violations`, `inv10Violations`, `pauseLeaks`, `sawArithmeticPanic`) and
///         asserted in `MarketInvariants.t.sol` through the `invariant_*` functions — a path
///         that CANNOT be swallowed.
///
///      4. **`creator` is not a trader.** It only deposits the symmetric seed at `initialize`
///         and claims at the end. INV-7 ("provider loss ≤ 29.30% of the deposit") holds only
///         for a SYMMETRIC provider — see the derivation in `MarketInvariants.t.sol` — so the
///         creator's position is deliberately kept exactly `(s, s)`, keeping the invariant
///         meaningful instead of polluted by directional trading or by an LP entering on a
///         skewed q.
contract MarketHandler is CommonBase, StdCheats, StdUtils {
    uint256 internal constant WAD = DPMMath.WAD;

    /// @dev The `Panic(uint256)` selector. Not a protocol magic number: it is a Solidity ABI constant.
    bytes4 internal constant PANIC_SELECTOR = 0x4e487b71;

    /// @dev Enough to fund the pool up to the MAX_Q limit (≈1.4e33 wad ≈ 1.4e21 token units).
    uint256 internal constant FUNDING = 1e30;

    Market public immutable market;
    MockUSDC public immutable usdc;
    OutcomeShares public immutable shares;
    ConfigRegistry public immutable config;

    address public immutable creator;
    address public immutable guardian;
    address public immutable resolutionModule;
    address public immutable configOwner;

    address[3] public traders;

    // ── counters for actions that ACTUALLY landed ────────────────────────────
    uint256 public callsBuy;
    uint256 public callsSell;
    uint256 public callsAddLiquidity;
    uint256 public callsRemoveLiquidity;
    uint256 public callsRoundTrip;
    uint256 public callsWarp;
    uint256 public callsPauseToggle;
    uint256 public callsPausedEntryBlocked;
    uint256 public callsPausedSell;
    uint256 public callsPausedRemoveLiquidity;
    uint256 public callsPausedRedeem;
    uint256 public callsPausedLiquidate;
    uint256 public callsClose;
    uint256 public callsPropose;
    uint256 public callsDispute;
    uint256 public callsSettle;
    uint256 public callsFail;
    uint256 public callsVoid;
    uint256 public callsRedeem;
    uint256 public callsLiquidate;
    /// @dev `fail()` taken through the PERMISSIONLESS branch (any caller, past the settlement
    ///      deadline) rather than through the resolution module. Counted separately because the
    ///      two are different authorisation paths through the same state transition.
    uint256 public callsFailPermissionless;
    uint256 public callsSweep;
    uint256 public callsPostSweepRejected;

    // ── handler efficiency accounting ────────────────────────────────────────
    uint256 public gatedActions;
    uint256 public landedActions;
    uint256 public unexpectedReverts;
    bytes public lastUnexpectedRevert;
    bool public sawArithmeticPanic;

    // ── conservation ghosts ──────────────────────────────────────────────────
    uint256 public ghostTokensIn;
    uint256 public ghostTokensOut;
    uint256 public redeemedTokens;
    uint256 public liquidatedTokens;

    uint256 public poolWadAtResolution;
    uint256[2] internal _qAtResolution;
    bool public resolved;

    /// @dev INV-7: what the creator actually DEPOSITED. The contract does not store it in this
    ///      form (only the seed shares from `seedShares(seedWad)`), so it is recorded here.
    uint256 public creatorDepositTokens;
    uint256 public creatorReturnedTokens;
    bool public creatorHasClaimed;

    // ── violation counters (asserted from the invariant_ functions) ──────────
    uint256 public inv5Violations;
    uint256 public inv9Violations;
    uint256 public inv10Violations;
    uint256 public pauseLeaks;
    /// @dev The post-sweep dual of `pauseLeaks`: once `sweptAt != 0` EVERY exit must reject with
    ///      `AlreadySwept`. Succeeding would burn a holder's shares for nothing, and a Panic —
    ///      which is what `redeem` used to answer with — would be swallowed by the try/catch.
    uint256 public sweepLeaks;
    uint256 public worstInv9Drift;
    uint256 public worstInv9Bound;

    constructor(
        Market market_,
        MockUSDC usdc_,
        OutcomeShares shares_,
        ConfigRegistry config_,
        address[3] memory traders_,
        address creator_,
        uint256 creatorSeedTokens_
    ) {
        market = market_;
        usdc = usdc_;
        shares = shares_;
        config = config_;
        creator = creator_;
        guardian = config_.guardian();
        resolutionModule = config_.addresses(ConfigKeys.RESOLUTION_MODULE);
        configOwner = config_.owner();
        traders = traders_;
        creatorDepositTokens = creatorSeedTokens_;

        for (uint256 i = 0; i < 3; ++i) {
            usdc_.mintTo(traders_[i], FUNDING);
            vm.prank(traders_[i]);
            usdc_.approve(address(market_), type(uint256).max);
        }
    }

    // ── views for the invariant contract ─────────────────────────────────────

    /// @notice Three traders plus the creator. Every share — tradable or seed — that has ever
    ///         existed in this market is held by one of those four: the handler always sends
    ///         `to` to its own caller and never transfers ERC-1155. That is what makes "all
    ///         positions cleared" (INV-4) genuinely mean "the whole of q has been liquidated".
    function claimants(uint256 i) public view returns (address) {
        uint256 k = i % 4;
        return k == 3 ? creator : traders[k];
    }

    function qAtResolution() external view returns (uint256[2] memory) {
        return _qAtResolution;
    }

    function positionOf(address who) public view returns (uint256) {
        uint256[2] memory seed = market.seedSharesOf(who);
        return shares.balanceOfOutcome(who, address(market), 0) + shares.balanceOfOutcome(who, address(market), 1)
            + seed[0] + seed[1];
    }

    /// @notice True when not a single claimant still holds anything.
    function allPositionsCleared() external view returns (bool) {
        for (uint256 i = 0; i < 4; ++i) {
            if (positionOf(claimants(i)) != 0) return false;
        }
        return true;
    }

    /// @notice The RECIPIENT of a trade — the caller itself about three times in four, another
    ///         TRADER otherwise.
    ///
    /// @dev Every `to` returned here is a claimant, and that is load-bearing rather than
    ///      incidental: INV-4's derivation needs `Σ_h a_{h,i} = qᵢ` exactly, which holds only
    ///      while every share ever minted is held by one of the four addresses
    ///      `allPositionsCleared` inspects.
    ///
    ///      The CREATOR is deliberately excluded. Crediting it with bought shares or with an
    ///      `addLiquidity` position would move its holding off the symmetric seed `(s, s)`, and
    ///      the 1 − 1/√2 constant INV-7 asserts is valid ONLY for a symmetric provider — the
    ///      general bound is `deposit × min(p₀,p₁) at entry`. Sending to the creator would not
    ///      break the protocol; it would break the invariant's premise, silently.
    ///
    ///      Callers pass the ACTOR seed, not the amount seed. The amount seed is already spent on
    ///      `_bound(seed, lo, hi)`, whose modular reduction shares a factor with 4 whenever
    ///      `hi − lo + 1` is even — which would tie "sends to a third party" to a fixed residue
    ///      of the trade size. The actor seed is reduced mod 3, and 3 and 4 are coprime.
    function _recipient(address self, uint256 seed) internal view returns (address) {
        return seed % 4 == 0 ? traders[(seed >> 8) % 3] : self;
    }

    // ── actions ──────────────────────────────────────────────────────────────

    function buy(uint256 actorSeed, uint256 outcomeSeed, uint256 amountSeed) external {
        if (!_tradable()) return;
        address a = traders[actorSeed % 3];
        uint8 o = uint8(outcomeSeed % 2);
        uint256 amount = _boundTradeSize(o, amountSeed);
        if (amount == 0) return;
        if (!_buyQuoteClearsMinimum(o, amount)) return;
        address to = _recipient(a, actorSeed);

        ++gatedActions;
        vm.prank(a);
        try market.buy(o, amount, type(uint256).max, to) returns (uint256 paid) {
            ghostTokensIn += paid;
            ++callsBuy;
            ++landedActions;
        } catch (bytes memory err) {
            _recordFailure(err);
        }
    }

    function sell(uint256 actorSeed, uint256 outcomeSeed, uint256 amountSeed) external {
        if (!_exitable()) return;
        address a = traders[actorSeed % 3];
        uint8 o = uint8(outcomeSeed % 2);

        uint256 held = shares.balanceOfOutcome(a, address(market), o);
        uint256 floorShares = _minSellShares(o);
        if (floorShares == 0 || held < floorShares) return;
        uint256 amount = _bound(amountSeed, floorShares, held);
        if (!_sellQuoteClearsMinimum(o, amount)) return;
        address to = _recipient(a, actorSeed);

        ++gatedActions;
        vm.prank(a);
        try market.sell(o, amount, 0, to) returns (uint256 got) {
            ghostTokensOut += got;
            ++callsSell;
            ++landedActions;
        } catch (bytes memory err) {
            _recordFailure(err);
        }
    }

    function addLiquidity(uint256 actorSeed, uint256 amountSeed) external {
        if (!_tradable()) return;
        address a = traders[actorSeed % 3];

        uint256[2] memory qBefore = market.qArray();
        // λ is capped at ≤ WAD below, so q at most doubles — keep MAX_Q headroom.
        if (qBefore[0] > DPMMath.MAX_Q / 2 || qBefore[1] > DPMMath.MAX_Q / 2) return;

        uint256 poolTokens = market.poolWad() / market.scale();
        uint256 amount = _bound(amountSeed, poolTokens / 100 + 1, poolTokens + 1);

        uint256 pBefore0 = market.probability(0);
        uint256 pBefore1 = market.probability(1);
        uint256 balBefore = usdc.balanceOf(a);
        // The seed position is credited to `to`, while the collateral is pulled from
        // `msg.sender` — so `removeLiquidity` is thereafter callable only by `to`.
        address to = _recipient(a, actorSeed);

        ++gatedActions;
        vm.prank(a);
        try market.addLiquidity(amount, 0, to) returns (uint256[2] memory) {
            ghostTokensIn += balBefore - usdc.balanceOf(a);
            ++callsAddLiquidity;
            ++landedActions;
            _checkInv9(qBefore, pBefore0, pBefore1);
        } catch (bytes memory err) {
            _recordFailure(err);
        }
    }

    function removeLiquidity(uint256 actorSeed, uint256 lambdaSeed) external {
        if (!_exitable()) return;
        address a = traders[actorSeed % 3];

        uint256[2] memory held = market.seedSharesOf(a);
        if (held[0] == 0 || held[1] == 0) return;
        uint256 lambda = _boundLambda(held, lambdaSeed);
        if (lambda == 0) return;
        address to = _recipient(a, actorSeed);

        ++gatedActions;
        vm.prank(a);
        try market.removeLiquidity(lambda, 0, to) returns (uint256 got) {
            ghostTokensOut += got;
            ++callsRemoveLiquidity;
            ++landedActions;
        } catch (bytes memory err) {
            _recordFailure(err);
        }
    }

    /// @notice INV-5 — buying then immediately selling never profits, in ANY state the random
    ///         sequence reaches, not merely in a freshly born market.
    function roundTrip(uint256 actorSeed, uint256 outcomeSeed, uint256 amountSeed) external {
        if (!_tradable()) return;
        address a = traders[actorSeed % 3];
        uint8 o = uint8(outcomeSeed % 2);
        uint256 amount = _boundTradeSize(o, amountSeed);
        if (amount == 0) return;
        if (!_buyQuoteClearsMinimum(o, amount)) return;

        uint256 balBefore = usdc.balanceOf(a);

        ++gatedActions;
        vm.prank(a);
        try market.buy(o, amount, type(uint256).max, a) returns (uint256 paid) {
            ghostTokensIn += paid;
            ++callsBuy;
            ++landedActions;
        } catch (bytes memory err) {
            _recordFailure(err);
            return;
        }

        // The sell leg may fail MIN_TRADE_TOKENS once the price has moved; that is not a
        // violation, merely an unfinished round-trip — and the trader clearly did NOT profit.
        if (!_sellQuoteClearsMinimum(o, amount)) return;

        ++gatedActions;
        vm.prank(a);
        try market.sell(o, amount, 0, a) returns (uint256 got) {
            ghostTokensOut += got;
            ++callsSell;
            ++landedActions;
        } catch (bytes memory err) {
            _recordFailure(err);
            return;
        }

        if (usdc.balanceOf(a) > balBefore) ++inv5Violations;
        ++callsRoundTrip;
    }

    function warpForward(uint256 secondsAhead) external {
        vm.warp(block.timestamp + _bound(secondsAhead, 1, 3 hours));
        ++gatedActions;
        ++landedActions;
        ++callsWarp;
    }

    function togglePause() external {
        ++gatedActions;
        if (config.paused()) {
            vm.prank(configOwner);
            config.unpause();
        } else {
            vm.prank(guardian);
            config.pause();
        }
        ++landedActions;
        ++callsPauseToggle;
    }

    /// @notice INV-10 — the pause closes EVERY entrance and closes not one exit.
    /// @dev Turns the pause on itself when it is off and then restores the original state, so
    ///      this action lands without depending on `togglePause` happening to be selected.
    ///      Deliberately does NOT touch `gatedActions`/`landedActions`: its own bookkeeping
    ///      (`inv10Violations`, `pauseLeaks`, `callsPaused*`) is the evidence.
    function exitWhilePaused(uint256 actorSeed, uint256 kindSeed) external {
        bool wasPaused = config.paused();
        if (!wasPaused) {
            vm.prank(guardian);
            config.pause();
        }

        _requireEntriesBlockedWhilePaused(actorSeed);
        _requireSomeExitWorksWhilePaused(actorSeed, kindSeed);

        if (!wasPaused) {
            vm.prank(configOwner);
            config.unpause();
        }
    }

    function advanceStatus(uint256 seed) external {
        if (block.timestamp < market.tradingEnd()) return;
        IMarket.Status s = market.status();

        if (s == IMarket.Status.Open) {
            ++gatedActions;
            try market.close() {
                ++callsClose;
                ++landedActions;
            } catch (bytes memory err) {
                _recordFailure(err);
            }
        } else if (s == IMarket.Status.Closed || s == IMarket.Status.Disputed) {
            ++gatedActions;
            vm.prank(resolutionModule);
            try market.markProposed() {
                ++callsPropose;
                ++landedActions;
            } catch (bytes memory err) {
                _recordFailure(err);
            }
        } else if (s == IMarket.Status.Proposed && seed % 2 == 0) {
            ++gatedActions;
            vm.prank(resolutionModule);
            try market.markDisputed() {
                ++callsDispute;
                ++landedActions;
            } catch (bytes memory err) {
                _recordFailure(err);
            }
        }
    }

    /// @dev Gated on `tradingEnd` so that resolution does not land on the very first call and
    ///      kill the whole trading coverage of that run.
    function resolve(uint256 seed) external {
        if (block.timestamp < market.tradingEnd()) return;
        IMarket.Status s = market.status();
        if (s == IMarket.Status.Settled || s == IMarket.Status.Failed || s == IMarket.Status.Voided) return;

        uint256 kind = seed % 3;
        if (kind == 0) {
            if (s != IMarket.Status.Open) return; // void is valid only from Open
            ++gatedActions;
            vm.prank(guardian);
            try market.void(bytes32("invariant")) {
                ++callsVoid;
                ++landedActions;
                _snapshotResolution();
            } catch (bytes memory err) {
                _recordFailure(err);
            }
        } else if (kind == 1) {
            ++gatedActions;
            // `fail()` has TWO authorisation paths: the resolution module at any time, or
            // ANYONE once `settlementDeadline` has passed. Until now the handler only ever
            // pranked the module, so the permissionless branch — the one a real deployment
            // relies on when the committee goes dark, and the one that snapshots the
            // liquidation prices and distributes the fees — was never executed statefully.
            // A market whose committee has ALREADY proposed an outcome gets a grace
            // period on top of its deadline, and only the module may fail it inside
            // that window — see the note in `Market.fail`. The handler has to model
            // that rule, or it predicts a landing the contract correctly refuses and
            // `invariant_handlerCallsLandAsPredicted` fires on the handler's error
            // rather than on the protocol's.
            uint256 failOpensAt = market.settlementDeadline();
            if (s == IMarket.Status.Proposed) failOpensAt += config.params(ConfigKeys.PROPOSED_FAIL_GRACE);
            bool permissionless = block.timestamp >= failOpensAt;
            vm.prank(permissionless ? traders[seed % 3] : resolutionModule);
            try market.fail() {
                ++callsFail;
                if (permissionless) ++callsFailPermissionless;
                ++landedActions;
                _snapshotResolution();
            } catch (bytes memory err) {
                _recordFailure(err);
            }
        } else {
            if (s == IMarket.Status.Open) return; // settle needs Closed/Proposed/Disputed
            ++gatedActions;
            vm.prank(resolutionModule);
            try market.settle(uint8((seed >> 8) % 2)) {
                ++callsSettle;
                ++landedActions;
                _snapshotResolution();
            } catch (bytes memory err) {
                _recordFailure(err);
            }
        }
    }

    /// @notice The claim window closes for good, and whatever nobody claimed goes to the Treasury.
    ///
    /// @dev `sweepUnclaimed` used to be absent from this handler on the grounds that
    ///      `SWEEP_UNCLAIMED_AFTER` is 365 days while `warpForward` is capped at 3 hours, so a
    ///      fuzz sequence could never reach the window. That reasoning is sound about
    ///      `warpForward` and wrong about the conclusion: the fix is for the action to carry its
    ///      OWN warp, not for the protocol's largest single money movement — the entire
    ///      collateral balance, in one transfer — to sit outside the stateful suite.
    ///
    ///      Three things make it land as predicted rather than poisoning
    ///      `invariant_handlerCallsLandAsPredicted`:
    ///        • the balance is checked BEFORE the warp, because `sweepUnclaimed` rejects a zero
    ///          balance with `ZeroAmount` — and a zero TOKEN balance is entirely reachable with
    ///          `poolWad` still positive, since leftover dust below `scale` is worth 0 tokens;
    ///        • the warp is taken only once the decision to sweep is final, so a declined
    ///          selection does not silently advance the clock a year;
    ///        • `seed % 6` rate-limits it. That is a rate limiter, NOT a tolerance: it exists so
    ///          that the remaining depth of a run is not spent entirely in the post-sweep
    ///          regime, and both orderings (sweep before any claim, sweep after some claims)
    ///          still occur across a campaign.
    function sweep(uint256 seed) external {
        if (market.sweptAt() != 0) return;
        IMarket.Status s = market.status();
        if (s != IMarket.Status.Settled && s != IMarket.Status.Failed && s != IMarket.Status.Voided) return;
        if (seed % 6 != 0) return;
        if (usdc.balanceOf(address(market)) == 0) return; // would revert ZeroAmount

        uint256 opensAt = uint256(market.resolvedAt()) + config.params(ConfigKeys.SWEEP_UNCLAIMED_AFTER);
        if (block.timestamp < opensAt) vm.warp(opensAt);

        ++gatedActions;
        try market.sweepUnclaimed() {
            ++callsSweep;
            ++landedActions;
        } catch (bytes memory err) {
            _recordFailure(err);
        }
    }

    function claim(uint256 actorSeed) external {
        // After a sweep the claim window is shut for everyone. That is not a reason to stop
        // exercising the exits — it is the reason to keep exercising them: this is the regime in
        // which `redeem` once answered with an arithmetic Panic and `liquidate` once succeeded
        // and burned the caller's shares for nothing.
        if (market.sweptAt() != 0) {
            _requireClaimWindowClosed(actorSeed);
            return;
        }

        IMarket.Status s = market.status();
        address a = claimants(actorSeed);

        if (s == IMarket.Status.Settled) {
            uint8 w = market.winningOutcome();
            if (shares.balanceOfOutcome(a, address(market), w) + market.seedSharesOf(a)[w] == 0) return;
            ++gatedActions;
            vm.prank(a);
            try market.redeem(a) returns (uint256 got) {
                ++landedActions;
                _noteClaim(a, got, true);
            } catch (bytes memory err) {
                _recordFailure(err);
            }
        } else if (s == IMarket.Status.Failed || s == IMarket.Status.Voided) {
            if (positionOf(a) == 0) return;
            ++gatedActions;
            vm.prank(a);
            try market.liquidate(a) returns (uint256 got) {
                ++landedActions;
                _noteClaim(a, got, false);
            } catch (bytes memory err) {
                _recordFailure(err);
            }
        }
    }

    /// @dev The post-sweep dual of `_requireEntriesBlockedWhilePaused`. `AlreadySwept` is the
    ///      FIRST statement of both `redeem` and `liquidate`, ahead of every amount check, so a
    ///      holder with a real position must see exactly that selector — not `NothingToClaim`,
    ///      which would mean the shares had already been consumed, and above all not a Panic.
    ///      Deliberately without `vm.expectRevert`: that cheatcode binds to the next external
    ///      call and its failure would be swallowed by the runner.
    function _requireClaimWindowClosed(uint256 actorSeed) internal {
        IMarket.Status s = market.status();
        for (uint256 i = 0; i < 4; ++i) {
            // `% 4` BEFORE the addition, exactly as `_pausedRedeem`/`_pausedLiquidate` do:
            // `actorSeed` is raw fuzzer input and reaches `type(uint256).max`, so `actorSeed + i`
            // overflows. `fail_on_revert = true` caught this on the first deep run.
            address a = claimants(actorSeed % 4 + i);
            if (positionOf(a) == 0) continue;

            if (s == IMarket.Status.Settled) {
                vm.prank(a);
                try market.redeem(a) returns (uint256) {
                    ++sweepLeaks;
                } catch (bytes memory err) {
                    _scoreSweptRejection(err);
                }
            } else {
                vm.prank(a);
                try market.liquidate(a) returns (uint256) {
                    ++sweepLeaks;
                } catch (bytes memory err) {
                    _scoreSweptRejection(err);
                }
            }
            return;
        }
    }

    function _scoreSweptRejection(bytes memory err) internal {
        if (_selectorOf(err) == Market.AlreadySwept.selector) {
            ++callsPostSweepRejected;
            return;
        }
        ++sweepLeaks;
        if (_selectorOf(err) == PANIC_SELECTOR) sawArithmeticPanic = true;
    }

    // ── internal: gates & bounds ─────────────────────────────────────────────

    function _tradable() internal view returns (bool) {
        return market.status() == IMarket.Status.Open && block.timestamp < market.tradingEnd() && !config.paused();
    }

    function _exitable() internal view returns (bool) {
        return market.status() == IMarket.Status.Open && block.timestamp < market.tradingEnd();
    }

    function _boundTradeSize(uint8 o, uint256 seed) internal view returns (uint256) {
        uint256[2] memory q = market.qArray();
        uint256 lo = q[o] / 500 + 2e18;
        uint256 hi = q[o] / 4 + 4e18;
        uint256 headroom = DPMMath.MAX_Q > q[o] ? DPMMath.MAX_Q - q[o] : 0;
        if (headroom < lo) return 0;
        if (hi > headroom) hi = headroom;
        return _bound(seed, lo, hi);
    }

    /// @dev λ_max keeps `take_i = ⌊q_i·λ/WAD⌋ ≤ held_i` on both sides; λ_min keeps
    ///      `take_i ≥ 1` on the smaller side (otherwise: `TradeTooSmall`). The creator seed
    ///      floor is never breached because a non-creator's `held` is always
    ///      ≤ seedSupply − creatorSeed. `hi == 0` means no valid λ exists.
    function _lambdaRange(uint256[2] memory held) internal view returns (uint256 lo, uint256 hi) {
        uint256[2] memory q = market.qArray();
        hi = Math.min(Math.mulDiv(held[0], WAD, q[0]), Math.mulDiv(held[1], WAD, q[1]));
        if (hi > WAD) hi = WAD;
        lo = WAD / Math.min(q[0], q[1]) + 1;
        if (lo > hi) return (0, 0);
    }

    function _boundLambda(uint256[2] memory held, uint256 seed) internal view returns (uint256) {
        (uint256 lo, uint256 hi) = _lambdaRange(held);
        if (hi == 0) return 0;
        return _bound(seed, lo, hi);
    }

    /// @dev A rough estimate of the smallest share count whose sale might still clear
    ///      MIN_TRADE_TOKENS (the marginal price falls while selling, hence the 50% padding).
    ///      The authority remains `quoteSell`, through `_sellQuoteClearsMinimum`.
    function _minSellShares(uint8 o) internal view returns (uint256) {
        uint256 px = market.marginalPrice(o);
        if (px == 0) return 0;
        uint256 need = Math.mulDiv(market.minTradeTokens() * market.scale(), WAD, px);
        return need + need / 2 + 1;
    }

    function _buyQuoteClearsMinimum(uint8 o, uint256 amount) internal view returns (bool) {
        try market.quoteBuy(o, amount) returns (uint256 tokensIn, uint256 fee) {
            return tokensIn - fee >= market.minTradeTokens();
        } catch {
            return false;
        }
    }

    function _sellQuoteClearsMinimum(uint8 o, uint256 amount) internal view returns (bool) {
        try market.quoteSell(o, amount) returns (uint256 tokensOut, uint256 fee) {
            return tokensOut + fee >= market.minTradeTokens();
        } catch {
            return false;
        }
    }

    // ── internal: bookkeeping ────────────────────────────────────────────────

    function _snapshotResolution() internal {
        poolWadAtResolution = market.poolWad();
        _qAtResolution = market.qArray();
        resolved = true;
    }

    function _noteClaim(address a, uint256 got, bool isRedeem) internal {
        ghostTokensOut += got;
        if (isRedeem) {
            redeemedTokens += got;
            ++callsRedeem;
        } else {
            liquidatedTokens += got;
            ++callsLiquidate;
        }
        if (a == creator) {
            creatorReturnedTokens += got;
            creatorHasClaimed = true;
        }
    }

    /// @dev INV-9. The derivation of the bound lives in `InvariantBounds.inv9ProbabilityDrift`;
    ///      here it is only applied. It is CALLED rather than restated — this file used to carry
    ///      its own copy of `ceilDiv(8·WAD/(q₀+q₁)) + 2`, which is precisely the arrangement in
    ///      which a corrected bound gets corrected in one place and not the other.
    function _checkInv9(uint256[2] memory qBefore, uint256 p0, uint256 p1) internal {
        uint256 tol = InvariantBounds.inv9ProbabilityDrift(qBefore);
        uint256 d0 = _absDiff(market.probability(0), p0);
        uint256 d1 = _absDiff(market.probability(1), p1);
        uint256 d = Math.max(d0, d1);
        // `>=` so that the bound is recorded too even when the drift is always 0 — a report of
        // "0 against a bound of 3" is far more informative than "0 against a bound of 0".
        if (d >= worstInv9Drift) {
            worstInv9Drift = d;
            worstInv9Bound = tol;
        }
        if (d > tol) ++inv9Violations;
    }

    // ── internal: INV-10 ─────────────────────────────────────────────────────

    function _requireEntriesBlockedWhilePaused(uint256 actorSeed) internal {
        if (market.status() != IMarket.Status.Open || block.timestamp >= market.tradingEnd()) return;
        address t = traders[actorSeed % 3];

        // `_requireTradable()` is the FIRST statement in `buy`, in the order
        // NotOpen → TradingEnded → ProtocolPaused. The first two conditions were already
        // confirmed to PASS on the line above, so the only revert possible here is
        // ProtocolPaused — not a `TradeTooSmall`/`SlippageExceeded` that would make this check
        // "pass" for the wrong reason. Deliberately WITHOUT `vm.expectRevert`: that cheatcode
        // binds to the next external call, and its failure would be swallowed by
        // `fail_on_revert = false`.
        vm.prank(t);
        try market.buy(0, 1e18, type(uint256).max, t) returns (uint256) {
            ++pauseLeaks;
        } catch (bytes memory err) {
            if (_selectorOf(err) != Market.ProtocolPaused.selector) ++pauseLeaks;
            else ++callsPausedEntryBlocked;
        }
    }

    /// @dev `kindSeed` decides which exit is TRIED FIRST while the market is still open.
    ///      Without it `_pausedSell` almost always wins (a tradable position is present far
    ///      more often than not) and `removeLiquidity` while paused is never exercised.
    function _requireSomeExitWorksWhilePaused(uint256 actorSeed, uint256 kindSeed) internal {
        IMarket.Status s = market.status();
        if (s == IMarket.Status.Open && block.timestamp < market.tradingEnd()) {
            if (kindSeed % 2 == 0) {
                if (_pausedSell(actorSeed)) return;
                _pausedRemoveLiquidity(actorSeed);
                return;
            }
            if (_pausedRemoveLiquidity(actorSeed)) return;
            _pausedSell(actorSeed);
        } else if (s == IMarket.Status.Settled) {
            _pausedRedeem(actorSeed);
        } else if (s == IMarket.Status.Failed || s == IMarket.Status.Voided) {
            _pausedLiquidate(actorSeed);
        }
    }

    /// @dev Each exit path below proves the exit REALLY happened — tokens genuinely arrived in
    ///      the wallet, or the position genuinely shrank — not merely that it "did not revert".
    ///      A call that reverts is recorded as an INV-10 violation.
    function _pausedSell(uint256 seed) internal returns (bool) {
        for (uint256 i = 0; i < 3; ++i) {
            address a = traders[(seed % 3 + i) % 3];
            for (uint256 j = 0; j < 2; ++j) {
                uint8 o = uint8((seed % 2 + j) % 2);
                uint256 held = shares.balanceOfOutcome(a, address(market), o);
                if (held == 0) continue;
                if (!_sellQuoteClearsMinimum(o, held)) continue;

                uint256 balBefore = usdc.balanceOf(a);
                vm.prank(a);
                try market.sell(o, held, 0, a) returns (uint256 got) {
                    if (got == 0 || usdc.balanceOf(a) != balBefore + got) {
                        ++inv10Violations;
                    } else {
                        ghostTokensOut += got;
                        ++callsPausedSell;
                    }
                } catch {
                    ++inv10Violations;
                }
                return true;
            }
        }
        return false;
    }

    function _pausedRemoveLiquidity(uint256 seed) internal returns (bool) {
        for (uint256 i = 0; i < 3; ++i) {
            address a = traders[(seed % 3 + i) % 3];
            uint256[2] memory held = market.seedSharesOf(a);
            if (held[0] == 0 || held[1] == 0) continue;
            (, uint256 lambda) = _lambdaRange(held); // the largest valid λ: withdraw as much as possible
            if (lambda == 0) continue;

            vm.prank(a);
            try market.removeLiquidity(lambda, 0, a) returns (uint256 got) {
                uint256[2] memory rest = market.seedSharesOf(a);
                if (rest[0] >= held[0] || rest[1] >= held[1]) {
                    ++inv10Violations;
                } else {
                    ghostTokensOut += got;
                    ++callsPausedRemoveLiquidity;
                }
            } catch {
                ++inv10Violations;
            }
            return true;
        }
        return false;
    }

    /// @dev The sweep gate here is NOT a weakening of INV-10. INV-10 says the PAUSE never closes
    ///      an exit; `sweepUnclaimed` closes it deliberately and permanently, a year after
    ///      resolution, and that closure is asserted separately through `sweepLeaks`. Counting it
    ///      as an INV-10 violation would blame the pause for something the pause did not do.
    function _pausedRedeem(uint256 seed) internal returns (bool) {
        if (market.sweptAt() != 0) return false;
        uint8 w = market.winningOutcome();
        for (uint256 i = 0; i < 4; ++i) {
            address a = claimants(seed % 4 + i);
            if (shares.balanceOfOutcome(a, address(market), w) + market.seedSharesOf(a)[w] == 0) continue;

            vm.prank(a);
            try market.redeem(a) returns (uint256 got) {
                if (shares.balanceOfOutcome(a, address(market), w) + market.seedSharesOf(a)[w] != 0) {
                    ++inv10Violations;
                } else {
                    _noteClaim(a, got, true);
                    ++callsPausedRedeem;
                }
            } catch {
                ++inv10Violations;
            }
            return true;
        }
        return false;
    }

    /// @dev See the note on `_pausedRedeem` for why the sweep is gated out rather than counted.
    function _pausedLiquidate(uint256 seed) internal returns (bool) {
        if (market.sweptAt() != 0) return false;
        for (uint256 i = 0; i < 4; ++i) {
            address a = claimants(seed % 4 + i);
            if (positionOf(a) == 0) continue;

            vm.prank(a);
            try market.liquidate(a) returns (uint256 got) {
                if (positionOf(a) != 0) {
                    ++inv10Violations;
                } else {
                    _noteClaim(a, got, false);
                    ++callsPausedLiquidate;
                }
            } catch {
                ++inv10Violations;
            }
            return true;
        }
        return false;
    }

    // ── internal: utilities ──────────────────────────────────────────────────

    function _recordFailure(bytes memory err) internal {
        ++unexpectedReverts;
        lastUnexpectedRevert = err;
        if (_selectorOf(err) == PANIC_SELECTOR) sawArithmeticPanic = true;
    }

    function _selectorOf(bytes memory err) internal pure returns (bytes4) {
        if (err.length < 4) return bytes4(0);
        return bytes4(err[0]) | (bytes4(err[1]) >> 8) | (bytes4(err[2]) >> 16) | (bytes4(err[3]) >> 24);
    }

    function _absDiff(uint256 x, uint256 y) internal pure returns (uint256) {
        return x > y ? x - y : y - x;
    }
}
