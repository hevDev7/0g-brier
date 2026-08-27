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

/// @title InvariantBounds
/// @notice Batas debu turunan untuk INV-4 dan INV-9.
///
/// @dev TIDAK ADA konstanta yang dicocokkan ke hasil pengukuran di sini. Setiap batas punya
///      turunan tertulis dan BERSKALA terhadap `q` hidup pada saat diassert. Protokol ini
///      sudah tiga kali digigit konstanta tebakan (`≤ 3` dua kali, melawan 646 wei terukur);
///      aturan yang sudah dibayar mahal: batas debu di sini SELALU berskala q, tidak pernah
///      konstanta. Satu-satunya pengecualian adalah INV-8, dan hanya karena aljabarnya
///      membuatnya begitu (Σqᵢ² = C² persis) — lihat `invariant_INV8_*`.
library InvariantBounds {
    uint256 internal constant WAD = DPMMath.WAD;

    /// @notice INV-4 — sisa `poolWad` setelah SETIAP pemegang melikuidasi.
    ///
    /// @dev Notasi: q = (q₀,q₁) beku sejak resolusi, S = q₀²+q₁², C = √S (real),
    ///      c = ⌊C⌋ = `DPMMath.cost(q)`, P = ⌈C⌉ = `DPMMath.costUp(q)` = `poolWad` saat
    ///      resolusi (INV-1), dan Lᵢ = ⌊qᵢ·WAD/c⌋ = `_liqPerShareWad[i]` yang dipotret
    ///      `_snapshotLiquidation`. Tulis Lᵢ = qᵢ·WAD/c − εᵢ dengan 0 ≤ εᵢ < 1.
    ///
    ///      `liquidate` membayar pemegang h sebanyak Σᵢ ⌊a_{h,i}·Lᵢ/WAD⌋ — satu floor per
    ///      outcome yang tak nol. Karena setiap lembar (tradable maupun benih) dipegang salah
    ///      satu klaimant dan tak pernah ditransfer keluar, Σ_h a_{h,i} = qᵢ PERSIS. Maka
    ///
    ///        T = Σ_h Σᵢ ⌊a_{h,i}Lᵢ/WAD⌋ > Σᵢ qᵢLᵢ/WAD − N,   N = jumlah kaki tak-nol ≤ 2H
    ///          = S/c − (Σᵢ qᵢεᵢ)/WAD − N
    ///          > S/c − (q₀+q₁)/WAD − N.
    ///
    ///      Sisa = P − T < P − S/c + (q₀+q₁)/WAD + N. Karena c ≤ C ≤ P berlaku
    ///      S/c = C²/c ≥ C, jadi P − S/c ≤ P − C = ⌈C⌉ − C ≤ 1. Dengan pembagian integer
    ///      (q₀+q₁)/WAD ≤ ⌊(q₀+q₁)/WAD⌋ + 1, dan N ≤ 2H:
    ///
    ///        Sisa ≤ ⌊(q₀+q₁)/WAD⌋ + 2H + 1.
    ///
    ///      H = jumlah panggilan `liquidate` yang benar-benar membayar; satu per pemegang,
    ///      karena panggilan kedua dari pemegang yang sama revert `NothingToClaim`.
    ///
    ///      Bila klamp `payoutWad > poolWad` sempat aktif, pool justru terkuras habis
    ///      (Sisa = 0) dan batas ini terpenuhi secara trivial.
    ///
    ///      Suku dominannya LINIER terhadap q₀+q₁ — persis skala yang diukur reviewer Task 16
    ///      pada 1×/10³×/10⁶×/10⁹×. Konstanta kecil apa pun akan lulus pada fixture kecil dan
    ///      gagal pada market yang jauh lebih besar; `< scale` yang dipakai Task 16 pun hanya
    ///      sah untuk skala fixture-nya, bukan untuk seluruh rentang MAX_Q.
    function inv4LiquidationDust(uint256[2] memory q, uint256 liquidators) internal pure returns (uint256) {
        return (q[0] + q[1]) / WAD + 2 * liquidators + 1;
    }

    /// @notice INV-9 — pergeseran `probability` maksimum akibat `addLiquidity` proporsional.
    ///
    /// @dev Sebelum: qᵢ. Sesudah: q'ᵢ = qᵢ + ⌊qᵢ·λ/WAD⌋ = μqᵢ − δᵢ, dengan μ = 1 + λ/WAD ≥ 1
    ///      dan 0 ≤ δᵢ < 1. Dalam aritmetika real q' = μq dan probabilitas TIDAK bergeser
    ///      (C homogen derajat 1); seluruh pergeseran berasal dari dua floor itu.
    ///
    ///      Dengan x = q'₀, y = q'₁ dan P₀ = q₀²/(q₀²+q₁²):
    ///
    ///        P'₀ − P₀ = (xq₁ − q₀y)(xq₁ + q₀y) / [(x²+y²)(q₀²+q₁²)]
    ///
    ///      dan xq₁ − q₀y = (μq₀−δ₀)q₁ − q₀(μq₁−δ₁) = δ₁q₀ − δ₀q₁, jadi |xq₁ − q₀y| < q₀+q₁.
    ///      Selanjutnya xq₁ + q₀y ≤ 2μq₀q₁, dan karena δᵢ < 1 ≤ μ berarti x ≥ μ(q₀−1),
    ///      sehingga x²+y² ≥ μ²((q₀−1)²+(q₁−1)²). Maka
    ///
    ///        |ΔP|/WAD < (q₀+q₁)·2μq₀q₁ / [μ²((q₀−1)²+(q₁−1)²)(q₀²+q₁²)]
    ///                 ≤ 2(q₀+q₁)q₀q₁ / [((q₀−1)²+(q₁−1)²)(q₀²+q₁²)]      [μ ≥ 1]
    ///                 ≤ 8(q₀+q₁)q₀q₁ / (q₀²+q₁²)²                        [qᵢ ≥ 2 ⇒ (qᵢ−1)² ≥ qᵢ²/4]
    ///                 ≤ 4(q₀+q₁) / (q₀²+q₁²)                              [2q₀q₁ ≤ q₀²+q₁²]
    ///                 ≤ 8 / (q₀+q₁).                                      [(q₀+q₁)² ≤ 2(q₀²+q₁²)]
    ///
    ///      `probability()` sendiri membulatkan ke bawah di KEDUA titik ukur, menambah ≤ 2:
    ///
    ///        |P'ukur − Pukur| ≤ ⌈8·WAD/(q₀+q₁)⌉ + 2.
    ///
    ///      Syarat qᵢ ≥ 2 dijamin INV-6 plus MIN_SEED: q awal = `seedShares(seedWad)` dengan
    ///      seedWad ≥ 100e6·1e12, jadi qᵢ ≥ ~7.07e19 dan tidak pernah turun di bawah benih creator.
    ///
    ///      Batas ini MENGECIL saat q membesar (pada q benih fixture ≈ 7.07e20 nilainya 3) dan
    ///      MEMBESAR di rezim degenerata (q = (2,2) → 2e18+2). Itulah sebabnya `± 2 wei` yang
    ///      ditulis spec TIDAK sah untuk invarian ini: ia kebetulan benar pada q realistis dan
    ///      salah secara sewenang-wenang pada q kecil. Kami menurunkan batasnya alih-alih
    ///      membatasi handler, supaya invariannya tetap bermakna pada q berapa pun.
    function inv9ProbabilityDrift(uint256[2] memory q) internal pure returns (uint256) {
        return Math.ceilDiv(8 * WAD, q[0] + q[1]) + 2;
    }
}

