// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ZgMerkle} from "../../src/math/ZgMerkle.sol";

/**
 * The Solidity mirror of `packages/zg-storage`'s `zgMerkleRoot`, held to the SAME
 * vectors, generated from 0G's own storage SDK (0g-storage-ts-sdk 1.2.11) with
 * `new MemData(bytes).merkleTree()` — not from either mirror.
 *
 * This is the device that pins the DPM library to its TypeScript twin, used again:
 * two implementations are only worth having if something fails when they drift. The
 * sizes straddle every boundary the padding rule has — 16, 32 and 1024 chunks —
 * because a wrong rule agrees with the right one on most inputs and disagrees just
 * past a power of two.
 *
 * The larger vectors from the TypeScript set are deliberately absent: they are
 * hundreds of kilobytes, which no transaction can carry as calldata anyway, and
 * hashing them here would cost minutes of test time to re-prove a rule the smaller
 * sizes already pin. What IS kept is every size within reach of a real agent
 * metadata document, plus both sides of each padding boundary below one segment.
 */
contract ZgMerkleTest is Test {
    /// @dev Byte i is `(i * 37 + 11) mod 256` — the same one-line pattern the
    ///      TypeScript vectors use, so anyone can regenerate both sides.
    function _bytesOf(uint256 n) internal pure returns (bytes memory out) {
        out = new bytes(n);
        for (uint256 i = 0; i < n; i++) {
            out[i] = bytes1(uint8((i * 37 + 11) % 256));
        }
    }

    function _check(uint256 size, bytes32 expected) internal pure {
        bytes32 actual = ZgMerkle.root(_bytesOf(size));
        require(actual == expected, "0G merkle root drifted from the reference SDK");
    }

    function test_matchesTheReferenceSdkOnEveryPaddingBoundary() public pure {
        _check(1, 0xc01911b7b53672791742fb9dcf630c3b6d001487f6f27f41d9018d0901eeb85c);
        _check(255, 0x5b741b651f4d16b5dddf2254ef561c027206811b3ce372b63e7c62f31adc2196);
        _check(256, 0x5fe18c6fe729a64cf9a6570ac86303dd45ec8d238c443a688a732a077f374e2d);
        _check(257, 0x93603545719c989cda4956f815f526162959775493f30e9c503651fc7afcb16f);
        _check(512, 0x876b82c83791b3614b11bf5abc7f7d0aa4189ddd963f36b3d2347209dcaf50eb);
        _check(807, 0xb3d000b5c77c58e452997cf8f1c6d51bfb15604a54d4a130543be0657f938a86);
        _check(1024, 0xf96026e2fea52b21169545a47f92ed2bc8e51dfd7aebf42cdff29a5d73bc14cb);
    }

    /// @dev 15, 16 and 17 chunks: the rule changes shape at exactly 16.
    function test_padsCorrectlyAcrossTheSixteenChunkRule() public pure {
        _check(3840, 0x536f04938b51e5710e71052fa510886f118a1404e6e5955432cc8f26d165c440);
        _check(4096, 0xe7c2511b59465e6753da7ac0d5273fda4156ea4d15486571da7040bf7675182e);
        _check(4352, 0x5102d446ca915f8cc6398a4a17aa32fe3df83e1151603dd13d3fbe7e1d28519f);
    }

    /// @dev 31, 32 and 33 chunks: the same rule one power of two later.
    function test_padsCorrectlyAcrossTheThirtyTwoChunkRule() public pure {
        _check(7936, 0x1786a66ebde715b94a6c0dcc6ea303bf4be8cb90f997007eda6dddc2f1ad4ae1);
        _check(8192, 0xd7dc5f8482d90aaaefc418bc1f9325ba57f91ee6441ceb00a6729f8271dfa34b);
        _check(8448, 0x051fb7cbe888288011d29a8d810cfb5da15d3da35263b17514fbcc39572787cc);
    }

    /**
     * Empty input has no root, and zero is how that is said. It is NOT the root of
     * zero bytes — a caller that treats it as one would accept a token whose data
     * nobody ever supplied.
     */
    function test_emptyInputHasNoRoot() public pure {
        require(ZgMerkle.root("") == bytes32(0), "empty must not hash to anything");
    }

    /// @dev A one-byte change anywhere must move the root, including inside the
    ///      zero padding region, where a careless implementation ignores it.
    function testFuzz_everyByteMatters(uint16 size, uint16 at, uint8 to) public pure {
        uint256 n = uint256(size) % 2048 + 1;
        bytes memory a = _bytesOf(n);
        uint256 i = uint256(at) % n;
        vm.assume(uint8(a[i]) != to);

        bytes memory b = _bytesOf(n);
        b[i] = bytes1(to);
        require(ZgMerkle.root(a) != ZgMerkle.root(b), "a changed byte left the root alone");
    }

    /// @dev Length is part of the identity: the same prefix with more data behind it
    ///      is a different file, even when the extra bytes land in the same chunk.
    function test_lengthIsPartOfTheIdentity() public pure {
        require(ZgMerkle.root(_bytesOf(100)) != ZgMerkle.root(_bytesOf(101)), "length ignored");
        require(ZgMerkle.root(_bytesOf(256)) != ZgMerkle.root(_bytesOf(257)), "chunk boundary ignored");
    }
}
