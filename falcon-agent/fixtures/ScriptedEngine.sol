// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import "../Agent.sol";

/// TEST FIXTURE ONLY: scripted decisions, no neural network and no Falcon weights.
/// Never represent deployments using this contract as an LLM agent.
contract ScriptedEngine is IOnchainInference {
    bytes32 public constant modelId = keccak256("TEST_FIXTURE_NOT_FALCON");
    struct Output { bool done; uint8 kind; address recipient; uint96 amount; bytes text; }
    uint256 public nextJob;
    mapping(uint256=>Output) private outputs;
    mapping(uint256=>uint256) public steps;
    mapping(uint256=>bytes32) public observationHash;
    mapping(uint256=>address) public caller;
    function begin(bytes calldata, bytes calldata observation, uint16) external returns(uint256 id) {
        id = ++nextJob;
        caller[id] = msg.sender;
        observationHash[id] = keccak256(observation);
    }
    function advance(uint256 id, uint8 work) external {
        require(caller[id] == msg.sender,"caller");
        steps[id] += work;
    }
    function set(uint256 id, bool done, uint8 kind, address recipient, uint96 amount, bytes calldata text) external {
        outputs[id] = Output(done,kind,recipient,amount,text);
    }
    function result(uint256 id) external view returns(bool,uint8,address,uint96,bytes memory) {
        Output storage o = outputs[id];
        return(o.done,o.kind,o.recipient,o.amount,o.text);
    }
}

contract RevertingRecipient { receive() external payable { revert("reject"); } }
contract ReenteringRecipient {
    OnchainAgent public target;
    bool public blocked;
    function setTarget(address a) external { target=OnchainAgent(payable(a)); }
    receive() external payable {
        (bool ok,) = address(target).call(abi.encodeCall(target.drive,(uint8(1))));
        blocked = !ok;
    }
}
