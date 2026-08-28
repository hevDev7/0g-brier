// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {IERC7857} from "../interfaces/IERC7857.sol";
import {IAgentCard} from "../interfaces/IAgentCard.sol";
import {
    IERC7857DataVerifier,
    PreimageProofOutput,
    TransferValidityProofOutput
} from "../interfaces/IERC7857DataVerifier.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ConfigRegistry} from "./ConfigRegistry.sol";
import {ConfigKeys} from "./ConfigKeys.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IAgentRegistry} from "../interfaces/IAgentRegistry.sol";

/// @title AgentRegistry
/// @notice Who an agent is, what it has at stake, and what it has done (spec §8.5).
///
/// @dev The stake is the point. A resolver's vote is worth exactly what it can lose
///      by voting badly, so `activeStake` — bonded and not cooling down — is what the
///      ResolutionModule samples on and what it slashes. Everything else here is
///      bookkeeping around that one number.
contract AgentRegistry is
    IAgentRegistry,
    IERC7857,
    Initializable,
    ERC721Upgradeable,
    Ownable2StepUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    struct Agent {
        Role role;
        address operator;
        bytes32 metadataRoot;
        uint256 staked;
        /// @dev Requested but not yet withdrawable. Excluded from `activeStake` the
        ///      moment it is requested, not when it is withdrawn — otherwise a
        ///      resolver could vote on stake it had already given notice on and walk
        ///      away before the dispute window closed.
        uint256 cooling;
        uint64 cooldownEnds;
        /// @dev The display handle, ON CHAIN and not in the metadata document.
        ///      Identity has to resolve every time — a leaderboard that fell back to a
        ///      hex address whenever 0G Storage was slow would be showing two different
        ///      things in one column. The rich persona, prompts and model config stay
        ///      in `metadataRoot`, because those are configuration and may be fetched.
        ///
        ///      APPENDED, and it has to be. This struct lives in a mapping on a contract
        ///      that is already deployed and already holds staked funds. Inserting a
        ///      slot between `operator` and `metadataRoot` — which is where it reads
        ///      most naturally — shifts every field after it, so `staked` would come
        ///      back as whatever `metadataRoot` held and 600 mUSDC of live stake would
        ///      read as a keccak hash. Only appending is safe.
        bytes32 name;
    }

    ConfigRegistry public config;
    uint256 public nextAgentId;

    mapping(uint256 => Agent) internal _agents;
    mapping(uint256 => Reputation) internal _reputation;

    /// @notice Every resolver with any stake, for the module's sampling. Append-only:
    ///         an agent that unstakes to zero stays in the list and is filtered by
    ///         `activeStake` at sampling time. Compacting it would renumber the array
    ///         under a sampling seed that was computed against the old indices.
    uint256[] public resolvers;
    mapping(uint256 => bool) internal _listed;

    // ── APPENDED AFTER DEPLOYMENT ────────────────────────────────────────────
    // Everything below this line was added to a contract that was already live and
    // already holding staked funds. It goes at the END, not where it reads best:
    // putting `agentOf` above `resolvers` — which is where it belongs logically —
    // pushes the resolver array from slot 4 to slot 6, and the committee's list of
    // who can be sampled comes back EMPTY.

    /// @notice Which agent an operator key acts for. Zero means none.
    ///
    /// @dev A `Trade` event carries `msg.sender` and nothing else, so attributing one
    ///      to an agent means going backwards from the key that signed it. One operator
    ///      maps to ONE agent: two would make the attribution ambiguous, and a
    ///      leaderboard cannot show an ambiguous name.
    mapping(address => uint256) public agentOf;

    /// @dev Names are unique. Two agents called "Nostradamus" on a leaderboard is
    ///      worse than two addresses — the reader believes they can tell them apart.
    mapping(bytes32 => bool) public nameTaken;

    // ── ERC-7857, appended after deployment for the same reason as everything above ──

    /// @notice The oracle this token defers to for proofs about its data.
    /// @dev Settable, because which proofs can be checked is a property of the
    ///      deployment rather than of this contract. Unset means no ERC-7857 call that
    ///      takes a proof will succeed — refused rather than waved through.
    IERC7857DataVerifier public verifier;

    /// @notice Who renders `tokenURI`. See the note on `tokenURI` for why it is not
    ///         rendered here any more.
    IAgentCard public card;

    /// @dev ERC-7857 lets a token carry SEVERAL pieces of data. Agents registered
    ///      before this existed carry one, in `Agent.metadataRoot`; `metadataRootOf`
    ///      reads whichever of the two a given agent actually has, so no migration is
    ///      needed and no agent is left with an empty document.
    mapping(uint256 => bytes32[]) internal _dataHashes;
    mapping(uint256 => string[]) internal _dataDescriptions;

    /// @dev `authorizeUsage` grants the right to USE an agent's data without owning
    ///      it. The list is the answer to `authorizedUsersOf`; the mapping is what
    ///      keeps it free of duplicates, since an address authorised twice would be
    ///      revoked once and still appear.
    mapping(uint256 => address[]) internal _authorizedUsers;
    mapping(uint256 => mapping(address => bool)) internal _usageGranted;

    error NotAgentOwner(uint256 agentId);
    error NotResolutionModule();
    error NotAResolver(uint256 agentId);
    error ZeroAmount();
    error StillCooling(uint64 until);
    error NothingCooling();
    error StakeTokenUnset();
    error NameTaken(bytes32 name);
    error NameEmpty();
    error OperatorAlreadyActs(address operator, uint256 agentId);
    error VerifierUnset();
    error CardUnset();
    error ProofRejected(uint256 index);
    error WrongReceiver(address expected, address got);
    error DataHashMismatch(bytes32 expected, bytes32 got);
    error ProofCountMismatch(uint256 expected, uint256 got);
    error NoData();
    error AlreadyAuthorized(address user);

    event VerifierSet(address indexed verifier);
    event CardSet(address indexed card);

    event AgentRegistered(
        uint256 indexed agentId, Role indexed role, address indexed owner, address operator, bytes32 name
    );
    event OperatorSet(uint256 indexed agentId, address indexed operator);
    event NameSet(uint256 indexed agentId, bytes32 name);
    event MetadataUpdated(uint256 indexed agentId, bytes32 newRoot);
    event Staked(uint256 indexed agentId, uint256 amount, uint256 total);
    event UnstakeRequested(uint256 indexed agentId, uint256 amount, uint64 cooldownEnds);
    event Unstaked(uint256 indexed agentId, uint256 amount);
    event Slashed(uint256 indexed agentId, uint256 amount, bytes32 indexed reason);

    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address config_) external initializer {
        __ERC721_init("Brier Agent", "BRIER");
        __Ownable_init(owner_);
        __Ownable2Step_init();
        __UUPSUpgradeable_init();
        config = ConfigRegistry(config_);
        nextAgentId = 1;
    }

    // ── identity ──────────────────────────────────────────────────────────────

    /// @param name A display handle, unique across the registry. Not decoration: it is
    ///        what a leaderboard shows in place of a hex address, and what makes one
    ///        agent's record legible as a record of that agent.
    function register(Role role, address operator, bytes32 name, bytes32 metadataRoot)
        external
        returns (uint256 agentId)
    {
        if (name == bytes32(0)) revert NameEmpty();
        if (nameTaken[name]) revert NameTaken(name);
        uint256 acting = agentOf[operator];
        if (acting != 0) revert OperatorAlreadyActs(operator, acting);

        agentId = nextAgentId++;
        _agents[agentId] = Agent({
            role: role,
            operator: operator,
            metadataRoot: metadataRoot,
            staked: 0,
            cooling: 0,
            cooldownEnds: 0,
            name: name
        });
        nameTaken[name] = true;
        if (operator != address(0)) agentOf[operator] = agentId;
        _safeMint(msg.sender, agentId);
        if (role == Role.Resolver && !_listed[agentId]) {
            _listed[agentId] = true;
            resolvers.push(agentId);
        }
        emit AgentRegistered(agentId, role, msg.sender, operator, name);
    }

    /// @dev Clears the OLD key's mapping before writing the new one. Leaving it would
    ///      let a retired key go on being attributed to an agent that had rotated away
    ///      from it, which is the one thing a rotation is for.
    function setOperator(uint256 agentId, address operator) external {
        _onlyAgentOwner(agentId);
        uint256 acting = agentOf[operator];
        if (acting != 0 && acting != agentId) revert OperatorAlreadyActs(operator, acting);

        address previous = _agents[agentId].operator;
        if (previous != address(0)) agentOf[previous] = 0;
        _agents[agentId].operator = operator;
        if (operator != address(0)) agentOf[operator] = agentId;
        emit OperatorSet(agentId, operator);
    }

    /// @notice Rename an agent, or name one that has none.
    ///
    /// @dev Needed for two reasons. An agent may want a different handle — a name is a
    ///      label, not a key. And agents registered BEFORE names existed have none at
    ///      all: the field was appended to a live contract, so it reads zero for every
    ///      one of them, and there would otherwise be no way to give them one.
    ///
    ///      The old name is released, so a handle a project has stopped using does not
    ///      stay locked away forever.
    function setName(uint256 agentId, bytes32 name) external {
        _onlyAgentOwner(agentId);
        if (name == bytes32(0)) revert NameEmpty();
        bytes32 previous = _agents[agentId].name;
        if (name == previous) return;
        if (nameTaken[name]) revert NameTaken(name);
        if (previous != bytes32(0)) nameTaken[previous] = false;
        nameTaken[name] = true;
        _agents[agentId].name = name;
        emit NameSet(agentId, name);
    }

    /// @dev `proof` is accepted and ignored in v1, per spec §8.5: the parameter exists
    ///      so that P7's ERC-7857 verification is a change of body, not of signature.
    /**
     * @notice Replace an agent's data, proving the new bytes hash to the root claimed.
     *
     * @dev The `proof` argument existed here from the start and was discarded — the
     *      body read `proof;` and moved on. Any owner could set `metadataRoot` to any
     *      32 bytes, including a root no document has ever hashed to, and the chain
     *      recorded it as the agent's metadata. `tokenURI` renders from it.
     *
     *      `newRoot` is kept alongside the proof rather than derived from it alone,
     *      so the caller states what they believe they are storing and the contract
     *      checks the two agree. A mismatch reverts with both numbers rather than
     *      silently storing whatever the bytes happened to hash to.
     */
    function updateMetadata(uint256 agentId, bytes32 newRoot, bytes calldata proof) external {
        _onlyAgentOwner(agentId);

        bytes[] memory proofs = new bytes[](1);
        proofs[0] = proof;
        bytes32 proven = _verifyPreimages(proofs)[0];
        if (proven != newRoot) revert DataHashMismatch(newRoot, proven);

        _setData(agentId, proven);
        emit MetadataUpdated(agentId, newRoot);
    }

    // ── stake ─────────────────────────────────────────────────────────────────

    function stake(uint256 agentId, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (_agents[agentId].role != Role.Resolver) revert NotAResolver(agentId);
        _stakeToken().safeTransferFrom(msg.sender, address(this), amount);
        _agents[agentId].staked += amount;
        emit Staked(agentId, amount, _agents[agentId].staked);
    }

    /// @dev Moves stake out of `activeStake` IMMEDIATELY and starts the cooldown. A
    ///      resolver that could vote on stake it had already given notice on would be
    ///      voting with nothing at risk by the time anyone could dispute the result.
    function requestUnstake(uint256 agentId, uint256 amount) external {
        _onlyAgentOwner(agentId);
        if (amount == 0) revert ZeroAmount();
        Agent storage a = _agents[agentId];
        a.staked -= amount;
        a.cooling += amount;
        a.cooldownEnds = uint64(block.timestamp + config.params(ConfigKeys.UNSTAKE_COOLDOWN));
        emit UnstakeRequested(agentId, amount, a.cooldownEnds);
    }

    function withdrawUnstaked(uint256 agentId, address to) external returns (uint256 amount) {
        _onlyAgentOwner(agentId);
        Agent storage a = _agents[agentId];
        if (a.cooling == 0) revert NothingCooling();
        if (block.timestamp < a.cooldownEnds) revert StillCooling(a.cooldownEnds);
        amount = a.cooling;
        a.cooling = 0;
        _stakeToken().safeTransfer(to, amount);
        emit Unstaked(agentId, amount);
    }

    /// @dev Takes from bonded stake first and from cooling stake only after that is
    ///      exhausted. The order matters: reaching the cooling balance last means a
    ///      resolver cannot shield stake from a slash by giving notice, while stake
    ///      that has finished its cooldown and been withdrawn is genuinely gone.
    function slash(uint256 agentId, uint256 amount, bytes32 reason) external returns (uint256 taken) {
        if (msg.sender != config.addresses(ConfigKeys.RESOLUTION_MODULE)) revert NotResolutionModule();
        Agent storage a = _agents[agentId];

        uint256 fromStaked = amount > a.staked ? a.staked : amount;
        a.staked -= fromStaked;
        taken = fromStaked;

        uint256 remaining = amount - fromStaked;
        if (remaining > 0) {
            uint256 fromCooling = remaining > a.cooling ? a.cooling : remaining;
            a.cooling -= fromCooling;
            taken += fromCooling;
        }

        if (taken > 0) _stakeToken().safeTransfer(config.addresses(ConfigKeys.TREASURY), taken);
        emit Slashed(agentId, taken, reason);
    }

    // ── reputation ────────────────────────────────────────────────────────────

    function recordResolution(uint256 agentId, bool agreed, bool overturned) external {
        if (msg.sender != config.addresses(ConfigKeys.RESOLUTION_MODULE)) revert NotResolutionModule();
        if (agreed) _reputation[agentId].resolutionsAgreed++;
        if (overturned) _reputation[agentId].resolutionsOverturned++;
    }

    // ── views ─────────────────────────────────────────────────────────────────

    function operatorOf(uint256 agentId) external view returns (address) {
        return _agents[agentId].operator;
    }

    function roleOf(uint256 agentId) external view returns (Role) {
        return _agents[agentId].role;
    }

    function stakeOf(uint256 agentId) external view returns (uint256) {
        return _agents[agentId].staked;
    }

    function activeStake(uint256 agentId) external view returns (uint256) {
        Agent storage a = _agents[agentId];
        return a.role == Role.Resolver ? a.staked : 0;
    }

    function nameOf(uint256 agentId) external view returns (bytes32) {
        return _agents[agentId].name;
    }

    /// @notice The handle behind a key that signed something, or zero if it is nobody's.
    function nameOfOperator(address operator) external view returns (bytes32) {
        return _agents[agentOf[operator]].name;
    }

    /**
     * @notice The agent's data root — its address on 0G Storage.
     *
     * @dev Reads the ERC-7857 array where there is one and the original single field
     *      otherwise. Agents registered before ERC-7857 existed keep their root where
     *      they always had it, so nothing had to be migrated and no agent was left
     *      with an empty document for the length of an upgrade.
     */
    function metadataRootOf(uint256 agentId) external view returns (bytes32) {
        bytes32[] storage hashes = _dataHashes[agentId];
        return hashes.length == 0 ? _agents[agentId].metadataRoot : hashes[0];
    }

    function coolingOf(uint256 agentId) external view returns (uint256 amount, uint64 endsAt) {
        return (_agents[agentId].cooling, _agents[agentId].cooldownEnds);
    }

    function reputationOf(uint256 agentId) external view returns (Reputation memory) {
        return _reputation[agentId];
    }

    function resolverCount() external view returns (uint256) {
        return resolvers.length;
    }

    // ── internals ─────────────────────────────────────────────────────────────

    function _stakeToken() internal view returns (IERC20 token) {
        address t = config.addresses(ConfigKeys.STAKE_TOKEN);
        if (t == address(0)) revert StakeTokenUnset();
        return IERC20(t);
    }

    function _onlyAgentOwner(uint256 agentId) internal view {
        if (ownerOf(agentId) != msg.sender) revert NotAgentOwner(agentId);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ── ERC-721 metadata ─────────────────────────────────────────────────────
    // Everything below is a VIEW over state that already exists. Not one storage
    // slot is added, which is what makes this safe to ship as an upgrade to a
    // contract already holding identities and stake.

    /// @notice The token's metadata, as a self-contained data URI.
    ///
    /// @dev Built on chain rather than served from a gateway, for two reasons.
    ///      A URL in here would pin the contract to one indexer deployment, and
    ///      `metadataRoot` is a CONTENT address — the document it names is the same
    ///      document wherever it is fetched from, so the contract has no business
    ///      choosing the host. And an agent that has published nothing still has a
    ///      name and a role on chain, so it can still render; before this existed
    ///      `tokenURI` returned the empty string and every explorer showed a blank
    ///      card for an identity that was perfectly well defined.
    ///
    ///      The persona itself is deliberately NOT inlined. It is configuration —
    ///      prompts, model, thresholds — it changes without the identity changing,
    ///      and it is far too large for a view that wallets call speculatively.
    ///      Its root is published as an attribute so a reader can go and fetch it.
    /**
     * @notice The wallet-facing card for an agent.
     *
     * @dev DELEGATED, and not for elegance. Implementing ERC-7857 pushed this contract
     *      to 25,380 bytes against EIP-170's 24,576 and the upgrade reverted at the far
     *      end of a broadcast. Turning the optimiser down fitted it with 53 bytes to
     *      spare, which is not a fix — it is the same failure waiting for the next
     *      change. Rendering is the right thing to move out: base64, an SVG and two
     *      escapers, called by wallets and by nothing on any hot path.
     *
     *      Reverts rather than returning "" when unset. An empty string IS the blank
     *      card that made `tokenURI` worth implementing in the first place; a revert
     *      says "not configured" instead of quietly saying "this agent has nothing".
     */
    function tokenURI(uint256 agentId) public view override returns (string memory) {
        _requireOwned(agentId);
        IAgentCard c = card;
        if (address(c) == address(0)) revert CardUnset();
        Agent storage a = _agents[agentId];
        return c.render(agentId, a.name, a.role, a.operator, a.metadataRoot);
    }

    // ── ERC-7857 ──────────────────────────────────────────────────────────────

    /**
     * @notice Point this registry at the oracle that checks proofs about its data.
     * @dev Owner-only and deliberately not set at `initialize`: which proofs can be
     *      checked at all is a property of the deployment, and a registry that named a
     *      verifier before one existed would be claiming a guarantee it could not keep.
     */
    function setVerifier(address verifier_) external onlyOwner {
        verifier = IERC7857DataVerifier(verifier_);
        emit VerifierSet(verifier_);
    }

    /// @notice Point this registry at the contract that renders its tokens.
    function setCard(address card_) external onlyOwner {
        card = IAgentCard(card_);
        emit CardSet(card_);
    }

    /**
     * @notice Mint an agent from proofs of the data it carries.
     *
     * @dev The standard's own entry point. `register` remains the one this protocol
     *      uses, because an agent here also needs a role, an operator key and a name —
     *      none of which ERC-7857 knows about. This path fills those in with defaults
     *      a caller can change afterwards: `Role.Trader`, no operator, and a name
     *      derived from the token id, which is unique by construction and so cannot
     *      collide with a name somebody already took.
     */
    function mint(bytes[] calldata _proofs, string[] calldata _dataDescriptionsIn, address _to)
        external
        payable
        returns (uint256 _tokenId)
    {
        if (_proofs.length == 0) revert NoData();
        if (_dataDescriptionsIn.length != _proofs.length) {
            revert ProofCountMismatch(_proofs.length, _dataDescriptionsIn.length);
        }
        bytes32[] memory hashes = _verifyPreimages(_proofs);

        address owner_ = _to == address(0) ? msg.sender : _to;
        _tokenId = nextAgentId++;

        bytes32 generated = _defaultName(_tokenId);
        _agents[_tokenId] = Agent({
            role: Role.Trader,
            operator: address(0),
            metadataRoot: hashes[0],
            staked: 0,
            cooling: 0,
            cooldownEnds: 0,
            name: generated
        });
        nameTaken[generated] = true;

        for (uint256 i = 0; i < hashes.length; i++) {
            _dataHashes[_tokenId].push(hashes[i]);
            _dataDescriptions[_tokenId].push(_dataDescriptionsIn[i]);
        }

        _safeMint(owner_, _tokenId);
        emit AgentRegistered(_tokenId, Role.Trader, owner_, address(0), generated);
        emit Minted(_tokenId, msg.sender, owner_, hashes, _dataDescriptionsIn);
    }

    /**
     * @notice Move an agent and its data to a new owner.
     *
     * @dev Ownership alone is `transferFrom`, which ERC-721 already provides and this
     *      contract does not touch. What this adds is the data half: the caller has to
     *      prove the receiver can reach the agent's data afterwards, and the proof has
     *      to name THIS receiver. Without that binding one holder's proof could be
     *      replayed to send a token somewhere its owner never intended.
     *
     *      For public data the verifier reports `oldDataHash == newDataHash`, because
     *      nothing is re-encrypted and claiming otherwise would be claiming a
     *      transformation that did not happen. The old hash is still checked against
     *      what the agent actually holds, so a proof made for different data is
     *      refused rather than allowed to overwrite it.
     */
    function transfer(address _to, uint256 _tokenId, bytes[] calldata _proofs) external {
        _onlyAgentOwner(_tokenId);
        address from = _ownerOf(_tokenId);
        bytes32[] memory next = _verifyTransfer(_tokenId, _to, _proofs);

        _replaceData(_tokenId, next);
        _transfer(from, _to, _tokenId);
        emit Transferred(_tokenId, from, _to);
    }

    /**
     * @notice Copy an agent's data into a new token, leaving the original where it is.
     * @dev The same proof obligation as `transfer`. The clone starts with no operator
     *      and no stake: those belong to the agent that earned them, and carrying them
     *      across would let anyone mint a copy of a staked resolver.
     */
    function clone(address _to, uint256 _tokenId, bytes[] calldata _proofs) external returns (uint256 _newTokenId) {
        _onlyAgentOwner(_tokenId);
        bytes32[] memory next = _verifyTransfer(_tokenId, _to, _proofs);

        _newTokenId = nextAgentId++;
        bytes32 generated = _defaultName(_newTokenId);
        _agents[_newTokenId] = Agent({
            role: _agents[_tokenId].role,
            operator: address(0),
            metadataRoot: next[0],
            staked: 0,
            cooling: 0,
            cooldownEnds: 0,
            name: generated
        });
        nameTaken[generated] = true;

        string[] storage descriptions = _dataDescriptions[_tokenId];
        for (uint256 i = 0; i < next.length; i++) {
            _dataHashes[_newTokenId].push(next[i]);
            _dataDescriptions[_newTokenId].push(i < descriptions.length ? descriptions[i] : "");
        }

        _safeMint(_to, _newTokenId);
        emit AgentRegistered(_newTokenId, _agents[_newTokenId].role, _to, address(0), generated);
        emit Cloned(_tokenId, _newTokenId, msg.sender, _to);
    }

    /// @notice Let another address use this agent's data without owning it.
    function authorizeUsage(uint256 _tokenId, address _user) external {
        _onlyAgentOwner(_tokenId);
        if (_usageGranted[_tokenId][_user]) revert AlreadyAuthorized(_user);
        _usageGranted[_tokenId][_user] = true;
        _authorizedUsers[_tokenId].push(_user);
        emit Authorization(msg.sender, _user, _tokenId);
    }

    function authorizedUsersOf(uint256 _tokenId) external view returns (address[] memory) {
        return _authorizedUsers[_tokenId];
    }

    /// @dev Both bases declare it; ERC-721's implementation is the one that answers.
    function ownerOf(uint256 tokenId) public view override(ERC721Upgradeable, IERC7857) returns (address) {
        return super.ownerOf(tokenId);
    }

    /// @notice Every data hash an agent carries — its addresses on 0G Storage.
    function dataHashesOf(uint256 agentId) external view returns (bytes32[] memory) {
        bytes32[] storage hashes = _dataHashes[agentId];
        if (hashes.length > 0) return hashes;
        // An agent from before ERC-7857 carries exactly one, where it always was.
        bytes32[] memory one = new bytes32[](1);
        one[0] = _agents[agentId].metadataRoot;
        return one;
    }

    function dataDescriptionsOf(uint256 agentId) external view returns (string[] memory) {
        return _dataDescriptions[agentId];
    }

    // ── internals ─────────────────────────────────────────────────────────────

    /// @dev Every hash returned here was COMPUTED by the verifier from bytes the
    ///      caller supplied. None of them was accepted as an assertion.
    function _verifyPreimages(bytes[] memory proofs) private returns (bytes32[] memory hashes) {
        IERC7857DataVerifier v = verifier;
        if (address(v) == address(0)) revert VerifierUnset();

        PreimageProofOutput[] memory out = v.verifyPreimage(proofs);
        if (out.length != proofs.length) revert ProofCountMismatch(proofs.length, out.length);

        hashes = new bytes32[](out.length);
        for (uint256 i = 0; i < out.length; i++) {
            if (!out[i].isValid) revert ProofRejected(i);
            hashes[i] = out[i].dataHash;
        }
    }

    /// @dev Checks the three things a transfer proof has to establish here: that the
    ///      verifier accepted it, that it was made for this receiver, and that it is
    ///      about the data this agent actually holds.
    function _verifyTransfer(uint256 agentId, address to, bytes[] calldata proofs)
        private
        returns (bytes32[] memory next)
    {
        IERC7857DataVerifier v = verifier;
        if (address(v) == address(0)) revert VerifierUnset();

        bytes32[] memory held = _heldHashes(agentId);
        if (proofs.length != held.length) revert ProofCountMismatch(held.length, proofs.length);

        TransferValidityProofOutput[] memory out = v.verifyTransferValidity(proofs);
        if (out.length != proofs.length) revert ProofCountMismatch(proofs.length, out.length);

        next = new bytes32[](out.length);
        bytes16[] memory sealedKeys = new bytes16[](out.length);
        for (uint256 i = 0; i < out.length; i++) {
            if (!out[i].isValid) revert ProofRejected(i);
            if (out[i].receiver != to) revert WrongReceiver(to, out[i].receiver);
            if (out[i].oldDataHash != held[i]) revert DataHashMismatch(held[i], out[i].oldDataHash);
            next[i] = out[i].newDataHash;
            sealedKeys[i] = out[i].sealedKey;
        }
        // Published even when empty: for public data there is no key to seal, and an
        // event that says so is how a reader tells "no secret" from "not disclosed".
        emit PublishedSealedKey(to, agentId, sealedKeys);
    }

    function _heldHashes(uint256 agentId) private view returns (bytes32[] memory held) {
        bytes32[] storage hashes = _dataHashes[agentId];
        if (hashes.length > 0) return hashes;
        held = new bytes32[](1);
        held[0] = _agents[agentId].metadataRoot;
    }

    function _replaceData(uint256 agentId, bytes32[] memory hashes) private {
        delete _dataHashes[agentId];
        for (uint256 i = 0; i < hashes.length; i++) {
            _dataHashes[agentId].push(hashes[i]);
        }
        _agents[agentId].metadataRoot = hashes[0];
    }

    /// @dev One root, written to both places, so the legacy field and the ERC-7857
    ///      array can never disagree about what an agent's document is.
    function _setData(uint256 agentId, bytes32 root) private {
        bytes32[] memory one = new bytes32[](1);
        one[0] = root;
        _replaceData(agentId, one);
    }

    /// @dev "agent-<id>", unique by construction, so a token minted through the
    ///      standard entry point cannot collide with a name somebody already took.
    function _defaultName(uint256 agentId) private pure returns (bytes32 out) {
        bytes memory digits;
        uint256 n = agentId;
        if (n == 0) {
            digits = "0";
        } else {
            while (n > 0) {
                digits = abi.encodePacked(bytes1(uint8(48 + (n % 10))), digits);
                n /= 10;
            }
        }
        bytes memory label = abi.encodePacked("agent-", digits);
        assembly ("memory-safe") {
            out := mload(add(label, 0x20))
        }
    }
}
