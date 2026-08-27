// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ConfigRegistry} from "./ConfigRegistry.sol";
import {ConfigKeys} from "./ConfigKeys.sol";
import {OutcomeShares} from "./OutcomeShares.sol";
import {Market} from "./Market.sol";
import {IMarket} from "../interfaces/IMarket.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";

/// @title MarketFactory
/// @notice Mints Market clones and acts as the registry OutcomeShares trusts.
/// @dev Creating a market requires an EIP-712 approval from the Curator agent. In P1 the
///      signer is a single address held in ConfigRegistry; P2 replaces it with an
///      AgentRegistry lookup without changing the shape of the signature.
///
///      This contract is upgradeable (UUPS) because it is a coordinator, not a vault: it
///      never holds user funds — collateral flows straight from the creator to the clone.
///      Market itself is deliberately NOT upgradeable.
contract MarketFactory is
    Initializable,
    Ownable2StepUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    EIP712Upgradeable,
    IMarketRegistry
{
    using SafeERC20 for IERC20;

    /// @dev The curator approves a COMPLETE market, not part of one: the whole identity of the
    ///      spec AND its whole economic profile are signed along with it.
    ///
    ///      `collateral` is here because `ConfigRegistry.allowedCollateral` is a SET, not a
    ///      singleton — the moment governance allows a second collateral, an approval that does
    ///      not bind the token could be used to launch the same spec in a different token, with
    ///      a different `scale` (Market accepts any decimals ≤ 18) and a different economic
    ///      profile as well. `seedTokens`/`depositTokens` are here because a market's opening
    ///      depth (the DPM `b` parameter) derives entirely from the seed: an approval that does
    ///      not bind the seed means the curator approved the question but not the market.
    ///
    ///      Signing every field is not enough on its own — a front-runner could still replay the
    ///      EXACT approved payload to burn that one-shot nonce and make the creator's own
    ///      transaction revert. That is why `createMarket` also requires
    ///      `msg.sender == p.creator`; both are needed, and neither substitutes for the other.
    bytes32 public constant MARKET_APPROVAL_TYPEHASH = keccak256(
        "MarketApproval(bytes32 specRoot,uint64 tradingEnd,uint64 settlementDeadline,uint8 tier,uint256 creatorAgentId,bytes32 category,address creator,address collateral,uint256 seedTokens,uint256 depositTokens,uint256 nonce)"
    );

    ConfigRegistry public config;
    OutcomeShares public shares;
    address public marketImplementation;

    mapping(address => bool) public isMarket;
    mapping(bytes32 => bool) public usedApprovals;
    address[] internal _markets;

    error BadCuratorSignature();
    error ApprovalAlreadyUsed();
    error ProtocolPaused();
    error ZeroAddress();
    error NotCreator();
    /// @dev Deliberately NOT named `CollateralNotAllowed`: `Market` declares an error by
    ///      that name too, and a selector is computed from the signature alone, so the two
    ///      were indistinguishable on the wire (both 0x00413389). A test asserting the factory
    ///      rejected a market would have passed just as happily if `Market.initialize` had
    ///      rejected it instead — which is exactly the ordering `test_collateralCheckedBefore\
    ///      TouchingToken` exists to pin down.
    error CollateralNotAllowlisted();
    /// @dev An address with no code. Not mere tidiness: `Clones.clone` over a codeless address
    ///      produces a minimal proxy that is LIVE, and its `delegatecall` returns success with
    ///      empty returndata. `Market(market).initialize(...)` has no return value, so
    ///      Solidity's `extcodesize` check passes (it checks the clone, which does have code)
    ///      and there is nothing to decode — the call "succeeds" silently after the user's
    ///      collateral has already moved into a clone that is permanently dead.
    error NotAContract(address account);

    event MarketCreated(
        address indexed market,
        address indexed creator,
        uint256 indexed creatorAgentId,
        bytes32 specRoot,
        uint256 seed,
        uint8 tier
    );
    event MarketImplementationSet(address indexed implementation);

    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address config_, address shares_, address marketImpl_) external initializer {
        if (config_ == address(0) || shares_ == address(0) || marketImpl_ == address(0)) revert ZeroAddress();
        _requireContract(config_);
        _requireContract(shares_);
        _requireContract(marketImpl_);
        __Ownable_init(owner_);
        __Ownable2Step_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __EIP712_init("0G-Delphi", "1");
        config = ConfigRegistry(config_);
        shares = OutcomeShares(shares_);
        marketImplementation = marketImpl_;
        emit MarketImplementationSet(marketImpl_);
    }

    function setMarketImplementation(address impl) external onlyOwner {
        if (impl == address(0)) revert ZeroAddress();
        _requireContract(impl);
        marketImplementation = impl;
        emit MarketImplementationSet(impl);
    }

    /// @dev `<address>.code.length` compiles to EXTCODESIZE, not a code copy.
    function _requireContract(address account) internal view {
        if (account.code.length == 0) revert NotAContract(account);
    }

    /// @notice Exposed so that an off-chain signer (the Curator agent) can compute exactly the
    ///         same digest without having to guess the domain separator.
    function hashTypedData(bytes32 structHash) external view returns (bytes32) {
        return _hashTypedDataV4(structHash);
    }

    /// @dev A function of its own rather than inline in `createMarket`: eleven fields plus the
    ///      typehash exceed the EVM stack depth on the default profile (without via_ir), and a
    ///      separate frame is the way around that which costs nothing.
    function _approvalDigest(IMarket.Params calldata p, uint256 seedTokens, uint256 depositTokens, uint256 nonce)
        internal
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    MARKET_APPROVAL_TYPEHASH,
                    p.specRoot,
                    p.tradingEnd,
                    p.settlementDeadline,
                    p.tier,
                    p.creatorAgentId,
                    p.category,
                    p.creator,
                    p.collateral,
                    seedTokens,
                    depositTokens,
                    nonce
                )
            )
        );
    }

    function createMarket(
        IMarket.Params calldata p,
        uint256 seedTokens,
        uint256 depositTokens,
        uint256 nonce,
        bytes calldata curatorSig
    ) external nonReentrant returns (address market) {
        if (config.paused()) revert ProtocolPaused();
        // A curator approval is not a bearer instrument: only the approved creator may use it.
        // Without this, anyone watching the mempool could replay the exact approved payload,
        // burn that one-shot nonce, and make the creator's own transaction revert with
        // `ApprovalAlreadyUsed` — a DoS on a curated launch flow in which every retry demands
        // a fresh curator signature.
        if (msg.sender != p.creator) revert NotCreator();
        // Checked HERE, before any external call at all. Market.initialize checks it again at
        // the far end, but deferring the check until then means the factory calls
        // `safeTransferFrom` on an address of the caller's choosing while `usedApprovals`,
        // `isMarket`, and `_markets` have already been written. The cost is one SLOAD; the
        // return is zero arbitrary calls.
        if (!config.allowedCollateral(p.collateral)) revert CollateralNotAllowlisted();

        bytes32 digest = _approvalDigest(p, seedTokens, depositTokens, nonce);
        if (usedApprovals[digest]) revert ApprovalAlreadyUsed();
        // The EIP-712 digest already binds chainId AND this factory's address, so one approval
        // cannot be moved to another chain or another factory. `ECDSA.recover` here is
        // deliberately the variant that REVERTS on a malformed signature, not `tryRecover`:
        // it never returns address(0), so an unset CURATOR_SIGNER (address(0)) cannot be
        // matched by any signature at all.
        if (ECDSA.recover(digest, curatorSig) != config.addresses(ConfigKeys.CURATOR_SIGNER)) {
            revert BadCuratorSignature();
        }
        usedApprovals[digest] = true;

        // The THIRD guard on the same invariant (the other two are in `initialize` and
        // `setMarketImplementation`), and this one is not redundant: this contract is UUPS, so
        // an upgrade that shifts the storage layout could leave this slot holding garbage
        // without ever passing through either setter. One cold EXTCODESIZE (~2600 gas on a
        // ~800k operation) turns a silent loss of user funds into a revert.
        address impl = marketImplementation;
        _requireContract(impl);

        market = Clones.clone(impl);
        // Registration precedes initialize as a DEFENSIVE stance, not because initialize needs
        // it: `Market.initialize` never touches OutcomeShares (it writes storage and nothing
        // else). What needs it is every trade afterwards — so this ordering keeps there from
        // ever being a window in which a market is live but not yet registered, should
        // initialize one day come to mint something too.
        isMarket[market] = true;
        _markets.push(market);

        IERC20(p.collateral).safeTransferFrom(msg.sender, market, seedTokens + depositTokens);
        Market(market).initialize(address(config), address(shares), p, seedTokens, depositTokens);

        emit MarketCreated(market, p.creator, p.creatorAgentId, p.specRoot, seedTokens, p.tier);
    }

    function marketCount() external view returns (uint256) {
        return _markets.length;
    }

    function marketAt(uint256 index) external view returns (address) {
        return _markets[index];
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
