// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {OApp, Origin, MessagingFee, MessagingReceipt} from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";
import {OptionsBuilder} from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OptionsBuilder.sol";

/// @notice One model-free RH -> opBNB -> RH transport probe. Not an inference engine.
/// @dev Each session sends exactly one challenge and one acknowledgement. All message
/// authentication still comes from the configured LayerZero endpoint, peer and DVNs.
contract RHOpBNBCanary is OApp, Ownable2Step, ReentrancyGuard {
    using OptionsBuilder for bytes;

    bytes32 public constant CANARY_DOMAIN = keccak256("GH0ST_RH_OPBNB_CANARY_V1");
    uint8 public constant VERSION = 1;
    uint8 public constant PING = 1;
    uint8 public constant ACK = 2;
    uint256 public constant PACKET_BYTES = 416;
    uint128 public constant RECEIVE_GAS = 500000;

    // Thirteen static ABI words, deliberately matching the short inference packet size.
    struct Packet {
        uint8 version;
        uint8 kind;
        bytes32 sessionId;
        bytes32 challenge;
        uint64 nonce;
        uint32 homeEid;
        uint32 computeEid;
        bytes32 requestHash;
        bytes32 reserved0;
        bytes32 reserved1;
        bytes32 reserved2;
        bytes32 reserved3;
        bytes32 reserved4;
    }

    bool public immutable isHome;
    uint32 public immutable homeEid;
    uint32 public immutable computeEid;
    uint256 public immutable deploymentChainId;
    address public immutable requester;
    bytes32 public immutable sessionId;
    uint64 public immutable deadline;
    bool public routeSealed;
    bool public pingSent;
    bool public pingReceived;
    bool public ackSent;
    bool public ackReceived;
    bytes32 public challenge;
    bytes32 public requestHash;
    bytes32 public pingGuid;
    bytes32 public ackGuid;
    mapping(bytes32 => bool) public acceptedGuid;

    error InvalidConfiguration();
    error InvalidState();
    error InvalidPacket();
    error Unauthorized();
    error SessionExpired();
    event ProbeSent(uint8 indexed kind, bytes32 indexed guid, bytes32 indexed requestHash, bytes32 challenge);
    event ProbeReceived(uint8 indexed kind, bytes32 indexed guid, bytes32 indexed requestHash, bytes32 challenge);

    constructor(address endpoint_, address admin_, address requester_, bool home_, uint32 homeEid_,
        uint32 computeEid_, bytes32 sessionId_, uint64 deadline_)
        OApp(endpoint_, admin_) Ownable(admin_)
    {
        if (endpoint_.code.length == 0 || requester_ == address(0) || sessionId_ == bytes32(0)
            || homeEid_ != 30416 || computeEid_ != 30202 || deadline_ <= block.timestamp
            || block.chainid != (home_ ? 4663 : 204)
            || endpoint.eid() != (home_ ? homeEid_ : computeEid_)) revert InvalidConfiguration();
        isHome = home_;
        homeEid = homeEid_;
        computeEid = computeEid_;
        deploymentChainId = block.chainid;
        requester = requester_;
        sessionId = sessionId_;
        deadline = deadline_;
    }

    modifier live() { if (block.timestamp > deadline) revert SessionExpired(); _; }
    modifier sealedRoute() { if (!routeSealed) revert InvalidState(); _; }
    function remoteEid() public view returns (uint32) { return isHome ? computeEid : homeEid; }

    function setPeer(uint32 eid_, bytes32 peer_) public override onlyOwner live {
        if (routeSealed || eid_ != remoteEid() || peer_ == bytes32(0) || uint256(peer_) >> 160 != 0) {
            revert InvalidConfiguration();
        }
        _setPeer(eid_, peer_);
    }

    function sealRoute() external onlyOwner live {
        if (routeSealed || peers[remoteEid()] == bytes32(0)) revert InvalidState();
        routeSealed = true;
    }

    function fixedOptions() public pure returns (bytes memory) {
        return OptionsBuilder.newOptions().addExecutorLzReceiveOption(RECEIVE_GAS, 0);
    }

    function _requestHash(bytes32 challenge_) private view returns (bytes32) {
        bytes32 local = bytes32(uint256(uint160(address(this))));
        bytes32 home = isHome ? local : peers[homeEid];
        bytes32 compute = isHome ? peers[computeEid] : local;
        return keccak256(abi.encode(CANARY_DOMAIN, sessionId, challenge_, uint64(1), homeEid, computeEid, home, compute));
    }

    function _packet(uint8 kind, bytes32 challenge_) private view returns (bytes memory) {
        return abi.encode(Packet(VERSION, kind, sessionId, challenge_, 1, homeEid, computeEid,
            _requestHash(challenge_), bytes32(0), bytes32(0), bytes32(0), bytes32(0), bytes32(0)));
    }

    function quotePing(bytes32 challenge_) external view sealedRoute live returns (MessagingFee memory) {
        if (!isHome || pingSent || challenge_ == bytes32(0)) revert InvalidState();
        return _quote(remoteEid(), _packet(PING, challenge_), fixedOptions(), false);
    }

    function ping(bytes32 challenge_) external payable sealedRoute live nonReentrant returns (MessagingReceipt memory receipt) {
        if (msg.sender != requester) revert Unauthorized();
        if (!isHome || pingSent || challenge_ == bytes32(0)) revert InvalidState();
        pingSent = true;
        challenge = challenge_;
        requestHash = _requestHash(challenge_);
        receipt = _lzSend(remoteEid(), _packet(PING, challenge_), fixedOptions(), MessagingFee(msg.value, 0), payable(msg.sender));
        pingGuid = receipt.guid;
        emit ProbeSent(PING, receipt.guid, requestHash, challenge_);
    }

    function quoteAck() external view sealedRoute live returns (MessagingFee memory) {
        if (isHome || !pingReceived || ackSent) revert InvalidState();
        return _quote(remoteEid(), _packet(ACK, challenge), fixedOptions(), false);
    }

    function ack() external payable sealedRoute live nonReentrant returns (MessagingReceipt memory receipt) {
        if (isHome || !pingReceived || ackSent) revert InvalidState();
        ackSent = true;
        receipt = _lzSend(remoteEid(), _packet(ACK, challenge), fixedOptions(), MessagingFee(msg.value, 0), payable(msg.sender));
        ackGuid = receipt.guid;
        emit ProbeSent(ACK, receipt.guid, requestHash, challenge);
    }

    function _lzReceive(Origin calldata origin, bytes32 guid, bytes calldata message, address, bytes calldata)
        internal override sealedRoute live nonReentrant
    {
        if (origin.srcEid != remoteEid() || acceptedGuid[guid] || message.length != PACKET_BYTES || msg.value != 0) {
            revert InvalidPacket();
        }
        Packet memory p = abi.decode(message, (Packet));
        if (keccak256(message) != keccak256(abi.encode(p)) || p.version != VERSION || p.sessionId != sessionId
            || p.nonce != 1 || p.homeEid != homeEid || p.computeEid != computeEid || p.challenge == bytes32(0)
            || p.requestHash != _requestHash(p.challenge) || p.reserved0 != 0 || p.reserved1 != 0
            || p.reserved2 != 0 || p.reserved3 != 0 || p.reserved4 != 0) revert InvalidPacket();
        if (isHome) {
            if (p.kind != ACK || !pingSent || ackReceived || p.challenge != challenge || p.requestHash != requestHash) {
                revert InvalidPacket();
            }
            ackReceived = true;
            ackGuid = guid;
        } else {
            if (p.kind != PING || pingReceived || ackSent) revert InvalidPacket();
            pingReceived = true;
            challenge = p.challenge;
            requestHash = p.requestHash;
            pingGuid = guid;
        }
        acceptedGuid[guid] = true;
        emit ProbeReceived(p.kind, guid, p.requestHash, p.challenge);
    }

    function transferOwnership(address next) public override(Ownable, Ownable2Step) { Ownable2Step.transferOwnership(next); }
    function _transferOwnership(address next) internal override(Ownable, Ownable2Step) { Ownable2Step._transferOwnership(next); }
    function acceptOwnership() public override { super.acceptOwnership(); endpoint.setDelegate(msg.sender); }
    function renounceOwnership() public override onlyOwner { revert Unauthorized(); }
}
