// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {
    IERC7857DataVerifier,
    PreimageProofOutput,
    TransferValidityProofOutput
} from "../interfaces/IERC7857DataVerifier.sol";
import {ZgMerkle} from "../math/ZgMerkle.sol";

/**
 * @title ZgDataVerifier
 * @notice An ERC-7857 data verifier that proves what it can prove, and refuses the rest.
 *
 * @dev ERC-7857 has two proof paths and they are not equally reachable today.
 *
 *      PRIVATE DATA needs an oracle that decrypts inside a TEE, re-encrypts under a
 *      fresh key, seals that key to the receiver's public key, and attests to all of
 *      it. 0G publishes no such oracle address — not on Galileo, not on mainnet — and
 *      this contract cannot conjure one. So the private path REVERTS. It would have
 *      been three lines to return `isValid: true` instead, and those three lines would
 *      have made every guarantee on this page worthless while looking identical on
 *      chain to one that meant something.
 *
 *      PUBLIC DATA needs no oracle, and the standard says so: "for public data, the
 *      proof is knowing the pre-image of dataHashes… if preimage proof is not
 *      required, the proof is the data itself." That is a claim this contract can
 *      settle by itself, and it does: it hashes the bytes it was handed and returns
 *      the hash it computed. A caller cannot name a hash — only supply bytes and be
 *      told what they hash to.
 *
 *      THE HASH IS 0G STORAGE'S OWN. Any hash function satisfies the letter of the
 *      standard. Using the 0G Storage Merkle root makes a token's `dataHash` the
 *      file's ADDRESS: anyone can fetch those exact bytes from 0G Storage by that
 *      number and recompute it. `keccak256` would prove the same thing about bytes
 *      nobody could find.
 *
 *      RE-ENCRYPTION IS A NO-OP FOR PUBLIC DATA, and that is a statement about the
 *      data rather than a shortcut. There is nothing to re-encrypt and no key to
 *      seal, so `oldDataHash == newDataHash` and `sealedKey` is empty. What transfer
 *      still has to establish is that the proof was made FOR this receiver, which is
 *      why the receiver is bound into the proof bytes and returned for the caller to
 *      check. Without that, one holder's proof could be replayed to send a token
 *      somewhere its owner never intended.
 *
 *      PROOF LAYOUT. The draft's byte layout is written for the TEE case and carries
 *      its own TODOs; following it verbatim for a path it does not describe would be
 *      imitation rather than conformance. The flags byte keeps the draft's meaning,
 *      and the rest is stated plainly here:
 *
 *        verifyPreimage:         [1 byte flags][data…]
 *        verifyTransferValidity: [1 byte flags][20 bytes receiver][data…]
 *
 *        flags bit 0 — 0 TEE, 1 ZKP        (both refused: neither is implemented)
 *        flags bit 1 — 0 public, 1 private (private refused)
 *        bits 2-7    — reserved, must be zero
 */
contract ZgDataVerifier is IERC7857DataVerifier {
    /// @dev bit 1 of the flags byte.
    uint8 private constant FLAG_PRIVATE = 0x02;
    /// @dev bit 0 of the flags byte.
    uint8 private constant FLAG_ZKP = 0x01;
    /// @dev Everything above bit 1 is reserved and must be zero, so that a proof
    ///      written for a future extension is refused here rather than half-read.
    uint8 private constant FLAG_RESERVED = 0xFC;

    error EmptyProof();
    error ReservedFlagsSet(uint8 flags);
    /// @dev No TEE or ZKP oracle exists to check such a proof. Refused rather than
    ///      assumed valid: an unverified claim recorded on chain is worth less than
    ///      no claim, because it looks exactly like a verified one.
    error PrivateDataUnsupported();
    error ZkpUnsupported();
    error ProofTooShortForReceiver();
    error EmptyData();

    /// @inheritdoc IERC7857DataVerifier
    function verifyPreimage(bytes[] calldata _proofs) external pure returns (PreimageProofOutput[] memory out) {
        out = new PreimageProofOutput[](_proofs.length);
        for (uint256 i = 0; i < _proofs.length; i++) {
            bytes calldata proof = _proofs[i];
            _requirePublicPlaintext(proof);

            bytes memory data = proof[1:];
            if (data.length == 0) revert EmptyData();
            // The hash is DERIVED, never accepted. That is the whole proof: the caller
            // supplies bytes and is told what they hash to.
            out[i] = PreimageProofOutput({dataHash: ZgMerkle.root(data), isValid: true});
        }
    }

    /// @inheritdoc IERC7857DataVerifier
    function verifyTransferValidity(bytes[] calldata _proofs)
        external
        pure
        returns (TransferValidityProofOutput[] memory out)
    {
        out = new TransferValidityProofOutput[](_proofs.length);
        for (uint256 i = 0; i < _proofs.length; i++) {
            bytes calldata proof = _proofs[i];
            _requirePublicPlaintext(proof);
            if (proof.length < 21) revert ProofTooShortForReceiver();

            address receiver = address(bytes20(proof[1:21]));
            bytes memory data = proof[21:];
            if (data.length == 0) revert EmptyData();

            bytes32 hash = ZgMerkle.root(data);
            out[i] = TransferValidityProofOutput({
                // Equal on purpose. Public data is not re-encrypted, so claiming a new
                // hash would be claiming a transformation that did not happen.
                oldDataHash: hash,
                newDataHash: hash,
                receiver: receiver,
                // Empty on purpose. There is no key to seal when there is no secret.
                sealedKey: bytes16(0),
                isValid: true
            });
        }
    }

    /// @dev The only shape this contract can honestly settle.
    function _requirePublicPlaintext(bytes calldata proof) private pure {
        if (proof.length == 0) revert EmptyProof();
        uint8 flags = uint8(proof[0]);
        if (flags & FLAG_RESERVED != 0) revert ReservedFlagsSet(flags);
        if (flags & FLAG_PRIVATE != 0) revert PrivateDataUnsupported();
        if (flags & FLAG_ZKP != 0) revert ZkpUnsupported();
    }
}
