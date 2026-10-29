// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {CCIPReceiver} from "./ccip/applications/CCIPReceiver.sol";
import {IRouterClient} from "./ccip/interfaces/IRouterClient.sol";
import {Client} from "./ccip/libraries/Client.sol";
import {FinalityCodec} from "./ccip/libraries/FinalityCodec.sol";
import {ExtraArgsCodec} from "./ccip/libraries/ExtraArgsCodec.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Finalized CCIP messages carry the accounting instruction, not the asset.
/// The original GH0ST is held in the RH escrow; only that escrow may back BNB minting.
abstract contract GH0STBridgeBase is CCIPReceiver, ReentrancyGuard {
    uint64 public immutable localSelector;
    uint64 public immutable remoteSelector;
    address public immutable nativeToken;
    address public immutable owner;
    uint256 public immutable maxTransfer;
    address public peer;
    bool public paused = true;
    uint256 public outboundNonce;
    uint32 public destinationGasLimit = 400_000;
    mapping(bytes32 => bool) public processedMessage;
    mapping(uint256 => bool) public processedNonce;
    mapping(address => uint256) public nativeCredits;
    event PeerBound(address indexed peer);
    event PauseChanged(bool paused);
    event GasLimitChanged(uint32 gasLimit);
    event BridgeSent(bytes32 indexed messageId, address indexed sender, address indexed recipient, uint256 amount, uint256 nonce, uint256 nativeFee);
    event BridgeReceived(bytes32 indexed messageId, address indexed recipient, uint256 amount, uint256 nonce);
    event NativeCreditWithdrawn(address indexed account, uint256 amount);
    error Unauthorized(); error InvalidBridge(); error InvalidMessage(); error FeeLimit();

    constructor(address router, uint64 local, uint64 remote, address token, address owner_, uint256 cap) CCIPReceiver(router) {
        if (router.code.length == 0 || local == 0 || remote == 0 || local == remote || token == address(0) || owner_ == address(0) || cap == 0) revert InvalidBridge();
        localSelector = local; remoteSelector = remote; nativeToken = token; owner = owner_; maxTransfer = cap;
    }
    function bindPeer(address peer_) external {
        if (msg.sender != owner) revert Unauthorized();
        // The same address may legitimately be deployed on two different chains.
        if (peer != address(0) || peer_ == address(0)) revert InvalidBridge();
        peer = peer_; emit PeerBound(peer_);
    }
    function setPaused(bool value) external {
        if (msg.sender != owner) revert Unauthorized();
        if (!value && (peer == address(0) || !IRouterClient(getRouter()).isChainSupported(remoteSelector))) revert InvalidBridge();
        paused = value; emit PauseChanged(value);
    }
    /// @notice Tuning execution gas never reduces the receiver's finalized-only policy.
    function setDestinationGasLimit(uint32 gasLimit) external {
        if (msg.sender != owner) revert Unauthorized();
        if (!paused || gasLimit < 150_000 || gasLimit > 2_000_000) revert InvalidBridge();
        destinationGasLimit = gasLimit; emit GasLimitChanged(gasLimit);
    }
    function _outboundAction() internal pure virtual returns (uint8);
    function _inboundAction() internal pure virtual returns (uint8);
    function _debit(address sender, uint256 amount) internal virtual;
    function _credit(address recipient, uint256 amount) internal virtual;
    function _message(uint256 amount, address recipient, uint256 nonce) internal view returns (Client.EVM2AnyMessage memory) {
        if (peer == address(0) || recipient == address(0) || recipient == peer || amount == 0 || amount > maxTransfer) revert InvalidBridge();
        return Client.EVM2AnyMessage({
            receiver: abi.encode(peer),
            data: abi.encode(uint8(1), _outboundAction(), nativeToken, nonce, recipient, amount),
            tokenAmounts: new Client.EVMTokenAmount[](0),
            feeToken: address(0),
            extraArgs: ExtraArgsCodec._getBasicEncodedExtraArgsV3(destinationGasLimit, FinalityCodec.WAIT_FOR_FINALITY_FLAG)
        });
    }
    function quoteBridge(uint256 amount, address recipient) external view returns (uint256 nativeFee) {
        if (paused) revert InvalidBridge();
        return IRouterClient(getRouter()).getFee(remoteSelector, _message(amount, recipient, outboundNonce + 1));
    }
    function bridge(uint256 amount, address recipient, uint256 maxNativeFee) external payable nonReentrant returns (bytes32 messageId) {
        if (paused) revert InvalidBridge();
        uint256 nonce = ++outboundNonce;
        Client.EVM2AnyMessage memory message = _message(amount, recipient, nonce);
        uint256 fee = IRouterClient(getRouter()).getFee(remoteSelector, message);
        if (fee > maxNativeFee || msg.value < fee) revert FeeLimit();
        _debit(msg.sender, amount);
        nativeCredits[msg.sender] += msg.value - fee;
        messageId = IRouterClient(getRouter()).ccipSend{value: fee}(remoteSelector, message);
        if (messageId == bytes32(0)) revert InvalidMessage();
        emit BridgeSent(messageId, msg.sender, recipient, amount, nonce, fee);
    }
    function _ccipReceive(Client.Any2EVMMessage memory message) internal override nonReentrant {
        if (peer == address(0) || message.messageId == bytes32(0) || processedMessage[message.messageId] || message.sourceChainSelector != remoteSelector || message.sender.length != 32 || message.destTokenAmounts.length != 0 || abi.decode(message.sender, (address)) != peer || message.data.length != 192) revert InvalidMessage();
        (uint8 version, uint8 action, address token, uint256 nonce, address recipient, uint256 amount) = abi.decode(message.data, (uint8, uint8, address, uint256, address, uint256));
        if (version != 1 || action != _inboundAction() || token != nativeToken || nonce == 0 || processedNonce[nonce] || recipient == address(0) || recipient == address(this) || amount == 0 || amount > maxTransfer) revert InvalidMessage();
        processedMessage[message.messageId] = true; processedNonce[nonce] = true;
        _credit(recipient, amount);
        emit BridgeReceived(message.messageId, recipient, amount, nonce);
    }
    function withdrawNativeCredit() external nonReentrant {
        uint256 amount = nativeCredits[msg.sender]; if (amount == 0) revert InvalidBridge();
        nativeCredits[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}(""); if (!ok) revert InvalidBridge();
        emit NativeCreditWithdrawn(msg.sender, amount);
    }
}
