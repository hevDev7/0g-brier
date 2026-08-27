// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ConfigRegistry} from "../../src/core/ConfigRegistry.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";
import {OutcomeShares} from "../../src/core/OutcomeShares.sol";
import {IMarketRegistry} from "../../src/interfaces/IMarketRegistry.sol";
import {IMarket} from "../../src/interfaces/IMarket.sol";
import {Market} from "../../src/core/Market.sol";
import {MockUSDC} from "../../src/mocks/MockUSDC.sol";
import {DeployLib} from "../../script/DeployLib.sol";

contract StubMarketRegistry is IMarketRegistry {
    mapping(address => bool) internal _markets;

    function set(address m, bool v) external {
        _markets[m] = v;
    }

    function isMarket(address m) external view returns (bool) {
        return _markets[m];
    }
}

abstract contract Fixtures is Test {
    ConfigRegistry internal config;
    MockUSDC internal usdc;
    OutcomeShares internal shares;
    StubMarketRegistry internal registry;
    Market internal marketImpl;

    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal treasury = makeAddr("treasury");
    address internal resolutionModule = makeAddr("resolutionModule");
    address internal guardian = makeAddr("guardian");

    uint256 internal constant SEED = 1_000e6;
    uint256 internal constant DEPOSIT = 20e6;
    uint64 internal constant TRADING_WINDOW = 7 days;

    function _deployBase() internal {
        usdc = new MockUSDC();
        shares = new OutcomeShares("");
        registry = new StubMarketRegistry();
        shares.setRegistry(address(registry));

        ConfigRegistry impl = new ConfigRegistry();
        config = ConfigRegistry(
            address(
                new ERC1967Proxy(address(impl), abi.encodeCall(ConfigRegistry.initialize, (address(this), guardian)))
            )
        );
        DeployLib.applyDefaults(config, address(usdc));
        config.setAddress(ConfigKeys.TREASURY, treasury);
        config.setAddress(ConfigKeys.RESOLUTION_MODULE, resolutionModule);
        config.setAddress(ConfigKeys.OUTCOME_SHARES, address(shares));

        marketImpl = new Market();
        vm.warp(1_800_000_000); // stempel waktu yang stabil dan jauh dari nol
    }

    function _params() internal view returns (IMarket.Params memory p) {
        p.collateral = address(usdc);
        p.creator = creator;
        p.creatorAgentId = 1;
        p.tradingEnd = uint64(block.timestamp) + TRADING_WINDOW;
        p.settlementDeadline = uint64(block.timestamp) + TRADING_WINDOW + 1 days;
        p.tier = 1;
        p.specRoot = keccak256("spec");
        p.category = bytes32("crypto");
    }

    /// @dev Mencerminkan persis apa yang akan dilakukan MarketFactory di Task 17:
    ///      clone → transfer collateral MASUK → initialize.
    function _newMarket(uint256 seedTokens) internal returns (Market m) {
        m = Market(Clones.clone(address(marketImpl)));
        registry.set(address(m), true);
        usdc.mintTo(address(this), seedTokens + DEPOSIT);
        usdc.transfer(address(m), seedTokens + DEPOSIT);
        m.initialize(address(config), address(shares), _params(), seedTokens, DEPOSIT);
    }

    /// @dev `OutcomeShares.setRegistry` adalah kunci sekali-pakai dan `_deployBase` sudah
    ///      memakainya untuk StubMarketRegistry — instance itu TIDAK akan pernah bisa
    ///      dialihkan ke MarketFactory sungguhan (`RegistryAlreadySet`). Uji yang memakai
    ///      factory sungguhan karena itu memulai dari instance yang bersih.
    ///
    ///      Registry sengaja belum dipasang di sini: urutannya harus mengikuti Deploy.s.sol —
    ///      shares → factory → setRegistry — karena MarketFactory MEMOTRET alamat shares saat
    ///      `initialize` dan tidak pernah membacanya ulang. Membalik urutannya menghasilkan
    ///      factory yang menunjuk shares lama sementara uji memeriksa shares baru: market
    ///      lahir sukses lalu gagal `NotMarket` pada trade pertama.
    ///
    ///      Deployer-lah satu-satunya yang boleh memanggil `setRegistry`, jadi instance ini
    ///      harus di-deploy oleh kontrak uji yang sama dengan pemanggil `_useFactoryAsRegistry`.
    function _freshShares() internal {
        shares = new OutcomeShares("");
        config.setAddress(ConfigKeys.OUTCOME_SHARES, address(shares));
    }

    /// @dev Menutup lingkaran dari `_freshShares`: mulai titik ini OutcomeShares hanya
    ///      mempercayai market yang benar-benar lahir dari factory.
    function _useFactoryAsRegistry(address factory_) internal {
        shares.setRegistry(factory_);
    }

    function _fund(address who, uint256 amount, address spender) internal {
        usdc.mintTo(who, amount);
        vm.prank(who);
        usdc.approve(spender, type(uint256).max);
    }
}
