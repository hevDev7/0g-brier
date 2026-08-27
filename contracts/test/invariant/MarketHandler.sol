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

/// @title MarketHandler
/// @notice Menjalankan aksi acak TERBATAS terhadap satu Market dan mencatat variabel hantu
///         untuk pemeriksaan konservasi INV-1..10.
///
/// @dev Empat keputusan desain yang membuat suite ini bukan hiasan:
///
///      1. **Setiap aksi memakai KUOTASI kontrak sendiri sebagai prakondisi.** `quoteBuy`
///         dan `buy` berbagi `_priceBuy` yang sama (begitu pula `quoteSell`/`sell`), jadi
///         keduanya tidak bisa berbeda formula. Bila kuotasi lolos, eksekusi WAJIB mendarat.
///         Aksi yang lolos seluruh prakondisi dihitung di `gatedActions`; yang benar-benar
///         mendarat di `landedActions`; selisihnya dicatat di `unexpectedReverts`, dan
///         `invariant_handlerCallsLandAsPredicted` menuntut selisih itu NOL. Handler yang
///         menghabiskan run-nya untuk revert akan terlihat langsung, bukan lulus diam-diam.
///
///      2. **Ukuran diskalakan ke state hidup, bukan konstanta.** Rentang beli/setor tetap
///         akan jadi debu (selalu `TradeTooSmall`) pada market besar dan guncangan ekstrem
///         pada market kecil; keduanya berarti run yang tidak mengeksplorasi apa pun.
///
///      3. **Handler TIDAK PERNAH mengassert sendiri.** `foundry.toml` memakai
///         `fail_on_revert = false`; sebuah `assert` yang gagal di dalam handler akan revert,
///         lalu DITELAN oleh runner dan run-nya lulus dengan sebab yang salah (diverifikasi
///         eksperimental sebelum file ini ditulis: 10 panggilan, 10 revert, suite lulus).
///         Karena itu setiap pelanggaran ditulis ke penghitung hantu (`inv5Violations`,
///         `inv9Violations`, `inv10Violations`, `pauseLeaks`, `sawArithmeticPanic`) dan
///         diassert di `MarketInvariants.t.sol` lewat fungsi `invariant_*` — jalur yang
///         TIDAK bisa ditelan.
///
///      4. **`creator` bukan trader.** Ia hanya menyetor benih simetris saat `initialize`
///         dan mengklaim di akhir. INV-7 ("rugi penyedia ≤ 29.30% setoran") hanya berlaku
///         untuk penyedia SIMETRIS — lihat turunannya di `MarketInvariants.t.sol` — jadi
///         posisi creator sengaja dijaga tetap persis `(s, s)` supaya invariannya bermakna
///         alih-alih tercemar oleh perdagangan berarah atau LP yang masuk pada q miring.
contract MarketHandler is CommonBase, StdCheats, StdUtils {
    uint256 internal constant WAD = DPMMath.WAD;

    /// @dev Selector `Panic(uint256)`. Bukan angka ajaib protokol: ini konstanta ABI Solidity.
    bytes4 internal constant PANIC_SELECTOR = 0x4e487b71;

    /// @dev Cukup membiayai pool sampai batas MAX_Q (≈1.4e33 wad ≈ 1.4e21 unit token).
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

    // ── penghitung aksi yang BENAR-BENAR mendarat ────────────────────────────
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

    // ── akuntansi efisiensi handler ──────────────────────────────────────────
    uint256 public gatedActions;
    uint256 public landedActions;
    uint256 public unexpectedReverts;
    bytes public lastUnexpectedRevert;
    bool public sawArithmeticPanic;

    // ── hantu konservasi ─────────────────────────────────────────────────────
    uint256 public ghostTokensIn;
    uint256 public ghostTokensOut;
    uint256 public redeemedTokens;
    uint256 public liquidatedTokens;

    uint256 public poolWadAtResolution;
    uint256[2] internal _qAtResolution;
    bool public resolved;

    /// @dev INV-7: yang benar-benar DISETOR creator. Kontrak tidak menyimpannya dalam bentuk
    ///      ini (hanya lembar benih hasil `seedShares(seedWad)`), jadi dicatat di sini.
    uint256 public creatorDepositTokens;
    uint256 public creatorReturnedTokens;
    bool public creatorHasClaimed;

    // ── penghitung pelanggaran (diassert dari fungsi invariant_) ─────────────
    uint256 public inv5Violations;
    uint256 public inv9Violations;
    uint256 public inv10Violations;
    uint256 public pauseLeaks;
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

    // ── view untuk kontrak invarian ──────────────────────────────────────────

    /// @notice Tiga trader ditambah creator. Setiap lembar — tradable maupun benih — yang
    ///         pernah ada di market ini dipegang salah satu dari keempatnya: handler selalu
    ///         mengirim `to` ke pemanggilnya sendiri dan tidak pernah mentransfer ERC-1155.
    ///         Itulah yang membuat "semua posisi bersih" (INV-4) benar-benar berarti
    ///         "seluruh q sudah dilikuidasi".
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

    /// @notice Benar bila tidak ada satu pun klaimant yang masih memegang apa pun.
    function allPositionsCleared() external view returns (bool) {
        for (uint256 i = 0; i < 4; ++i) {
            if (positionOf(claimants(i)) != 0) return false;
        }
        return true;
    }

    // ── aksi ─────────────────────────────────────────────────────────────────

    function buy(uint256 actorSeed, uint256 outcomeSeed, uint256 amountSeed) external {
        if (!_tradable()) return;
        address a = traders[actorSeed % 3];
        uint8 o = uint8(outcomeSeed % 2);
        uint256 amount = _boundTradeSize(o, amountSeed);
        if (amount == 0) return;
        if (!_buyQuoteClearsMinimum(o, amount)) return;

        ++gatedActions;
        vm.prank(a);
        try market.buy(o, amount, type(uint256).max, a) returns (uint256 paid) {
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

        ++gatedActions;
        vm.prank(a);
        try market.sell(o, amount, 0, a) returns (uint256 got) {
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
        // λ dibatasi ≤ WAD di bawah, jadi q paling banyak menjadi 2q — jaga headroom MAX_Q.
        if (qBefore[0] > DPMMath.MAX_Q / 2 || qBefore[1] > DPMMath.MAX_Q / 2) return;

        uint256 poolTokens = market.poolWad() / market.scale();
        uint256 amount = _bound(amountSeed, poolTokens / 100 + 1, poolTokens + 1);

        uint256 pBefore0 = market.probability(0);
        uint256 pBefore1 = market.probability(1);
        uint256 balBefore = usdc.balanceOf(a);

        ++gatedActions;
        vm.prank(a);
        try market.addLiquidity(amount, 0, a) returns (uint256[2] memory) {
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

        ++gatedActions;
        vm.prank(a);
        try market.removeLiquidity(lambda, 0, a) returns (uint256 got) {
            ghostTokensOut += got;
            ++callsRemoveLiquidity;
            ++landedActions;
        } catch (bytes memory err) {
            _recordFailure(err);
        }
    }

    /// @notice INV-5 — beli lalu jual seketika tidak pernah menguntungkan, pada state APA PUN
    ///         yang dicapai sekuens acak, bukan hanya pada market yang baru lahir.
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

        // Kaki jual boleh saja tidak memenuhi MIN_TRADE_TOKENS setelah harga bergerak; itu
        // bukan pelanggaran, hanya round-trip yang tak selesai — dan trader jelas TIDAK untung.
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

    /// @notice INV-10 — pause menutup SETIAP jalan masuk dan tidak menutup satu pun jalan keluar.
    /// @dev Menyalakan pause sendiri bila belum menyala lalu mengembalikan keadaan semula,
    ///      supaya aksi ini mendarat tanpa bergantung pada `togglePause` yang kebetulan terpilih.
    ///      Sengaja TIDAK menyentuh `gatedActions`/`landedActions`: pembukuannya sendiri
    ///      (`inv10Violations`, `pauseLeaks`, `callsPaused*`) yang jadi bukti.
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

    /// @dev Digerbang oleh `tradingEnd` supaya resolusi tidak mendarat di panggilan pertama
    ///      dan membunuh seluruh cakupan perdagangan run itu.
    function resolve(uint256 seed) external {
        if (block.timestamp < market.tradingEnd()) return;
        IMarket.Status s = market.status();
        if (s == IMarket.Status.Settled || s == IMarket.Status.Failed || s == IMarket.Status.Voided) return;

        uint256 kind = seed % 3;
        if (kind == 0) {
            if (s != IMarket.Status.Open) return; // void hanya sah dari Open
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
            vm.prank(resolutionModule);
            try market.fail() {
                ++callsFail;
                ++landedActions;
                _snapshotResolution();
            } catch (bytes memory err) {
                _recordFailure(err);
            }
        } else {
            if (s == IMarket.Status.Open) return; // settle butuh Closed/Proposed/Disputed
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

    function claim(uint256 actorSeed) external {
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

    // ── internal: gerbang & pembatas ─────────────────────────────────────────

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

    /// @dev λ_max menjaga `take_i = ⌊q_i·λ/WAD⌋ ≤ held_i` di kedua sisi; λ_min menjaga
    ///      `take_i ≥ 1` di sisi terkecil (kalau tidak: `TradeTooSmall`). Lantai benih creator
    ///      tidak pernah tertembus karena `held` milik non-creator selalu ≤ seedSupply − creatorSeed.
    ///      `hi == 0` berarti tidak ada λ yang sah.
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

    /// @dev Perkiraan kasar lembar minimum yang hasil jualnya masih mungkin melewati
    ///      MIN_TRADE_TOKENS (harga marginal turun selama menjual, karena itu padding 50%).
    ///      Otoritasnya tetap `quoteSell` lewat `_sellQuoteClearsMinimum`.
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

    // ── internal: pembukuan ──────────────────────────────────────────────────

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

    /// @dev INV-9. Turunan batasnya ada di `MarketInvariants.t.sol`
    ///      (`invariant_INV9_addLiquidityDoesNotMoveProbability`); di sini hanya dipakai.
    function _checkInv9(uint256[2] memory qBefore, uint256 p0, uint256 p1) internal {
        uint256 tol = Math.ceilDiv(8 * WAD, qBefore[0] + qBefore[1]) + 2;
        uint256 d0 = _absDiff(market.probability(0), p0);
        uint256 d1 = _absDiff(market.probability(1), p1);
        uint256 d = Math.max(d0, d1);
        // `>=` supaya batasnya ikut tercatat walau drift-nya selalu 0 — angka pelaporan
        // "0 dari batas 3" jauh lebih informatif daripada "0 dari batas 0".
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

        // `_requireTradable()` adalah pernyataan PERTAMA di `buy`, dengan urutan
        // NotOpen → TradingEnded → ProtocolPaused. Dua syarat pertama sudah dipastikan LULUS
        // di baris atas, jadi satu-satunya revert yang mungkin di sini adalah ProtocolPaused —
        // bukan `TradeTooSmall`/`SlippageExceeded` yang akan membuat pemeriksaan ini "lulus"
        // karena alasan yang salah. Sengaja TANPA `vm.expectRevert`: cheatcode itu mengikat ke
        // panggilan eksternal berikutnya dan kegagalannya akan ditelan `fail_on_revert = false`.
        vm.prank(t);
        try market.buy(0, 1e18, type(uint256).max, t) returns (uint256) {
            ++pauseLeaks;
        } catch (bytes memory err) {
            if (_selectorOf(err) != Market.ProtocolPaused.selector) ++pauseLeaks;
            else ++callsPausedEntryBlocked;
        }
    }

    /// @dev `kindSeed` menentukan jalan keluar mana yang DICOBA LEBIH DULU saat market masih
    ///      terbuka. Tanpa ini `_pausedSell` hampir selalu menang (posisi tradable jauh lebih
    ///      sering ada daripada tidak) dan `removeLiquidity` saat paused tak pernah teruji.
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

    /// @dev Setiap jalur keluar di bawah membuktikan keluarnya SUNGGUH terjadi — token
    ///      benar-benar masuk dompet, atau posisi benar-benar berkurang — bukan sekadar
    ///      "tidak revert". Panggilan yang revert dicatat sebagai pelanggaran INV-10.
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
            (, uint256 lambda) = _lambdaRange(held); // λ terbesar yang sah: tarik semaksimal mungkin
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

    function _pausedRedeem(uint256 seed) internal returns (bool) {
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

    function _pausedLiquidate(uint256 seed) internal returns (bool) {
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

    // ── internal: util ───────────────────────────────────────────────────────

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
