// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CommitteeFixtures} from "../helpers/CommitteeFixtures.sol";
import {IAgentRegistry} from "../../src/interfaces/IAgentRegistry.sol";
import {ZgDataVerifier} from "../../src/core/ZgDataVerifier.sol";
import {AgentCard} from "../../src/core/AgentCard.sol";
import {ZgMerkle} from "../../src/math/ZgMerkle.sol";

/// @dev `tokenURI` returned the empty string until this existed, because the contract
///      inherited OpenZeppelin's ERC721 and never overrode it. The identity was
///      perfectly well defined on chain — name, role, operator — and every explorer
///      and wallet showed a blank card, which is what prompted this file.
contract AgentTokenURITest is CommitteeFixtures {
    /// @dev Rendering moved out of the registry when ERC-7857 pushed it past EIP-170.
    ///      The card is a separate contract now and has to be pointed at, which is the
    ///      one thing these tests had to learn — everything they assert is unchanged.
    address internal trader = makeAddr("traderOperator");
    uint256 internal traderId;

    string internal constant PREFIX = "data:application/json;base64,";

    function setUp() public {
        _deployBase();
        _deployCommittee(3, 1_000e6);
        traderId = registry_.register(IAgentRegistry.Role.Trader, trader, "Nostradamus", bytes32(0));
        registry_.setVerifier(address(new ZgDataVerifier()));
        registry_.setCard(address(new AgentCard()));
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /// @dev Decodes the payload so the assertions read the JSON a wallet would, not
    ///      the base64 a wallet never shows anyone.
    function _json(uint256 agentId) internal view returns (string memory) {
        string memory uri = registry_.tokenURI(agentId);
        bytes memory b = bytes(uri);
        bytes memory prefix = bytes(PREFIX);
        assertGt(b.length, prefix.length, "uri is nothing but a prefix");
        for (uint256 i; i < prefix.length; i++) {
            assertEq(b[i], prefix[i], "not a base64 json data uri");
        }
        bytes memory payload = new bytes(b.length - prefix.length);
        for (uint256 i; i < payload.length; i++) {
            payload[i] = b[i + prefix.length];
        }
        return string(_b64decode(payload));
    }

    function _contains(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length == 0 || n.length > h.length) return false;
        for (uint256 i; i <= h.length - n.length; i++) {
            bool hit = true;
            for (uint256 j; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    hit = false;
                    break;
                }
            }
            if (hit) return true;
        }
        return false;
    }

    function _b64decode(bytes memory data) internal pure returns (bytes memory) {
        bytes memory table = bytes("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/");
        uint8[128] memory rev;
        for (uint8 i; i < 64; i++) {
            rev[uint8(table[i])] = i;
        }

        uint256 pad;
        while (pad < 2 && data.length > pad && data[data.length - 1 - pad] == "=") pad++;
        bytes memory out = new bytes((data.length / 4) * 3 - pad);

        uint256 n;
        for (uint256 i; i + 3 < data.length; i += 4) {
            uint256 chunk = (uint256(rev[uint8(data[i])]) << 18) | (uint256(rev[uint8(data[i + 1])]) << 12)
                | (uint256(rev[uint8(data[i + 2])]) << 6) | uint256(rev[uint8(data[i + 3])]);
            if (n < out.length) out[n++] = bytes1(uint8(chunk >> 16));
            if (n < out.length) out[n++] = bytes1(uint8(chunk >> 8));
            if (n < out.length) out[n++] = bytes1(uint8(chunk));
        }
        return out;
    }

    // ── the metadata itself ───────────────────────────────────────────────────

    function test_tokenURIcarriesTheNameRoleAndOperator() public view {
        string memory json = _json(traderId);
        assertTrue(_contains(json, '"name":"Nostradamus"'), "name missing");
        assertTrue(_contains(json, '"value":"Trader"'), "role missing");
        // Lowercase, as Strings.toHexString writes it.
        assertTrue(_contains(json, '"value":"0x'), "operator missing");
        assertTrue(_contains(json, '"image":"data:image/svg+xml;base64,'), "no image, so a blank card again");
    }

    /// @dev The state this shipped in: registered, never published. It must still
    ///      render — a name and a role are on chain and are enough to show.
    function test_anAgentWithNoPersonaStillRenders() public view {
        assertEq(registry_.metadataRootOf(traderId), bytes32(0), "fixture already has a persona");
        string memory json = _json(traderId);
        assertTrue(_contains(json, '"trait_type":"Persona","value":"none published"'), "empty root not stated plainly");
        assertTrue(_contains(json, '"name":"Nostradamus"'), "an unpublished agent lost its name");
    }

    /// @dev The root is no longer a number chosen for this test: `updateMetadata` now
    ///      makes the caller prove it, so the document is supplied and the root is
    ///      whatever 0G Storage would address those exact bytes by.
    function test_publishingAPersonaPutsItsRootInTheMetadata() public {
        bytes memory persona = '{"name":"Nostradamus","style":"forecast first, size second"}';
        bytes32 root = ZgMerkle.root(persona);
        registry_.updateMetadata(traderId, root, abi.encodePacked(bytes1(0x00), persona));

        string memory json = _json(traderId);
        assertTrue(
            _contains(json, string.concat('"value":"', vm.toString(root), '"')),
            "the root is not fetchable from the metadata"
        );
        assertFalse(_contains(json, "none published"), "still claims nothing is published");
    }

    /// @dev A name is 31 arbitrary bytes chosen by whoever registered it. An
    ///      unescaped quote closes the JSON string early and produces a document no
    ///      parser will read — from a name anyone can pick, for free.
    function test_aQuoteInANameDoesNotBreakTheDocument() public {
        uint256 id = registry_.register(IAgentRegistry.Role.Trader, makeAddr("quoted"), bytes32('say "hi"'), bytes32(0));
        string memory json = _json(id);
        assertTrue(_contains(json, '\\"hi\\"'), "the quote was not escaped");
        // Escaped, not stripped: the name shown has to be the name registered.
        assertTrue(_contains(json, "say "), "the name was mangled rather than escaped");
    }

    /// @dev The SVG is base64'd into the JSON, so it needs XML escaping, not JSON
    ///      escaping. A name with an angle bracket would otherwise open a tag.
    function test_anAngleBracketInANameDoesNotBreakTheImage() public {
        uint256 id = registry_.register(IAgentRegistry.Role.Trader, makeAddr("tagged"), bytes32("a<b>c"), bytes32(0));
        string memory json = _json(id);
        // The name reaches the JSON intact; the escaping happens inside the SVG.
        assertTrue(_contains(json, '"name":"a<b>c"'), "name mangled in the json");
        assertTrue(_contains(json, '"image":"data:image/svg+xml;base64,'), "image missing");
    }

    function test_askingForAnAgentThatDoesNotExistReverts() public {
        // Bound to the selector rather than a bare expectRevert, which would be
        // satisfied by any revert at all — including one from the wrong call.
        vm.expectRevert(abi.encodeWithSignature("ERC721NonexistentToken(uint256)", 999));
        registry_.tokenURI(999);
    }

    /// @dev Two identities that look alike in a list are two identities somebody will
    ///      confuse. The hue is derived, so this costs no storage.
    function test_twoAgentsDoNotGetTheSameCard() public {
        uint256 other = registry_.register(IAgentRegistry.Role.Trader, makeAddr("second"), "Pythia", bytes32(0));
        assertTrue(
            keccak256(bytes(registry_.tokenURI(traderId))) != keccak256(bytes(registry_.tokenURI(other))),
            "two agents render identically"
        );
    }
}
