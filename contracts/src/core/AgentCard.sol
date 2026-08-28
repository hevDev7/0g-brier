// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IAgentRegistry} from "../interfaces/IAgentRegistry.sol";
import {IAgentCard} from "../interfaces/IAgentCard.sol";

/**
 * @title AgentCard
 * @notice How an agent identity renders in a wallet or an explorer.
 *
 * @dev Split out of `AgentRegistry` when implementing ERC-7857 pushed that contract
 *      past EIP-170's 24,576-byte limit. This is the part that had to go: base64, an
 *      SVG and two escapers, all of it reached only by a `tokenURI` call from a wallet
 *      and none of it on any path that moves money.
 *
 *      PURE, and holding no state. It is handed what it renders, so it can be replaced
 *      without touching an identity, and replacing it cannot lose one.
 */
contract AgentCard is IAgentCard {
    function render(uint256 agentId, bytes32 name, IAgentRegistry.Role role, address operator, bytes32 metadataRoot)
        external
        pure
        returns (string memory)
    {
        string memory name_ = _readName(name);
        string memory persona =
            metadataRoot == bytes32(0) ? "none published" : Strings.toHexString(uint256(metadataRoot), 32);

        string memory json = string.concat(
            '{"name":"',
            _jsonEscape(name_),
            '","description":"An agent identity on Brier. The name and role are on chain; the persona, prompts and model configuration live in a 0G Storage document addressed by the Persona attribute.","image":"',
            _image(name_, agentId),
            '","attributes":[{"trait_type":"Role","value":"',
            _roleName(role),
            '"},{"trait_type":"Agent ID","value":',
            Strings.toString(agentId),
            '},{"trait_type":"Operator","value":"',
            Strings.toHexString(operator),
            '"},{"trait_type":"Persona","value":"',
            persona,
            '"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// @dev A plain card. Deterministic hue per agent so two identities are
    ///      distinguishable at a glance without storing anything.
    function _image(string memory name_, uint256 agentId) internal pure returns (string memory) {
        string memory hue = Strings.toString(uint256(keccak256(abi.encode(agentId))) % 360);
        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">',
            '<rect width="400" height="400" fill="hsl(',
            hue,
            ',35%,16%)"/>',
            '<text x="200" y="196" font-family="ui-monospace,monospace" font-size="15" fill="hsl(',
            hue,
            ',45%,68%)" text-anchor="middle">BRIER AGENT</text>',
            '<text x="200" y="228" font-family="ui-monospace,monospace" font-size="26" fill="#f2f2f0" text-anchor="middle">',
            _xmlEscape(name_),
            "</text></svg>"
        );
        return string.concat("data:image/svg+xml;base64,", Base64.encode(bytes(svg)));
    }

    /// @dev `name` is a right-padded bytes32 string; the padding is not part of it.
    function _readName(bytes32 raw) internal pure returns (string memory) {
        uint256 len;
        while (len < 32 && raw[len] != 0) len++;
        bytes memory out = new bytes(len);
        for (uint256 i; i < len; i++) {
            out[i] = raw[i];
        }
        return string(out);
    }

    function _roleName(IAgentRegistry.Role r) internal pure returns (string memory) {
        if (r == IAgentRegistry.Role.Creator) return "Creator";
        if (r == IAgentRegistry.Role.Curator) return "Curator";
        if (r == IAgentRegistry.Role.Resolver) return "Resolver";
        return "Trader";
    }

    /// @dev A name is 31 arbitrary bytes chosen by whoever registered it, so it can
    ///      contain a quote and produce a document no parser will read. Escaped
    ///      rather than filtered: the name shown must be the name registered.
    function _jsonEscape(string memory input) internal pure returns (string memory) {
        bytes memory b = bytes(input);
        bytes memory out = new bytes(b.length * 2);
        uint256 n;
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == '"' || c == "\\") {
                out[n++] = "\\";
                out[n++] = c;
            } else if (uint8(c) >= 0x20) {
                out[n++] = c;
            }
            // Control bytes are dropped. JSON would need \u00XX for them, and a
            // display name containing one is not a name anybody meant to register.
        }
        assembly {
            mstore(out, n)
        }
        return string(out);
    }

    /// @dev The SVG is base64'd into the JSON, so it needs XML escaping only.
    function _xmlEscape(string memory input) internal pure returns (string memory) {
        bytes memory b = bytes(input);
        bytes memory out = new bytes(b.length * 6);
        uint256 n;
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == "&") {
                for (uint256 k; k < 5; k++) {
                    out[n++] = bytes("&amp;")[k];
                }
            } else if (c == "<") {
                for (uint256 k; k < 4; k++) {
                    out[n++] = bytes("&lt;")[k];
                }
            } else if (c == ">") {
                for (uint256 k; k < 4; k++) {
                    out[n++] = bytes("&gt;")[k];
                }
            } else if (uint8(c) >= 0x20) {
                out[n++] = c;
            }
        }
        assembly {
            mstore(out, n)
        }
        return string(out);
    }
}
