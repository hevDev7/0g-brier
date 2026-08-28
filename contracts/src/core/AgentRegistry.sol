// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
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
contract AgentRegistry is IAgentRegistry, Initializable, ERC721Upgradeable, Ownable2StepUpgradeable, UUPSUpgradeable {
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
    function updateMetadata(uint256 agentId, bytes32 newRoot, bytes calldata proof) external {
        _onlyAgentOwner(agentId);
        proof;
        _agents[agentId].metadataRoot = newRoot;
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

    function metadataRootOf(uint256 agentId) external view returns (bytes32) {
        return _agents[agentId].metadataRoot;
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
    function tokenURI(uint256 agentId) public view override returns (string memory) {
        _requireOwned(agentId);
        Agent storage a = _agents[agentId];

        string memory name_ = _readName(a.name);
        string memory persona = a.metadataRoot == bytes32(0)
            ? "none published"
            : Strings.toHexString(uint256(a.metadataRoot), 32);

        string memory json = string.concat(
            '{"name":"',
            _jsonEscape(name_),
            '","description":"An agent identity on Brier. The name and role are on chain; the persona, prompts and model configuration live in a 0G Storage document addressed by the Persona attribute.","image":"',
            _image(name_, agentId),
            '","attributes":[{"trait_type":"Role","value":"',
            _roleName(a.role),
            '"},{"trait_type":"Agent ID","value":',
            Strings.toString(agentId),
            '},{"trait_type":"Operator","value":"',
            Strings.toHexString(a.operator),
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
        for (uint256 i; i < len; i++) out[i] = raw[i];
        return string(out);
    }

    function _roleName(Role r) internal pure returns (string memory) {
        if (r == Role.Creator) return "Creator";
        if (r == Role.Curator) return "Curator";
        if (r == Role.Resolver) return "Resolver";
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
                for (uint256 k; k < 5; k++) out[n++] = bytes("&amp;")[k];
            } else if (c == "<") {
                for (uint256 k; k < 4; k++) out[n++] = bytes("&lt;")[k];
            } else if (c == ">") {
                for (uint256 k; k < 4; k++) out[n++] = bytes("&gt;")[k];
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
