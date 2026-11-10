// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev Deliberately configurable local test token. Never a production asset.
contract LocalTestToken {
    string public constant name = "Local Test GH0ST";
    string public constant symbol = "TEST";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint16 public taxBps;
    address public blockedTransferRecipient;
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackEnabled;
    bool public callbackAttempted;
    bool public callbackSucceeded;
    bytes public callbackResult;
    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    function mint(address recipient, uint256 amount) external {
        balanceOf[recipient] += amount;
        totalSupply += amount;
        emit Transfer(address(0), recipient, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        if (recipient == blockedTransferRecipient) return false;
        _move(msg.sender, recipient, amount);
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[sender][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) allowance[sender][msg.sender] = allowed - amount;
        _move(sender, recipient, amount);
        if (callbackEnabled) {
            callbackAttempted = true;
            callbackEnabled = false;
            (callbackSucceeded, callbackResult) = callbackTarget.call(callbackData);
            callbackEnabled = true;
        }
        return true;
    }

    function setTaxBps(uint16 next) external { require(next <= 10_000); taxBps = next; }
    function setBlockedTransferRecipient(address recipient) external { blockedTransferRecipient = recipient; }
    function approveSelf(address spender, uint256 amount) external { allowance[address(this)][spender] = amount; }
    function setCallback(address target, bytes calldata data, bool enabled) external {
        callbackTarget = target;
        callbackData = data;
        callbackEnabled = enabled;
        callbackAttempted = false;
        callbackSucceeded = false;
        delete callbackResult;
    }

    function _move(address sender, address recipient, uint256 amount) private {
        require(balanceOf[sender] >= amount, "balance");
        balanceOf[sender] -= amount;
        uint256 tax = amount * taxBps / 10_000;
        balanceOf[recipient] += amount - tax;
        totalSupply -= tax;
        emit Transfer(sender, recipient, amount - tax);
        if (tax != 0) emit Transfer(sender, address(0), tax);
    }
}

/// @dev Each hostile implementation has interface-shaped metadata but a foreign
/// runtime. SYNAPSE's scoped v1 kernel policy must reject it before execution.
contract LocalHostileExpert {
    address public beneficiary;
    uint96 public fee;
    bytes32 public spaceId;
    bytes32 public weightsHash;
    uint256 public calls;
    uint8 public immutable mode;

    constructor(address recipient, bytes32 space, uint8 behavior) {
        beneficiary = recipient;
        fee = 1 ether;
        spaceId = space;
        weightsHash = keccak256("hostile fixture");
        mode = behavior;
    }

    function forward(int256[8] calldata hidden) external returns (int256[8] memory output) {
        if (mode == 0) revert("hostile expert");
        if (mode == 1) {
            assembly { return(0, 0x10000) }
        }
        calls++;
        return hidden;
    }
}
