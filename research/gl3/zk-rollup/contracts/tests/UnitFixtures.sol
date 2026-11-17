// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;
import "../GL3DataRegistry.sol";
import "../GL3ZkTypes.sol";

// SYNTHETIC UNIT FIXTURES ONLY. None of these contracts can authorize a
// production bridge, proof, state root, child credit or parent payout.
contract UnitAccumulatorBridge is IGL3AccumulatorBridge {
    bytes32[] public sequencerInboxAccs;
    bytes32[] public delayedInboxAccs;
    function appendSequencer(bytes32 value) external { sequencerInboxAccs.push(value); }
    function appendDelayed(bytes32 value) external { delayedInboxAccs.push(value); }
    function appendSyntheticSequencers(uint256 count, bytes32 wireHash, bytes32 delayedAcc) external {
        bytes32 previous = sequencerInboxAccs.length == 0 ? bytes32(0) : sequencerInboxAccs[sequencerInboxAccs.length - 1];
        for(uint256 i=0;i<count;++i) {
            previous = keccak256(abi.encodePacked(previous,wireHash,delayedAcc));
            sequencerInboxAccs.push(previous);
        }
    }
    function sequencerMessageCount() external view returns(uint256) { return sequencerInboxAccs.length; }
    function delayedMessageCount() external view returns(uint256) { return delayedInboxAccs.length; }
}

contract UnitDataRegistry is GL3DataRegistry {
    IGL3AccumulatorBridge private immutable unitBridge;
    bytes32 private immutable unitDomain;
    bool public live = true;
    constructor(address bridge, bytes32 domain) { unitBridge = IGL3AccumulatorBridge(bridge); unitDomain = domain; }
    function setLive(bool value) external { live = value; }
    function unitRegisterMany(uint64 start, bytes[] calldata wires) external {
        for(uint64 i=0;i<wires.length;++i) this.registerSequencerData(start+i,wires[i]);
    }
    function _registryBridge() internal view override returns (IGL3AccumulatorBridge) { return unitBridge; }
    function _registryDomain() internal view override returns (bytes32) { return unitDomain; }
    function _registrySealed() internal view override returns (bool) { return live; }
}

contract UnitStatementCodec {
    function decode(bytes calldata values) external pure returns(GL3ZkTypes.Statement memory result) {
        require(values.length == 736, "statement length");
        return abi.decode(values,(GL3ZkTypes.Statement));
    }
    function hashState(GL3ZkTypes.GlobalState calldata state) external pure returns(bytes32) {
        return GL3ZkTypes.hashState(state);
    }
}
