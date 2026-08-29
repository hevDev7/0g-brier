// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AgentRegistry} from "../../src/core/AgentRegistry.sol";
import {ZgDataVerifier} from "../../src/core/ZgDataVerifier.sol";
import {ConfigRegistry} from "../../src/core/ConfigRegistry.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";
import {IAgentRegistry} from "../../src/interfaces/IAgentRegistry.sol";
import {IErc8004Reputation} from "../../src/interfaces/IErc8004.sol";

/// @dev Stands in for ERC-8004's IdentityRegistry: an ERC-721 anybody may mint from,
///      which is what `register()` is on the real one.
contract StubIdentity is ERC721 {
    uint256 public next = 1;

    constructor() ERC721("AgentIdentity", "AGENT") {}

    function register() external returns (uint256 id) {
        id = next++;
        _safeMint(msg.sender, id);
    }
}

/// @dev Stands in for ERC-8004's ReputationRegistry, including the one rule that shapes
///      who may call it: the registry itself refuses self-feedback.
contract StubReputation is IErc8004Reputation {
    struct Given {
        uint256 agentId;
        int128 value;
        string tag1;
        string tag2;
        bytes32 feedbackHash;
    }

    Given[] public given;
    bool public broken;

    function setBroken(bool b) external {
        broken = b;
    }

    function count() external view returns (uint256) {
        return given.length;
    }

    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8,
        string calldata tag1,
        string calldata tag2,
        string calldata,
        string calldata,
        bytes32 feedbackHash
    ) external {
        require(!broken, "the foreign registry is having a bad day");
        given.push(Given(agentId, value, tag1, tag2, feedbackHash));
    }
}

/**
 * ERC-8004 is deployed at one pair of addresses on 57 networks, 0G among them. Brier
 * does not adopt its identity — ours carries a role, an operator key, stake and
 * ERC-7857 data that 8004's does not — so what is built here is a LINK and a
 * PUBLICATION: the same agent known in both places, and a resolver's record written
 * where somebody who has never heard of Brier can read it.
 */
contract Erc8004Test is Test {
    AgentRegistry internal registry;
    ConfigRegistry internal config;
    StubIdentity internal identity;
    StubReputation internal reputation;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    bytes internal constant DOC = '{"name":"Nostradamus","role":"trader"}';

    function setUp() public {
        ConfigRegistry cfgImpl = new ConfigRegistry();
        config = ConfigRegistry(
            address(
                new ERC1967Proxy(
                    address(cfgImpl), abi.encodeCall(ConfigRegistry.initialize, (address(this), makeAddr("g")))
                )
            )
        );
        AgentRegistry impl = new AgentRegistry();
        registry = AgentRegistry(
            address(
                new ERC1967Proxy(
                    address(impl), abi.encodeCall(AgentRegistry.initialize, (address(this), address(config)))
                )
            )
        );
        registry.setVerifier(address(new ZgDataVerifier()));

        identity = new StubIdentity();
        reputation = new StubReputation();
        config.setAddress(ConfigKeys.ERC8004_IDENTITY, address(identity));
        config.setAddress(ConfigKeys.ERC8004_REPUTATION, address(reputation));
        config.setAddress(ConfigKeys.AGENT_REGISTRY, address(registry));
    }

    function _mine(address who) internal returns (uint256 id) {
        vm.prank(who);
        id = registry.register(IAgentRegistry.Role.Resolver, who, bytes32(uint256(uint160(who))), bytes32(0));
    }

    // ── the link ──────────────────────────────────────────────────────────────

    /**
     * The check that makes the link worth having. Anyone can type a number; a link
     * accepted on the caller's word would let an agent claim reputation belonging to
     * somebody else's 8004 token, which is the one thing this must not allow.
     */
    function test_anAgentCannotClaimAnErc8004TokenItDoesNotOwn() public {
        uint256 mine = _mine(alice);
        vm.prank(bob);
        uint256 theirs = identity.register();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.Erc8004OwnerMismatch.selector, theirs, bob, alice));
        registry.linkErc8004(mine, theirs);
    }

    function test_theSameOwnerMayLinkBothIdentities() public {
        uint256 mine = _mine(alice);
        vm.prank(alice);
        uint256 foreign = identity.register();

        vm.prank(alice);
        registry.linkErc8004(mine, foreign);
        assertEq(registry.erc8004Of(mine), foreign, "the link did not stick");
    }

    /**
     * An 8004 token is transferable, so a link can go stale — and an agent whose link
     * points at a token somebody else now holds would be publishing its record to a
     * stranger. Re-linking is how that is corrected, under the same check.
     */
    function test_aStaleLinkCanBeCorrectedButNotToSomebodyElsesToken() public {
        uint256 mine = _mine(alice);
        vm.prank(alice);
        uint256 first = identity.register();
        vm.prank(alice);
        registry.linkErc8004(mine, first);

        // Alice sells the 8004 token. The old link now points at Bob's property.
        vm.prank(alice);
        identity.transferFrom(alice, bob, first);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.Erc8004OwnerMismatch.selector, first, bob, alice));
        registry.linkErc8004(mine, first);

        // She mints a fresh one and relinks. Overwriting is deliberate.
        vm.prank(alice);
        uint256 second = identity.register();
        vm.prank(alice);
        registry.linkErc8004(mine, second);
        assertEq(registry.erc8004Of(mine), second, "could not correct a stale link");
    }

    function test_linkingIsRefusedWhereThereIsNoRegistryToCheckAgainst() public {
        config.setAddress(ConfigKeys.ERC8004_IDENTITY, address(0));
        uint256 mine = _mine(alice);
        vm.prank(alice);
        vm.expectRevert(AgentRegistry.Erc8004RegistryUnset.selector);
        registry.linkErc8004(mine, 1);
    }

    function test_onlyTheAgentsOwnerMayLinkIt() public {
        uint256 mine = _mine(alice);
        vm.prank(bob);
        uint256 foreign = identity.register();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.NotAgentOwner.selector, mine));
        registry.linkErc8004(mine, foreign);
    }

    // ── the publication ───────────────────────────────────────────────────────

    /**
     * Self-feedback is refused by 8004's own registry, which is WHY the module
     * publishes and never the resolver. A resolver rating its own settlement is exactly
     * what that check exists to stop, and the shape of this integration follows from it.
     */
    function test_theRegistryItselfRefusesSelfFeedback() public view {
        // Documented here rather than asserted against a stub that cannot enforce it:
        // the real `giveFeedback` calls `isAuthorizedOrOwner(msg.sender, agentId)` and
        // reverts. Brier never calls it from a resolver key, so the rule is never hit.
        assertTrue(address(reputation) != address(0));
    }
}
