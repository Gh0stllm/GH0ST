// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev Local EVM fixtures only; unrestricted setters are intentional.
contract IntelV2TokenMock {
    uint256 public totalSupply;
    uint8 public immutable decimals;
    mapping(address => uint256) public balanceOf;

    constructor(uint256 supply_, uint8 decimals_) {
        totalSupply = supply_;
        decimals = decimals_;
        balanceOf[msg.sender] = supply_;
    }

    function setSupply(uint256 supply_) external { totalSupply = supply_; }
    function setBalance(address account, uint256 balance_) external { balanceOf[account] = balance_; }
}

/// @dev Exposes both token and pool getters so detection must prefer the pool.
contract IntelV2PairMock {
    address public immutable token0;
    address public immutable token1;
    uint256 public totalSupply = 10_000;
    uint8 public constant decimals = 18;
    mapping(address => uint256) public balanceOf;
    uint112 private reserve0;
    uint112 private reserve1;
    uint32 private observedAt;

    constructor(address token0_, address token1_) { token0 = token0_; token1 = token1_; }
    function setSupply(uint256 value) external { totalSupply = value; }
    function setBalance(address account, uint256 value) external { balanceOf[account] = value; }
    function setReserves(uint112 first, uint112 second, uint32 time) external {
        reserve0 = first; reserve1 = second; observedAt = time;
    }
    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, observedAt);
    }
}

/// @dev A selected fixed getter may violate returndata, range or gas limits.
/// Modes: 0 normal; 1 revert; 2 return31; 3 return64; 4 return64KiB;
/// 5 revert64KiB; 6 uint256max; 7 exhaust gas; 8 attempt callback;
/// 9 balance>supply; 10 dirty address; 11 uint112 overflow; 12 uint32 overflow;
/// 13 empty return; 14 return95; 15 return128.
contract IntelV2HostileGetter {
    bytes4 public badSelector;
    uint8 public mode;
    uint256 public supply = 1_000_000;
    uint256 public watchedBalance = 100_000;
    address public firstToken;
    address public secondToken;
    uint256 public reserve0 = 1_000;
    uint256 public reserve1 = 2_000;
    uint256 public observedAt = 1;
    address public callbackTarget;
    bytes public callbackData;

    constructor(address token0_, address token1_) { firstToken = token0_; secondToken = token1_; }
    function setFacts(uint256 supply_, uint256 balance_, uint256 first, uint256 second, uint256 time) external {
        supply = supply_; watchedBalance = balance_; reserve0 = first; reserve1 = second; observedAt = time;
    }
    function setTokens(address first, address second) external { firstToken = first; secondToken = second; }
    function configure(bytes4 selector, uint8 selected, address target, bytes calldata data) external {
        badSelector = selector; mode = selected; callbackTarget = target; callbackData = data;
    }

    fallback() external {
        bytes4 selector = msg.sig;
        if (selector == badSelector) {
            uint8 selected = mode;
            if (selected == 1) revert("hostile getter rejected");
            if (selected == 2) { assembly { mstore(0, 1) return(0, 31) } }
            if (selected == 3) { assembly { mstore(0, 1) mstore(32, 2) return(0, 64) } }
            if (selected == 4) { assembly { mstore(0, 1) return(0, 65536) } }
            if (selected == 5) { assembly { mstore(0, 1) revert(0, 65536) } }
            if (selected == 6) { assembly { mstore(0, not(0)) return(0, 32) } }
            if (selected == 7) { assembly { for { } 1 { } { } } }
            if (selected == 8) {
                address target = callbackTarget;
                bytes memory data = callbackData;
                // No returndata allocation; STATICCALL ancestry forbids state changes.
                assembly { pop(call(20000, target, 0, add(data, 32), mload(data), 0, 0)) }
            }
            if (selected == 9) {
                uint256 value = supply + 1;
                assembly { mstore(0, value) return(0, 32) }
            }
            if (selected == 10) {
                uint256 value = uint256(uint160(firstToken)) | (uint256(1) << 200);
                assembly { mstore(0, value) return(0, 32) }
            }
            if (selected == 11) { assembly { mstore(0, shl(112, 1)) mstore(32, 2) mstore(64, 1) return(0, 96) } }
            if (selected == 12) { assembly { mstore(0, 1) mstore(32, 2) mstore(64, shl(32, 1)) return(0, 96) } }
            if (selected == 13) { assembly { return(0, 0) } }
            if (selected == 14) { assembly { mstore(0, 1) mstore(32, 2) mstore(64, 1) return(0, 95) } }
            if (selected == 15) { assembly { mstore(0, 1) mstore(32, 2) mstore(64, 1) mstore(96, 4) return(0, 128) } }
        }
        if (selector == bytes4(keccak256("totalSupply()"))) {
            uint256 value = supply;
            assembly { mstore(0, value) return(0, 32) }
        }
        if (selector == bytes4(keccak256("balanceOf(address)"))) {
            uint256 value = watchedBalance;
            assembly { mstore(0, value) return(0, 32) }
        }
        if (selector == bytes4(keccak256("decimals()"))) {
            assembly { mstore(0, 18) return(0, 32) }
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
            uint256 first = reserve0; uint256 second = reserve1; uint256 time = observedAt;
            assembly { mstore(0, first) mstore(32, second) mstore(64, time) return(0, 96) }
        }
        revert("unsupported fixture getter");
    }
}

contract IntelV2ImplementationOne {
    function totalSupply() external pure returns (uint256) { return 1_000_000; }
    function balanceOf(address) external pure returns (uint256) { return 100_000; }
    function decimals() external pure returns (uint8) { return 18; }
}

contract IntelV2ImplementationTwo {
    function totalSupply() external pure returns (uint256) { return 2_000_000; }
    function balanceOf(address) external pure returns (uint256) { return 200_000; }
    function decimals() external pure returns (uint8) { return 18; }
}

/// @dev Upgrade changes behavior without changing this proxy's runtime hash.
contract IntelV2MutableProxy {
    address public implementation;
    constructor(address implementation_) { implementation = implementation_; }
    function setImplementation(address implementation_) external { implementation = implementation_; }
    fallback() external payable {
        address target = implementation;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            if iszero(ok) { revert(0, returndatasize()) }
            return(0, returndatasize())
        }
    }
}
