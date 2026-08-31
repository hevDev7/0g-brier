// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console} from "forge-std/Test.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Fixtures} from "../helpers/Fixtures.sol";
import {MarketHandler} from "./MarketHandler.sol";
import {Market} from "../../src/core/Market.sol";
import {IMarket} from "../../src/interfaces/IMarket.sol";
import {DPMMath} from "../../src/math/DPMMath.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";
import {InvariantBounds} from "../helpers/InvariantBounds.sol";

/// @title MarketInvariantsTest
/// @notice INV-1..10 as stateful invariants over an arbitrary call sequence.
/// @dev `fail-on-revert = true` is set inline for BOTH profiles: every market call inside the
///      handler is already wrapped in try/catch, so a handler that reverts on its own is a
///      handler bug and must be visible rather than swallowed.
///
///      The DEPTH now lives in `foundry.toml` (512 × 256 by default, 2048 × 512 under `ci`)
///      rather than in an inline override here. The `depth = 128` this replaces was measured
///      against a depth-64 default and was right at the time, but an inline `forge-config` wins
///      over the profile AND over the environment in BOTH directions — so once it was written
///      here it stopped being a floor and became a ceiling: `[profile.ci.invariant] depth` and
///      `FOUNDRY_INVARIANT_DEPTH` were silently ignored for this contract (verified: with the
///      line present, `FOUNDRY_INVARIANT_DEPTH=300` still ran 128).
///
///      Raising the depth is only half the job: the market's TRADING WINDOW has to move with it
///      or the added depth lands entirely in the dead post-resolution tail. See
///      `INV_TRADING_WINDOW` below, where that is derived and where the measurement is recorded.
/// forge-config: default.invariant.fail-on-revert = true
/// forge-config: ci.invariant.fail-on-revert = true
contract MarketInvariantsTest is Fixtures {
    /// @notice The market's trading window, sized so that a run crosses it about HALFWAY.
    ///
    /// @dev The short window is DELIBERATE — the 7-day window `Fixtures` provides would never be
    ///      crossed at this depth and INV-3/INV-4 would never be exercised at all — and it MUST
    ///      SCALE WITH THE DEPTH. That second half is not decoration:
    ///
    ///        `warpForward` is 1 of 12 selectors and warps uniformly on (0, 3h], so a run
    ///        advances D/12 × 1.5h = D/8 hours of simulated time. The window is crossed at about
    ///        call index `8 × window / (1 hour)`.
    ///
    ///      At depth 128 an 8-hour window put that crossing at call ~64, i.e. halfway, which is
    ///      what the original comment claimed. Raising the depth to 256 while LEAVING the window
    ///      at 8 hours moves the crossing to call ~64 of 256 — a quarter — and the extra depth
    ///      buys nothing at all. That is not a prediction; it was MEASURED across 12 fixed seeds
    ///      before this constant was changed: at depth 256 with an 8-hour window, every seed's
    ///      buy/sell/addLiquidity/removeLiquidity counts were IDENTICAL to the same seed at depth
    ///      128, to the call. The whole of the added depth was spent in the resolved regime with
    ///      nothing left to do.
    ///
    ///      16 hours restores the halfway crossing at depth 256 (8 × 16 = 128). If the depth is
    ///      changed again, this constant has to move with it, or the run silently degenerates
    ///      back into a long post-resolution tail.
    uint64 internal constant INV_TRADING_WINDOW = 16 hours;
    /// @dev Half the trading window, as before, so that `settlementDeadline` falls at about
    ///      three-quarters of a run and the PERMISSIONLESS branch of `fail()` gets real exposure.
    uint64 internal constant INV_SETTLEMENT_WINDOW = 8 hours;

    Market internal m;
    MarketHandler internal handler;
    address internal carol = makeAddr("carol");

    /// @notice The fee this campaign's market is born with, in bps.
    /// @dev Overridden by `MarketInvariantsZeroFeeTest`. See the note there for why running the
    ///      whole stateful campaign at 1% only is not enough.
    function _campaignFeeBps() internal pure virtual returns (uint256) {
        return 100;
    }

    function setUp() public virtual {
        _deployBase();
        config.setParam(ConfigKeys.FEE_BPS, _campaignFeeBps());
        // This campaign runs on a COMPRESSED CLOCK throughout — a 16-hour trading window
        // where production uses days — so the two windows that gate resolution are
        // compressed with it. Left at their deployed defaults (3 days and 7 days) the
        // market could not be created at all, and the permissionless branch of `fail()`
        // would sit outside every reachable sequence. The RELATION they encode is what
        // matters and is preserved: a settlement window wide enough to resolve inside,
        // and a grace period on top of it during which a proposed outcome still wins.
        config.setParam(ConfigKeys.MIN_SETTLEMENT_WINDOW, 1 hours);
        config.setParam(ConfigKeys.PROPOSED_FAIL_GRACE, 3 hours);
        m = _newShortWindowMarket();
        handler = new MarketHandler(m, usdc, shares, config, [alice, bob, carol], creator, SEED);

        targetContract(address(handler));
        // Chosen EXPLICITLY: left to the default, Foundry would fuzz every public state-changing
        // function on every deployed contract — including `MockUSDC.mintTo`,
        // `ConfigRegistry.setParam`, and `Market` itself with no bounds at all.
        bytes4[] memory sel = new bytes4[](12);
        sel[0] = MarketHandler.buy.selector;
        sel[1] = MarketHandler.sell.selector;
        sel[2] = MarketHandler.addLiquidity.selector;
        sel[3] = MarketHandler.removeLiquidity.selector;
        sel[4] = MarketHandler.roundTrip.selector;
        sel[5] = MarketHandler.warpForward.selector;
        sel[6] = MarketHandler.togglePause.selector;
        sel[7] = MarketHandler.exitWhilePaused.selector;
        sel[8] = MarketHandler.advanceStatus.selector;
        sel[9] = MarketHandler.resolve.selector;
        sel[10] = MarketHandler.claim.selector;
        sel[11] = MarketHandler.sweep.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sel}));
    }

    function _newShortWindowMarket() internal returns (Market mm) {
        IMarket.Params memory p = _params();
        p.tradingEnd = uint64(block.timestamp) + INV_TRADING_WINDOW;
        p.settlementDeadline = p.tradingEnd + INV_SETTLEMENT_WINDOW;
        mm = Market(Clones.clone(address(marketImpl)));
        registry.set(address(mm), true);
        usdc.mintTo(address(this), SEED + DEPOSIT);
        usdc.transfer(address(mm), SEED + DEPOSIT);
        mm.initialize(address(config), address(shares), p, SEED, DEPOSIT);
    }

    function _resolvedRegime() internal view returns (bool) {
        IMarket.Status s = m.status();
        return s == IMarket.Status.Settled || s == IMarket.Status.Failed || s == IMarket.Status.Voided;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  INV-1..10
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice INV-1 — `poolWad == costUp(q)` before resolution. ZERO tolerance.
    /// @dev Not a measurement: `Market` SETS `poolWad = target` on every mutation and never
    ///      accumulates it, so this equality holds by construction. It applies to Open AND to
    ///      Closed/Proposed/Disputed — in those last three statuses `q` and `poolWad` are frozen
    ///      and no path touches them, so including them makes this invariant stricter, not
    ///      looser.
    function invariant_INV1_poolEqualsCostUp() public view {
        if (_resolvedRegime()) return;
        assertEq(m.poolWad(), DPMMath.costUp(m.qArray()), "INV-1: poolWad != costUp(q)");
    }

    /// @notice INV-2 — the collateral held always covers the pool, the fees, and the deposit.
    ///         ZERO tolerance (this is an inequality, not an equality).
    function invariant_INV2_collateralCoversObligations() public view {
        assertGe(usdc.balanceOf(address(m)), m.collateralOwed(), "INV-2: market is insolvent");
    }

    /// @notice INV-3 — Σ redeem never exceeds the pool at resolution. ZERO tolerance.
    /// @dev Each `redeem` pays ⌊payoutWadₕ/scale⌋ and Σ payoutWadₕ ≤ poolWad (otherwise
    ///      `poolWad -= payoutWad` underflows), so Σ tokensOut ≤ ⌊poolWad/scale⌋ exactly. That
    ///      underflow is guarded separately by `invariant_noArithmeticPanic`: without it, a
    ///      `redeem` that panics would be swallowed by the handler's try/catch and INV-3 would
    ///      pass on nothing.
    function invariant_INV3_redemptionsNeverExceedPool() public view {
        if (m.status() != IMarket.Status.Settled) return;
        if (handler.callsRedeem() == 0) return;
        assertLe(
            handler.redeemedTokens(), handler.poolWadAtResolution() / m.scale(), "INV-3: redemptions exceed the pool"
        );
    }

    /// @notice INV-4 — liquidation exhausts the pool, within a DERIVED dust bound (not a constant).
    /// @dev Two directions:
    ///      (a) never pays more than exists — ZERO tolerance;
    ///      (b) drains it — tolerance `InvariantBounds.inv4LiquidationDust(q, H)`, which scales
    ///          with (q₀+q₁)/WAD. Meaningful only after EVERY position is cleared; before that
    ///          the pool remainder genuinely belongs to holders who have not yet claimed.
    function invariant_INV4_liquidationDrainsPool() public view {
        IMarket.Status s = m.status();
        if (s != IMarket.Status.Failed && s != IMarket.Status.Voided) return;
        if (handler.callsLiquidate() == 0) return;

        assertLe(
            handler.liquidatedTokens(),
            handler.poolWadAtResolution() / m.scale(),
            "INV-4a: liquidation exceeds the pool"
        );

        if (!handler.allPositionsCleared()) return;
        uint256 tol = InvariantBounds.inv4LiquidationDust(handler.qAtResolution(), handler.callsLiquidate());
        assertLe(m.poolWad(), tol, "INV-4b: pool not drained within the derived bound");
    }

    /// @notice INV-5 — buying then immediately selling never profits. ZERO tolerance.
    /// @dev Checked inside the handler (`roundTrip`) in ANY state the sequence reaches, then
    ///      reported through a counter — a direct assert in the handler would be swallowed by
    ///      the runner.
    function invariant_INV5_roundTripNeverProfits() public view {
        assertEq(handler.inv5Violations(), 0, "INV-5: a round-trip turned a profit");
    }

    /// @notice INV-6 — qᵢ ≥ seedSupplyᵢ ≥ creatorSeedᵢ > 0. ZERO tolerance.
    function invariant_INV6_seedFloorHolds() public view {
        uint256[2] memory q = m.qArray();
        uint256[2] memory seedSup = m.seedSupply();
        uint256[2] memory creatorS = m.creatorSeed();
        for (uint256 i = 0; i < 2; ++i) {
            assertGe(q[i], seedSup[i], "INV-6: q < seedSupply");
            assertGe(seedSup[i], creatorS[i], "INV-6: seedSupply < creatorSeed");
            assertGt(creatorS[i], 0, "INV-6: creatorSeed == 0");
        }
    }

    /// @notice INV-7 — provider loss ≤ 29.30% of the deposit, under an arbitrary order flow.
    ///
    /// @dev The 29.30% figure is NOT a dust tolerance but an economic constant:
    ///      1 − 1/√2 = 29.2893%, rounded up by the spec. Its derivation, for a provider
    ///      entering at a q whose marginal prices are pᵢ = qᵢ/C(q) — the value returned is
    ///      ≥ deposit × min(p₀, p₁):
    ///
    ///        Settled: a holder of λq receives λq_w·C(q')/q'_w. Since C(q') ≥ q'_w, this is
    ///                 ≥ λq_w = λC(q)·p_w = deposit × p_w.
    ///        Failed/Voided: the holder receives Σᵢ λqᵢ·p'ᵢ = λC(q)·Σᵢ pᵢp'ᵢ. p and p' are unit
    ///                 vectors in the positive quadrant (Σpᵢ² = 1), so Σpᵢp'ᵢ = cos θ, which is
    ///                 minimized when p' lies on an axis: min = min(p₀, p₁).
    ///
    ///      For the creator the seed is SYMMETRIC by construction (`_q[0] = _q[1] = s`), so
    ///      p₀ = p₁ = 1/√2 and the bound is exactly 1 − 1/√2. That is why the handler keeps the
    ///      creator's position at exactly `(s, s)`: it never buys and never adds liquidity.
    ///
    ///      The 7070/10000 value is safe against rounding: s = ⌊√⌊seedWad²/2⌋⌋ ≥ seedWad/√2 − 1,
    ///      and the payout is ≥ s − O(s/WAD) wad, so recovery is ≥ 70.7106% − ~1e-9 percentage
    ///      points of the deposit, against a 70.70% threshold — a margin of ≈ 0.0107% × deposit
    ///      (≈0.107 USDC at SEED = 1000 USDC), thousands of times larger than all the rounding
    ///      dust involved.
    ///
    ///      `creatorDepositTokens` is a handler ghost variable: the contract does not store the
    ///      deposit in token form, only the seed shares from `seedShares(seedWad)`.
    function invariant_INV7_creatorLossBounded() public view {
        if (!handler.creatorHasClaimed()) return;
        assertGe(
            handler.creatorReturnedTokens() * 10_000,
            handler.creatorDepositTokens() * 7_070,
            "INV-7: provider loss exceeded 29.30%"
        );
    }

    /// @notice INV-8 — Σ probability(i) == WAD within 2 wei, ONE-SIDED.
    /// @dev The only constant tolerance in this suite, and algebraically valid:
    ///      probability(i) = ⌊qᵢ²·WAD/S⌋ with S = Σqⱼ², so the EXACT sum is precisely WAD before
    ///      rounding. Two terms each rounded down lose < 1 wei apiece, so the sum lies in
    ///      (WAD − 2, WAD]. The bound does not depend on q at all — and the sum can NEVER exceed
    ///      WAD, so it is asserted one-sided rather than symmetrically.
    function invariant_INV8_probabilitiesSumToOne() public view {
        uint256 sum = m.probability(0) + m.probability(1);
        assertLe(sum, DPMMath.WAD, "INV-8: probability sum exceeds WAD");
        assertLe(DPMMath.WAD - sum, 2, "INV-8: deficit larger than 2 wei");
    }

    /// @notice INV-9 — a proportional `addLiquidity` does not move the probability, within the
    ///         DERIVED bound `InvariantBounds.inv9ProbabilityDrift(q)`.
    /// @dev Checked inside the handler around every `addLiquidity` that lands, using the q from
    ///      BEFORE the deposit (that is the q in the derivation), then reported via a counter.
    function invariant_INV9_addLiquidityDoesNotMoveProbability() public view {
        assertEq(handler.inv9Violations(), 0, "INV-9: addLiquidity moved the probability");
    }

    /// @notice INV-10 — the pause never closes an exit, and always closes an entrance.
    /// @dev `inv10Violations` rises only when an exit whose preconditions were ALREADY verified
    ///      genuinely fails or moves nothing — not merely when it "did not revert".
    ///      `pauseLeaks` is its dual: a `buy` while paused must revert `ProtocolPaused`, and
    ///      must do so with THAT selector, not a `TradeTooSmall` that would let the check pass
    ///      without ever touching the pause guard.
    function invariant_INV10_pauseNeverClosesAnExit() public view {
        assertEq(handler.inv10Violations(), 0, "INV-10: an exit failed while paused");
        assertEq(handler.pauseLeaks(), 0, "INV-10 dual: an entrance got through while paused");
    }

    /// @notice Once `sweepUnclaimed` has run, EVERY exit rejects with `AlreadySwept` — it does
    ///         not succeed, and above all it does not Panic.
    ///
    /// @dev The counterpart of INV-10's `pauseLeaks`, for the one mechanism in this contract that
    ///      is ALLOWED to close an exit. Both failure modes it guards against have actually
    ///      shipped here: `redeem` answered a swept market with an arithmetic Panic, and
    ///      `liquidate` answered it by succeeding and burning the caller's shares for nothing.
    ///      Neither would be visible through the handler's try/catch without this counter.
    ///
    ///      This regime used to be reachable only from one directed test. It is now part of the
    ///      random campaign, because `sweep` carries its own warp.
    function invariant_claimWindowClosesCleanly() public view {
        assertEq(handler.sweepLeaks(), 0, "an exit did not reject cleanly after the sweep");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Suite quality guards
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Two regimes: from `settle`/`fail`/`void` onward, `q` is FROZEN. Without this
    ///         guard, INV-4b — which derives its dust bound from `qAtResolution` — could be
    ///         comparing the pool against a q that has since moved, and pass on nothing.
    function invariant_qFrozenAfterResolution() public view {
        if (!_resolvedRegime()) return;
        assertTrue(handler.resolved(), "resolution happened outside the handler bookkeeping");
        uint256[2] memory qNow = m.qArray();
        uint256[2] memory qAtRes = handler.qAtResolution();
        assertEq(qNow[0], qAtRes[0], "q[0] moved after resolution");
        assertEq(qNow[1], qAtRes[1], "q[1] moved after resolution");
    }

    /// @notice Coarse conservation: tokens flowing OUT through user paths never exceed those
    ///         flowing IN, plus the opening SEED. ZERO tolerance.
    ///
    /// @dev The `+ DEPOSIT` this bound used to carry was dead slack, and dead slack in a
    ///      conservation check is exactly where a small leak hides. The settlement deposit never
    ///      enters the pool: it is held in `settlementDeposit` and paid out in full by
    ///      `_distributeFees` to the resolver pool (settle/fail) or to the Treasury (void). No
    ///      user path can reach it, so it cannot fund an outflow and has no business widening the
    ///      bound by 20 USDC on a 1,000 USDC seed.
    ///
    ///      What remains is exact rather than fitted. Every path that puts money INTO the pool
    ///      charges `ceilDiv(target − poolWad, scale)`; every path that takes money out pays
    ///      `⌊(poolWad − target)/scale⌋`. The pool opens at `costUp(seedShares(SEED·scale))`,
    ///      which is ≤ `SEED·scale` by construction of `seedShares`. So user outflow ≤ pool
    ///      inflow + SEED, and `ghostTokensIn` is ≥ pool inflow because it also counts the fee
    ///      leg of every buy. The inequality therefore still has genuine slack — the accrued
    ///      fees — but no longer any that was simply asserted.
    function invariant_userOutflowNeverExceedsInflow() public view {
        assertLe(handler.ghostTokensOut(), handler.ghostTokensIn() + SEED, "money out > money in");
    }

    /// @notice No arithmetic path may Panic. These are INV-3's teeth: a `redeem` that underflows
    ///         at `poolWad -= payoutWad` would be swallowed by the handler's try/catch, and
    ///         without this guard the whole suite would be green on top of locked user funds.
    function invariant_noArithmeticPanic() public view {
        assertFalse(handler.sawArithmeticPanic(), "a call reverted with an arithmetic Panic");
    }

    /// @notice Every action that clears all of its preconditions MUST land.
    /// @dev This is what separates a real handler from a decorative one: a suite in which 95% of
    ///      calls revert explores nothing, and stays green.
    function invariant_handlerCallsLandAsPredicted() public view {
        if (handler.unexpectedReverts() != 0) {
            console.log("last unexpected revert:");
            console.logBytes(handler.lastUnexpectedRevert());
        }
        assertEq(handler.unexpectedReverts(), 0, "an action that cleared its preconditions still reverted");
        assertEq(handler.gatedActions(), handler.landedActions(), "the gated/landed bookkeeping does not balance");
    }

    function afterInvariant() public view {
        assertEq(handler.unexpectedReverts(), 0, "an action that cleared its preconditions still reverted");
        assertEq(handler.gatedActions(), handler.landedActions(), "the gated/landed bookkeeping does not balance");
        _logCoverage();
    }

    function _logCoverage() internal view {
        console.log("--- coverage of the last run (actions that LANDED) ---");
        console.log("buy                 ", handler.callsBuy());
        console.log("sell                ", handler.callsSell());
        console.log("addLiquidity        ", handler.callsAddLiquidity());
        console.log("removeLiquidity     ", handler.callsRemoveLiquidity());
        console.log("roundTrip (INV-5)   ", handler.callsRoundTrip());
        console.log("warpForward         ", handler.callsWarp());
        console.log("togglePause         ", handler.callsPauseToggle());
        console.log("pausedEntryBlocked  ", handler.callsPausedEntryBlocked());
        console.log("pausedSell          ", handler.callsPausedSell());
        console.log("pausedRemoveLiq     ", handler.callsPausedRemoveLiquidity());
        console.log("pausedRedeem        ", handler.callsPausedRedeem());
        console.log("pausedLiquidate     ", handler.callsPausedLiquidate());
        console.log("close               ", handler.callsClose());
        console.log("markProposed        ", handler.callsPropose());
        console.log("markDisputed        ", handler.callsDispute());
        console.log("settle              ", handler.callsSettle());
        console.log("fail                ", handler.callsFail());
        console.log("  of which permless ", handler.callsFailPermissionless());
        console.log("void                ", handler.callsVoid());
        console.log("redeem              ", handler.callsRedeem());
        console.log("liquidate           ", handler.callsLiquidate());
        console.log("sweepUnclaimed      ", handler.callsSweep());
        console.log("exit rejected swept ", handler.callsPostSweepRejected());
        console.log("gated / landed      ", handler.gatedActions(), handler.landedActions());
        console.log("tokens in / out     ", handler.ghostTokensIn(), handler.ghostTokensOut());
        console.log("worst INV-9 drift   ", handler.worstInv9Drift(), "bound", handler.worstInv9Bound());
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  DETERMINISTIC coverage gates
    // ═══════════════════════════════════════════════════════════════════════
    //
    //  Foundry rolls state back to the setUp point between runs, so the ghost counters cannot
    //  accumulate across runs, and demanding "every action lands" per run is probabilistic (a
    //  single run cannot settle, fail, AND void at once). The coverage gates are therefore
    //  deterministic: the three tests below drive the same handler through a fixed-seed
    //  sequence and FAIL if even one action never lands. The call distribution of the random
    //  campaign itself is reported by Foundry (its per-selector metrics table) and by
    //  `afterInvariant` above.

    function test_coverage_settlePath() public {
        _tradePhase();
        _warpPastTradingEnd();
        _advanceThroughProposedAndDisputed();
        handler.resolve(2); // 2 % 3 == 2 -> settle
        assertEq(uint256(m.status()), uint256(IMarket.Status.Settled), "settle did not happen");

        handler.togglePause();
        handler.exitWhilePaused(0, 0);
        handler.togglePause();
        for (uint256 i = 0; i < 4; ++i) {
            handler.claim(i);
        }

        _assertTradingCoverage();
        assertGt(handler.callsClose(), 0, "close never landed");
        assertGt(handler.callsPropose(), 0, "markProposed never landed");
        assertGt(handler.callsDispute(), 0, "markDisputed never landed");
        assertGt(handler.callsSettle(), 0, "settle never landed");
        assertGt(handler.callsPausedRedeem(), 0, "redeem while paused never landed");
        assertGt(handler.callsRedeem(), 0, "redeem never landed");
        assertEq(handler.unexpectedReverts(), 0, "an action with satisfied preconditions still reverted");
        _logCoverage();
    }

    function test_coverage_failPath() public {
        _tradePhase();
        _warpPastTradingEnd();
        _advanceThroughProposedAndDisputed();
        // A market resting at `Proposed` gets the grace period ON TOP of its deadline
        // before anyone but the module may fail it, so the clock has to be taken past
        // that too. Without this the call still lands — through the module-authorised
        // branch — and the coverage assertion below would pass while covering the wrong
        // path, which is exactly the failure it exists to catch.
        if (m.status() == IMarket.Status.Proposed) {
            vm.warp(m.settlementDeadline() + config.params(ConfigKeys.PROPOSED_FAIL_GRACE));
        }
        handler.resolve(1); // 1 % 3 == 1 -> fail
        assertEq(uint256(m.status()), uint256(IMarket.Status.Failed), "fail did not happen");

        handler.togglePause();
        handler.exitWhilePaused(0, 0);
        handler.togglePause();
        for (uint256 i = 0; i < 4; ++i) {
            handler.claim(i);
        }

        _assertTradingCoverage();
        assertGt(handler.callsFail(), 0, "fail never landed");
        // `_warpPastTradingEnd` lands exactly on `settlementDeadline` (8h window + 4×3h), and the
        // warp above carries a proposed market past its grace period, so this path takes the
        // PERMISSIONLESS branch of `fail()` — the one a real deployment falls back on when the
        // committee never reports. The module-authorised branch is covered by
        // `MarketLifecycleTest.test_anyoneCanFailAfterSettlementDeadline` and by the random
        // campaign, which reaches `fail` before the deadline too.
        assertEq(handler.callsFailPermissionless(), handler.callsFail(), "fail did not take the permissionless path");
        assertGt(handler.callsPausedLiquidate(), 0, "liquidate while paused never landed");
        assertGt(handler.callsLiquidate(), 0, "liquidate never landed");
        assertTrue(handler.allPositionsCleared(), "positions still remain");

        // INV-4b on a sequence that was actually executed, not only on a directed fixture.
        uint256 tol = InvariantBounds.inv4LiquidationDust(m.qArray(), handler.callsLiquidate());
        assertLe(m.poolWad(), tol, "INV-4b failed on the coverage path");
        console.log("INV-4 dust / bound  ", m.poolWad(), tol);
        assertEq(handler.unexpectedReverts(), 0, "an action with satisfied preconditions still reverted");
        _logCoverage();
    }

    function test_coverage_voidPath() public {
        _tradePhase();
        _warpPastTradingEnd();
        handler.resolve(0); // 0 % 3 == 0 -> void (needs status Open, hence no close)
        assertEq(uint256(m.status()), uint256(IMarket.Status.Voided), "void did not happen");

        handler.togglePause();
        handler.exitWhilePaused(0, 0);
        handler.togglePause();
        for (uint256 i = 0; i < 4; ++i) {
            handler.claim(i);
        }

        _assertTradingCoverage();
        assertGt(handler.callsVoid(), 0, "void never landed");
        assertGt(handler.callsLiquidate(), 0, "liquidate never landed");
        assertTrue(handler.allPositionsCleared(), "positions still remain");
        uint256 tol = InvariantBounds.inv4LiquidationDust(m.qArray(), handler.callsLiquidate());
        assertLe(m.poolWad(), tol, "INV-4b failed on the void path");
        assertEq(handler.unexpectedReverts(), 0, "an action with satisfied preconditions still reverted");
        _logCoverage();
    }

    /// @notice The post-sweep regime, driven through the HANDLER rather than through a directed
    ///         fixture — so that the same gates the random campaign relies on are the ones under
    ///         test.
    /// @dev One claimant exits before the window closes and the rest never do; that asymmetry is
    ///      the entire point of the sweep and is what leaves unclaimed liability behind.
    function test_coverage_sweepPath() public {
        _tradePhase();
        _warpPastTradingEnd();
        _advanceThroughProposedAndDisputed();
        handler.resolve(2); // settle
        handler.claim(0); // exactly one claimant exits in time

        handler.sweep(0); // 0 % 6 == 0 -> sweeps; carries its own 365-day warp
        assertGt(handler.callsSweep(), 0, "sweepUnclaimed never landed");
        assertEq(m.poolWad(), 0, "the pool is not empty after a sweep");
        assertGe(usdc.balanceOf(address(m)), m.collateralOwed(), "INV-2: insolvent after the sweep");

        // Every remaining exit — plain, and while paused — must now reject with AlreadySwept.
        for (uint256 i = 0; i < 4; ++i) {
            handler.claim(i);
        }
        handler.togglePause();
        handler.exitWhilePaused(0, 0);
        handler.togglePause();

        assertGt(handler.callsPostSweepRejected(), 0, "no exit was ever probed after the sweep");
        assertEq(handler.sweepLeaks(), 0, "an exit did not reject cleanly after the sweep");
        assertEq(handler.inv10Violations(), 0, "INV-10 violated on the sweep path");
        assertFalse(handler.sawArithmeticPanic(), "an exit Panicked after the sweep");
        assertEq(handler.unexpectedReverts(), 0, "an action with satisfied preconditions still reverted");
        _logCoverage();
    }

    function _tradePhase() internal {
        for (uint256 i = 0; i < 8; ++i) {
            uint256 s = uint256(keccak256(abi.encode("brier-invariant", i)));
            handler.buy(i, i, s);
            handler.addLiquidity(i, s >> 8);
            handler.roundTrip(i, i + 1, s >> 16);
            handler.sell(i, i, s >> 24);
            handler.removeLiquidity(i, s >> 32);
            handler.togglePause();
            handler.exitWhilePaused(i, i); // even kindSeed: sell first
            handler.exitWhilePaused(i, i + 1); // odd kindSeed: withdraw liquidity first
            handler.togglePause();
        }
    }

    /// @dev Warps until the SETTLEMENT DEADLINE, not merely past `tradingEnd`. Derived from the
    ///      market rather than from a fixed count of 3-hour hops: the old `4 × 3 hours` was
    ///      exactly enough for an 8-hour trading window and silently stops being enough the
    ///      moment `INV_TRADING_WINDOW` moves.
    function _warpPastTradingEnd() internal {
        while (block.timestamp < m.settlementDeadline()) {
            handler.warpForward(3 hours);
        }
        assertGe(block.timestamp, m.tradingEnd(), "failed to get past tradingEnd");
        assertGe(block.timestamp, m.settlementDeadline(), "failed to get past settlementDeadline");
    }

    function _advanceThroughProposedAndDisputed() internal {
        handler.advanceStatus(0); // Open -> Closed
        handler.advanceStatus(0); // Closed -> Proposed
        handler.advanceStatus(0); // Proposed -> Disputed
        handler.advanceStatus(0); // Disputed -> Proposed
    }

    function _assertTradingCoverage() internal view {
        assertGt(handler.callsBuy(), 0, "buy never landed");
        assertGt(handler.callsSell(), 0, "sell never landed");
        assertGt(handler.callsAddLiquidity(), 0, "addLiquidity never landed");
        assertGt(handler.callsRemoveLiquidity(), 0, "removeLiquidity never landed");
        assertGt(handler.callsRoundTrip(), 0, "roundTrip (INV-5) never landed");
        assertGt(handler.callsWarp(), 0, "warpForward never landed");
        assertGt(handler.callsPauseToggle(), 0, "togglePause never landed");
        assertGt(handler.callsPausedEntryBlocked(), 0, "the entrance while paused was never exercised");
        assertGt(handler.callsPausedSell(), 0, "sell while paused never landed");
        assertGt(handler.callsPausedRemoveLiquidity(), 0, "removeLiquidity while paused never landed");
        assertEq(handler.inv5Violations(), 0, "INV-5 violated on the coverage path");
        assertEq(handler.inv9Violations(), 0, "INV-9 violated on the coverage path");
        assertEq(handler.inv10Violations(), 0, "INV-10 violated on the coverage path");
        assertEq(handler.pauseLeaks(), 0, "the pause leaked on the coverage path");
    }
}

/// @title MarketInvariantsZeroFeeTest
/// @notice The whole INV-1..10 campaign again, on a market born with `FEE_BPS = 0`.
///
/// @dev Not a duplicate run for its own sake. Until now every STATEFUL invariant in this repo was
///      exercised against a 1% fee, and a 1% fee papers over almost every rounding error: a
///      round-trip can only profit if its rounding error exceeds roughly 2% of the trade value,
///      and the pool is handed a 1% cushion on every buy and every sell. With the fee removed,
///      the only thing standing between the pool and a leak is the direction discipline — money
///      in through `ceilDiv`, money out through floor division.
///
///      The observation was already written down for ONE directed fuzz test
///      (`testFuzz_INV5_roundTripNeverProfitsWithoutFee`) and then not applied to the stateful
///      suite, where an arbitrary order flow can compose thousands of roundings that a two-call
///      directed test cannot. `FEE_BPS = 0` is inside DeployLib's [0, 300] bounds, so this is a
///      configuration the protocol may genuinely ship, not a synthetic one.
///
///      Everything else — the handler, the selectors, the invariants, the coverage gates — is
///      inherited unchanged, so the two campaigns cannot drift apart.
/// forge-config: default.invariant.fail-on-revert = true
/// forge-config: ci.invariant.fail-on-revert = true
contract MarketInvariantsZeroFeeTest is MarketInvariantsTest {
    function _campaignFeeBps() internal pure override returns (uint256) {
        return 0;
    }

    function test_theCampaignReallyRunsWithoutAFee() public view {
        assertEq(m.feeBps(), 0, "the fee was not actually removed");
    }
}

/// @title MarketInvariantsDirectedTest
/// @notice Directed and closed-form fuzz tests accompanying the stateful suite: a random
///         sequence does not necessarily reach the extreme regimes (q near MAX_Q, extreme
///         skew), which is exactly where the derived INV-4/INV-9 bounds are most interesting.
contract MarketInvariantsDirectedTest is Fixtures {
    Market internal m;

    function setUp() public {
        _deployBase();
        m = _newMarket(SEED);
    }

    // ── INV-3 & INV-4 ────────────────────────────────────────────────────────

    function test_INV3_INV4_claimsNeverExceedPool() public {
        _fund(alice, 1_000_000e6, address(m));
        vm.prank(alice);
        m.buy(1, 800e18, type(uint256).max, alice);

        uint256 poolTokens = usdc.balanceOf(address(m)) - m.feeAccrued() - m.settlementDeposit();
        uint256[2] memory q = m.qArray();
        vm.warp(m.settlementDeadline());
        m.fail();
        uint256 poolAtFail = m.poolWad();

        vm.prank(alice);
        uint256 a = m.liquidate(alice);
        vm.prank(creator);
        uint256 c = m.liquidate(creator);

        assertLe(a + c, poolTokens, "INV-3: claims exceed the pool collateral");
        assertLe(a + c, poolAtFail / m.scale(), "INV-4a: claims exceed poolWad at resolution");

        uint256 tol = InvariantBounds.inv4LiquidationDust(q, 2);
        assertLe(m.poolWad(), tol, "INV-4b: pool not drained within the derived bound");
        console.log("INV-4 dust / bound  ", m.poolWad(), tol);
    }

    /// @notice The scaling experiment the Task 16 reviewer ran, turned into a test.
    /// @dev Proves two things at once: liquidation dust grows LINEARLY with (q₀+q₁), and the
    ///      derived bound still contains it at every scale. A small constant — or the `< scale`
    ///      Task 16 used — would fail at the upper end of this range.
    function test_INV4_liquidationDustScalesLinearlyWithQ() public {
        uint256[5] memory mults = [uint256(1), 1e3, 1e6, 1e9, 1e12];
        for (uint256 i = 0; i < 5; ++i) {
            Market mm = _newMarket(SEED);
            _fund(alice, type(uint128).max, address(mm));
            _fund(bob, type(uint128).max, address(mm));

            vm.prank(alice);
            mm.buy(1, 400e18 * mults[i], type(uint256).max, alice);
            vm.prank(bob);
            mm.buy(0, 150e18 * mults[i], type(uint256).max, bob);

            uint256[2] memory q = mm.qArray();
            vm.warp(mm.settlementDeadline());
            mm.fail();

            vm.prank(alice);
            mm.liquidate(alice);
            vm.prank(bob);
            mm.liquidate(bob);
            vm.prank(creator);
            mm.liquidate(creator);

            uint256 tol = InvariantBounds.inv4LiquidationDust(q, 3);
            console.log("scale", mults[i]);
            console.log("  q0+q1 / dust / bound", q[0] + q[1], mm.poolWad(), tol);
            assertLe(mm.poolWad(), tol, "INV-4b failed at one of the scales");
            assertEq(mm.status() == IMarket.Status.Failed, true, "status is not Failed");
        }
    }

    function testFuzz_INV4_liquidationDustWithinDerivedBound(uint96 flow0, uint96 flow1) public {
        _fund(alice, type(uint128).max, address(m));
        _fund(bob, type(uint128).max, address(m));

        // The size is COMPUTED FIRST, outside the argument list: `_boundBuySize` calls a view on
        // `m`, and `vm.prank` binds to the very NEXT external call — putting it inside the
        // argument list lets `minTradeTokens()` eat the prank and `buy` execute as the test
        // contract (which shows up as `ERC20InsufficientAllowance`, not as an invariant
        // failure: a test failing for the wrong reason).
        uint256 f1 = _boundBuySize(1, flow1);
        vm.prank(alice);
        m.buy(1, f1, type(uint256).max, alice);

        uint256 f0 = _boundBuySize(0, flow0);
        vm.prank(bob);
        m.buy(0, f0, type(uint256).max, bob);

        uint256[2] memory q = m.qArray();
        vm.warp(m.settlementDeadline());
        m.fail();

        vm.prank(alice);
        m.liquidate(alice);
        vm.prank(bob);
        m.liquidate(bob);
        vm.prank(creator);
        m.liquidate(creator);

        assertLe(m.poolWad(), InvariantBounds.inv4LiquidationDust(q, 3), "INV-4b");
    }

    // ── INV-5 ────────────────────────────────────────────────────────────────

    function testFuzz_INV5_roundTripNeverProfits(uint96 amount, uint256 outcomeSeed) public {
        uint256 size = bound(uint256(amount), 3e18, 1e22);
        uint8 o = uint8(outcomeSeed % 2);
        _fund(alice, 100_000_000e6, address(m));
        uint256 before = usdc.balanceOf(alice);

        vm.startPrank(alice);
        m.buy(o, size, type(uint256).max, alice);
        m.sell(o, size, 0, alice);
        vm.stopPrank();

        assertLe(usdc.balanceOf(alice), before, "INV-5: the round-trip profited");
    }

    /// @dev A 1% fee papers over almost every rounding error: with the fee on, a round-trip can
    ///      profit only if its rounding error exceeds ~2% of the trade value — so the fee-paying
    ///      version above tests almost nothing about rounding. This market is born with
    ///      FEE_BPS = 0 (a valid value under DeployLib's [0, 300] bounds), so the only thing
    ///      protecting the pool is the direction discipline: money in uses `ceilDiv`, money out
    ///      uses floor division.
    function testFuzz_INV5_roundTripNeverProfitsWithoutFee(uint96 amount, uint256 outcomeSeed) public {
        config.setParam(ConfigKeys.FEE_BPS, 0);
        Market zf = _newMarket(SEED);
        assertEq(zf.feeBps(), 0, "the market should be born with no fee");

        uint256 size = bound(uint256(amount), 3e18, 1e22);
        uint8 o = uint8(outcomeSeed % 2);
        _fund(alice, 100_000_000e6, address(zf));
        uint256 before = usdc.balanceOf(alice);

        vm.startPrank(alice);
        zf.buy(o, size, type(uint256).max, alice);
        zf.sell(o, size, 0, alice);
        vm.stopPrank();

        assertLe(usdc.balanceOf(alice), before, "INV-5: the round-trip profited with no fee");
    }

    // ── INV-7 ────────────────────────────────────────────────────────────────

    /// @dev The INV-7 worst case: the ENTIRE order flow onto one side, and then that side wins.
    function testFuzz_INV7_creatorLossBoundedOnSettle(uint96 flow) public {
        uint256 size = bound(uint256(flow), 3e18, 1e26);
        _fund(alice, type(uint128).max, address(m));
        vm.prank(alice);
        m.buy(1, size, type(uint256).max, alice);

        vm.warp(m.tradingEnd());
        m.close();
        vm.prank(resolutionModule);
        m.settle(1);

        vm.prank(creator);
        uint256 back = m.redeem(creator);
        assertGe(back * 10_000, SEED * 7_070, "INV-7: creator loss > 29.30% on settle");
        // The tight bound: recovery is never below the seed shares themselves.
        assertGe(back, m.creatorSeed()[1] / m.scale() - 1, "INV-7: below the tight bound s");
    }

    /// @dev The other side of the regime: on Failed/Voided the creator is paid s·(p₀+p₁), and
    ///      (q₀+q₁)/C(q) ≥ 1 for any q, so the same 70.70% bound holds.
    function testFuzz_INV7_creatorLossBoundedOnFailure(uint96 flow) public {
        uint256 size = bound(uint256(flow), 3e18, 1e26);
        _fund(alice, type(uint128).max, address(m));
        vm.prank(alice);
        m.buy(1, size, type(uint256).max, alice);

        vm.warp(m.settlementDeadline());
        m.fail();

        vm.prank(creator);
        uint256 back = m.liquidate(creator);
        assertGe(back * 10_000, SEED * 7_070, "INV-7: creator loss > 29.30% on fail");
    }

    /// @notice The GENERAL INV-7 bound, on a provider who is not the creator.
    ///
    /// @dev Until now every INV-7 assertion in this repo used 7070/10000 against the creator,
    ///      whose seed is symmetric by construction — so the corrected general form
    ///      (`recovery ≥ deposit × min(p₀,p₁) at entry`) was stated in the spec and asserted
    ///      nowhere. That is the exact shape of the original error: a special case, verified
    ///      thoroughly, mistaken for the rule.
    ///
    ///      The sequence below is the worst case the spec's proof describes. An LP enters on a
    ///      book already skewed toward YES, so the marginal price of NO — the side that will
    ///      eventually win — is small at the moment of entry. Then NO is bought until it
    ///      dominates, which drives `C(q_f)/q_{f,NO}` toward 1 and therefore drives the LP's
    ///      recovery down to its floor of `deposit × p_NO`.
    ///
    ///      An LP who enters and is never traded against gets the whole deposit back: the
    ///      payout is `λq_w·C(q_f)/q_{f,w}`, and with `q_f = q(1+λ)` that collapses to `λC(q)`,
    ///      which is the deposit. The loss is other people's order flow, not the entry itself —
    ///      which is why `test_lpLossOnASkewedBookExceedsTheSymmetricConstant` below needs the
    ///      flood to say anything at all.
    function test_lpRecoveryRespectsTheGeneralBoundOnASkewedBook() public {
        _fund(alice, type(uint128).max, address(m));
        _fund(bob, type(uint128).max, address(m));

        // Skew the book toward YES, so NO is the cheap side at the moment bob enters.
        vm.prank(alice);
        m.buy(1, 4_000e18, type(uint256).max, alice);

        uint256 pNoAtEntry = m.marginalPrice(0);
        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        m.addLiquidity(500e6, 0, bob);
        uint256 deposited = bobBefore - usdc.balanceOf(bob);
        assertGt(deposited, 0, "precondition: the LP actually paid something");

        // Now flood the side that was cheap, so it wins from far behind.
        vm.prank(alice);
        m.buy(0, 400_000e18, type(uint256).max, alice);

        vm.warp(m.tradingEnd());
        m.close();
        vm.prank(resolutionModule);
        m.settle(0);

        vm.prank(bob);
        uint256 back = m.redeem(bob);

        // The bound is `deposit × min(p₀,p₁) at entry`; here NO is the cheaper side, and it is
        // also the winner, which is the worst case rather than a coincidence.
        uint256 floorTokens = Math.mulDiv(deposited, Math.min(pNoAtEntry, m.marginalPrice(1)), DPMMath.WAD);
        // One token unit of slack, and it is derived rather than chosen: every intermediate
        // floor in this path (λ, minted[i], the payout mulDiv) loses less than one wei at WAD
        // scale, and WAD-scale dust divided by `scale` (1e12) reaches zero tokens. Only the
        // final division into token units can cost a whole unit.
        assertGe(back + 1, floorTokens, "INV-7 general: recovery below deposit x min(p) at entry");
    }

    /// @dev The corollary that kills the constant. If 29.29% were a universal bound, this
    ///      assertion could not hold — and the whole point of the correction is that it does.
    ///      The number is not asserted as a target; what is asserted is that the symmetric
    ///      constant is BREACHED, which is a property of the book's skew alone.
    function test_lpLossOnASkewedBookExceedsTheSymmetricConstant() public {
        _fund(alice, type(uint128).max, address(m));
        _fund(bob, type(uint128).max, address(m));

        vm.prank(alice);
        m.buy(1, 4_000e18, type(uint256).max, alice);
        assertLt(m.marginalPrice(0), (DPMMath.WAD * 7_070) / 10_000, "precondition: NO is priced below 1/sqrt(2)");

        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        m.addLiquidity(500e6, 0, bob);
        uint256 deposited = bobBefore - usdc.balanceOf(bob);

        vm.prank(alice);
        m.buy(0, 400_000e18, type(uint256).max, alice);

        vm.warp(m.tradingEnd());
        m.close();
        vm.prank(resolutionModule);
        m.settle(0);

        vm.prank(bob);
        uint256 back = m.redeem(bob);

        assertLt(
            back * 10_000,
            deposited * 7_070,
            "a proportional LP on a skewed book must be able to lose more than the symmetric 29.30%"
        );
        console.log("LP deposit / recovery", deposited, back);
    }

    // ── INV-8 ─────────────────────────────────────────────────────────────

    /// @dev Extreme skew is where the probability sum is most likely to slip; the 2 wei bound in
    ///      INV-8 does not scale with q, so it must be tested precisely here.
    function testFuzz_INV8_probabilitiesSumToOneUnderSkew(uint96 flow, uint256 outcomeSeed) public {
        uint256 size = bound(uint256(flow), 3e18, 1e28);
        uint8 o = uint8(outcomeSeed % 2);
        _fund(alice, type(uint128).max, address(m));
        vm.prank(alice);
        m.buy(o, size, type(uint256).max, alice);

        uint256 sum = m.probability(0) + m.probability(1);
        assertLe(sum, DPMMath.WAD, "INV-8: exceeds WAD");
        assertLe(DPMMath.WAD - sum, 2, "INV-8: deficit > 2 wei");
    }

    // ── INV-9 ────────────────────────────────────────────────────────────────

    function testFuzz_INV9_addLiquidityIsNeutral(uint96 tradeSize, uint96 lpSize) public {
        uint256 size = bound(uint256(tradeSize), 3e18, 1e24);
        uint256 lp = bound(uint256(lpSize), 10e6, 1_000_000e6);
        _fund(alice, type(uint128).max, address(m));
        _fund(bob, type(uint128).max, address(m));

        vm.prank(alice);
        m.buy(1, size, type(uint256).max, alice);

        uint256[2] memory q = m.qArray();
        uint256 p0 = m.probability(0);
        uint256 p1 = m.probability(1);

        vm.prank(bob);
        m.addLiquidity(lp, 0, bob);

        uint256 tol = InvariantBounds.inv9ProbabilityDrift(q);
        assertLe(_absDiff(m.probability(0), p0), tol, "INV-9: P(0) drifted outside the derived bound");
        assertLe(_absDiff(m.probability(1), p1), tol, "INV-9: P(1) drifted outside the derived bound");
    }

    // ── INV-10 ───────────────────────────────────────────────────────────────

    function test_INV10_exitsAlwaysWorkWhilePaused() public {
        _fund(alice, 1_000_000e6, address(m));
        _fund(bob, 1_000_000e6, address(m));
        vm.prank(alice);
        m.buy(1, 300e18, type(uint256).max, alice);
        vm.prank(bob);
        m.addLiquidity(500e6, 0, bob);

        vm.prank(guardian);
        config.pause();

        // The dual: the ENTRANCE must be closed, and with the ProtocolPaused selector — not some
        // other revert that happens to fire first. `_requireTradable` runs first in
        // `buy`/`addLiquidity`, and the status/time here have already been confirmed valid.
        vm.prank(alice);
        vm.expectRevert(Market.ProtocolPaused.selector);
        m.buy(1, 10e18, type(uint256).max, alice);

        vm.prank(bob);
        vm.expectRevert(Market.ProtocolPaused.selector);
        m.addLiquidity(100e6, 0, bob);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        uint256 sold = m.sell(1, 100e18, 0, alice);
        assertGt(sold, 0, "INV-10: sell while paused paid nothing");
        assertEq(usdc.balanceOf(alice), aliceBefore + sold, "INV-10: the sell tokens never arrived");

        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        uint256 pulled = m.removeLiquidity(1e16, 0, bob);
        assertGt(pulled, 0, "INV-10: removeLiquidity while paused paid nothing");
        assertEq(usdc.balanceOf(bob), bobBefore + pulled, "INV-10: the removeLiquidity tokens never arrived");

        vm.warp(m.tradingEnd());
        m.close();
        vm.prank(resolutionModule);
        m.settle(1);

        assertTrue(config.paused(), "the pause must still be on while redeeming");
        uint256 aliceMid = usdc.balanceOf(alice);
        vm.prank(alice);
        uint256 redeemed = m.redeem(alice);
        assertGt(redeemed, 0, "INV-10: redeem while paused paid nothing");
        assertEq(usdc.balanceOf(alice), aliceMid + redeemed, "INV-10: the redeem tokens never arrived");
    }

    /// @dev The fourth exit path: `liquidate` while paused. Task 16 tested only `redeem`.
    function test_INV10_liquidateWorksWhilePaused() public {
        _fund(alice, 1_000_000e6, address(m));
        vm.prank(alice);
        m.buy(1, 300e18, type(uint256).max, alice);

        vm.warp(m.settlementDeadline());
        m.fail();

        vm.prank(guardian);
        config.pause();

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        uint256 got = m.liquidate(alice);
        assertGt(got, 0, "INV-10: liquidate while paused paid nothing");
        assertEq(usdc.balanceOf(alice), before + got, "INV-10: the liquidate tokens never arrived");
        assertEq(shares.balanceOfOutcome(alice, address(m), 1), 0, "the position was not cleared");
    }

    // ── the post-sweep regime ────────────────────────────────────────────────

    /// @notice The post-sweep regime, from the outside: still solvent, pool empty, and no exit
    ///         for any holder can produce an arithmetic Panic.
    ///
    /// @dev `sweepUnclaimed` used to be absent from the stateful handler — first because `redeem`
    ///      panicked afterwards and a known Panic would have forced `invariant_noArithmeticPanic`
    ///      to be weakened (INV-3's teeth), and then, once that was fixed, because
    ///      `SWEEP_UNCLAIMED_AFTER` is 365 days while `warpForward` is capped at 3 hours and a
    ///      fuzz sequence could never reach the window.
    ///
    ///      It is no longer absent. `MarketHandler.sweep` carries its own warp, so the largest
    ///      single money movement in this contract — the entire collateral balance, in one
    ///      transfer — is now inside the random campaign, guarded by
    ///      `invariant_claimWindowClosesCleanly` and reached by `test_coverage_sweepPath`.
    ///
    ///      This test stays, and is not redundant: it asserts the regime through the MARKET's own
    ///      interface with `expectRevert` bound to the selector, whereas the handler necessarily
    ///      observes it through try/catch and a counter.
    function test_postSweepRegimeIsConsistentAndPanicFree() public {
        _fund(alice, 1_000_000e6, address(m));
        _fund(bob, 1_000_000e6, address(m));
        vm.prank(alice);
        m.buy(1, 400e18, type(uint256).max, alice);
        vm.prank(bob);
        m.buy(0, 150e18, type(uint256).max, bob);

        vm.warp(m.settlementDeadline());
        m.fail();

        // One holder claims before the window closes; the others never do. That asymmetry is
        // the whole point of the sweep, and it is what leaves unclaimed liability behind.
        vm.prank(alice);
        assertGt(m.liquidate(alice), 0, "precondition: a normal exit still works before the sweep");

        vm.warp(block.timestamp + config.params(ConfigKeys.SWEEP_UNCLAIMED_AFTER));
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        m.sweepUnclaimed();

        assertGt(usdc.balanceOf(treasury) - treasuryBefore, 0, "the unclaimed remainder reached the Treasury");
        assertEq(m.poolWad(), 0, "the pool is empty after a sweep");
        // INV-2 still holds, and not vacuously: it is an inequality over what the contract
        // owes, and a sweep that left liability behind while taking the collateral would
        // break it.
        assertGe(usdc.balanceOf(address(m)), m.collateralOwed(), "INV-2: still solvent after the sweep");

        // The claim window is closed for everyone, including the holder who never claimed and
        // the creator whose seed is still recorded. `expectRevert` binds to the selector, so a
        // Panic here would fail rather than pass.
        address[3] memory stragglers = [bob, creator, alice];
        for (uint256 i = 0; i < 3; ++i) {
            vm.prank(stragglers[i]);
            vm.expectRevert(Market.AlreadySwept.selector);
            m.liquidate(stragglers[i]);
        }
    }

    /// @dev The buy size is BOUNDED relative to the LIVE q, not to a fixed range. After a first
    ///      leg that may be enormous, any FIXED share count on the other side falls below
    ///      MIN_TRADE_TOKENS (that side's marginal price approaches zero) and reverts
    ///      `TradeTooSmall` — which is a wrong fuzz bound, not an invariant violation. The floor
    ///      is derived from the live marginal price, with 2× padding for the price decline over
    ///      the course of the trade.
    function _boundBuySize(uint8 o, uint256 seed) internal view returns (uint256) {
        uint256 lo = Math.mulDiv(m.minTradeTokens() * m.scale(), DPMMath.WAD, m.marginalPrice(o)) * 2;
        uint256 hi = lo > 1e26 ? lo * 4 : 1e26;
        uint256 qo = m.qArray()[o];
        uint256 headroom = DPMMath.MAX_Q > qo ? DPMMath.MAX_Q - qo : 0;
        if (hi > headroom) hi = headroom;
        if (lo > hi) lo = hi;
        return bound(seed, lo, hi);
    }

    function _absDiff(uint256 x, uint256 y) internal pure returns (uint256) {
        return x > y ? x - y : y - x;
    }
}
