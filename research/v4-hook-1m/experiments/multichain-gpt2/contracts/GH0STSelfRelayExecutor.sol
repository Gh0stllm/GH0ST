// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ILayerZeroExecutor} from "@layerzerolabs/lz-evm-messagelib-v2/contracts/interfaces/ILayerZeroExecutor.sol";

/// @notice A narrowly scoped LayerZero executor adapter for an operator-run relay.
/// @dev This quotes zero SERVICE fee. Operators still pay source, DVN, verification
/// and destination execution fees. It does not verify messages or bypass DVNs.
contract GH0STSelfRelayExecutor is ILayerZeroExecutor {
    address public immutable sendLibrary;
    address public immutable authorizedOApp;
    uint32 public immutable remoteEid;
    uint256 public immutable deploymentChainId;
    uint256 public constant MAX_MESSAGE_BYTES = 4480;
    bytes32 public constant OPTIONS_HASH = keccak256(hex"010011010000000000000000000000000007a120");

    error Unauthorized();
    error InvalidConfiguration();
    error UnsupportedJob();
    event RelayJobAssigned(address indexed oapp, uint32 indexed destinationEid, uint256 payloadBytes, bytes32 optionsHash);

    constructor(address sendLibrary_, address authorizedOApp_, uint32 remoteEid_, uint256 chainId_) {
        if (sendLibrary_.code.length == 0 || authorizedOApp_.code.length == 0 || remoteEid_ == 0 || chainId_ != block.chainid) {
            revert InvalidConfiguration();
        }
        sendLibrary = sendLibrary_;
        authorizedOApp = authorizedOApp_;
        remoteEid = remoteEid_;
        deploymentChainId = chainId_;
    }

    function _check(uint32 eid, address sender, uint256 size, bytes calldata options) private view {
        if (eid != remoteEid || sender != authorizedOApp || size < 384 || size > MAX_MESSAGE_BYTES
            || keccak256(options) != OPTIONS_HASH) revert UnsupportedJob();
    }

    function getFee(uint32 eid, address sender, uint256 size, bytes calldata options) external view override returns (uint256) {
        _check(eid, sender, size, options);
        return 0;
    }

    function assignJob(uint32 eid, address sender, uint256 size, bytes calldata options) external override returns (uint256) {
        if (msg.sender != sendLibrary) revert Unauthorized();
        _check(eid, sender, size, options);
        emit RelayJobAssigned(sender, eid, size, keccak256(options));
        return 0;
    }
}
