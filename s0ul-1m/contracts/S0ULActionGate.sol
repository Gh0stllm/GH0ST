// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IS0ULBalanceToken {
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Typed proposal checks and caller-only balance reads; never executes actions.
/// @dev A valid proposal is NOT proof that a model produced it or that a user authorized it.
contract S0ULActionGate {
    uint8 public constant WAIT = 0;
    uint8 public constant BALANCE_ETH = 1;
    uint8 public constant BALANCE_TOKEN = 2;
    uint8 public constant MEM_SET = 3;
    uint8 public constant MEM_GET = 4;
    uint8 public constant TASK_ADD = 5;
    uint8 public constant TASK_LIST = 6;
    uint8 public constant TASK_DONE = 7;
    uint8 public constant CLARIFY = 8;
    uint8 public constant REFUSE = 9;

    struct Proposal {
        uint8 kind;
        bytes32 key;
        bytes value;
        uint256 taskId;
        address token;
    }

    /// @dev Constructor-only allowlist: no method changes it after deployment.
    mapping(address => bool) public allowedTokens;

    error InvalidToken();
    error UnsupportedAction();
    error InvalidArguments();

    constructor(address[] memory tokens) {
        for (uint256 i; i < tokens.length; ++i) {
            if (tokens[i].code.length == 0 || allowedTokens[tokens[i]]) revert InvalidToken();
            allowedTokens[tokens[i]] = true;
        }
    }

    function nativeBalance() external view returns (uint256) {
        return msg.sender.balance;
    }

    function tokenBalance(address token) external view returns (uint256) {
        if (!allowedTokens[token]) revert InvalidToken();
        return IS0ULBalanceToken(token).balanceOf(msg.sender);
    }

    function validateProposal(Proposal calldata p) external view returns (bool) {
        if (p.kind > REFUSE) revert UnsupportedAction();
        bool valid;
        if (p.kind == WAIT || p.kind == BALANCE_ETH || p.kind == TASK_LIST) {
            valid = p.key == 0 && p.value.length == 0 && p.taskId == 0 && p.token == address(0);
        } else if (p.kind == BALANCE_TOKEN) {
            valid = p.key == 0 && p.value.length == 0 && p.taskId == 0 && allowedTokens[p.token];
        } else if (p.kind == MEM_SET) {
            valid = memoryKey(p.key) && slug(p.value) && p.taskId == 0 && p.token == address(0);
        } else if (p.kind == MEM_GET) {
            valid = memoryKey(p.key) && p.value.length == 0 && p.taskId == 0 && p.token == address(0);
        } else if (p.kind == TASK_ADD) {
            valid = p.key == 0 && slug(p.value) && p.taskId == 0 && p.token == address(0);
        } else if (p.kind == TASK_DONE) {
            valid = p.key == 0 && p.value.length == 0 && p.taskId >= 1 && p.taskId <= 9999 && p.token == address(0);
        } else if (p.kind == CLARIFY) {
            valid = (p.key == bytes32("asset") || p.key == bytes32("key") || p.key == bytes32("value")
                || p.key == bytes32("title") || p.key == bytes32("task_id") || p.key == bytes32("request"))
                && p.value.length == 0 && p.taskId == 0 && p.token == address(0);
        } else if (p.kind == REFUSE) {
            valid = (p.key == bytes32("unsupported") || p.key == bytes32("unauthorized") || p.key == bytes32("unsafe"))
                && p.value.length == 0 && p.taskId == 0 && p.token == address(0);
        }
        if (!valid) revert InvalidArguments();
        return true;
    }

    function memoryKey(bytes32 key) internal pure returns (bool) {
        return key == bytes32("theme") || key == bytes32("language") || key == bytes32("mode");
    }

    function slug(bytes calldata value) internal pure returns (bool) {
        if (value.length == 0 || value.length > 24 || value[0] < 0x61 || value[0] > 0x7a) return false;
        for (uint256 i = 1; i < value.length; ++i) {
            bytes1 c = value[i];
            if (!((c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x5f)) return false;
        }
        return true;
    }
}
