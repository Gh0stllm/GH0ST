// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract Forwarder {
    function forward(address target, address payable recipient) external {
        (bool ok,) = target.call(abi.encodeWithSignature("pay(address,uint256)", recipient, 7));
        require(ok);
    }
}
contract ReentryProbe {
    address target;
    bool takesAmount;
    bool attempted;
    function begin(address pool, bool amount) external payable {
        target = pool;
        takesAmount = amount;
        (bool funded,) = pool.call{value: msg.value}(abi.encodeWithSignature("deposit()"));
        require(funded);
        require(withdrawOnce());
    }
    function withdrawOnce() private returns (bool ok) {
        bytes memory data = takesAmount ? abi.encodeWithSignature("withdraw(uint256)",7) : abi.encodeWithSignature("withdraw()");
        (ok,) = target.call(data);
    }
    receive() external payable {
        if (!attempted) { attempted = true; withdrawOnce(); }
    }
}
contract ToggleToken {
    mapping(address => uint) public balance;
    bool enabled;
    constructor(address user) { balance[user] = 100; }
    function enable() external { enabled = true; }
    function transferFrom(address from, address to, uint amount) external returns (bool) {
        if (!enabled) return false;
        balance[from] -= amount;
        balance[to] += amount;
        return true;
    }
}