/// @title MarketInvariantsTest
/// @notice INV-1..10 sebagai invarian stateful terhadap sekuens panggilan sembarang.
/// @dev `fail-on-revert = true` disetel inline untuk KEDUA profil: setiap panggilan market di
///      dalam handler sudah dibungkus try/catch, jadi handler yang revert sendiri = bug handler,
///      dan harus terlihat, bukan ditelan.
///
///      `depth = 128` (bukan 64 bawaan) DIUKUR, bukan ditebak: pada kedalaman 64 hanya 8 dari
///      20 seed yang sempat menyilangi `tradingEnd`, jadi INV-3/INV-4 — satu-satunya invarian
///      yang hidup di rezim pasca-resolusi — tidak pernah terjangkau di 60% run. Pada 128,
///      15 dari 15 seed mencapai resolusi (5 settle, 7 fail, 3 void) dan seluruhnya sempat
///      mengklaim. Profil `ci` sudah memakai 512×128 dari foundry.toml.
/// forge-config: default.invariant.depth = 128
/// forge-config: default.invariant.fail-on-revert = true
/// forge-config: ci.invariant.fail-on-revert = true
contract MarketInvariantsTest is Fixtures {
    /// @dev Jendela pendek DISENGAJA. `warpForward` dibatasi 3 jam dan ~1/11 panggilan adalah
    ///      warp, jadi jendela 8 jam disilangi kira-kira di pertengahan run: separuh awal
    ///      menguji rezim perdagangan (INV-1/2/5/6/8/9/10), separuh akhir menguji rezim
    ///      resolusi (INV-3/4/7/10). Jendela 7 hari bawaan Fixtures tidak akan pernah
    ///      disilangi pada kedalaman ini, dan INV-3/INV-4 tak akan pernah teruji sama sekali.
    uint64 internal constant INV_TRADING_WINDOW = 8 hours;
    uint64 internal constant INV_SETTLEMENT_WINDOW = 4 hours;

    Market internal m;
    MarketHandler internal handler;
    address internal carol = makeAddr("carol");

    function setUp() public {
        _deployBase();
        m = _newShortWindowMarket();
        handler = new MarketHandler(m, usdc, shares, config, [alice, bob, carol], creator, SEED);

        targetContract(address(handler));
        // Dipilih EKSPLISIT: dibiarkan bawaan, Foundry akan memfuzz setiap fungsi publik yang
        // bisa berubah state pada setiap kontrak yang di-deploy — termasuk `MockUSDC.mintTo`,
        // `ConfigRegistry.setParam`, dan `Market` itu sendiri tanpa pembatas apa pun.
        bytes4[] memory sel = new bytes4[](11);
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

    /// @notice INV-1 — `poolWad == costUp(q)` sebelum resolusi. Toleransi NOL.
    /// @dev Bukan hasil pengukuran: `Market` menyetel `poolWad = target` pada setiap mutasi,
    ///      tidak pernah mengakumulasinya, jadi kesetaraan ini berlaku by construction. Berlaku
    ///      untuk Open DAN Closed/Proposed/Disputed — di ketiga status terakhir `q` dan
    ///      `poolWad` sudah beku dan tidak ada satu pun jalur yang menyentuhnya, jadi
    ///      memasukkannya membuat invarian ini lebih ketat, bukan lebih longgar.
    function invariant_INV1_poolEqualsCostUp() public view {
        if (_resolvedRegime()) return;
        assertEq(m.poolWad(), DPMMath.costUp(m.qArray()), "INV-1: poolWad != costUp(q)");
    }

    /// @notice INV-2 — collateral yang dipegang selalu menutup pool, fee, dan setoran.
    ///         Toleransi NOL (ini pertidaksamaan, bukan kesetaraan).
    function invariant_INV2_collateralCoversObligations() public view {
        assertGe(usdc.balanceOf(address(m)), m.collateralOwed(), "INV-2: market insolven");
    }

    /// @notice INV-3 — Σ redeem tidak pernah melebihi pool saat resolusi. Toleransi NOL.
    /// @dev Setiap `redeem` membayar ⌊payoutWadₕ/scale⌋ dan Σ payoutWadₕ ≤ poolWad (kalau tidak,
    ///      `poolWad -= payoutWad` underflow), jadi Σ tokensOut ≤ ⌊poolWad/scale⌋ persis.
    ///      Underflow itu sendiri dijaga terpisah oleh `invariant_noArithmeticPanic`: tanpa itu,
    ///      `redeem` yang panic akan ditelan try/catch handler dan INV-3 lulus tanpa isi.
    function invariant_INV3_redemptionsNeverExceedPool() public view {
        if (m.status() != IMarket.Status.Settled) return;
        if (handler.callsRedeem() == 0) return;
        assertLe(handler.redeemedTokens(), handler.poolWadAtResolution() / m.scale(), "INV-3: redeem melebihi pool");
    }

    /// @notice INV-4 — likuidasi menghabiskan pool, dalam batas debu TURUNAN (bukan konstanta).
    /// @dev Dua arah:
    ///      (a) tidak pernah membayar lebih dari yang ada — toleransi NOL;
    ///      (b) menguras habis — toleransi `InvariantBounds.inv4LiquidationDust(q, H)`, yang
    ///          berskala (q₀+q₁)/WAD. Hanya bermakna setelah SETIAP posisi bersih; sebelum itu
    ///          sisa pool memang milik pemegang yang belum mengklaim.
    function invariant_INV4_liquidationDrainsPool() public view {
        IMarket.Status s = m.status();
        if (s != IMarket.Status.Failed && s != IMarket.Status.Voided) return;
        if (handler.callsLiquidate() == 0) return;

        assertLe(
            handler.liquidatedTokens(), handler.poolWadAtResolution() / m.scale(), "INV-4a: likuidasi melebihi pool"
        );

        if (!handler.allPositionsCleared()) return;
        uint256 tol = InvariantBounds.inv4LiquidationDust(handler.qAtResolution(), handler.callsLiquidate());
        assertLe(m.poolWad(), tol, "INV-4b: pool tidak terkuras dalam batas turunan");
    }

    /// @notice INV-5 — beli lalu jual seketika tidak pernah menguntungkan. Toleransi NOL.
    /// @dev Diperiksa di dalam handler (`roundTrip`) pada state APA PUN yang dicapai sekuens,
    ///      lalu dilaporkan lewat penghitung — assert langsung di handler akan ditelan runner.
    function invariant_INV5_roundTripNeverProfits() public view {
        assertEq(handler.inv5Violations(), 0, "INV-5: round-trip menghasilkan untung");
    }

    /// @notice INV-6 — qᵢ ≥ seedSupplyᵢ ≥ creatorSeedᵢ > 0. Toleransi NOL.
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

    /// @notice INV-7 — rugi penyedia ≤ 29.30% setoran, di bawah aliran order sembarang.
    ///
    /// @dev Angka 29.30% BUKAN toleransi debu melainkan konstanta ekonomi: 1 − 1/√2 = 29.2893%,
    ///      dibulatkan ke atas oleh spec. Turunannya, untuk penyedia yang masuk pada q dengan
    ///      harga marginal pᵢ = qᵢ/C(q) — nilai kembalian ≥ setoran × min(p₀, p₁):
    ///
    ///        Settled: pemegang λq menerima λq_w·C(q')/q'_w. Karena C(q') ≥ q'_w, ini
    ///                 ≥ λq_w = λC(q)·p_w = setoran × p_w.
    ///        Failed/Voided: pemegang menerima Σᵢ λqᵢ·p'ᵢ = λC(q)·Σᵢ pᵢp'ᵢ. p dan p' adalah
    ///                 vektor satuan di kuadran positif (Σpᵢ² = 1), jadi Σpᵢp'ᵢ = cos θ, yang
    ///                 minimum ketika p' menempel sumbu: min = min(p₀, p₁).
    ///
    ///      Untuk creator, benihnya SIMETRIS by construction (`_q[0] = _q[1] = s`), jadi
    ///      p₀ = p₁ = 1/√2 dan batasnya tepat 1 − 1/√2. Karena itu handler menjaga posisi
    ///      creator tetap persis `(s, s)`: ia tidak pernah membeli maupun menambah likuiditas.
    ///
    ///      Nilai 7070/10000 aman terhadap pembulatan: s = ⌊√⌊seedWad²/2⌋⌋ ≥ seedWad/√2 − 1,
    ///      dan payout ≥ s − O(s/WAD) wad, jadi pemulihan ≥ 70.7106% − ~1e-9 poin persen dari
    ///      setoran, melawan ambang 70.70% — margin ≈ 0.0107% × setoran (≈0.107 USDC pada
    ///      SEED = 1000 USDC), ribuan kali lebih besar dari seluruh debu pembulatan yang terlibat.
    ///
    ///      `creatorDepositTokens` adalah variabel hantu handler: kontrak tidak menyimpan
    ///      setoran dalam bentuk token, hanya lembar benih hasil `seedShares(seedWad)`.
    function invariant_INV7_creatorLossBounded() public view {
        if (!handler.creatorHasClaimed()) return;
        assertGe(
            handler.creatorReturnedTokens() * 10_000,
            handler.creatorDepositTokens() * 7_070,
            "INV-7: rugi penyedia melampaui 29.30%"
        );
    }

    /// @notice INV-8 — Σ probability(i) == WAD dalam 2 wei, SATU ARAH.
    /// @dev Satu-satunya toleransi konstanta di suite ini, dan sah secara aljabar:
    ///      probability(i) = ⌊qᵢ²·WAD/S⌋ dengan S = Σqⱼ², jadi jumlah EKSAK-nya tepat WAD
    ///      sebelum pembulatan. Dua suku yang masing-masing dibulatkan ke bawah kehilangan
    ///      < 1 wei masing-masing, jadi jumlahnya berada di (WAD − 2, WAD]. Batasnya tidak
    ///      bergantung pada q sama sekali — dan jumlahnya TIDAK PERNAH bisa melebihi WAD,
    ///      jadi diassert satu arah, bukan simetris.
    function invariant_INV8_probabilitiesSumToOne() public view {
        uint256 sum = m.probability(0) + m.probability(1);
        assertLe(sum, DPMMath.WAD, "INV-8: jumlah probabilitas melebihi WAD");
        assertLe(DPMMath.WAD - sum, 2, "INV-8: defisit lebih dari 2 wei");
    }

    /// @notice INV-9 — `addLiquidity` proporsional tidak menggeser probabilitas,
    ///         dalam batas TURUNAN `InvariantBounds.inv9ProbabilityDrift(q)`.
    /// @dev Diperiksa di dalam handler mengelilingi setiap `addLiquidity` yang mendarat,
    ///      dengan q SEBELUM setoran (itulah q pada turunannya), lalu dilaporkan lewat penghitung.
    function invariant_INV9_addLiquidityDoesNotMoveProbability() public view {
        assertEq(handler.inv9Violations(), 0, "INV-9: addLiquidity menggeser probabilitas");
    }

    /// @notice INV-10 — pause tidak pernah menutup jalan keluar, dan selalu menutup jalan masuk.
    /// @dev `inv10Violations` naik hanya bila keluar yang prakondisinya SUDAH diverifikasi
    ///      benar-benar gagal atau tidak memindahkan apa pun — bukan sekadar "tidak revert".
    ///      `pauseLeaks` adalah dualnya: `buy` saat paused wajib revert `ProtocolPaused`,
    ///      dan wajib dengan selector ITU, bukan `TradeTooSmall` yang akan membuat pemeriksaan
    ///      lulus tanpa pernah menyentuh penjaga pause.
    function invariant_INV10_pauseNeverClosesAnExit() public view {
        assertEq(handler.inv10Violations(), 0, "INV-10: sebuah jalan keluar gagal saat paused");
        assertEq(handler.pauseLeaks(), 0, "INV-10 dual: jalan masuk lolos saat paused");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Penjaga kualitas suite
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Dua rezim: sejak `settle`/`fail`/`void`, `q` BEKU. Tanpa penjaga ini, INV-4b
    ///         yang mengukur batas debunya dari `qAtResolution` bisa saja membandingkan pool
    ///         dengan q yang sudah bergerak, dan lulus tanpa isi.
    function invariant_qFrozenAfterResolution() public view {
        if (!_resolvedRegime()) return;
        assertTrue(handler.resolved(), "resolusi terjadi di luar pembukuan handler");
        uint256[2] memory qNow = m.qArray();
        uint256[2] memory qAtRes = handler.qAtResolution();
        assertEq(qNow[0], qAtRes[0], "q[0] bergerak setelah resolusi");
        assertEq(qNow[1], qAtRes[1], "q[1] bergerak setelah resolusi");
    }

    /// @notice Konservasi kasar: token yang KELUAR lewat jalur pengguna tidak pernah melebihi
    ///         yang MASUK, ditambah benih dan setoran awal. Fee yang dibagikan `_distributeFees`
    ///         sengaja tidak dihitung di sisi keluar, jadi ini pertidaksamaan longgar dengan
    ///         toleransi NOL — yang dijaga adalah "tidak ada uang tercipta", bukan neraca eksak.
    function invariant_userOutflowNeverExceedsInflow() public view {
        assertLe(handler.ghostTokensOut(), handler.ghostTokensIn() + SEED + DEPOSIT, "uang keluar > uang masuk");
    }

    /// @notice Tidak satu pun jalur aritmetika boleh Panic. Ini gigi INV-3: `redeem` yang
    ///         underflow di `poolWad -= payoutWad` akan ditelan try/catch handler, dan tanpa
    ///         penjaga ini seluruh suite akan hijau di atas dana pengguna yang terkunci.
    function invariant_noArithmeticPanic() public view {
        assertFalse(handler.sawArithmeticPanic(), "sebuah panggilan revert dengan Panic aritmetika");
    }

    /// @notice Setiap aksi yang lolos seluruh prakondisinya WAJIB mendarat.
    /// @dev Ini yang membedakan handler sungguhan dari handler hiasan: suite yang 95%
    ///      panggilannya revert tidak mengeksplorasi apa pun, dan tetap hijau.
    function invariant_handlerCallsLandAsPredicted() public view {
        if (handler.unexpectedReverts() != 0) {
            console.log("revert tak terduga terakhir:");
            console.logBytes(handler.lastUnexpectedRevert());
        }
        assertEq(handler.unexpectedReverts(), 0, "aksi yang lolos prakondisi tetap revert");
        assertEq(handler.gatedActions(), handler.landedActions(), "pembukuan gated/landed tidak seimbang");
    }

    function afterInvariant() public view {
        assertEq(handler.unexpectedReverts(), 0, "aksi yang lolos prakondisi tetap revert");
        assertEq(handler.gatedActions(), handler.landedActions(), "pembukuan gated/landed tidak seimbang");
        _logCoverage();
    }

    function _logCoverage() internal view {
        console.log("--- cakupan run terakhir (aksi yang MENDARAT) ---");
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
        console.log("void                ", handler.callsVoid());
        console.log("redeem              ", handler.callsRedeem());
        console.log("liquidate           ", handler.callsLiquidate());
        console.log("gated / landed      ", handler.gatedActions(), handler.landedActions());
        console.log("token masuk / keluar", handler.ghostTokensIn(), handler.ghostTokensOut());
        console.log("drift INV-9 terburuk", handler.worstInv9Drift(), "batas", handler.worstInv9Bound());
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Gerbang cakupan DETERMINISTIK
    // ═══════════════════════════════════════════════════════════════════════
    //
    //  Foundry mengembalikan state ke titik setUp di antara run, jadi penghitung hantu tidak
    //  bisa diakumulasi lintas-run, dan menuntut "setiap aksi mendarat" per run bersifat
    //  probabilistik (satu run tidak bisa sekaligus settle, fail, DAN void). Karena itu
    //  gerbang cakupannya deterministik: tiga uji di bawah menggerakkan handler yang sama
    //  lewat sekuens berseed tetap dan GAGAL bila satu aksi pun tidak pernah mendarat.
    //  Distribusi panggilan kampanye acaknya sendiri dilaporkan Foundry (tabel metrik per
    //  selector) dan `afterInvariant` di atas.

    function test_coverage_settlePath() public {
        _tradePhase();
        _warpPastTradingEnd();
        _advanceThroughProposedAndDisputed();
        handler.resolve(2); // 2 % 3 == 2 -> settle
        assertEq(uint256(m.status()), uint256(IMarket.Status.Settled), "settle tidak terjadi");

        handler.togglePause();
        handler.exitWhilePaused(0, 0);
        handler.togglePause();
        for (uint256 i = 0; i < 4; ++i) {
            handler.claim(i);
        }

        _assertTradingCoverage();
        assertGt(handler.callsClose(), 0, "close tidak pernah mendarat");
        assertGt(handler.callsPropose(), 0, "markProposed tidak pernah mendarat");
        assertGt(handler.callsDispute(), 0, "markDisputed tidak pernah mendarat");
        assertGt(handler.callsSettle(), 0, "settle tidak pernah mendarat");
        assertGt(handler.callsPausedRedeem(), 0, "redeem saat paused tidak pernah mendarat");
        assertGt(handler.callsRedeem(), 0, "redeem tidak pernah mendarat");
        assertEq(handler.unexpectedReverts(), 0, "ada aksi berprakondisi yang revert");
        _logCoverage();
    }

    function test_coverage_failPath() public {
        _tradePhase();
        _warpPastTradingEnd();
        _advanceThroughProposedAndDisputed();
        handler.resolve(1); // 1 % 3 == 1 -> fail
        assertEq(uint256(m.status()), uint256(IMarket.Status.Failed), "fail tidak terjadi");

        handler.togglePause();
        handler.exitWhilePaused(0, 0);
        handler.togglePause();
        for (uint256 i = 0; i < 4; ++i) {
            handler.claim(i);
        }

        _assertTradingCoverage();
        assertGt(handler.callsFail(), 0, "fail tidak pernah mendarat");
        assertGt(handler.callsPausedLiquidate(), 0, "liquidate saat paused tidak pernah mendarat");
        assertGt(handler.callsLiquidate(), 0, "liquidate tidak pernah mendarat");
        assertTrue(handler.allPositionsCleared(), "masih ada posisi tersisa");

        // INV-4b pada sekuens yang benar-benar dijalankan, bukan hanya pada fixture terarah.
        uint256 tol = InvariantBounds.inv4LiquidationDust(m.qArray(), handler.callsLiquidate());
        assertLe(m.poolWad(), tol, "INV-4b gagal pada jalur cakupan");
        console.log("INV-4 debu / batas  ", m.poolWad(), tol);
        assertEq(handler.unexpectedReverts(), 0, "ada aksi berprakondisi yang revert");
        _logCoverage();
    }

    function test_coverage_voidPath() public {
        _tradePhase();
        _warpPastTradingEnd();
        handler.resolve(0); // 0 % 3 == 0 -> void (butuh status Open, jadi tanpa close)
        assertEq(uint256(m.status()), uint256(IMarket.Status.Voided), "void tidak terjadi");

        handler.togglePause();
        handler.exitWhilePaused(0, 0);
        handler.togglePause();
        for (uint256 i = 0; i < 4; ++i) {
            handler.claim(i);
        }

        _assertTradingCoverage();
        assertGt(handler.callsVoid(), 0, "void tidak pernah mendarat");
        assertGt(handler.callsLiquidate(), 0, "liquidate tidak pernah mendarat");
        assertTrue(handler.allPositionsCleared(), "masih ada posisi tersisa");
        uint256 tol = InvariantBounds.inv4LiquidationDust(m.qArray(), handler.callsLiquidate());
        assertLe(m.poolWad(), tol, "INV-4b gagal pada jalur void");
        assertEq(handler.unexpectedReverts(), 0, "ada aksi berprakondisi yang revert");
        _logCoverage();
    }

    function _tradePhase() internal {
        for (uint256 i = 0; i < 8; ++i) {
            uint256 s = uint256(keccak256(abi.encode("0g-delphi-invariant", i)));
            handler.buy(i, i, s);
            handler.addLiquidity(i, s >> 8);
            handler.roundTrip(i, i + 1, s >> 16);
            handler.sell(i, i, s >> 24);
            handler.removeLiquidity(i, s >> 32);
            handler.togglePause();
            handler.exitWhilePaused(i, i); // kindSeed genap: jual dulu
            handler.exitWhilePaused(i, i + 1); // kindSeed ganjil: tarik likuiditas dulu
            handler.togglePause();
        }
    }

    function _warpPastTradingEnd() internal {
        for (uint256 i = 0; i < 4; ++i) {
            handler.warpForward(3 hours);
        }
        assertGe(block.timestamp, m.tradingEnd(), "gagal melewati tradingEnd");
    }

    function _advanceThroughProposedAndDisputed() internal {
        handler.advanceStatus(0); // Open -> Closed
        handler.advanceStatus(0); // Closed -> Proposed
        handler.advanceStatus(0); // Proposed -> Disputed
        handler.advanceStatus(0); // Disputed -> Proposed
    }

    function _assertTradingCoverage() internal view {
        assertGt(handler.callsBuy(), 0, "buy tidak pernah mendarat");
        assertGt(handler.callsSell(), 0, "sell tidak pernah mendarat");
        assertGt(handler.callsAddLiquidity(), 0, "addLiquidity tidak pernah mendarat");
        assertGt(handler.callsRemoveLiquidity(), 0, "removeLiquidity tidak pernah mendarat");
        assertGt(handler.callsRoundTrip(), 0, "roundTrip (INV-5) tidak pernah mendarat");
        assertGt(handler.callsWarp(), 0, "warpForward tidak pernah mendarat");
        assertGt(handler.callsPauseToggle(), 0, "togglePause tidak pernah mendarat");
        assertGt(handler.callsPausedEntryBlocked(), 0, "jalan masuk saat paused tak pernah diuji");
        assertGt(handler.callsPausedSell(), 0, "sell saat paused tidak pernah mendarat");
        assertGt(handler.callsPausedRemoveLiquidity(), 0, "removeLiquidity saat paused tak pernah mendarat");
        assertEq(handler.inv5Violations(), 0, "INV-5 dilanggar pada jalur cakupan");
        assertEq(handler.inv9Violations(), 0, "INV-9 dilanggar pada jalur cakupan");
        assertEq(handler.inv10Violations(), 0, "INV-10 dilanggar pada jalur cakupan");
        assertEq(handler.pauseLeaks(), 0, "pause bocor pada jalur cakupan");
    }
}

/// @title MarketInvariantsDirectedTest
/// @notice Uji terarah dan fuzz bentuk-tertutup yang menemani suite stateful: sekuens acak
///         belum tentu mencapai rezim ekstrem (q mendekati MAX_Q, skew ekstrem), sementara
///         batas turunan INV-4/INV-9 justru paling menarik justru di sana.
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

        assertLe(a + c, poolTokens, "INV-3: klaim melebihi collateral pool");
        assertLe(a + c, poolAtFail / m.scale(), "INV-4a: klaim melebihi poolWad saat resolusi");

        uint256 tol = InvariantBounds.inv4LiquidationDust(q, 2);
        assertLe(m.poolWad(), tol, "INV-4b: pool tidak terkuras dalam batas turunan");
        console.log("INV-4 debu / batas  ", m.poolWad(), tol);
    }

    /// @notice Eksperimen penskalaan yang dijalankan reviewer Task 16, dijadikan uji.
    /// @dev Membuktikan dua hal sekaligus: debu likuidasi tumbuh LINIER terhadap (q₀+q₁), dan
    ///      batas turunan tetap memuatnya pada setiap skala. Sebuah konstanta kecil — atau
    ///      `< scale` yang dipakai Task 16 — akan gagal di ujung atas rentang ini.
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
            console.log("skala", mults[i]);
            console.log("  q0+q1 / debu / batas", q[0] + q[1], mm.poolWad(), tol);
            assertLe(mm.poolWad(), tol, "INV-4b gagal pada salah satu skala");
            assertEq(mm.status() == IMarket.Status.Failed, true, "status bukan Failed");
        }
    }

    function testFuzz_INV4_liquidationDustWithinDerivedBound(uint96 flow0, uint96 flow1) public {
        _fund(alice, type(uint128).max, address(m));
        _fund(bob, type(uint128).max, address(m));

        // Ukuran DIHITUNG DULU, di luar argumen: `_boundBuySize` memanggil view di `m`, dan
        // `vm.prank` mengikat ke panggilan eksternal BERIKUTNYA — menaruhnya di dalam daftar
        // argumen membuat prank-nya dimakan `minTradeTokens()` dan `buy` dieksekusi oleh
        // kontrak uji (terdeteksi sebagai `ERC20InsufficientAllowance`, bukan sebagai
        // kegagalan invarian: uji yang gagal karena alasan yang salah).
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

        assertLe(usdc.balanceOf(alice), before, "INV-5: round-trip untung");
    }

    /// @dev Fee 1% menutupi hampir setiap kesalahan pembulatan: dengan fee menyala, sebuah
    ///      round-trip baru bisa untung kalau galat pembulatannya melampaui ~2% nilai
    ///      perdagangan — jadi versi berfee di atas nyaris tidak menguji apa pun tentang
    ///      pembulatan. Market ini lahir dengan FEE_BPS = 0 (nilai sah menurut bounds
    ///      [0, 300] milik DeployLib), sehingga satu-satunya yang melindungi pool adalah
    ///      disiplin arahnya: uang masuk `ceilDiv`, uang keluar pembagian floor.
    function testFuzz_INV5_roundTripNeverProfitsWithoutFee(uint96 amount, uint256 outcomeSeed) public {
        config.setParam(ConfigKeys.FEE_BPS, 0);
        Market zf = _newMarket(SEED);
        assertEq(zf.feeBps(), 0, "market seharusnya lahir tanpa fee");

        uint256 size = bound(uint256(amount), 3e18, 1e22);
        uint8 o = uint8(outcomeSeed % 2);
        _fund(alice, 100_000_000e6, address(zf));
        uint256 before = usdc.balanceOf(alice);

        vm.startPrank(alice);
        zf.buy(o, size, type(uint256).max, alice);
        zf.sell(o, size, 0, alice);
        vm.stopPrank();

        assertLe(usdc.balanceOf(alice), before, "INV-5: round-trip untung tanpa fee");
    }

    // ── INV-7 ────────────────────────────────────────────────────────────────

    /// @dev Kasus terburuk INV-7: SELURUH aliran order ke satu sisi, lalu sisi itu yang menang.
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
        assertGe(back * 10_000, SEED * 7_070, "INV-7: rugi creator > 29.30% saat settle");
        // Batas ketat: pemulihan tidak pernah di bawah lembar benih itu sendiri.
        assertGe(back, m.creatorSeed()[1] / m.scale() - 1, "INV-7: di bawah batas ketat s");
    }

    /// @dev Sisi lain rezim: pada Failed/Voided creator dibayar s·(p₀+p₁), dan
    ///      (q₀+q₁)/C(q) ≥ 1 untuk q apa pun, jadi batas 70.70% yang sama berlaku.
    function testFuzz_INV7_creatorLossBoundedOnFailure(uint96 flow) public {
        uint256 size = bound(uint256(flow), 3e18, 1e26);
        _fund(alice, type(uint128).max, address(m));
        vm.prank(alice);
        m.buy(1, size, type(uint256).max, alice);

        vm.warp(m.settlementDeadline());
        m.fail();

        vm.prank(creator);
        uint256 back = m.liquidate(creator);
        assertGe(back * 10_000, SEED * 7_070, "INV-7: rugi creator > 29.30% saat fail");
    }

    // ── INV-8 ────────────────────────────────────────────────────────────────

    /// @dev Skew ekstrem adalah tempat jumlah probabilitas paling mungkin meleset; batas
    ///      2 wei di INV-8 tidak berskala terhadap q, jadi harus diuji justru di sini.
    function testFuzz_INV8_probabilitiesSumToOneUnderSkew(uint96 flow, uint256 outcomeSeed) public {
        uint256 size = bound(uint256(flow), 3e18, 1e28);
        uint8 o = uint8(outcomeSeed % 2);
        _fund(alice, type(uint128).max, address(m));
        vm.prank(alice);
        m.buy(o, size, type(uint256).max, alice);

        uint256 sum = m.probability(0) + m.probability(1);
        assertLe(sum, DPMMath.WAD, "INV-8: melebihi WAD");
        assertLe(DPMMath.WAD - sum, 2, "INV-8: defisit > 2 wei");
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
        assertLe(_absDiff(m.probability(0), p0), tol, "INV-9: P(0) bergeser di luar batas turunan");
        assertLe(_absDiff(m.probability(1), p1), tol, "INV-9: P(1) bergeser di luar batas turunan");
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

        // Dual: jalan MASUK harus tertutup, dan dengan selector ProtocolPaused — bukan revert
        // lain yang kebetulan terjadi lebih dulu. `_requireTradable` dijalankan paling awal di
        // `buy`/`addLiquidity`, dan status/waktu di sini sudah dipastikan sah.
        vm.prank(alice);
        vm.expectRevert(Market.ProtocolPaused.selector);
        m.buy(1, 10e18, type(uint256).max, alice);

        vm.prank(bob);
        vm.expectRevert(Market.ProtocolPaused.selector);
        m.addLiquidity(100e6, 0, bob);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        uint256 sold = m.sell(1, 100e18, 0, alice);
        assertGt(sold, 0, "INV-10: sell saat paused tidak membayar");
        assertEq(usdc.balanceOf(alice), aliceBefore + sold, "INV-10: token sell tidak sampai");

        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        uint256 pulled = m.removeLiquidity(1e16, 0, bob);
        assertGt(pulled, 0, "INV-10: removeLiquidity saat paused tidak membayar");
        assertEq(usdc.balanceOf(bob), bobBefore + pulled, "INV-10: token removeLiquidity tidak sampai");

        vm.warp(m.tradingEnd());
        m.close();
        vm.prank(resolutionModule);
        m.settle(1);

        assertTrue(config.paused(), "pause harus masih menyala saat menebus");
        uint256 aliceMid = usdc.balanceOf(alice);
        vm.prank(alice);
        uint256 redeemed = m.redeem(alice);
        assertGt(redeemed, 0, "INV-10: redeem saat paused tidak membayar");
        assertEq(usdc.balanceOf(alice), aliceMid + redeemed, "INV-10: token redeem tidak sampai");
    }

    /// @dev Jalur keluar keempat: `liquidate` saat paused. Task 16 hanya menguji `redeem`.
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
        assertGt(got, 0, "INV-10: liquidate saat paused tidak membayar");
        assertEq(usdc.balanceOf(alice), before + got, "INV-10: token liquidate tidak sampai");
        assertEq(shares.balanceOfOutcome(alice, address(m), 1), 0, "posisi tidak dibersihkan");
    }

    /// @dev Ukuran beli DIBATASI relatif terhadap q HIDUP, bukan ke rentang tetap. Setelah
    ///      kaki pertama yang bisa sangat besar, jumlah lembar TETAP apa pun di sisi lain jatuh
    ///      di bawah MIN_TRADE_TOKENS (harga marginal sisi itu mendekati nol) dan revert
    ///      `TradeTooSmall` — itu batas fuzz yang salah, bukan pelanggaran invarian. Lantainya
    ///      diturunkan dari harga marginal hidup, dengan padding 2× untuk penurunan harga
    ///      sepanjang perdagangan.
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
