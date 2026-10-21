// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import "../../contracts/S0ULActionCodec.sol";
contract S0ULActionCodecHarness {
    function parse(bytes memory text) external pure returns (bool valid, S0ULActionCodec.Action memory action) {
        return S0ULActionCodec.parse(text);
    }
}
