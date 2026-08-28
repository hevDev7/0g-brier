// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title ConfigRegistry
/// @notice The single source of protocol parameters, addresses, and pause state.
/// @dev Parameter bounds are LOCKED the first time they are set: no function on this
///      implementation can loosen them. The only route outside those bounds is a
///      governance upgrade (spec §13.3) — its admin is a 3/5 multisig, and every upgrade
///      goes through a 48-hour timelock.
contract ConfigRegistry is Initializable, Ownable2StepUpgradeable, UUPSUpgradeable {
    struct Bounds {
        uint128 lo;
        uint128 hi;
        bool locked;
    }

    mapping(bytes32 => uint256) public params;
    mapping(bytes32 => Bounds) public bounds;
    mapping(bytes32 => address) public addresses;
    mapping(address => bool) public allowedCollateral;

    address public guardian;
    bool public paused;

    /// @notice A market's category, and its position in a policy bitmask.
    ///
    /// @dev 1-based, so 0 means "not a category" and an unset entry is the same as an
    ///      unknown one. `AgentAccount.Policy.allowedCategories` (spec §8.4) is a
    ///      bytes32 bitmask over these indices — which only means anything if the set
    ///      is bounded and ordered, so it lives here rather than as free text.
    ///
    ///      Here rather than hardcoded in a library because adding a category should
    ///      be a governance PARAMETER change, not a contract upgrade. "sports" and
    ///      "politics" are not architecture.
    mapping(bytes32 => uint8) public categoryIndex;
    bytes32[] public categories;

    error UnboundedParam(bytes32 key);
    error BoundsLocked(bytes32 key);
    error BadBounds(uint128 lo, uint128 hi);
    error ParamOutOfBounds(bytes32 key, uint256 value, uint256 lo, uint256 hi);
    error NotGuardian();
    error CategoryExists(bytes32 name);
    error TooManyCategories();

    event ParamSet(bytes32 indexed key, uint256 value);
    event BoundsSet(bytes32 indexed key, uint256 lo, uint256 hi);
    event AddressSet(bytes32 indexed key, address value);
    event CollateralAllowed(address indexed token, bool allowed);
    event GuardianSet(address indexed guardian);
    event CategoryAdded(bytes32 indexed name, uint8 index);
    event PausedSet(bool paused);

    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address guardian_) external initializer {
        __Ownable_init(owner_);
        __Ownable2Step_init();
        __UUPSUpgradeable_init();
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    function setBounds(bytes32 key, uint128 lo, uint128 hi) external onlyOwner {
        if (bounds[key].locked) revert BoundsLocked(key);
        if (lo > hi) revert BadBounds(lo, hi);
        bounds[key] = Bounds({lo: lo, hi: hi, locked: true});
        emit BoundsSet(key, lo, hi);
    }

    function setParam(bytes32 key, uint256 value) external onlyOwner {
        Bounds memory b = bounds[key];
        if (!b.locked) revert UnboundedParam(key);
        if (value < b.lo || value > b.hi) revert ParamOutOfBounds(key, value, b.lo, b.hi);
        params[key] = value;
        emit ParamSet(key, value);
    }

    function setAddress(bytes32 key, address value) external onlyOwner {
        addresses[key] = value;
        emit AddressSet(key, value);
    }

    function setCollateralAllowed(address token, bool allowed) external onlyOwner {
        allowedCollateral[token] = allowed;
        emit CollateralAllowed(token, allowed);
    }

    /// @notice Register a category. There is deliberately no way to remove one.
    ///
    /// @dev Removing a category would renumber nothing — indices are permanent — but
    ///      it would strand every market already created under it, and invalidate the
    ///      bit that every existing Policy set for it. A category that should no
    ///      longer be used is a UI decision, not a storage one.
    function addCategory(bytes32 name) external onlyOwner returns (uint8 index) {
        if (categoryIndex[name] != 0) revert CategoryExists(name);
        if (categories.length >= 255) revert TooManyCategories();
        categories.push(name);
        index = uint8(categories.length); // 1-based
        categoryIndex[name] = index;
        emit CategoryAdded(name, index);
    }

    function categoryCount() external view returns (uint256) {
        return categories.length;
    }

    function isCategory(bytes32 name) external view returns (bool) {
        return categoryIndex[name] != 0;
    }

    /// @notice The bit a Policy sets to allow this category.
    function categoryBit(bytes32 name) external view returns (bytes32) {
        uint8 i = categoryIndex[name];
        return i == 0 ? bytes32(0) : bytes32(uint256(1) << (i - 1));
    }

    function setGuardian(address guardian_) external onlyOwner {
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    /// @notice The guardian may halt quickly; only the owner may switch it back on.
    function pause() external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        paused = true;
        emit PausedSet(true);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit PausedSet(false);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
