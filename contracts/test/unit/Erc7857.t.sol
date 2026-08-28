// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {AgentRegistry} from "../../src/core/AgentRegistry.sol";
import {ZgDataVerifier} from "../../src/core/ZgDataVerifier.sol";
import {ConfigRegistry} from "../../src/core/ConfigRegistry.sol";
import {IAgentRegistry} from "../../src/interfaces/IAgentRegistry.sol";
import {IERC7857} from "../../src/interfaces/IERC7857.sol";
import {ZgMerkle} from "../../src/math/ZgMerkle.sol";
import {AgentCard} from "../../src/core/AgentCard.sol";

/**
 * ERC-7857 on this registry, and what it does NOT claim.
 *
 * The interface was named in the codebase long before anything implemented it:
 * `updateMetadata` took a `proof` argument and its body read `proof;` — discarded.
 * Any owner could set an agent's metadata root to any 32 bytes, including a number
 * no document has ever hashed to, and `tokenURI` would render from it as fact.
 *
 * The tests below are as much about the refusals as the acceptances. A verifier that
 * returned `isValid: true` for proofs it cannot check would satisfy every happy path
 * here and be worth nothing, so the paths with no oracle behind them are pinned to
 * REVERT rather than left unexercised.
 */
contract Erc7857Test is Test {
    AgentRegistry internal registry;
    ZgDataVerifier internal verifier;
    ConfigRegistry internal config;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    /// @dev A plausible agent document. Its 0G Storage root is what the token carries.
    bytes internal constant DOC =
        '{"name":"Nostradamus","role":"trader","model":"claude-sonnet-4-6","persona":"forecasts, then sizes"}';

    function setUp() public {
        ConfigRegistry cfgImpl = new ConfigRegistry();
        config = ConfigRegistry(
            address(
                new ERC1967Proxy(
                    address(cfgImpl), abi.encodeCall(ConfigRegistry.initialize, (address(this), makeAddr("guardian")))
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
        verifier = new ZgDataVerifier();
        registry.setVerifier(address(verifier));
    }

    /// @dev flags byte 0x00: TEE-shaped, public data — the only shape this verifier settles.
    function _preimageProof(bytes memory data) internal pure returns (bytes memory) {
        return abi.encodePacked(bytes1(0x00), data);
    }

    function _transferProof(address to, bytes memory data) internal pure returns (bytes memory) {
        return abi.encodePacked(bytes1(0x00), bytes20(to), data);
    }

    function _one(bytes memory proof) internal pure returns (bytes[] memory out) {
        out = new bytes[](1);
        out[0] = proof;
    }

    function _desc(string memory d) internal pure returns (string[] memory out) {
        out = new string[](1);
        out[0] = d;
    }

    // ── what it proves ────────────────────────────────────────────────────────

    /**
     * The hash a token carries is DERIVED from bytes the caller supplied, never
     * accepted as an assertion — and it is 0G Storage's own root, so the number is
     * the file's address. Anyone can fetch those bytes by it and recompute.
     */
    function test_mintDerivesTheDataHashFromTheBytesSupplied() public {
        vm.prank(alice);
        uint256 id = registry.mint(_one(_preimageProof(DOC)), _desc("agent metadata"), alice);

        assertEq(registry.ownerOf(id), alice, "minted to the wrong owner");
        assertEq(registry.metadataRootOf(id), ZgMerkle.root(DOC), "not the 0G Storage root of the document");
        assertEq(registry.dataHashesOf(id)[0], ZgMerkle.root(DOC), "the 7857 array disagrees");
        assertEq(registry.dataDescriptionsOf(id)[0], "agent metadata", "description lost");
    }

    /**
     * The defect this whole implementation exists to close. `updateMetadata` took a
     * proof and discarded it; a root could be set to any 32 bytes at all.
     */
    function test_metadataCannotBeSetToARootNoDocumentHashesTo() public {
        vm.prank(alice);
        uint256 id = registry.mint(_one(_preimageProof(DOC)), _desc("agent metadata"), alice);

        bytes memory replacement = '{"name":"Nostradamus","model":"claude-opus-5"}';
        bytes32 invented = keccak256("a root I would like this agent to have");

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(AgentRegistry.DataHashMismatch.selector, invented, ZgMerkle.root(replacement))
        );
        registry.updateMetadata(id, invented, _preimageProof(replacement));

        // The honest update, of the same document, succeeds.
        vm.prank(alice);
        registry.updateMetadata(id, ZgMerkle.root(replacement), _preimageProof(replacement));
        assertEq(registry.metadataRootOf(id), ZgMerkle.root(replacement), "the proven root was not stored");
    }

    /// @dev A transfer proof is bound to its receiver, or one holder's proof could be
    ///      replayed to send a token somewhere its owner never intended.
    function test_aTransferProofIsBoundToItsReceiver() public {
        vm.prank(alice);
        uint256 id = registry.mint(_one(_preimageProof(DOC)), _desc("agent metadata"), alice);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.WrongReceiver.selector, bob, alice));
        registry.transfer(bob, id, _one(_transferProof(alice, DOC)));

        vm.prank(alice);
        registry.transfer(bob, id, _one(_transferProof(bob, DOC)));
        assertEq(registry.ownerOf(id), bob, "ownership did not move");
        assertEq(registry.metadataRootOf(id), ZgMerkle.root(DOC), "data did not follow the token");
    }

    /// @dev A proof about different data cannot overwrite what the agent holds.
    function test_aProofAboutOtherDataIsRefused() public {
        vm.prank(alice);
        uint256 id = registry.mint(_one(_preimageProof(DOC)), _desc("agent metadata"), alice);

        bytes memory other = "a completely different document";
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(AgentRegistry.DataHashMismatch.selector, ZgMerkle.root(DOC), ZgMerkle.root(other))
        );
        registry.transfer(bob, id, _one(_transferProof(bob, other)));
    }

    function test_cloneCopiesTheDataAndNotTheStakeOrOperator() public {
        vm.prank(alice);
        uint256 id = registry.mint(_one(_preimageProof(DOC)), _desc("agent metadata"), alice);
        vm.prank(alice);
        registry.setOperator(id, alice);

        vm.prank(alice);
        uint256 copyId = registry.clone(bob, id, _one(_transferProof(bob, DOC)));

        assertEq(registry.ownerOf(id), alice, "the original changed hands");
        assertEq(registry.ownerOf(copyId), bob, "the clone went to the wrong owner");
        assertEq(registry.metadataRootOf(copyId), ZgMerkle.root(DOC), "the clone carries different data");
        // A clone that inherited the operator key would let anyone mint a second agent
        // that acts for the first.
        assertEq(registry.operatorOf(copyId), address(0), "the clone inherited an operator");
        assertEq(registry.stakeOf(copyId), 0, "the clone inherited stake");
    }

    function test_usageCanBeAuthorizedWithoutTransferringOwnership() public {
        vm.prank(alice);
        uint256 id = registry.mint(_one(_preimageProof(DOC)), _desc("agent metadata"), alice);

        vm.prank(alice);
        registry.authorizeUsage(id, bob);
        assertEq(registry.authorizedUsersOf(id).length, 1, "not recorded");
        assertEq(registry.authorizedUsersOf(id)[0], bob, "wrong user");
        assertEq(registry.ownerOf(id), alice, "authorising moved ownership");

        // Twice is refused rather than duplicated: an address listed twice would be
        // revoked once and still appear.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.AlreadyAuthorized.selector, bob));
        registry.authorizeUsage(id, bob);
    }

    // ── what it refuses ───────────────────────────────────────────────────────

    /**
     * The heart of it. ERC-7857's private path needs an oracle that re-encrypts inside
     * a TEE and attests to it; 0G publishes no such oracle address on any network.
     * Returning `isValid: true` here would have been three lines and would have made
     * every guarantee above worthless while looking identical on chain.
     */
    function test_privateDataIsRefusedRatherThanAssumedValid() public {
        bytes memory privateProof = abi.encodePacked(bytes1(0x02), DOC);
        vm.prank(alice);
        vm.expectRevert(ZgDataVerifier.PrivateDataUnsupported.selector);
        registry.mint(_one(privateProof), _desc("agent metadata"), alice);
    }

    function test_zkpProofsAreRefusedRatherThanAssumedValid() public {
        bytes memory zkp = abi.encodePacked(bytes1(0x01), DOC);
        vm.prank(alice);
        vm.expectRevert(ZgDataVerifier.ZkpUnsupported.selector);
        registry.mint(_one(zkp), _desc("agent metadata"), alice);
    }

    /// @dev A proof written for a future extension is refused, not half-read.
    function test_reservedFlagsAreRefused() public {
        bytes memory future = abi.encodePacked(bytes1(0x80), DOC);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ZgDataVerifier.ReservedFlagsSet.selector, uint8(0x80)));
        registry.mint(_one(future), _desc("agent metadata"), alice);
    }

    /// @dev With no verifier there is nothing that can check a proof, so nothing that
    ///      takes one may succeed. Refused rather than waved through.
    function test_nothingTakingAProofWorksWithoutAVerifier() public {
        registry.setVerifier(address(0));
        vm.prank(alice);
        vm.expectRevert(AgentRegistry.VerifierUnset.selector);
        registry.mint(_one(_preimageProof(DOC)), _desc("agent metadata"), alice);
    }

    function test_emptyDataHasNoRootAndIsRefused() public {
        vm.prank(alice);
        vm.expectRevert(ZgDataVerifier.EmptyData.selector);
        registry.mint(_one(_preimageProof("")), _desc("agent metadata"), alice);
    }

    // ── living alongside what was already there ───────────────────────────────

    /**
     * Agents registered before ERC-7857 existed keep their root where it always was,
     * in `Agent.metadataRoot`, and nothing had to be migrated. A reader asking either
     * way gets the same answer.
     */
    function test_anAgentFromBeforeErc7857StillHasItsDocument() public {
        bytes32 root = ZgMerkle.root(DOC);
        vm.prank(alice);
        uint256 id = registry.register(IAgentRegistry.Role.Trader, alice, "legacy-agent", root);

        assertEq(registry.metadataRootOf(id), root, "the legacy root went missing");
        assertEq(registry.dataHashesOf(id).length, 1, "should read as exactly one document");
        assertEq(registry.dataHashesOf(id)[0], root, "the 7857 view disagrees with the legacy field");

        // And it can be transferred under the standard, proving the same document.
        vm.prank(alice);
        registry.transfer(bob, id, _one(_transferProof(bob, DOC)));
        assertEq(registry.ownerOf(id), bob, "a legacy agent could not be transferred");
    }

    function test_theStandardInterfaceIsWhatCallersBindTo() public view {
        // A 7857-aware tool asks for the verifier and gets a real address.
        assertEq(address(IERC7857(address(registry)).verifier()), address(verifier), "verifier not exposed");
    }

    /**
     * Rendering left this contract when ERC-7857 pushed it past EIP-170's 24,576-byte
     * limit — the upgrade reverted at the far end of a broadcast that had already
     * spent the gas. Turning the optimiser down fitted it with 53 bytes to spare,
     * which is the same failure waiting for the next change rather than a fix.
     *
     * An unset renderer REVERTS. Returning "" instead would be the blank card that
     * made `tokenURI` worth implementing in the first place, and it would look to a
     * wallet exactly like an agent with nothing to show.
     */
    function test_anUnsetRendererSaysSoRatherThanRenderingNothing() public {
        vm.prank(alice);
        uint256 id = registry.mint(_one(_preimageProof(DOC)), _desc("agent metadata"), alice);

        vm.expectRevert(AgentRegistry.CardUnset.selector);
        registry.tokenURI(id);

        registry.setCard(address(new AgentCard()));
        assertGt(bytes(registry.tokenURI(id)).length, 0, "still renders nothing");
    }
}
