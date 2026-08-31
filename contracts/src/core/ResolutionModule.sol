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
import {IErc8004Reputation} from "../interfaces/IErc8004.sol";
import {AgentRegistry} from "./AgentRegistry.sol";
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

    // ── resolver earnings ─────────────────────────────────────────────────────
    // APPENDED, and that is not stylistic. Inserting a mapping above shifts every
    // slot after it, and the symptom is a getter quietly returning the next
    // mapping's contents. That happened once on AgentRegistry in this codebase;
    // the upgrade script's before/after read is what caught it.

    /// @notice What a resolver has earned and not yet taken, in collateral units.
    /// @dev Per agent rather than per market: a resolver judging fifty markets
    ///      should not need fifty transactions to be paid for them.
    mapping(uint256 => uint256) public owedTo;

    /// @notice The sum of every entry in `owedTo`.
    /// @dev Held so `sweepUnallocated` can tell earnings apart from residue
    ///      without walking a mapping it cannot enumerate.
    uint256 public totalOwed;

    /// @notice Which collateral a given agent's balance is denominated in.
    /// @dev One token per deployment today. Recorded anyway, because a module
    ///      that assumed one and later met two would pay the second's earnings
    ///      out of the first's balance, and nothing would revert.
    mapping(uint256 => address) public owedToken;

    // ── the deferred draw ─────────────────────────────────────────────────────
    // APPENDED, like everything above it. See the note on `owedTo`.

    /// @notice A committee that has been asked for but not yet drawn.
    struct Draw {
        /// @dev The block whose hash seeds the sample. It is in the FUTURE when the
        ///      draw is requested, and that is the entire security property: nobody,
        ///      caller or validator, can read `blockhash(drawBlock)` at the moment
        ///      they decide to ask for a committee.
        uint64 drawBlock;
        /// @dev Which round the draw is for, 1 or 2. Kept so a round-2 draw cannot be
        ///      spent opening round 1, or the other way about.
        uint8 index;
    }

    /// @dev At most one outstanding draw per market: a round is asked for, then made.
    mapping(address => Draw) internal _draws;

    error NotResolver();
    error EmptyReceipt();
    error NotAMarket(address market);
    error MarketNotClosed(address market);
    error RoundAlreadyOpen(address market);
    error NoRound(address market);
    error NothingOwed(uint256 agentId);
    error NotOwed(uint256 agentId);
    error MixedCollateral(uint256 agentId);
    error WouldTouchEarnings(uint256 requested, uint256 free);
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
    error NoDrawRequested(address market);
    error DrawNotReady(uint64 drawBlock);
    error DrawExpired(uint64 drawBlock);
    error BadCommitteeShape(uint8 n, uint8 k);

    event DrawRequested(address indexed market, uint8 round, uint64 drawBlock);
    event ResolutionOpened(address indexed market, uint8 round, uint8 n, uint8 k, uint256[] committee);
    event Committed(address indexed market, uint256 indexed agentId, bytes32 commitment);
    event Revealed(address indexed market, uint256 indexed agentId, uint8 outcome, bytes32 receiptRoot);
    event Proposed(address indexed market, uint8 outcome, uint64 disputeDeadline);
    event Disputed(address indexed market, address indexed challenger, bytes32 evidenceRoot);
    event Finalized(address indexed market, uint8 outcome, bool viaCommittee);
    event Earned(address indexed market, uint256 indexed agentId, uint256 amount);
    event Claimed(uint256 indexed agentId, address indexed to, uint256 amount);
    event Swept(address indexed to, uint256 amount);
    event FeedbackPublished(uint256 indexed agentId, uint256 indexed erc8004Id, bool agreed);
    event FeedbackFailed(uint256 indexed agentId, uint256 indexed erc8004Id);
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

    /**
     * @notice Ask for a committee. The draw itself happens later, in `openResolution`.
     *
     * @dev TWO CALLS, AND THE SPLIT IS THE POINT. Sampling used to happen in this one
     *      transaction, seeded from `blockhash(block.number - 1)` — a value every
     *      caller can read a block ahead. Since this entry point is permissionless and
     *      has no deadline, the caller did not have to accept the draw it was given:
     *      it could simulate the sample off-chain, send nothing when the committee was
     *      unfavourable, and try again next block. That is not sampling, it is
     *      selection. Measured against fourteen equally-staked resolvers, an attacker
     *      holding three of them waited ten blocks to seat three of five committee
     *      seats — exactly the threshold, which is unilateral control of the outcome.
     *
     *      Here the seed is `blockhash(drawBlock)` for a `drawBlock` that has not been
     *      mined yet, so there is nothing to simulate and nothing to wait for.
     *
     *      Permissionless, and deliberately NOT called from `Market.close()`. Making
     *      the market call this would mean redeploying its implementation, which no
     *      existing market clone can ever receive — so the module reads the market's
     *      status instead and every market already created can be resolved by the
     *      committee.
     *
     *      Also the re-request path: a draw whose block has fallen out of the EVM's
     *      256-block `blockhash` window can never be made, so it must be possible to
     *      ask again without that being a way to re-roll a draw that is still live.
     *      `_consumeDraw` deletes the draw it spends, and the branches below refuse a
     *      round that has already been drawn — so the only re-request that gets
     *      through is one for a round still waiting.
     */
    function requestResolution(address market) external {
        _requireMarket(market);
        Round storage r = _rounds[market];
        if (r.finalized) revert AlreadyFinalized();
        if (r.index == 0) {
            if (IMarketResolution(market).status() != 1) revert MarketNotClosed(market);
            _requestDraw(market, 1);
        } else if (r.index == 2 && r.n == 0) {
            // A dispute round that was asked for and whose draw expired unclaimed.
            _requestDraw(market, 2);
        } else {
            revert RoundAlreadyOpen(market);
        }
    }

    /// @notice Draw round 1's committee, once the block that seeds it has been mined.
    /// @dev `index != 0` rather than `n != 0` is what marks a market whose resolution
    ///      has begun: between `dispute` and `openDisputeRound` the round is real but
    ///      its committee is not yet drawn, so `n` is legitimately zero there.
    function openResolution(address market) external {
        _requireMarket(market);
        if (_rounds[market].index != 0) revert RoundAlreadyOpen(market);
        if (IMarketResolution(market).status() != 1) revert MarketNotClosed(market);

        bytes32 seedHash = _consumeDraw(market, 1);
        (uint8 n, uint8 k) = _committeeShape(IMarketResolution(market).tier());
        uint256[] memory none = new uint256[](0);
        uint256[] memory picked = _sample(market, n, 1, none, seedHash);

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

        // THE ROUND-2 COMMITTEE IS NOT DRAWN HERE, and that is the fix to the worst
        // defect this contract had. Drawing it inside the challenger's own transaction
        // let the challenger CHOOSE it: the seed was readable a block ahead, so a
        // challenger could wait for a draw that seated enough of its own agents to make
        // the threshold, vote whichever outcome it pleased, and finalize — round 2 has
        // no dispute window of its own, so nothing came after. Measured end to end, that
        // flip took one block of waiting, and the bond came back in full afterwards.
        //
        // Round 2 still excludes round 1: a cartel that could re-sample itself into the
        // round reviewing its own work would make the dispute a formality.
        _requestDraw(market, 2);

        // The committee is cleared rather than left pointing at round 1's members. If
        // the market is failed in the gap before the draw, `_settleAccounts` walks this
        // list, and round 1 has already been judged.
        delete _committee[market];

        r.n = 0;
        r.k = 0;
        r.index = 2;
        r.commits = 0;
        r.reveals = 0;
        r.commitDeadline = 0;
        r.revealDeadline = 0;
        r.disputeDeadline = 0;
        uint8 proposed = r.proposedOutcome;
        r.proposedOutcome = Outcomes.NONE;
        _tally[market] = [uint16(0), 0, 0];
        _roundOneOutcome[market] = proposed + 1;

        IMarketResolution(market).markDisputed();
        emit Disputed(market, msg.sender, evidenceRoot);
    }

    /// @notice Draw the dispute round's committee, once the block that seeds it exists.
    /// @dev Permissionless, like every other step: the challenger paid for the round
    ///      but does not own it, and a round that only the challenger could open would
    ///      be a round the challenger could decline to open once the draw stopped
    ///      suiting it. Nobody can read the draw before this call either way.
    function openDisputeRound(address market) external {
        Round storage r = _rounds[market];
        if (r.index != 2) revert NoRound(market);
        if (r.finalized) revert AlreadyFinalized();
        if (r.n != 0) revert RoundAlreadyOpen(market);

        bytes32 seedHash = _consumeDraw(market, 2);
        (uint8 n2, uint8 k2) = _shapeOf(config.params(ConfigKeys.COMMITTEE_DISPUTE));
        uint256[] memory picked = _sample(market, n2, 2, _roundOne[market], seedHash);
        _committee[market] = picked;

        uint64 commitEnds = uint64(block.timestamp + config.params(ConfigKeys.COMMIT_WINDOW));
        r.n = n2;
        r.k = k2;
        r.commits = 0;
        r.reveals = 0;
        r.commitDeadline = commitEnds;
        r.revealDeadline = uint64(commitEnds + config.params(ConfigKeys.REVEAL_WINDOW));
        emit ResolutionOpened(market, 2, n2, k2, picked);
    }

    /// @notice Carry out what the committee decided, once nobody can still object.
    function finalize(address market) external {
        Round storage r = _rounds[market];
        if (r.n == 0) revert NoRound(market);
        if (r.finalized) revert AlreadyFinalized();
        if (r.proposedOutcome == Outcomes.NONE) revert NoThreshold();
        if (r.index == 1 && block.timestamp <= r.disputeDeadline) revert TooEarly();
        // ROUND 2 ALWAYS WAITS OUT ITS REVEAL WINDOW. The old `&& r.reveals < r.n`
        // let a round finalize the instant its last member revealed, which meant the
        // members themselves chose the moment the market settled — and since round 2
        // is the last word, nobody could look at the votes before they took effect.
        // A fixed window costs a few hours and buys every observer the same sight of
        // the tally that the committee has.
        if (r.index == 2 && block.timestamp <= r.revealDeadline) revert TooEarly();

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
        Round storage r = _rounds[market];
        if (r.finalized) revert AlreadyFinalized();
        // A market whose committee HAS answered is not one where "nobody produced an
        // answer", so this path must not be able to race `finalize` at the deadline.
        // A live proposal buys the same grace period the market itself grants — see
        // the note in `Market.fail`. Whoever wants the verdict carried out can call
        // `finalize`, which is permissionless, at any point inside it.
        uint256 openAt = IMarketResolution(market).settlementDeadline();
        if (r.proposedOutcome != Outcomes.NONE) openAt += config.params(ConfigKeys.PROPOSED_FAIL_GRACE);
        if (block.timestamp < openAt) revert TooEarly();
        r.finalized = true;
        // `NONE`, not `UNRESOLVABLE`. The market fails either way, but the committee
        // said nothing here, and `_settleAccounts` treats the two very differently —
        // see the note at the top of it.
        _settleAccounts(market, Outcomes.NONE);
        IMarketResolution(market).fail();
        emit Finalized(market, Outcomes.UNRESOLVABLE, r.n != 0);
    }

    /**
     * @dev Publish a resolver's record to ERC-8004, where it can be read outside Brier.
     *
     *      `recordResolution` above keeps the same fact in this protocol's own registry,
     *      and that copy is the one this protocol trusts. This one is for everybody
     *      else: 8004's ReputationRegistry sits at one address on 57 networks, so a
     *      resolver who has judged well here carries something legible to a venue that
     *      has never heard of Brier. That is the whole argument for publishing at all.
     *
     *      NOTHING HERE MAY BLOCK A SETTLEMENT. Every step can decline and every failure
     *      is swallowed: an unset registry, an agent that never linked, an 8004 contract
     *      that reverts or is upgraded into something else. A market whose outcome is
     *      already decided must not become unsettleable because a foreign contract had a
     *      bad day — the money in it is real and the reputation signal is a courtesy.
     *
     *      Self-feedback is refused by 8004 itself, which is why the MODULE publishes
     *      and never the resolver: a resolver rating its own settlement is exactly what
     *      that check exists to stop.
     */
    function _publish(uint256 agentId, bool agreed, bytes32 receiptRoot) private {
        address reputation = config.addresses(ConfigKeys.ERC8004_REPUTATION);
        if (reputation == address(0)) return;

        address identity = config.addresses(ConfigKeys.AGENT_REGISTRY);
        if (identity == address(0)) return;

        uint256 foreignId = AgentRegistry(identity).erc8004Of(agentId);
        if (foreignId == 0) return;

        // +1 agreed, -1 outvoted, whole numbers. A richer scale would invite a
        // precision nobody has: the committee's verdict is binary, and dressing it as
        // 0.87 would be inventing confidence the vote never expressed.
        try IErc8004Reputation(reputation)
            .giveFeedback(
                foreignId, agreed ? int128(1) : int128(-1), 0, "brier", "resolution", "0g-storage", "", receiptRoot
            ) {
            emit FeedbackPublished(agentId, foreignId, agreed);
        } catch {
            // Named, not hidden. A settlement that stands with its signal unpublished is
            // a smaller problem than one that cannot be settled at all — but it is still
            // something an operator should be able to see having happened.
            emit FeedbackFailed(agentId, foreignId);
        }
    }

    // ── slashing and reward ───────────────────────────────────────────────────

    /// @dev Three ways to lose stake, and they are different failures:
    ///      - NO SHOW: committed nothing, or committed and never revealed. The
    ///        committee was short a member for a job it was paid to do.
    ///      - DISAGREE: revealed, but not what the committee concluded. Being
    ///        outvoted is not misconduct, so this is the mildest of the three.
    ///      - OVERTURN: agreed with a round-1 outcome that a fresh committee then
    ///        reversed. The heaviest, because this is what a cartel does.
    /// @param outcome the committee's verdict, or `Outcomes.NONE` when the module is
    ///        failing this market WITHOUT one — `markFailed`, never `finalize`.
    ///
    /// @dev THE `NONE` CASE IS NOT A THIRD OUTCOME, IT IS THE ABSENCE OF ONE, and
    ///      conflating it with `UNRESOLVABLE` was a defect that paid. A dissenting
    ///      vote is measured against what the committee concluded; when it concluded
    ///      nothing, there is nothing to dissent from, and every member who showed up
    ///      was judged as wrong for showing up. A no-show is still a no-show — that
    ///      much is a fault whatever the round went on to do.
    function _settleAccounts(address market, uint8 outcome) internal {
        bool inconclusive = outcome == Outcomes.NONE;
        // Locals kept to a minimum here, and not for tidiness: adding two of them
        // to this function pushed it over solc's stack limit. The slash rates are
        // read at their call sites and the round is re-read at the end rather than
        // held, which costs two SLOADs and avoids compiling with `via_ir` — a
        // switch that would change the bytecode of every contract in the build.
        IAgentRegistry registry = _registry();
        uint256[] memory members = _committee[market];

        uint256[] memory agreed = new uint256[](members.length);
        uint256 agreedCount;
        for (uint256 i = 0; i < members.length; i++) {
            uint256 id = members[i];
            uint8 vote = _revealPlusOne[market][id];
            if (vote == 0) {
                _slashBps(registry, id, uint16(config.params(ConfigKeys.NO_SHOW_SLASH_BPS)), "NO_SHOW");
            } else if (inconclusive) {
                // A member who said the question could not be answered was right about
                // the market that is now failing, and is paid for it. Everyone else
                // voted into a round that never concluded, and is simply left alone.
                if (vote - 1 == Outcomes.UNRESOLVABLE) agreed[agreedCount++] = id;
            } else if (vote - 1 != outcome) {
                _slashBps(registry, id, uint16(config.params(ConfigKeys.DISAGREE_SLASH_BPS)), "DISAGREE");
                registry.recordResolution(id, false, false);
                _publish(id, false, receiptRootOf[market][id]);
            } else {
                registry.recordResolution(id, true, false);
                _publish(id, true, receiptRootOf[market][id]);
                agreed[agreedCount++] = id;
            }
        }

        // Credited BEFORE the caller settles the market, because settling zeroes
        // the very numbers this reads. The transfer that follows carries no memo,
        // so an amount not worked out here cannot be worked out at all — which is
        // exactly why the pool had no withdrawal path: the module was receiving
        // money it had no way to attribute.
        _creditResolvers(market, agreed, agreedCount);

        if (_rounds[market].index == 2) _settleDispute(market, outcome, registry);
    }

    function _settleDispute(address market, uint8 outcome, IAgentRegistry registry) internal {
        uint8 roundOne = _roundOneOutcome[market];
        address challenger = disputerOf[market];
        uint256 bond = disputeBondOf[market];
        disputeBondOf[market] = 0;

        // THREE ENDINGS, NOT TWO. A dispute that never concluded is not an overturn:
        // round 2 said nothing, so nobody has contradicted round 1. Treating silence as
        // a reversal refunded the challenger's bond and slashed round 1 at the CARTEL
        // rate for an answer no second committee ever reviewed — measured at 20% of
        // stake apiece, taken from five resolvers who were right. That made stalling a
        // dispute free, and profitable to anyone holding the losing side, because a
        // failed market pays BOTH sides pᵢ where a settled one pays the loser nothing.
        //
        // The bond is forfeited rather than returned. A challenge that produced no
        // evidence that round 1 was wrong is exactly the noise the bond exists to
        // price, and refunding it is what made the stall cost nothing at all.
        if (outcome == Outcomes.NONE) {
            if (bond > 0) _stakeToken().safeTransfer(config.addresses(ConfigKeys.TREASURY), bond);
            return;
        }

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
    ///      `seedHash` is `blockhash(drawBlock)` for a block that had NOT been mined
    ///      when the draw was requested — see `requestResolution`. It is passed in
    ///      rather than read here so that this function cannot quietly acquire an
    ///      entropy source of its own: there is exactly one place a seed is chosen,
    ///      and it is `_consumeDraw`.
    ///
    ///      This is still a blockhash, so a validator who wins `drawBlock` can choose
    ///      between the hash it produces and no block at all. That is a far smaller
    ///      lever than the one it replaces — it needs the proposer slot for one
    ///      specific block, and gives one re-roll rather than unlimited free ones —
    ///      but it is not zero, and a randomness beacon remains the P7 upgrade.
    function _sample(address market, uint8 n, uint8 index, uint256[] memory exclude, bytes32 seedHash)
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
        bytes32 seed = keccak256(abi.encode(market, seedHash, index));
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

    /**
     * Books what this market is about to pay the resolver pool.
     *
     * Split EVENLY among the resolvers who agreed with the outcome. Weighting by
     * stake would pay the largest resolver most for identical work and turn the
     * committee into an auction; weighting by speed would reward whoever commits
     * first, which is the opposite of the deliberation a threshold exists to buy.
     * An even share is the only division that does not distort the vote itself.
     *
     * No-shows and dissenters are credited nothing. Both have just been slashed,
     * and paying them for the same act would cancel the penalty.
     *
     * The remainder of an uneven division stays as residue, reachable only by
     * `sweepUnallocated`. Giving it to whoever happens to sit first in the array
     * would be arbitrary; rounding it up would pay out money that never arrived.
     */
    /**
     * Take what this agent has earned.
     *
     * Pull, not push. Paying resolvers inside `finalize` would put an ERC-20
     * transfer per committee member on the settlement path, where one reverting
     * recipient — a token with a blocklist, a contract that rejects transfers —
     * would wedge the settlement of a market for everybody else. The same reason
     * `redeem` is pull-based on the market.
     *
     * `to` is free, `msg.sender` is not: only the agent's owner may spend its
     * balance, and where the money lands is their business.
     */
    // No `nonReentrant`, and deliberately so: adding `ReentrancyGuardUpgradeable`
    // would insert a storage slot into a live contract's layout and shift every
    // mapping after it. The guard is unnecessary anyway — the balance is zeroed
    // and `totalOwed` decremented BEFORE the transfer, so a reentrant call finds
    // nothing owed and reverts on its own.
    function claim(uint256 agentId, address to) external returns (uint256 amount) {
        if (_registry().ownerOf(agentId) != msg.sender) revert NotOwed(agentId);
        amount = owedTo[agentId];
        if (amount == 0) revert NothingOwed(agentId);

        owedTo[agentId] = 0;
        totalOwed -= amount;
        IERC20(owedToken[agentId]).safeTransfer(to, amount);
        emit Claimed(agentId, to, amount);
    }

    /**
     * Move balance that no resolver is owed.
     *
     * Three things end up here and none of them belongs to a committee member:
     * the remainder of an uneven split, the settlement deposit of a market that
     * timed out with nobody judging it, and anything sent to this address by
     * mistake. Without this they would accumulate permanently — which was half
     * the reason the pool looked unreachable.
     *
     * `totalOwed` is the floor and the check is unconditional: governance cannot
     * reach a resolver's earnings with this, however the arithmetic is argued.
     */
    function sweepUnallocated(address token, address to, uint256 amount) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        // Only the deployment's own collateral can be owed. A stray token has no
        // earnings behind it and its whole balance is free.
        uint256 reserved = token == config.addresses(ConfigKeys.STAKE_TOKEN) ? totalOwed : 0;
        uint256 free = balance > reserved ? balance - reserved : 0;
        if (amount > free) revert WouldTouchEarnings(amount, free);

        IERC20(token).safeTransfer(to, amount);
        emit Swept(to, amount);
    }

    function _creditResolvers(address market, uint256[] memory agreed, uint256 count) private {
        if (count == 0) return;
        IMarketResolution m = IMarketResolution(market);
        uint256 pool = (m.feeAccrued() * m.resolverFeeShareBps()) / 10_000 + m.settlementDeposit();
        uint256 each = pool / count;
        if (each == 0) return;

        address token = m.collateral();
        for (uint256 i = 0; i < count; i++) {
            uint256 id = agreed[i];
            address held = owedToken[id];
            if (held == address(0)) {
                owedToken[id] = token;
            } else if (held != token) {
                // One collateral per deployment today. Should that stop being
                // true, an agent holding a balance in one token must not be paid
                // in another — silently, out of somebody else's money.
                revert MixedCollateral(id);
            }
            owedTo[id] += each;
            emit Earned(market, id, each);
        }
        totalOwed += each * count;
    }

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
    ///
    ///      VALIDATED HERE, at read time, and not in `ConfigRegistry`: bounds there are
    ///      a numeric range over the packed value, which cannot express a relation
    ///      between the two halves. FAST shipped as 1-of-1 — a "committee" of a single
    ///      agent, on the tier with the loosest evidence requirement. `k * 2 > n` is
    ///      what makes the threshold a majority; at or below half, two different
    ///      answers could each clear it and the first to reveal would win.
    function _shapeOf(uint256 packed) internal pure returns (uint8 n, uint8 k) {
        n = uint8(packed >> 8);
        k = uint8(packed);
        if (n < 3 || k > n || uint256(k) * 2 <= uint256(n)) revert BadCommitteeShape(n, k);
    }

    /// @dev Lower trust means a LONGER window, not a shorter one: FAST resolves from an
    ///      unattested router and gets the most time to be challenged.
    function _disputeWindow(uint8 tier) internal view returns (uint256) {
        bytes32 key = tier == 0
            ? ConfigKeys.DISPUTE_WINDOW_FAST
            : tier == 1 ? ConfigKeys.DISPUTE_WINDOW_VERIFIED : ConfigKeys.DISPUTE_WINDOW_DETERMINISTIC;
        return config.params(key);
    }

    function _requestDraw(address market, uint8 index) internal {
        uint256 delay = config.params(ConfigKeys.RESOLUTION_DRAW_DELAY);
        uint64 drawBlock = uint64(block.number + delay);
        _draws[market] = Draw({drawBlock: drawBlock, index: index});
        emit DrawRequested(market, index, drawBlock);
    }

    /// @dev Spends a matured draw and returns its seed. Deleting it is what keeps a
    ///      draw from being re-rolled: without that, a caller who disliked the
    ///      committee could simply request again and open on whichever draw suited,
    ///      which is the grinding this whole mechanism exists to remove.
    function _consumeDraw(address market, uint8 index) internal returns (bytes32 seedHash) {
        Draw memory d = _draws[market];
        if (d.drawBlock == 0 || d.index != index) revert NoDrawRequested(market);
        if (block.number <= d.drawBlock) revert DrawNotReady(d.drawBlock);
        seedHash = blockhash(d.drawBlock);
        // Zero means the draw block has fallen out of the 256-block window the EVM
        // keeps hashes for. Sampling from zero would be sampling from a constant that
        // every caller knows — precisely the defect being replaced — so it is refused,
        // and `requestResolution` may be called again for a fresh block.
        if (seedHash == bytes32(0)) revert DrawExpired(d.drawBlock);
        delete _draws[market];
    }

    /// @notice The draw a market is waiting on, or a zero `drawBlock` if none.
    function drawOf(address market) external view returns (Draw memory) {
        return _draws[market];
    }

    function _registry() internal view returns (IAgentRegistry) {
        return IAgentRegistry(config.addresses(ConfigKeys.AGENT_REGISTRY));
    }

    function _stakeToken() internal view returns (IERC20) {
        return IERC20(config.addresses(ConfigKeys.STAKE_TOKEN));
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
