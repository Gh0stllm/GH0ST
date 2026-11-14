// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev Deliberately hostile, freely configurable token for isolated local tests only.
contract ForgeTestToken {
    string public constant name = "Local Test GH0ST";
    string public constant symbol = "TEST";
    uint8 public constant decimals = 18;
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

    function mint(address recipient, uint256 amount) external { balanceOf[recipient] += amount; totalSupply += amount; }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; return true; }
    function approveSelf(address spender, uint256 amount) external { allowance[address(this)][spender] = amount; }
    function transfer(address recipient, uint256 amount) external returns (bool) {
        _move(msg.sender, recipient, amount);
        _callback();
        return !falseOutgoing;
    }
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[sender][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) allowance[sender][msg.sender] = allowed - amount;
        _move(sender, recipient, amount);
        _callback();
        return !falseIncoming;
    }
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
    function _callback() private {
        if (!callbackEnabled) return;
        callbackAttempted = true; callbackEnabled = false;
        (callbackSucceeded, callbackResult) = callbackTarget.call(callbackData);
        callbackEnabled = true;
    }
    function _move(address sender, address recipient, uint256 amount) private {
        require(balanceOf[sender] >= amount, "balance");
        balanceOf[sender] -= amount;
        uint256 tax = amount * taxBps / 10_000;
        balanceOf[recipient] += amount - tax;
        totalSupply -= tax;
    }
}
