// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title ZgMerkle
 * @notice The 0G Storage Merkle root of a byte string — the same number the upload
 *         returns and the same one a file is addressed by.
 *
 * @dev A Solidity mirror of `packages/zg-storage`'s `zgMerkleRoot`, which is itself
 *      pinned to 0G's own storage SDK by 19 vectors. Those vectors are
 *      re-run against THIS implementation in `test/unit/ZgMerkle.t.sol`, because a
 *      mirror is only worth having if something fails when it drifts.
 *
 *      WHY ON CHAIN AT ALL. ERC-7857 requires a data hash and a proof that the holder
 *      knows its pre-image. Any hash function would satisfy the letter of that. Using
 *      0G Storage's own root makes the token's `dataHash` the file's ADDRESS: anyone
 *      can fetch those exact bytes from 0G Storage by that number and recompute it.
 *      A plain `keccak256` would prove the same thing about bytes nobody could find.
 *
 *      Two details are easy to get wrong and both are load-bearing:
 *
 *      PADDING is not simply the next power of two. Above 16 chunks 0G rounds the
 *      count up to a multiple of a SIXTEENTH of that power, which is far less
 *      padding. A wrong rule agrees with the right one on most inputs and disagrees
 *      just past a power of two, which is why the vectors straddle 16, 32 and 1024.
 *
 *      THE FOLD is not the textbook shape. An odd node is carried unchanged to the
 *      BACK of the queue rather than duplicated or paired with its neighbour, so the
 *      tree is deliberately unbalanced. Mirroring the sequence exactly is the whole
 *      point: a root that is "a" Merkle root of the same bytes is still wrong.
 */
library ZgMerkle {
    /// @dev 0G splits a file into 256-byte chunks and 1024-chunk segments.
    uint256 internal constant CHUNK_BYTES = 256;
    uint256 internal constant CHUNKS_PER_SEGMENT = 1024;

    /// @notice The root of `data`, or zero for empty input — which has no root at all.
    function root(bytes memory data) internal pure returns (bytes32) {
        if (data.length == 0) return bytes32(0);

        uint256 chunks = _ceilDiv(data.length, CHUNK_BYTES);
        uint256 padded = _paddedChunkCount(chunks);
        uint256 segments = _ceilDiv(padded, CHUNKS_PER_SEGMENT);

        bytes32[] memory segmentRoots = new bytes32[](segments);
        for (uint256 s = 0; s < segments; s++) {
            uint256 first = s * CHUNKS_PER_SEGMENT;
            uint256 count = padded - first;
            if (count > CHUNKS_PER_SEGMENT) count = CHUNKS_PER_SEGMENT;

            bytes32[] memory leaves = new bytes32[](count);
            for (uint256 c = 0; c < count; c++) {
                leaves[c] = _chunkHash(data, (first + c) * CHUNK_BYTES);
            }
            segmentRoots[s] = _fold(leaves);
        }
        return _fold(segmentRoots);
    }

    /**
     * @dev The hash of one 256-byte chunk, zero-filled past the end of `data`.
     *
     *      The padding is never materialised: a chunk entirely past the end is the
     *      hash of 256 zero bytes whatever the file was, and a straddling chunk is
     *      copied into a zeroed buffer. Building the whole padded copy instead would
     *      mean allocating up to sixteen times the input for the last chunk's sake.
     */
    function _chunkHash(bytes memory data, uint256 offset) private pure returns (bytes32 h) {
        uint256 len = data.length;
        if (offset >= len) return keccak256(new bytes(CHUNK_BYTES));

        uint256 take = len - offset;
        if (take > CHUNK_BYTES) take = CHUNK_BYTES;

        bytes memory chunk = new bytes(CHUNK_BYTES);
        // `new bytes` is already zeroed, so only the present bytes are copied and the
        // tail keeps the zero fill the padding rule asks for.
        assembly ("memory-safe") {
            let src := add(add(data, 0x20), offset)
            let dst := add(chunk, 0x20)
            mcopy(dst, src, take)
            h := keccak256(dst, CHUNK_BYTES)
        }
    }

    /**
     * @dev Fold leaves into a root, in 0G's order.
     *
     *      Pass one pairs neighbours, carrying a lone final leaf unchanged. Each pass
     *      after that takes two from the FRONT and appends the hash to the BACK, then
     *      moves any single leftover from front to back — so the carried node ends up
     *      after the nodes formed in the same pass, not before them.
     */
    function _fold(bytes32[] memory leaves) private pure returns (bytes32) {
        uint256 n = leaves.length;
        if (n == 0) return bytes32(0);

        // Written into once and never resized: every pass appends about half of what
        // it consumes, so the total ever written is under 2n.
        bytes32[] memory queue = new bytes32[](2 * n + 2);
        uint256 head = 0;
        uint256 tail = 0;

        for (uint256 i = 0; i < n; i += 2) {
            queue[tail++] = i + 1 < n ? keccak256(abi.encodePacked(leaves[i], leaves[i + 1])) : leaves[i];
        }

        while (tail - head > 1) {
            uint256 m = tail - head;
            for (uint256 i = 0; i < m / 2; i++) {
                bytes32 left = queue[head++];
                bytes32 right = queue[head++];
                queue[tail++] = keccak256(abi.encodePacked(left, right));
            }
            if (m % 2 == 1) queue[tail++] = queue[head++];
        }
        return queue[head];
    }

    /**
     * @dev How many chunks the file is zero-padded to before hashing.
     *
     *      Not the next power of two: above 16 chunks 0G rounds up to a multiple of a
     *      SIXTEENTH of that power, which pads far less. Getting this wrong produces a
     *      root that is wrong only for some sizes.
     */
    function _paddedChunkCount(uint256 chunks) private pure returns (uint256) {
        uint256 p2 = _nextPow2(chunks);
        if (p2 == chunks) return chunks;
        uint256 minChunk = p2 >= 16 ? p2 / 16 : 1;
        return _ceilDiv(chunks, minChunk) * minChunk;
    }

    function _nextPow2(uint256 n) private pure returns (uint256 p) {
        if (n <= 1) return 1;
        p = 1;
        while (p < n) p <<= 1;
    }

    function _ceilDiv(uint256 total, uint256 unit) private pure returns (uint256) {
        return (total - 1) / unit + 1;
    }
}
