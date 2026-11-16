// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// Solidity ABI for the locally compiled Stylus compatibility kernel.
/// No address is deployed or assumed to provide this interface yet.
interface IGh0stTensorKernel {
    function kernelVersion() external view returns (uint32);
    function dotProduct(int16[] calldata weights, int16[] calldata activations) external view returns (int64);
    function linearRelu(int16[] calldata weights, int16[] calldata activations, int64 bias) external view returns (int64);
    function argmax(int64[] calldata logits) external view returns (uint32);
}

contract Gh0stTensorCaller {
    function evaluate(address kernel, int16[] calldata weights, int16[] calldata activations)
        external view returns (int64)
    {
        require(kernel.code.length != 0, "kernel is not deployed");
        return IGh0stTensorKernel(kernel).dotProduct(weights, activations);
    }
}
