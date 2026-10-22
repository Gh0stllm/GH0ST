// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev Local EVM fixtures only. These contracts intentionally expose setters.
contract IntelTokenMock {
    uint8 public immutable decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    constructor(uint256 supply, uint8 decimals_) {
        decimals = decimals_;
        totalSupply = supply;
        balanceOf[msg.sender] = supply;
    }

    function setSupply(uint256 value) external { totalSupply = value; }
    function setBalance(address account, uint256 value) external { balanceOf[account] = value; }
}

contract IntelPairMock {
    address public immutable token0;
    address public immutable token1;
    uint112 private _reserve0;
    uint112 private _reserve1;
    uint32 private _timestamp;
    uint256 public totalSupply = 10_000;

    constructor(address first, address second) { token0 = first; token1 = second; }
    function setSupply(uint256 value) external { totalSupply = value; }
    function setReserves(uint112 first, uint112 second, uint32 timestamp) external {
        _reserve0 = first; _reserve1 = second; _timestamp = timestamp;
    }
    function getReserves() external view returns (uint112, uint112, uint32) {
        return (_reserve0, _reserve1, _timestamp);
    }
}

/// @dev Its chosen getter can violate ABI bounds or attempt a stateful callback.
contract IntelAdversarialGetter {
    bytes4 public badSelector;
    uint8 public mode;
    address public callbackTarget;
    bytes public callbackData;
    uint256 public supply = 1_000_000;
    uint256 public balance = 100_000;
    address public firstToken;
    address public secondToken;

    constructor(address first, address second) { firstToken = first; secondToken = second; }
    function setTokens(address first, address second) external { firstToken = first; secondToken = second; }
    function configure(bytes4 selector_, uint8 mode_, address target_, bytes calldata data_) external {
        badSelector = selector_; mode = mode_; callbackTarget = target_; callbackData = data_;
    }

    fallback() external {
        bytes4 selector = msg.sig;
        if (selector == badSelector) {
            uint8 selected = mode;
            if (selected == 1) revert("fixture getter failure");
            if (selected == 2) { assembly { mstore(0, 1) mstore(32, 2) return(0, 64) } }
            if (selected == 3) { assembly { return(0, 0) } }
            if (selected == 4) { assembly { mstore(0, not(0)) return(0, 32) } }
            if (selected == 5) { assembly { mstore(0, 1) return(0, 65536) } }
            if (selected == 6) {
                // STATICCALL ancestry must prevent observation state changes.
                (bool ignored,) = callbackTarget.call(callbackData);
                ignored;
            }
            if (selected == 7) { assembly { for { } 1 { } { } } }
            if (selected == 8) { assembly { mstore(0, 1) return(0, 31) } }
            if (selected == 9) { assembly { mstore(0, shl(112, 1)) mstore(32, 2) mstore(64, 1) return(0, 96) } }
            if (selected == 10) { assembly { mstore(0, 1) mstore(32, 2) mstore(64, shl(32, 1)) return(0, 96) } }
        }
        if (selector == bytes4(keccak256("decimals()"))) {
            assembly { mstore(0, 18) return(0, 32) }
        }
        if (selector == bytes4(keccak256("totalSupply()"))) {
            uint256 value = supply;
            assembly { mstore(0, value) return(0, 32) }
        }
        if (selector == bytes4(keccak256("balanceOf(address)"))) {
            uint256 value = balance;
            assembly { mstore(0, value) return(0, 32) }
        }
        if (selector == bytes4(keccak256("token0()"))) {
            address value = firstToken;
            assembly { mstore(0, value) return(0, 32) }
        }
        if (selector == bytes4(keccak256("token1()"))) {
            address value = secondToken;
            assembly { mstore(0, value) return(0, 32) }
        }
        if (selector == bytes4(keccak256("getReserves()"))) {
            assembly { mstore(0, 1000) mstore(32, 2000) mstore(64, 1) return(0, 96) }
        }
        revert("fixture unsupported selector");
    }
}

contract IntelMutableClassifier {
    bytes32 public modelId = bytes32(uint256(1));
    bytes32 public trainingManifestHash = bytes32(uint256(2));
    uint8 public selectedLabel = 5;
    function setIdentity(bytes32 id, bytes32 manifest) external { modelId = id; trainingManifestHash = manifest; }
    function setLabel(uint8 label) external { selectedLabel = label; }
    function classify(int32[8] calldata) external view returns (uint8 label, int256[6] memory scores) {
        return (selectedLabel, scores);
    }
}
