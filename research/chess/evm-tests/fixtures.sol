// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev Deliberately hostile token; isolated EVM tests ONLY.
contract ChessTestToken {
    uint8 public immutable decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint16 public taxBps;
    bool public falseIncoming;
    bool public falseOutgoing;
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackEnabled;
    bool public callbackAttempted;
    bool public callbackSucceeded;
    bytes public callbackResult;

    constructor(uint8 decimalCount) { decimals = decimalCount; }
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; totalSupply += amount; }
    function burn(address from, uint256 amount) external { balanceOf[from] -= amount; totalSupply -= amount; }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; return true; }
    function approveSelf(address spender, uint256 amount) external { allowance[address(this)][spender] = amount; }
    function configure(uint16 tax, bool incomingFalse, bool outgoingFalse) external {
        require(tax <= 10_000);
        taxBps = tax; falseIncoming = incomingFalse; falseOutgoing = outgoingFalse;
    }
    function setCallback(address target, bytes calldata payload, bool enabled) external {
        callbackTarget = target; callbackData = payload; callbackEnabled = enabled;
        callbackAttempted = false; callbackSucceeded = false; delete callbackResult;
    }
    function callExternal(address target, bytes calldata payload) external returns (bytes memory result) {
        (bool success, bytes memory returned) = target.call(payload);
        require(success, "external call failed");
        return returned;
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount); _callback(); return !falseOutgoing;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _move(from, to, amount); _callback(); return !falseIncoming;
    }
    function _callback() private {
        if (!callbackEnabled) return;
        callbackAttempted = true; callbackEnabled = false;
        (callbackSucceeded, callbackResult) = callbackTarget.call(callbackData);
        callbackEnabled = true;
    }
    function _move(address from, address to, uint256 amount) private {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        uint256 tax = amount * taxBps / 10_000;
        balanceOf[to] += amount - tax;
        totalSupply -= tax;
    }
}
