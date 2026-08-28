// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ConfigRegistry} from "./ConfigRegistry.sol";
import {ConfigKeys} from "./ConfigKeys.sol";
import {IAgentRegistry} from "../interfaces/IAgentRegistry.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {IMarketResolution} from "../interfaces/IMarketResolution.sol";
import {IResolutionModule, Outcomes} from "../interfaces/IResolutionModule.sol";

/// @title ResolutionModule
/// @notice The committee that decides a market, and the record it leaves behind
///         (spec §7).
///
/// @dev A settlement is only worth as much as what a resolver loses by getting it
///      wrong, so everything here is arranged around stake: the committee is sampled
///      by it, the threshold is counted in members who each have it, and every way of
///      failing the job takes some of it.
///
///      Commit–reveal, because a resolver who could see another's answer would copy
///      it, and a committee of copies is a committee of one. The commitment binds
///      `msg.sender` so it cannot be lifted from someone else's transaction either.
///
///      UPGRADED IN PLACE from the receipt-anchoring version. The first three storage
///      slots are unchanged and deliberately so: the receipts already anchored for
///      markets settled before the committee existed stay readable, which is the whole
///      reason this contract was made upgradeable rather than replaceable.
contract ResolutionModule is Initializable, Ownable2StepUpgradeable, UUPSUpgradeable, IResolutionModule {
    using SafeERC20 for IERC20;

    struct Resolution {
        bytes32 receiptRoot;
        address resolver;
    }

    // ── storage: the first three slots are inherited and must not move ────────
    ConfigRegistry public config;
    mapping(address => Resolution) public resolutionOf;
    /// @notice The DIRECT-settlement allowlist, which bypasses the committee.
    /// @dev Kept for local demos and testnet lifecycles where staking a committee is
    ///      not the thing under test. It is empty by default on any chain the deploy
    ///      script treats as real, and a settlement that used it is recorded as
    ///      `viaCommittee = false` so the shortcut is visible rather than silent.
    mapping(address => bool) public isResolver;
    // ── appended below this line ──────────────────────────────────────────────

    mapping(address => Round) internal _rounds;
    mapping(address => uint256[]) internal _committee;
    /// @dev Round 1's members, kept so the dispute round can exclude them. A cartel
    ///      that could re-sample itself into the round reviewing its own work would
    ///      make the dispute a formality.
    mapping(address => uint256[]) internal _roundOne;
    mapping(address => mapping(uint256 => bytes32)) public commitmentOf;
    /// @dev Stored as outcome + 1, so zero means "did not reveal" rather than "voted NO".
    mapping(address => mapping(uint256 => uint8)) internal _revealPlusOne;
    mapping(address => mapping(uint256 => bytes32)) public receiptRootOf;
    mapping(address => uint16[3]) internal _tally;
    mapping(address => address) public disputerOf;
    mapping(address => uint256) public disputeBondOf;
    mapping(address => bool) public viaCommittee;
    /// @dev Round 1's proposal, stored as outcome + 1 so zero means "no round 1".
    ///      Kept across the dispute round because finalize compares the two.
    mapping(address => uint8) internal _roundOneOutcome;

    error NotResolver();
    error EmptyReceipt();
    error NotAMarket(address market);
    error MarketNotClosed(address market);
    error RoundAlreadyOpen(address market);
    error NoRound(address market);
    error NotOnCommittee(uint256 agentId);
    error NotOperator(uint256 agentId);
    error WindowClosed();
    error WindowOpen();
    error BadCommitment();
    error AlreadyRevealed();
    error BadOutcome();
    error NoThreshold();
    error AlreadyFinalized();
    error NotEnoughResolvers(uint256 available, uint8 needed);
    error DisputeClosed();
    error AlreadyDisputed();
    error TooEarly();

    event ResolutionOpened(address indexed market, uint8 round, uint8 n, uint8 k, uint256[] committee);
    event Committed(address indexed market, uint256 indexed agentId, bytes32 commitment);
    event Revealed(address indexed market, uint256 indexed agentId, uint8 outcome, bytes32 receiptRoot);
    event Proposed(address indexed market, uint8 outcome, uint64 disputeDeadline);
    event Disputed(address indexed market, address indexed challenger, bytes32 evidenceRoot);
    event Finalized(address indexed market, uint8 outcome, bool viaCommittee);
    event ResolverSet(address indexed resolver, bool allowed);
    event Resolved(address indexed market, uint8 indexed outcome, bytes32 receiptRoot, address indexed resolver);
    event Abandoned(address indexed market, bytes32 receiptRoot, address indexed resolver);

    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address config_) external initializer {
        __Ownable_init(owner_);
        __Ownable2Step_init();
        __UUPSUpgradeable_init();
        config = ConfigRegistry(config_);
    }

    function setResolver(address resolver, bool allowed) external onlyOwner {
        isResolver[resolver] = allowed;
        emit ResolverSet(resolver, allowed);
    }

    function roundOf(address market) external view returns (Round memory) {
        return _rounds[market];
    }

    function committeeOf(address market) external view returns (uint256[] memory) {
        return _committee[market];
    }

    function tallyOf(address market) external view returns (uint16[3] memory) {
        return _tally[market];
    }

    function revealOf(address market, uint256 agentId) external view returns (uint8) {
        uint8 v = _revealPlusOne[market][agentId];
        return v == 0 ? Outcomes.NONE : v - 1;
    }

    // ── the committee flow ────────────────────────────────────────────────────

    /// @notice Open round 1 for a market that has closed.
    /// @dev Permissionless, and deliberately NOT called from `Market.close()`. Making
    ///      the market call this would mean redeploying its implementation, which no
    ///      existing market clone can ever receive — so the module reads the market's
    ///      status instead and every market already created can be resolved by the
    ///      committee.
    function openResolution(address market) external {
        _requireMarket(market);
        if (_rounds[market].n != 0) revert RoundAlreadyOpen(market);
        if (IMarketResolution(market).status() != 1) revert MarketNotClosed(market);

        (uint8 n, uint8 k) = _committeeShape(IMarketResolution(market).tier());
        uint256[] memory none = new uint256[](0);
        uint256[] memory picked = _sample(market, n, 1, none);

        _committee[market] = picked;
        _roundOne[market] = picked;
        uint64 commitEnds = uint64(block.timestamp + config.params(ConfigKeys.COMMIT_WINDOW));
        _rounds[market] = Round({
            n: n,
            k: k,
            index: 1,
            proposedOutcome: Outcomes.NONE,
            commitDeadline: commitEnds,
            revealDeadline: uint64(commitEnds + config.params(ConfigKeys.REVEAL_WINDOW)),
            disputeDeadline: 0,
            commits: 0,
            reveals: 0,
            finalized: false
        });
        emit ResolutionOpened(market, 1, n, k, picked);
    }

    /// @param commitment `keccak256(abi.encode(market, outcome, salt, receiptRoot, msg.sender))`
    /// @dev The commitment binds the sender, so one lifted from another resolver's
    ///      transaction hashes to something else and cannot be revealed.
    function commitVote(address market, uint256 agentId, bytes32 commitment) external {
        Round storage r = _rounds[market];
        if (r.n == 0) revert NoRound(market);
        if (block.timestamp > r.commitDeadline) revert WindowClosed();
        _requireCommitteeOperator(market, agentId);
        if (commitmentOf[market][agentId] == bytes32(0)) r.commits++;
        commitmentOf[market][agentId] = commitment;
        emit Committed(market, agentId, commitment);
    }

    function revealVote(address market, uint256 agentId, uint8 outcome, bytes32 salt, bytes32 receiptRoot) external {
        Round storage r = _rounds[market];
        if (r.n == 0) revert NoRound(market);
        if (block.timestamp <= r.commitDeadline) revert WindowOpen();
        if (block.timestamp > r.revealDeadline) revert WindowClosed();
        _requireCommitteeOperator(market, agentId);
        if (outcome > Outcomes.UNRESOLVABLE) revert BadOutcome();
        if (_revealPlusOne[market][agentId] != 0) revert AlreadyRevealed();
        // A resolution with no document behind it is the defect this whole mechanism
        // exists to prevent — the same one a market's `specRoot` shipped with once.
        if (receiptRoot == bytes32(0)) revert EmptyReceipt();
        if (commitmentOf[market][agentId] != keccak256(abi.encode(market, outcome, salt, receiptRoot, msg.sender))) {
            revert BadCommitment();
        }

        _revealPlusOne[market][agentId] = outcome + 1;
        receiptRootOf[market][agentId] = receiptRoot;
        _tally[market][outcome]++;
        r.reveals++;

        if (_tally[market][outcome] >= r.k && r.proposedOutcome == Outcomes.NONE) {
            r.proposedOutcome = outcome;
            r.disputeDeadline = uint64(block.timestamp + _disputeWindow(IMarketResolution(market).tier()));
            IMarketResolution(market).markProposed();
            emit Proposed(market, outcome, r.disputeDeadline);
        }
        emit Revealed(market, agentId, outcome, receiptRoot);
    }

    /// @notice Challenge a proposed outcome. Costs a bond, which is forfeited if the
    ///         dispute round confirms what round 1 said.
    function dispute(address market, bytes32 evidenceRoot) external {
        Round storage r = _rounds[market];
        if (r.proposedOutcome == Outcomes.NONE) revert NoThreshold();
        if (r.finalized) revert AlreadyFinalized();
        if (block.timestamp > r.disputeDeadline) revert DisputeClosed();
        if (disputerOf[market] != address(0)) revert AlreadyDisputed();

        uint256 bond = config.params(ConfigKeys.DISPUTE_BOND);
        _stakeToken().safeTransferFrom(msg.sender, address(this), bond);
        disputerOf[market] = msg.sender;
        disputeBondOf[market] = bond;

        // Round 2 excludes round 1. A cartel that could re-sample itself into the
        // round reviewing its own work would make the dispute a formality.
        (uint8 n2, uint8 k2) = _shapeOf(config.params(ConfigKeys.COMMITTEE_DISPUTE));
        uint256[] memory picked = _sample(market, n2, 2, _roundOne[market]);
        _committee[market] = picked;

        uint64 commitEnds = uint64(block.timestamp + config.params(ConfigKeys.COMMIT_WINDOW));
        r.n = n2;
        r.k = k2;
        r.index = 2;
        r.commits = 0;
        r.reveals = 0;
        r.commitDeadline = commitEnds;
        r.revealDeadline = uint64(commitEnds + config.params(ConfigKeys.REVEAL_WINDOW));
        r.disputeDeadline = 0;
        // The round-1 proposal is remembered in `_tally`, which is NOT cleared: the
        // comparison at finalize is between what round 1 said and what round 2 says.
        uint8 proposed = r.proposedOutcome;
        r.proposedOutcome = Outcomes.NONE;
        _tally[market] = [uint16(0), 0, 0];
        _tally[market][proposed] = 0;
        _roundOneOutcome[market] = proposed + 1;

        IMarketResolution(market).markDisputed();
        emit Disputed(market, msg.sender, evidenceRoot);
    }

    /// @notice Carry out what the committee decided, once nobody can still object.
    function finalize(address market) external {
        Round storage r = _rounds[market];
        if (r.n == 0) revert NoRound(market);
        if (r.finalized) revert AlreadyFinalized();
        if (r.proposedOutcome == Outcomes.NONE) revert NoThreshold();
        if (r.index == 1 && block.timestamp <= r.disputeDeadline) revert TooEarly();
        if (r.index == 2 && block.timestamp <= r.revealDeadline && r.reveals < r.n) revert TooEarly();

        r.finalized = true;
        viaCommittee[market] = true;
        uint8 outcome = r.proposedOutcome;

        _settleAccounts(market, outcome);

        if (outcome == Outcomes.UNRESOLVABLE) {
            IMarketResolution(market).fail();
        } else {
            IMarketResolution(market).settle(outcome);
        }
        emit Finalized(market, outcome, true);
    }

    /// @notice Nobody produced an answer before the market's own deadline.
    /// @dev Not a failure of the market but of the process, and the exit is the same
    ///      either way: every side liquidates at its own price rather than one side
    ///      taking a pool on a question nobody answered.
    function markFailed(address market) external {
        _requireMarket(market);
        if (block.timestamp < IMarketResolution(market).settlementDeadline()) revert TooEarly();
        Round storage r = _rounds[market];
        if (r.finalized) revert AlreadyFinalized();
        r.finalized = true;
        _settleAccounts(market, Outcomes.UNRESOLVABLE);
        IMarketResolution(market).fail();
        emit Finalized(market, Outcomes.UNRESOLVABLE, r.n != 0);
    }

    // ── slashing and reward ───────────────────────────────────────────────────

    /// @dev Three ways to lose stake, and they are different failures:
    ///      - NO SHOW: committed nothing, or committed and never revealed. The
    ///        committee was short a member for a job it was paid to do.
    ///      - DISAGREE: revealed, but not what the committee concluded. Being
    ///        outvoted is not misconduct, so this is the mildest of the three.
    ///      - OVERTURN: agreed with a round-1 outcome that a fresh committee then
    ///        reversed. The heaviest, because this is what a cartel does.
    function _settleAccounts(address market, uint8 outcome) internal {
        IAgentRegistry registry = _registry();
        uint256[] memory members = _committee[market];
        Round storage r = _rounds[market];

        uint16 noShowBps = uint16(config.params(ConfigKeys.NO_SHOW_SLASH_BPS));
        uint16 disagreeBps = uint16(config.params(ConfigKeys.DISAGREE_SLASH_BPS));

        for (uint256 i = 0; i < members.length; i++) {
            uint256 id = members[i];
            uint8 vote = _revealPlusOne[market][id];
            if (vote == 0) {
                _slashBps(registry, id, noShowBps, "NO_SHOW");
            } else if (vote - 1 != outcome) {
                _slashBps(registry, id, disagreeBps, "DISAGREE");
                registry.recordResolution(id, false, false);
            } else {
                registry.recordResolution(id, true, false);
            }
        }

        if (r.index == 2) _settleDispute(market, outcome, registry);
    }

    function _settleDispute(address market, uint8 outcome, IAgentRegistry registry) internal {
        uint8 roundOne = _roundOneOutcome[market];
        address challenger = disputerOf[market];
        uint256 bond = disputeBondOf[market];
        disputeBondOf[market] = 0;

        bool overturned = roundOne != 0 && (roundOne - 1) != outcome;
        if (overturned) {
            // The round-1 members who backed the reversed outcome pay for it, and the
            // challenger is made whole. Without the second half nobody would ever pay
            // a bond to be right.
            uint16 overturnBps = uint16(config.params(ConfigKeys.OVERTURN_SLASH_BPS));
            uint256[] memory one = _roundOne[market];
            for (uint256 i = 0; i < one.length; i++) {
                uint256 id = one[i];
                uint8 v = _revealPlusOne[market][id];
                if (v != 0 && v - 1 == roundOne - 1) {
                    _slashBps(registry, id, overturnBps, "OVERTURN");
                    registry.recordResolution(id, false, true);
                }
            }
            if (bond > 0) _stakeToken().safeTransfer(challenger, bond);
        } else if (bond > 0) {
            // Round 2 confirmed round 1: the challenge was noise, and noise is what
            // the bond exists to price.
            _stakeToken().safeTransfer(config.addresses(ConfigKeys.TREASURY), bond);
        }
    }

    function _slashBps(IAgentRegistry registry, uint256 agentId, uint16 bps, bytes32 reason) internal {
        if (bps == 0) return;
        uint256 amount = (registry.stakeOf(agentId) * bps) / 10_000;
        if (amount > 0) registry.slash(agentId, amount, reason);
    }

    // ── committee sampling ────────────────────────────────────────────────────

    /// @dev Stake-weighted, without replacement.
    ///
    ///      ⚠️ The seed uses `blockhash`, which a validator can influence. This is the
    ///      known v1 limitation recorded in spec §13.2, accepted on the grounds that a
    ///      long commit window makes prediction expensive, with the upgrade to a
    ///      randomness beacon scheduled for P7. It is written here as well as in the
    ///      spec because the person who needs to know is the one reading this function.
    function _sample(address market, uint8 n, uint8 index, uint256[] memory exclude)
        internal
        view
        returns (uint256[] memory picked)
    {
        IAgentRegistry registry = _registry();
        uint256 total = registry.resolverCount();
        uint256[] memory ids = new uint256[](total);
        uint256[] memory weights = new uint256[](total);
        uint256 minStake = config.params(ConfigKeys.MIN_RESOLVER_STAKE);
        uint256 pool;
        uint256 eligible;

        for (uint256 i = 0; i < total; i++) {
            uint256 id = registry.resolvers(i);
            uint256 w = registry.activeStake(id);
            if (w < minStake || w == 0) continue;
            bool skip;
            for (uint256 j = 0; j < exclude.length; j++) {
                if (exclude[j] == id) {
                    skip = true;
                    break;
                }
            }
            if (skip) continue;
            ids[eligible] = id;
            weights[eligible] = w;
            pool += w;
            eligible++;
        }
        if (eligible < n) revert NotEnoughResolvers(eligible, n);

        picked = new uint256[](n);
        bytes32 seed = keccak256(abi.encode(market, blockhash(block.number - 1), index));
        for (uint256 s = 0; s < n; s++) {
            uint256 draw = uint256(keccak256(abi.encode(seed, s))) % pool;
            uint256 acc;
            for (uint256 i = 0; i < eligible; i++) {
                if (weights[i] == 0) continue;
                acc += weights[i];
                if (draw < acc) {
                    picked[s] = ids[i];
                    pool -= weights[i];
                    weights[i] = 0; // without replacement
                    break;
                }
            }
        }
    }

    // ── the direct path, kept visible ─────────────────────────────────────────

    /// @notice Settle without a committee, for an allowlisted key.
    /// @dev This is the shortcut that a committee exists to remove, and it is kept for
    ///      local demos and testnet lifecycles where staking five resolvers is not the
    ///      thing under test. Two things keep it honest: the allowlist is EMPTY unless
    ///      an owner deliberately fills it, and a market settled this way is recorded
    ///      with `viaCommittee == false`, so a reader can tell a committee decision
    ///      from an operator's.
    function settle(address market, uint8 outcome, bytes32 receiptRoot) external {
        if (!isResolver[msg.sender]) revert NotResolver();
        _record(market, receiptRoot);
        IMarketResolution(market).settle(outcome);
        emit Resolved(market, outcome, receiptRoot, msg.sender);
        emit Finalized(market, outcome, false);
    }

    function fail(address market, bytes32 receiptRoot) external {
        if (!isResolver[msg.sender]) revert NotResolver();
        _record(market, receiptRoot);
        IMarketResolution(market).fail();
        emit Abandoned(market, receiptRoot, msg.sender);
    }

    function markProposed(address market) external {
        if (!isResolver[msg.sender]) revert NotResolver();
        IMarketResolution(market).markProposed();
    }

    function markDisputed(address market) external {
        if (!isResolver[msg.sender]) revert NotResolver();
        IMarketResolution(market).markDisputed();
    }

    // ── internals ─────────────────────────────────────────────────────────────

    function _record(address market, bytes32 receiptRoot) internal {
        if (receiptRoot == bytes32(0)) revert EmptyReceipt();
        _requireMarket(market);
        resolutionOf[market] = Resolution({receiptRoot: receiptRoot, resolver: msg.sender});
    }

    function _requireMarket(address market) internal view {
        address factory = config.addresses(ConfigKeys.MARKET_FACTORY);
        if (!IMarketRegistry(factory).isMarket(market)) revert NotAMarket(market);
    }

    function _requireCommitteeOperator(address market, uint256 agentId) internal view {
        uint256[] memory members = _committee[market];
        bool found;
        for (uint256 i = 0; i < members.length; i++) {
            if (members[i] == agentId) {
                found = true;
                break;
            }
        }
        if (!found) revert NotOnCommittee(agentId);
        if (_registry().operatorOf(agentId) != msg.sender) revert NotOperator(agentId);
    }

    function _committeeShape(uint8 tier) internal view returns (uint8 n, uint8 k) {
        bytes32 key = tier == 0
            ? ConfigKeys.COMMITTEE_FAST
            : tier == 1 ? ConfigKeys.COMMITTEE_VERIFIED : ConfigKeys.COMMITTEE_DETERMINISTIC;
        return _shapeOf(config.params(key));
    }

    /// @dev Packed as `n * 256 + k`, so one parameter carries both and they cannot be
    ///      changed out of step with each other.
    function _shapeOf(uint256 packed) internal pure returns (uint8 n, uint8 k) {
        return (uint8(packed >> 8), uint8(packed));
    }

    /// @dev Lower trust means a LONGER window, not a shorter one: FAST resolves from an
    ///      unattested router and gets the most time to be challenged.
    function _disputeWindow(uint8 tier) internal view returns (uint256) {
        bytes32 key = tier == 0
            ? ConfigKeys.DISPUTE_WINDOW_FAST
            : tier == 1 ? ConfigKeys.DISPUTE_WINDOW_VERIFIED : ConfigKeys.DISPUTE_WINDOW_DETERMINISTIC;
        return config.params(key);
    }

    function _registry() internal view returns (IAgentRegistry) {
        return IAgentRegistry(config.addresses(ConfigKeys.AGENT_REGISTRY));
    }

    function _stakeToken() internal view returns (IERC20) {
        return IERC20(config.addresses(ConfigKeys.STAKE_TOKEN));
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
