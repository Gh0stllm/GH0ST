// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.17;

import "src/challengeV2/EdgeChallengeManager.sol";

// Test-only assertion configuration. This is deliberately NOT a rollup or an
// assertion-confirmation test. It pins the exact context passed to the real OSP.
contract FixedAssertionConfig {
    bytes32 public immutable previousAssertion;
    bytes32 public immutable pinnedModule;
    address public manager;

    constructor(bytes32 previousAssertion_, bytes32 pinnedModule_) {
        previousAssertion = previousAssertion_;
        pinnedModule = pinnedModule_;
    }

    function setManager(address manager_) external {
        require(manager == address(0), "ALREADY_SET");
        manager = manager_;
    }

    function bridge() external pure returns (IBridge) { return IBridge(address(0)); }

    function validateConfig(bytes32 assertion, ConfigData calldata config) external view {
        require(assertion == previousAssertion, "WRONG_PREDECESSOR");
        require(config.wasmModuleRoot == pinnedModule, "WRONG_MODULE_CONTEXT");
        require(config.challengeManager == manager, "WRONG_MANAGER_CONTEXT");
        require(config.requiredStake == 0 && config.confirmPeriodBlocks == 1 && config.nextInboxPosition == 1000000, "WRONG_CONFIG");
    }
}

// The only additions to the pinned manager are fixture admission and getters.
// confirmEdgeByOneStepProof, config lookup, ancestor traversal, real verifier
// execution, edge status changes and rival exclusion are the inherited code.
// Ancestors and history siblings are seeded; no full-history bisection or
// assertion winner is established by this bounded regression.
contract TerminalChallengeHarness is EdgeChallengeManager {
    using ChallengeEdgeLib for ChallengeEdge;

    bytes32 public immutable fixturePreviousAssertion;
    uint256 public constant LEAF_HEIGHT = 1 << 20;

    constructor(address config, address osp, bytes32 previousAssertion) {
        assertionChain = IAssertionChain(config);
        oneStepProofEntry = IOneStepProofEntry(osp);
        NUM_BIGSTEP_LEVEL = 1;
        LAYERZERO_BLOCKEDGE_HEIGHT = 1;
        LAYERZERO_BIGSTEPEDGE_HEIGHT = 1 << 20;
        LAYERZERO_SMALLSTEPEDGE_HEIGHT = LEAF_HEIGHT;
        fixturePreviousAssertion = previousAssertion;
    }

    function seedTerminalRivals(
        bytes32 caseId,
        uint256 machineStep,
        bytes32 beforeRoot,
        bytes32 honestAfterRoot,
        bytes32 wrongAfterRoot
    ) external returns (bytes32 honestId, bytes32 wrongId) {
        bytes32 blockId = keccak256(abi.encode("fixture-block", caseId));
        bytes32 blockMutual = keccak256(abi.encode("fixture-block-mutual", caseId));
        bytes32 bigId = keccak256(abi.encode("fixture-big", caseId));
        bytes32 bigMutual = keccak256(abi.encode("fixture-big-mutual", caseId));
        // These are prelocalized ancestor fixtures, not claims produced by the
        // real block assertion/bisection lifecycle.
        store.edges[blockId] = ChallengeEdgeLib.newChildEdge(fixturePreviousAssertion, beforeRoot, 0, honestAfterRoot, 1, 0);
        store.firstRivals[blockMutual] = blockId;
        uint256 bigStart = machineStep / LEAF_HEIGHT;
        store.edges[bigId] = ChallengeEdgeLib.newChildEdge(blockMutual, beforeRoot, bigStart, honestAfterRoot, bigStart + 1, 1);
        store.firstRivals[bigMutual] = bigId;
        uint256 smallStart = machineStep % LEAF_HEIGHT;
        ChallengeEdge memory honest = ChallengeEdgeLib.newChildEdge(bigMutual, beforeRoot, smallStart, honestAfterRoot, smallStart + 1, 2);
        ChallengeEdge memory wrong = ChallengeEdgeLib.newChildEdge(bigMutual, beforeRoot, smallStart, wrongAfterRoot, smallStart + 1, 2);
        honestId = ChallengeEdgeLib.idMem(honest);
        wrongId = ChallengeEdgeLib.idMem(wrong);
        require(store.edges[honestId].createdAtBlock == 0, "CASE_ALREADY_SEEDED");
        store.edges[honestId] = honest;
        store.edges[wrongId] = wrong;
        store.firstRivals[ChallengeEdgeLib.mutualIdMem(honest)] = wrongId;
    }

    function fixtureStatus(bytes32 edgeId) external view returns (EdgeStatus) {
        return store.edges[edgeId].status;
    }

    function fixtureConfirmedRival(bytes32 edgeId) external view returns (bytes32) {
        return store.confirmedRivals[store.edges[edgeId].mutualId()];
    }
}
