// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "../helpers/Fixtures.sol";
import {ConfigRegistry} from "../../src/core/ConfigRegistry.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev A market's category was a free `bytes32`: nothing checked it, so "cyrpto"
///      created a market nobody could filter for, no agent policy could match, and no
///      category-specific settlement template could reach. All three failures are
///      silent. This is the registry that makes them loud.
contract CategoriesTest is Fixtures {
    function setUp() public {
        _deployBase();
    }

    function test_theSpecsSixAreRegisteredByDefault() public view {
        bytes32[6] memory expected = [bytes32("crypto"), "politics", "sports", "economics", "science", "culture"];
        assertEq(config.categoryCount(), 6, "wrong number of categories");
        for (uint256 i = 0; i < 6; i++) {
            assertTrue(config.isCategory(expected[i]), "a category from spec 5.2 is missing");
            // 1-based: index 0 has to mean "not a category", so that an unset entry and
            // an unknown one are the same answer.
            assertEq(config.categoryIndex(expected[i]), i + 1, "wrong index");
        }
    }

    function test_anUnregisteredNameIsNotACategory() public view {
        assertFalse(config.isCategory("cyrpto"), "a typo passed as a category");
        assertEq(config.categoryIndex("cyrpto"), 0, "an unknown name got an index");
        assertEq(config.categoryBit("cyrpto"), bytes32(0), "an unknown name got a policy bit");
    }

    /// @dev The reason the set is ordered at all: `AgentAccount.Policy.allowedCategories`
    ///      (spec §8.4) is a bitmask over these indices. A bitmask over an unbounded set
    ///      of free strings cannot exist.
    function test_everyCategoryHasItsOwnBitInAPolicyMask() public view {
        bytes32 seen;
        bytes32[6] memory names = [bytes32("crypto"), "politics", "sports", "economics", "science", "culture"];
        for (uint256 i = 0; i < 6; i++) {
            bytes32 bit = config.categoryBit(names[i]);
            assertTrue(bit != bytes32(0), "no bit");
            assertEq(uint256(seen) & uint256(bit), 0, "two categories share a bit");
            seen = bytes32(uint256(seen) | uint256(bit));
        }
        assertEq(uint256(seen), 0x3f, "the six should occupy the low six bits");
    }

    function test_governanceCanAddOneWithoutAnUpgrade() public {
        assertFalse(config.isCategory("technology"));
        config.addCategory("technology");
        assertTrue(config.isCategory("technology"), "a new category did not take");
        assertEq(config.categoryIndex("technology"), 7, "a new category did not get the next index");
        assertEq(config.categoryBit("technology"), bytes32(uint256(1) << 6), "wrong policy bit");
    }

    function test_aCategoryCannotBeRegisteredTwice() public {
        vm.expectRevert(abi.encodeWithSelector(ConfigRegistry.CategoryExists.selector, bytes32("sports")));
        config.addCategory("sports");
    }

    function test_onlyTheOwnerMayAddACategory() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        config.addCategory("sports");
    }

    /// @dev Indices are permanent, which is why there is no `removeCategory`. Removing
    ///      one would strand every market already created under it and invalidate the
    ///      bit every existing Policy set for it. Retiring a category is a UI decision.
    function test_thereIsNoWayToRemoveOne() public view {
        // Asserted structurally: the ABI has no such function. If one is ever added,
        // this comment is the argument it has to answer.
        assertEq(config.categoryIndex("crypto"), 1, "index drift would repoint every policy");
    }
}
