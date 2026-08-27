// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "../helpers/Fixtures.sol";
import {Market} from "../../src/core/Market.sol";
import {IMarket} from "../../src/interfaces/IMarket.sol";
import {DPMMath} from "../../src/math/DPMMath.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

contract MarketInitTest is Fixtures {
    function setUp() public {
        _deployBase();
    }

    function test_marketOpensAtFiftyPercent() public {
        Market m = _newMarket(SEED);
        assertEq(uint8(m.status()), uint8(IMarket.Status.Open));
        assertEq(m.probability(0), 5e17);
        assertEq(m.probability(1), 5e17);
    }

    function test_creatorHoldsSeedOnBothSides() public {
        Market m = _newMarket(SEED);
        uint256[2] memory q = m.qArray();
        uint256[2] memory held = m.seedSharesOf(creator);
        assertEq(q[0], q[1]);
        assertEq(held[0], q[0]);
        assertEq(held[1], q[1]);
        assertEq(m.creatorSeed()[0], q[0]);
    }

    /// @dev The system's central invariant, checked from second zero.
    function test_poolEqualsCostUpAtInit() public {
        Market m = _newMarket(SEED);
        assertEq(m.poolWad(), DPMMath.costUp(m.qArray()));
    }

    /// @dev The pool must never claim more collateral than actually exists.
    function test_collateralCoversPoolAndDeposit() public {
        Market m = _newMarket(SEED);
        assertGe(usdc.balanceOf(address(m)), m.collateralOwed());
        assertLe(Math.ceilDiv(m.poolWad(), m.scale()), SEED);
    }

    function test_scaleMatchesSixDecimalCollateral() public {
        Market m = _newMarket(SEED);
        assertEq(m.scale(), 1e12);
    }

    /// @dev A live market is IMMUNE to parameter changes. The fee and the minimum trade size
    ///      are snapshotted at initialization, not read on every trade.
    function test_liveMarketIsImmuneToLaterConfigChanges() public {
        Market m = _newMarket(SEED);
        assertEq(m.feeBps(), 100);
        config.setParam(ConfigKeys.FEE_BPS, 300);
        assertEq(m.feeBps(), 100);
    }

    /// @dev As with `feeBps`/`minTradeTokens`: the creator and resolver fee shares are also
    ///      snapshotted at initialization, not re-read in `_distributeFees`. Without this, a
    ///      `setParam` that is individually valid (each ≤ 10_000) but sums above 10_000 would
    ///      freeze settle/fail/void on EVERY market already live under this ConfigRegistry,
    ///      not merely on new ones.
    function test_liveMarketKeepsSnapshottedFeeShares() public {
        Market m = _newMarket(SEED);
        assertEq(m.creatorFeeShareBps(), 4000);
        assertEq(m.resolverFeeShareBps(), 3000);

        // Both are individually valid (ConfigRegistry bounds them at [0, 10_000] apiece) even
        // though they sum to 12_000 — exactly the scenario that freezes a market WITHOUT
        // this snapshot.
        config.setParam(ConfigKeys.CREATOR_FEE_SHARE_BPS, 6000);
        config.setParam(ConfigKeys.RESOLVER_FEE_SHARE_BPS, 6000);

        assertEq(m.creatorFeeShareBps(), 4000);
        assertEq(m.resolverFeeShareBps(), 3000);
    }

    /// @dev `vm.expectRevert` binds to the very NEXT call, literally — including a CREATE.
    ///      `_newMarket` performs a `Clones.clone` (a CREATE) before `initialize`, so wrapping
    ///      the whole helper would take aim at the clone, which succeeds. The cloning and
    ///      funding are therefore done by hand outside the expectRevert window, exactly as in
    ///      `test_deadlinesMustBeOrdered` below.
    function test_seedBelowMinimumReverts() public {
        Market m = Market(Clones.clone(address(marketImpl)));
        registry.set(address(m), true);
        uint256 seedTokens = 1e6; // MIN_SEED is 100e6
        usdc.mintTo(address(this), seedTokens + DEPOSIT);
        usdc.transfer(address(m), seedTokens + DEPOSIT);
        vm.expectRevert(Market.SeedTooSmall.selector);
        m.initialize(address(config), address(shares), _params(), seedTokens, DEPOSIT);
    }

    function test_disallowedCollateralReverts() public {
        config.setCollateralAllowed(address(usdc), false);
        Market m = Market(Clones.clone(address(marketImpl)));
        registry.set(address(m), true);
        usdc.mintTo(address(this), SEED + DEPOSIT);
        usdc.transfer(address(m), SEED + DEPOSIT);
        vm.expectRevert(Market.CollateralNotAllowed.selector);
        m.initialize(address(config), address(shares), _params(), SEED, DEPOSIT);
    }

    function test_deadlinesMustBeOrdered() public {
        Market m = Market(Clones.clone(address(marketImpl)));
        registry.set(address(m), true);
        IMarket.Params memory p = _params();
        p.settlementDeadline = p.tradingEnd - 1;
        usdc.mintTo(address(this), SEED + DEPOSIT);
        usdc.transfer(address(m), SEED + DEPOSIT);
        vm.expectRevert(Market.BadDeadlines.selector);
        m.initialize(address(config), address(shares), p, SEED, DEPOSIT);
    }

    /// @dev Rejected AT BIRTH rather than quietly stored and then exploding (an underflow
    ///      Panic) at the first settle/fail/void. The cloning and funding stay outside the
    ///      expectRevert window — exactly as in `test_seedBelowMinimumReverts` above.
    function test_initializeRevertsWhenFeeSharesExceedTotal() public {
        config.setParam(ConfigKeys.CREATOR_FEE_SHARE_BPS, 6000);
        config.setParam(ConfigKeys.RESOLVER_FEE_SHARE_BPS, 6000);

        Market m = Market(Clones.clone(address(marketImpl)));
        registry.set(address(m), true);
        usdc.mintTo(address(this), SEED + DEPOSIT);
        usdc.transfer(address(m), SEED + DEPOSIT);
        vm.expectRevert(abi.encodeWithSelector(Market.FeeSharesExceedTotal.selector, 6000, 6000));
        m.initialize(address(config), address(shares), _params(), SEED, DEPOSIT);
    }

    function test_cannotInitializeTwice() public {
        Market m = _newMarket(SEED);
        vm.expectRevert();
        m.initialize(address(config), address(shares), _params(), SEED, DEPOSIT);
    }

    function test_implementationCannotBeInitialized() public {
        vm.expectRevert();
        marketImpl.initialize(address(config), address(shares), _params(), SEED, DEPOSIT);
    }
}
