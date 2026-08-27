// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "../helpers/Fixtures.sol";
import {Market} from "../../src/core/Market.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

contract ReentrantBuyer is IERC1155Receiver {
    Market public immutable market;
    bool public armed;

    constructor(Market m) {
        market = m;
    }

    function setArmed(bool v) external {
        armed = v;
    }

    function attack(uint256 amount) external {
        market.buy(1, amount, type(uint256).max, address(this));
    }

    /// @dev Called in the middle of `buy`. The second inbound call must be rejected by the guard.
    /// @dev `armed` is cleared BEFORE re-entering, and the amount (10e18) is deliberately far
    ///      above MIN_TRADE_TOKENS: manual verification (temporarily removing `nonReentrant`)
    ///      showed that the first draft's amount of 1e18 is dust (< MIN_TRADE_TOKENS) and
    ///      reverts TradeTooSmall regardless of the guard — a vm.expectRevert() with no selector
    ///      would pass for the WRONG reason. Without clearing `armed`, a missing guard would
    ///      instead re-enter endlessly until the EVM call depth ran out — another revert that
    ///      likewise masks the guard. Both are fixed together so that the re-entry attempt is
    ///      genuinely a single one and, were the guard absent, would SUCCEED (rather than revert
    ///      for some other reason) — only then does the `vm.expectRevert()` below test
    ///      `nonReentrant` and nothing else.
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4) {
        if (armed) {
            armed = false;
            market.buy(1, 10e18, type(uint256).max, address(this));
        }
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC1155Receiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}

contract MarketReentrancyTest is Fixtures {
    Market internal m;
    ReentrantBuyer internal attacker;

    function setUp() public {
        _deployBase();
        m = _newMarket(SEED);
        attacker = new ReentrantBuyer(m);
        usdc.mintTo(address(attacker), 10_000_000e6);
        vm.prank(address(attacker));
        usdc.approve(address(m), type(uint256).max);
    }

    function test_reentrantReceiverCannotReenterBuy() public {
        attacker.setArmed(true);
        // A specific selector, not a bare expectRevert(): the latter passes for ANY revert,
        // including a TradeTooSmall that has nothing to do with the guard (see R25). A live
        // market is immune to parameter changes (minTradeTokens is snapshotted at initialize —
        // see test_liveMarketIsImmuneToLaterConfigChanges), BUT DeployLib locks the
        // MIN_TRADE_TOKENS bounds as wide as [1, UNBOUNDED]; setParam may raise the value at any
        // time within that range, and setUp() here builds a NEW market for every test — so a
        // DeployLib default raised above 7,330,600 (the cost of this 10e18 re-entry) would be
        // inherited by this new market immediately as well. The revert data arrives here intact:
        // ERC1155Utils re-propagates the original reason unmodified.
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        attacker.attack(50e18);

        // Control: the same receiver, without the attack, succeeds. This proves the revert above
        // really was reentrancy and not something else.
        attacker.setArmed(false);
        attacker.attack(50e18);
        assertEq(shares.balanceOfOutcome(address(attacker), address(m), 1), 50e18);
    }

    function test_stateUnchangedAfterFailedReentrancy() public {
        uint256[2] memory qBefore = m.qArray();
        uint256 poolBefore = m.poolWad();

        attacker.setArmed(true);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        attacker.attack(50e18);

        assertEq(m.qArray()[1], qBefore[1]);
        assertEq(m.poolWad(), poolBefore);
    }
}
