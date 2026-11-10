// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SynapseBackbone, SynapseExpert} from "./SynapseModules.sol";

interface ISynapseToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Immutable two-expert composition with exact ERC20 funding and pull-based module credits.
/// @dev Supports the fixed v1 kernel and conventional, non-taxed ERC20s. Module quality is empirical.
contract SynapseGraph {
    struct Trace {
        int256[8] hidden;
        int256[8][2] expertActivations;
        int256[8] merged;
        int256[] logits;
        uint16 token;
    }

    ISynapseToken public immutable paymentToken;
    SynapseBackbone public immutable backbone;
    SynapseExpert[2] public experts;
    bytes32 public immutable graphId;
    uint256 public immutable totalFee;
    address[3] public beneficiaries;
    uint96[3] public fees;
    bytes32[3] public moduleCodeHashes;
    mapping(address => uint256) public credits;
    uint256 public totalCredits;
    bool private entered;

    event ModuleUsed(bytes32 indexed graphId, address indexed module, address indexed beneficiary,
        bytes32 activationHash, uint256 fee);
    event Inference(address indexed payer, bytes32 indexed graphId, uint16 token,
        bytes32 inputHash, bytes32 traceHash, uint256 fee);
    event Withdrawal(address indexed beneficiary, uint256 amount);

    error InvalidGraph();
    error InvalidQuote();
    error Expired();
    error TransferFailed();
    error Reentrancy();

    constructor(address token, address base, address[2] memory modules) {
        if (token.code.length == 0 || modules[0] == modules[1]) revert InvalidGraph();
        paymentToken = ISynapseToken(token);
        if (base.codehash != keccak256(type(SynapseBackbone).runtimeCode)) revert InvalidGraph();
        backbone = SynapseBackbone(base);
        bytes32 space = backbone.spaceId();
        bytes32[3] memory weightHashes;
        beneficiaries[0] = backbone.beneficiary();
        fees[0] = backbone.fee();
        moduleCodeHashes[0] = base.codehash;
        weightHashes[0] = backbone.weightsHash();
        for (uint256 i; i < 2; ++i) {
            address module = modules[i];
            if (module.codehash != keccak256(type(SynapseExpert).runtimeCode)) revert InvalidGraph();
            SynapseExpert expert = SynapseExpert(module);
            if (expert.spaceId() != space) revert InvalidGraph();
            experts[i] = expert;
            beneficiaries[i + 1] = expert.beneficiary();
            fees[i + 1] = expert.fee();
            moduleCodeHashes[i + 1] = module.codehash;
            weightHashes[i + 1] = expert.weightsHash();
        }
        for (uint256 i; i < 3; ++i) {
            if (beneficiaries[i] == address(0) || beneficiaries[i] == address(this)) revert InvalidGraph();
        }
        totalFee = uint256(fees[0]) + fees[1] + fees[2];
        graphId = keccak256(abi.encode(block.chainid, address(this), token, base, modules,
            space, weightHashes, moduleCodeHashes, beneficiaries, fees));
    }

    modifier nonReentrant() {
        if (entered) revert Reentrancy();
        entered = true;
        _;
        entered = false;
    }

    function quote() external view returns (bytes32, uint256) {
        return (graphId, totalFee);
    }

    function preview(uint16[2] calldata context) public view returns (Trace memory trace) {
        if (address(backbone).codehash != moduleCodeHashes[0]) revert InvalidGraph();
        trace.hidden = backbone.encode{gas: 200_000}(context);
        for (uint256 i; i < 2; ++i) {
            if (address(experts[i]).codehash != moduleCodeHashes[i + 1]) revert InvalidGraph();
            trace.expertActivations[i] = experts[i].forward{gas: 200_000}(trace.hidden);
        }
        for (uint256 i; i < 8; ++i) {
            trace.merged[i] = (trace.expertActivations[0][i] + trace.expertActivations[1][i]) / 2;
        }
        trace.logits = backbone.project{gas: 600_000}(trace.merged);
        for (uint16 word = 1; word < trace.logits.length; ++word) {
            if (trace.logits[word] > trace.logits[trace.token]) trace.token = word;
        }
    }

    function inferPaid(uint16[2] calldata context, bytes32 expectedGraphId, uint256 maxFee, uint256 deadline)
        external nonReentrant returns (uint16 token)
    {
        if (block.timestamp > deadline) revert Expired();
        if (expectedGraphId != graphId || totalFee > maxFee) revert InvalidQuote();
        Trace memory trace = preview(context);
        if (totalFee != 0) _transferExact(msg.sender, address(this), totalFee);
        for (uint256 i; i < 3; ++i) credits[beneficiaries[i]] += fees[i];
        totalCredits += totalFee;
        emit ModuleUsed(graphId, address(backbone), beneficiaries[0],
            keccak256(abi.encode(trace.hidden, trace.logits)), fees[0]);
        for (uint256 i; i < 2; ++i) {
            emit ModuleUsed(graphId, address(experts[i]), beneficiaries[i + 1],
                keccak256(abi.encode(trace.expertActivations[i])), fees[i + 1]);
        }
        emit Inference(msg.sender, graphId, trace.token, keccak256(abi.encode(context)),
            keccak256(abi.encode(trace)), totalFee);
        return trace.token;
    }

    function withdraw() external nonReentrant returns (uint256 amount) {
        amount = credits[msg.sender];
        if (amount == 0) return 0;
        credits[msg.sender] = 0;
        totalCredits -= amount;
        _transferExact(address(this), msg.sender, amount);
        emit Withdrawal(msg.sender, amount);
    }

    /// @dev Reuse the project's escrow balance-delta checks for incoming and outgoing transfers.
    function _transferExact(address from, address to, uint256 amount) private {
        uint256 senderBefore = paymentToken.balanceOf(from);
        uint256 recipientBefore = paymentToken.balanceOf(to);
        if (senderBefore < amount) revert TransferFailed();
        bool sent = from == address(this)
            ? paymentToken.transfer(to, amount)
            : paymentToken.transferFrom(from, to, amount);
        if (!sent || paymentToken.balanceOf(from) != senderBefore - amount
            || paymentToken.balanceOf(to) != recipientBefore + amount) revert TransferFailed();
    }
}
