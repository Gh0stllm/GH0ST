// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IRouterClient} from "./ccip/interfaces/IRouterClient.sol";
import {IAny2EVMMessageReceiver} from "./ccip/interfaces/IAny2EVMMessageReceiver.sol";
import {Client} from "./ccip/libraries/Client.sol";

contract BridgeTokenMock is ERC20 {
    bool public tax;
    constructor() ERC20("GH0ST test token", "GH0ST") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setTax(bool value) external { tax = value; }
    function _update(address from, address to, uint256 amount) internal override {
        if (tax && from != address(0) && to != address(0)) { super._update(from,address(0),amount/100); super._update(from,to,amount-amount/100); }
        else super._update(from,to,amount);
    }
}
contract CCIPRouterMock is IRouterClient {
    uint256 public fee = 10;
    uint256 public sequence;
    bool public fail;
    bool public supported = true;
    event Packet(bytes32 indexed id, address indexed sender, bytes receiver, bytes data, bytes extraArgs);
    function setFee(uint256 f) external { fee = f; }
    function setFail(bool value) external { fail = value; }
    function setSupported(bool value) external { supported = value; }
    function isChainSupported(uint64) external view returns(bool) { return supported; }
    function getFee(uint64,Client.EVM2AnyMessage memory) external view returns(uint256) { require(supported); return fee; }
    function ccipSend(uint64 selector,Client.EVM2AnyMessage calldata message) external payable returns(bytes32 id) {
        require(supported && !fail && msg.value == fee && message.tokenAmounts.length == 0);
        id = keccak256(abi.encode(block.chainid,address(this),msg.sender,++sequence,selector,message.data));
        emit Packet(id,msg.sender,message.receiver,message.data,message.extraArgs);
    }
    function deliver(address to,Client.Any2EVMMessage calldata message) external { IAny2EVMMessageReceiver(to).ccipReceive(message); }
}
