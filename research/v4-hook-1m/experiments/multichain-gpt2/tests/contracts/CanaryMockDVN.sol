// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ILayerZeroDVN} from "@layerzerolabs/lz-evm-messagelib-v2/contracts/uln/interfaces/ILayerZeroDVN.sol";

interface ICanaryReceiveUln {
    function verify(bytes calldata header, bytes32 payloadHash, uint64 confirmations) external;
}

/// @notice TEST ONLY: explicit administrator-controlled attestations, no cryptographic or live DVN claim.
contract CanaryMockDVN is ILayerZeroDVN {
    address public immutable testAdministrator;
    address public immutable sendLibrary;
    address public immutable receiveLibrary;
    uint256 public assignedJobs;

    error TestOnlyUnauthorized();
    event TestJobAssigned(uint32 destinationEid, bytes header, bytes32 payloadHash);

    constructor(address sendLibrary_, address receiveLibrary_) {
        testAdministrator = msg.sender;
        sendLibrary = sendLibrary_;
        receiveLibrary = receiveLibrary_;
    }

    function getFee(uint32, uint64, address, bytes calldata) external pure override returns (uint256) {
        return 0;
    }

    function assignJob(AssignJobParam calldata params, bytes calldata) external payable override returns (uint256) {
        if (msg.sender != sendLibrary) revert TestOnlyUnauthorized();
        assignedJobs++;
        emit TestJobAssigned(params.dstEid, params.packetHeader, params.payloadHash);
        return 0;
    }

    function attest(bytes calldata header, bytes32 payloadHash, uint64 confirmations) external {
        if (msg.sender != testAdministrator) revert TestOnlyUnauthorized();
        ICanaryReceiveUln(receiveLibrary).verify(header, payloadHash, confirmations);
    }
}
