// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title ConfigRegistry
/// @notice Satu-satunya sumber parameter, alamat, dan status pause protokol.
/// @dev Batas parameter DIKUNCI saat pertama dipasang: tidak ada fungsi pada implementasi
///      ini yang bisa melonggarkannya. Satu-satunya jalan di luar batas itu adalah upgrade
///      tata kelola (spec §13.3) — admin-nya multisig 3/5, dan semua upgrade lewat timelock 48 jam.
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

    error UnboundedParam(bytes32 key);
    error BoundsLocked(bytes32 key);
    error BadBounds(uint128 lo, uint128 hi);
    error ParamOutOfBounds(bytes32 key, uint256 value, uint256 lo, uint256 hi);
    error NotGuardian();

    event ParamSet(bytes32 indexed key, uint256 value);
    event BoundsSet(bytes32 indexed key, uint256 lo, uint256 hi);
    event AddressSet(bytes32 indexed key, address value);
    event CollateralAllowed(address indexed token, bool allowed);
    event GuardianSet(address indexed guardian);
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

    function setGuardian(address guardian_) external onlyOwner {
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    /// @notice Guardian boleh menghentikan cepat; hanya pemilik yang boleh menyalakan kembali.
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
