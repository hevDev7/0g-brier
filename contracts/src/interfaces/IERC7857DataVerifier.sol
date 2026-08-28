// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice What a preimage proof establishes about one piece of data.
struct PreimageProofOutput {
    bytes32 dataHash;
    bool isValid;
}

/// @notice What a transfer proof establishes about one piece of data changing hands.
struct TransferValidityProofOutput {
    bytes32 oldDataHash;
    bytes32 newDataHash;
    address receiver;
    bytes16 sealedKey;
    bool isValid;
}

/**
 * @notice The oracle an ERC-7857 token defers to for proofs about its data.
 * @dev Interface and structs taken verbatim from 0G's reference implementation
 *      (0g-agent-nft, eip-7857-draft) so that a 7857-aware tool binds to the same
 *      shape. What a given verifier will actually PROVE is its own business — see
 *      `ZgDataVerifier` for one that proves something checkable and refuses the rest.
 */
interface IERC7857DataVerifier {
    /// @notice Verify preimage of data. For public data the proof is knowing the
    ///         pre-image of the data hash; where no preimage proof is required, the
    ///         proof is the data itself.
    function verifyPreimage(bytes[] calldata _proofs) external returns (PreimageProofOutput[] memory);

    /// @notice Verify that data may validly change hands: that the pre-image is known,
    ///         that the receiver can reach the data afterwards, and — for private data
    ///         — that it was re-encrypted to a key sealed for the receiver.
    function verifyTransferValidity(bytes[] calldata _proofs) external returns (TransferValidityProofOutput[] memory);
}
