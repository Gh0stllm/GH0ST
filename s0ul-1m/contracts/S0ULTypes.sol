// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

library S0ULTypes {
    struct Config {
        uint16 vocabSize;
        uint16 dim;
        uint16 layers;
        uint16 heads;
        uint16 hiddenDim;
        uint16 maxSeqLen;
        uint32 epsQ28;
        uint32 attentionScaleQ14;
    }
}

interface IS0ULModel {
    function configuration() external view returns (S0ULTypes.Config memory);
    function readTensor(uint256 tensor, uint256 offset, uint256 length) external view returns (bytes memory);
    function modelId() external view returns (bytes32);
    function sourceCheckpoint() external view returns (bytes32);
}

interface IS0ULTokenizer {
    function encode(string calldata text) external pure returns (uint16[] memory);
    function decode(uint16[] calldata ids, bool skipSpecial) external pure returns (bytes memory);
    function domainSha256() external pure returns (bytes32);
}
