// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Bounded, public on-chain memory. Only the caller's namespace is writable.
/// @dev Research component: no model, inference or trusted executor is connected.
contract S0ULMemory {
    uint256 public constant MAX_ENTRIES = 32;
    uint256 public constant MAX_VALUE_BYTES = 128;

    mapping(address => mapping(bytes32 => bytes)) private values;
    mapping(address => uint256) public entryCount;

    error EmptyKey();
    error EmptyValue();
    error ValueTooLong();
    error MemoryFull();

    event Remembered(address indexed account, bytes32 indexed key, bytes value);
    event Forgotten(address indexed account, bytes32 indexed key);

    function remember(bytes32 key, bytes calldata value) external {
        if (key == bytes32(0)) revert EmptyKey();
        if (value.length == 0) revert EmptyValue();
        if (value.length > MAX_VALUE_BYTES) revert ValueTooLong();
        if (values[msg.sender][key].length == 0) {
            if (entryCount[msg.sender] >= MAX_ENTRIES) revert MemoryFull();
            ++entryCount[msg.sender];
        }
        values[msg.sender][key] = value;
        emit Remembered(msg.sender, key, value);
    }

    function recall(bytes32 key) external view returns (bytes memory) {
        return values[msg.sender][key];
    }

    function forget(bytes32 key) external returns (bool removed) {
        if (key == bytes32(0)) revert EmptyKey();
        if (values[msg.sender][key].length == 0) return false;
        delete values[msg.sender][key];
        --entryCount[msg.sender];
        emit Forgotten(msg.sender, key);
        return true;
    }
}
