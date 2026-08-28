// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ConfigRegistry} from "./ConfigRegistry.sol";
import {ConfigKeys} from "./ConfigKeys.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {IMarketResolution} from "../interfaces/IMarketResolution.sol";

/// @title ResolutionModule
/// @notice Anchors the settlement receipt for a market, and drives the market's terminal
///         transition in the same transaction.
///
/// @dev Why this contract exists at all: `Market.settle(uint8)` records the winner and the
///      timestamp and nothing else. The receipt — which models judged, on what evidence,
///      against which criteria — is a 0G Storage document (spec §7.5), and without a root
///      on chain there is no way to fetch one, nor any way to tell a real receipt from a
///      story invented afterwards. A market's `specRoot` shipped once with no document
///      behind it, and the lesson is written into `EmptyReceipt` below.
///
///      It is keyed by market address rather than stored inside `Market`, and that is the
///      whole reason no redeployment was needed: `Market` is a non-upgradeable clone, but
///      `onlyResolutionModule` reads `config.addresses(RESOLUTION_MODULE)` at CALL time, so
///      pointing the registry here is enough for every market that already exists.
///
///      UUPS rather than swap-and-replace, even though a swap is one owner call: the
///      receipts accumulate HERE. Replacing the address would strand every record written
///      by the previous module and leave a reader unable to say which contract to ask.
///      When P2 grows this into the committee — commit-reveal, dispute window, slashing —
///      it upgrades in place.
contract ResolutionModule is Initializable, Ownable2StepUpgradeable, UUPSUpgradeable {
    /// @dev Two fields, and both absences are deliberate.
    ///
    ///      No timestamp: `Market.resolvedAt` already holds it, written in this same
    ///      transaction. A second copy would be a second source for one fact, and the
    ///      two could only ever agree or be a bug.
    ///
    ///      No round counter either, though spec §7.5 gives the receipt document one. In
    ///      THIS contract it could never exceed 1: `Market.settle` rejects a settled
    ///      market and `markDisputed` accepts only a proposed one, so a market resolves
    ///      exactly once. A field that can hold only one value is a promise the code
    ///      cannot keep — it belongs here when P2 makes re-resolution real, and a mapping
    ///      entry can grow a slot safely because entries are spread across the hash space.
    struct Resolution {
        bytes32 receiptRoot;
        address resolver;
    }

    ConfigRegistry public config;

    /// @notice The receipt anchored for a market, and who anchored it. A non-zero
    ///         `receiptRoot` IS the record's existence check — an empty root is rejected
    ///         on the way in, so there is no third state to reason about.
    mapping(address => Resolution) public resolutionOf;

    /// @notice Who may resolve. Deliberately not the owner: a resolver is an operational
    ///         key that signs many transactions, and an owner is the key that can replace
    ///         this contract. They should not be the same key even when they are the same
    ///         person.
    mapping(address => bool) public isResolver;

    error NotResolver();
    error EmptyReceipt();
    error NotAMarket(address market);

    event ResolverSet(address indexed resolver, bool allowed);
    event Resolved(address indexed market, uint8 indexed outcome, bytes32 receiptRoot, address indexed resolver);
    event Abandoned(address indexed market, bytes32 receiptRoot, address indexed resolver);
    event Proposed(address indexed market, address indexed resolver);
    event Disputed(address indexed market, address indexed resolver);

    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address config_) external initializer {
        __Ownable_init(owner_);
        __Ownable2Step_init();
        __UUPSUpgradeable_init();
        config = ConfigRegistry(config_);
    }

    modifier onlyResolver() {
        if (!isResolver[msg.sender]) revert NotResolver();
        _;
    }

    function setResolver(address resolver, bool allowed) external onlyOwner {
        isResolver[resolver] = allowed;
        emit ResolverSet(resolver, allowed);
    }

    // ── the two terminal decisions, each with its receipt ─────────────────────

    /// @notice Anchor the receipt and settle `market` on `outcome`.
    /// @dev Checks and state first, the external call last. Not for atomicity — one
    ///      transaction gives that whichever way round they go — but because `_record`
    ///      holds both validations, and an invalid request should never reach the market
    ///      at all. What the ordering guarantees is that no `settle()` is ever attempted
    ///      on behalf of a receipt this contract was going to reject.
    function settle(address market, uint8 outcome, bytes32 receiptRoot) external onlyResolver {
        _record(market, receiptRoot);
        IMarketResolution(market).settle(outcome);
        emit Resolved(market, outcome, receiptRoot, msg.sender);
    }

    /// @notice Anchor the receipt and abandon `market` — no outcome could be established,
    ///         so every side exits at its own price.
    /// @dev A failure needs its evidence at least as much as a settlement does: it is the
    ///      case where holders are told the question could not be answered, and "why" is
    ///      the only thing they have to go on.
    function fail(address market, bytes32 receiptRoot) external onlyResolver {
        _record(market, receiptRoot);
        IMarketResolution(market).fail();
        emit Abandoned(market, receiptRoot, msg.sender);
    }

    // ── the intermediate transitions, which anchor nothing ────────────────────

    /// @dev No receipt here, and that is not an oversight: a proposal is not yet a
    ///      decision. Anchoring a root at this point would put a document on chain that
    ///      the dispute window still exists to overturn.
    function markProposed(address market) external onlyResolver {
        IMarketResolution(market).markProposed();
        emit Proposed(market, msg.sender);
    }

    function markDisputed(address market) external onlyResolver {
        IMarketResolution(market).markDisputed();
        emit Disputed(market, msg.sender);
    }

    // ── internals ─────────────────────────────────────────────────────────────

    function _record(address market, bytes32 receiptRoot) internal {
        // The defect this contract was built to prevent. A zero root is not "a receipt
        // that happens to be empty" — it is a commitment to a document that cannot exist,
        // and it would read downstream as a resolution with evidence behind it.
        if (receiptRoot == bytes32(0)) revert EmptyReceipt();

        // Verified through the factory rather than trusted from the caller. A resolver is
        // an operational key, not an auditor, and a contract that merely ACCEPTS a
        // `settle()` call could otherwise leave a record here that names a real protocol
        // market it has nothing to do with.
        address factory = config.addresses(ConfigKeys.MARKET_FACTORY);
        if (!IMarketRegistry(factory).isMarket(market)) revert NotAMarket(market);

        // No status check of its own. `Market` owns the state machine, and if the
        // transition is illegal the call below reverts and takes this record with it.
        // A second copy of that guard here would be a second answer to one question.
        resolutionOf[market] = Resolution({receiptRoot: receiptRoot, resolver: msg.sender});
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
