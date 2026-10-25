// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Origin, MessagingParams, MessagingFee, MessagingReceipt} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";
import {ILayerZeroReceiver} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroReceiver.sol";
import {GUID} from "@layerzerolabs/lz-evm-protocol-v2/contracts/libs/GUID.sol";

/// @notice TEST ONLY. An asynchronous queue that simulates transport between isolated local EVMs.
/// @dev Anyone can inject any packet through deliver. There are NO DVNs, proofs, finality or real fees.
/// Never use this contract as a production endpoint or report its deliveries as LayerZero verification.
contract MockEndpoint {
    struct QueuedPacket {
        uint32 srcEid;
        uint32 dstEid;
        bytes32 sender;
        bytes32 receiver;
        uint64 nonce;
        bytes32 guid;
        bytes message;
        bytes options;
    }

    uint32 public immutable eid;
    address public immutable testAdmin;
    uint256 public nativeFee;
    mapping(address => address) public delegates;
    mapping(address => mapping(uint32 => mapping(bytes32 => uint64))) public outboundNonce;
    mapping(address => mapping(bytes32 => bool)) public delivered;
    QueuedPacket[] private _packets;

    error InvalidPacket();
    error DuplicateDelivery();
    error InsufficientFee();
    error OnlyTestAdmin();
    error RefundFailed();

    event MockPacketQueued(uint256 indexed index, uint32 indexed dstEid, bytes32 indexed guid, bytes32 sender,
        bytes32 receiver, uint64 nonce, bytes message, bytes options);
    event MockPacketDelivered(bytes32 indexed guid, uint32 indexed srcEid, address indexed receiver);

    constructor(uint32 eid_) {
        if (eid_ == 0) revert InvalidPacket();
        eid = eid_;
        testAdmin = msg.sender;
    }

    function setDelegate(address delegate) external { delegates[msg.sender] = delegate; }
    function setNativeFee(uint256 fee) external {
        if (msg.sender != testAdmin) revert OnlyTestAdmin();
        nativeFee = fee;
    }
    function lzToken() external pure returns (address) { return address(0); }
    function nativeToken() external pure returns (address) { return address(0); }
    function packetCount() external view returns (uint256) { return _packets.length; }
    function packet(uint256 index) external view returns (QueuedPacket memory) { return _packets[index]; }

    function quote(MessagingParams calldata params, address) external view returns (MessagingFee memory) {
        if (params.payInLzToken) revert InvalidPacket();
        return MessagingFee(nativeFee, 0);
    }

    function send(MessagingParams calldata params, address refundAddress) external payable returns (MessagingReceipt memory) {
        if (params.payInLzToken || params.dstEid == 0 || params.dstEid == eid || params.receiver == bytes32(0)) revert InvalidPacket();
        uint256 fee = nativeFee;
        if (msg.value < fee) revert InsufficientFee();
        uint64 nonce = ++outboundNonce[msg.sender][params.dstEid][params.receiver];
        bytes32 guid = GUID.generate(nonce, eid, msg.sender, params.dstEid, params.receiver);
        bytes32 sender = bytes32(uint256(uint160(msg.sender)));
        _packets.push(QueuedPacket(eid, params.dstEid, sender, params.receiver, nonce, guid, params.message, params.options));
        emit MockPacketQueued(_packets.length - 1, params.dstEid, guid, sender, params.receiver, nonce, params.message, params.options);
        if (msg.value > fee) {
            (bool ok,) = payable(refundAddress).call{value: msg.value - fee}("");
            if (!ok) revert RefundFailed();
        }
        return MessagingReceipt(guid, nonce, MessagingFee(fee, 0));
    }

    function deliver(uint32 srcEid, bytes32 sender, uint64 nonce, bytes32 guid, address receiver, bytes calldata message) external {
        if (srcEid == 0 || srcEid == eid || sender == bytes32(0) || nonce == 0 || receiver.code.length == 0) revert InvalidPacket();
        if (delivered[receiver][guid]) revert DuplicateDelivery();
        delivered[receiver][guid] = true;
        ILayerZeroReceiver(receiver).lzReceive(Origin(srcEid, sender, nonce), guid, message, msg.sender, "");
        emit MockPacketDelivered(guid, srcEid, receiver);
    }
}
