// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {OutcomeShares} from "../../src/core/OutcomeShares.sol";
import {IMarketRegistry} from "../../src/interfaces/IMarketRegistry.sol";

contract StubRegistry is IMarketRegistry {
    mapping(address => bool) public markets;

    function set(address m, bool v) external {
        markets[m] = v;
    }

    function isMarket(address m) external view returns (bool) {
        return markets[m];
    }
}

/// @dev Berpura-pura menjadi Market: memanggil mint/burn atas namanya sendiri.
contract FakeMarket {
    OutcomeShares public immutable shares;

    constructor(OutcomeShares s) {
        shares = s;
    }

    function mint(address to, uint8 outcome, uint256 amount) external {
        shares.mint(to, outcome, amount);
    }

    function burn(address from, uint8 outcome, uint256 amount) external {
        shares.burn(from, outcome, amount);
    }
}

contract OutcomeSharesTest is Test {
    OutcomeShares internal shares;
    StubRegistry internal registry;
    FakeMarket internal marketA;
    FakeMarket internal marketB;
    address internal alice = makeAddr("alice");

    function setUp() public {
        shares = new OutcomeShares("https://delphi.0g/{id}.json");
        registry = new StubRegistry();
        shares.setRegistry(address(registry));
        marketA = new FakeMarket(shares);
        marketB = new FakeMarket(shares);
        registry.set(address(marketA), true);
        registry.set(address(marketB), true);
    }

    function test_idEncodesMarketAndOutcome() public view {
        uint256 id = shares.idFor(address(marketA), 1);
        assertEq(shares.marketOf(id), address(marketA));
        assertEq(id & 0xff, 1);
    }

    function test_marketMintsAndBurnsItsOwnIds() public {
        marketA.mint(alice, 1, 100e18);
        assertEq(shares.balanceOfOutcome(alice, address(marketA), 1), 100e18);
        marketA.burn(alice, 1, 40e18);
        assertEq(shares.balanceOfOutcome(alice, address(marketA), 1), 60e18);
    }

    /// @dev Sifat kunci: id market A dan market B tidak pernah bertabrakan, dan
    ///      market B tidak punya cara menyentuh saldo market A.
    function test_marketsCannotTouchEachOthersIds() public {
        marketA.mint(alice, 1, 100e18);
        assertEq(shares.balanceOfOutcome(alice, address(marketB), 1), 0);

        vm.expectRevert();
        marketB.burn(alice, 1, 1e18); // membakar id MILIKNYA sendiri, yang saldonya nol
    }

    function test_nonMarketCannotMint() public {
        vm.prank(alice);
        vm.expectRevert(OutcomeShares.NotMarket.selector);
        shares.mint(alice, 0, 1e18);
    }

    function test_outcomeAboveOneReverts() public {
        vm.expectRevert(OutcomeShares.BadOutcome.selector);
        shares.idFor(address(marketA), 2);
    }

    function test_registryCanOnlyBeSetOnce() public {
        vm.expectRevert(OutcomeShares.RegistryAlreadySet.selector);
        shares.setRegistry(address(0xBEEF));
    }

    function test_onlyDeployerCanSetRegistry() public {
        OutcomeShares fresh = new OutcomeShares("");
        vm.prank(alice);
        vm.expectRevert(OutcomeShares.NotDeployer.selector);
        fresh.setRegistry(address(registry));
    }

    function test_holdersCanTransferPositions() public {
        address bob = makeAddr("bob");
        marketA.mint(alice, 0, 10e18);
        // id resolved before the prank: `shares.idFor(...)` is itself an external call, and
        // vm.prank only overrides msg.sender for the single next call — evaluating it as an
        // inline argument would consume the prank before safeTransferFrom ever runs.
        uint256 id = shares.idFor(address(marketA), 0);
        vm.prank(alice);
        shares.safeTransferFrom(alice, bob, id, 4e18, "");
        assertEq(shares.balanceOfOutcome(bob, address(marketA), 0), 4e18);
        assertEq(shares.balanceOfOutcome(alice, address(marketA), 0), 6e18);
    }
}
