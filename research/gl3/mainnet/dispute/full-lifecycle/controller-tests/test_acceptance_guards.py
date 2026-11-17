"""Adversarial controller regressions; execute only on the isolated Linux worker."""
import copy
import platform
from pathlib import Path
import sys
import unittest

if platform.system() != "Linux":
    raise RuntimeError("Run these regressions on Runpod Linux, never the local Mac")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from acceptance_guards import (AcceptanceError, validate_acceptance, validate_named_test, validate_reuse,
    validate_launch_prerequisites, SELECTED_ROOT, SELECTED_MACHINE, SELECTED_GUEST,
    SELECTED_COMPANION, SELECTED_INPUT, SELECTED_PROVER)


def h(n, size=32):
    return "0x" + n.to_bytes(size, "big").hex()


NAME = "TestGL3TerminalResultBoLDLifecycle"
GOOD_LOG = "=== RUN   " + NAME + "\nfixture output\n--- PASS: " + NAME + " (42.01s)\nPASS\n"


def evidence():
    target = {"BlockHash": h(4), "SendRoot": h(0), "Batch": 2470, "PosInBatch": 0}
    forged = {**target, "BlockHash": h(5)}
    run_id, module = "a" * 32, h(1)
    report = {"runID": run_id, "passed": True, "moduleRoot": module,
              "honestOneStepWinner": True, "assertionConfirmationPassed": True,
              "stakeSettlementPassed": True, "fullStrengthDecisionVerified": True,
              "allExecutionOnRunpod": True, "enginePolicyChanged": False,
              "publicDeployment": False, "honestLayerZeroRefunds": 1,
              "claimPairContentVerified": True, "strictAuditPassedBeforeCleanup": True,
              "strictAuditSHA256": "d" * 64,
              "targetHonestAssertion": h(21), "targetFalseAssertion": h(22),
              "targetParentAssertion": h(23), "expectedHonestHistory": h(24),
              "expectedFalseHistory": h(25), "refundEdge": h(8),
              "refundTransaction": h(33), "targetRefundAmount": "500000000000000000",
              "terminalComputeBlock": target["BlockHash"],
              "oneStepEdge": h(11), "oneStepTransaction": h(31)}
    pair = {"honest": h(21), "false": h(22), "parent": h(23),
            "honestHistory": h(24), "falseHistory": h(25), "honestSender": h(1, 20),
            "manager": h(2, 20), "rollup": h(3, 20), "actualTerminalGlobalsMatch": True,
            "sameBeforeStateAndBatch": True}
    audit = {"passed": True, "targetBound": True, "refundExact": True,
             "terminalInputBytesVerified": True, "runID": run_id,
             "moduleRoot": module, "terminalInputSHA256": "b" * 64,
             "terminalTransitionBinding": {"verified": True, "terminalBlockNumber": 4921,
                 "startHeight": "4920", "endHeight": "4921", "blockClaimEdge": h(10),
                 "machineSubchallengeRoot": h(12), "oneStepEdge": h(11), "oneStepTransaction": h(31)},
             "terminal": target.copy(), "forgedTerminal": forged,
             "pair": pair, "targetRootEdges": {"honest": [h(8)], "false": [h(9)]},
             "boundOneStepEvents": [{"edge": h(11), "transaction": h(31),
                 "order": ["11", "0", "0"], "receiptStatus": "0x1",
                 "path": [{"from": h(8), "to": h(10), "kind": "bisection-upper"},
                          {"from": h(10), "to": h(12), "kind": "subchallenge-claim"},
                          {"from": h(12), "to": h(11), "kind": "bisection-upper"}]}],
             "boundConfirmations": [{"hash": h(21), "transaction": h(32), "order": ["12", "0", "0"]}],
             "assertionStates": {"honest": {"status": "2"}, "false": {"status": "1"}},
             "boundCollateralRefunds": [{"edge": h(8), "level": "0", "transaction": h(33),
                 "stakeToken": h(4, 20), "amount": "500000000000000000", "receiver": h(1, 20),
                 "exactTransfer": True, "blockBalancesReconcile": True,
                 "order": ["13", "0", "0"], "path": []}],
             "completeAssertionBondSettlementAudited": False}
    terminal = {"runID": run_id, "SHA256": "b" * 64, "bytes": 2574999906, "blockNumber": 4921,
                "moduleRoot": module, "expectedEndState": target.copy()}
    return dict(test_exit=0, test_log=GOOD_LOG, report=report, audit_exit=0, audit=audit,
                terminal=terminal, run_id=run_id, module_root=module,
                completion={"completed": True, "runID": run_id, "moduleRoot": module,
                            "auditExitCode": 0, "strictAuditSHA256": "d" * 64}, audit_sha256="d" * 64)


class AcceptanceTests(unittest.TestCase):
    def test_fresh_exact_terminal_edge_lifecycle_is_accepted_at_bounded_scope(self):
        result = validate_acceptance(**evidence())
        self.assertIs(result["passed"], True)
        self.assertIn("no assertion-stake withdrawal", result["scope"])
        self.assertIn("production acceptance", result["scope"])

    def test_manifest_canonical_uint64_strings_remain_supported(self):
        e = evidence()
        for target in [e["terminal"]["expectedEndState"], e["audit"]["terminal"], e["audit"]["forgedTerminal"]]:
            target["Batch"], target["PosInBatch"] = "2470", "0"
        self.assertTrue(validate_acceptance(**e)["passed"])

    def test_integer_transition_heights_remain_supported(self):
        e = evidence()
        e["audit"]["terminalTransitionBinding"].update(startHeight=4920, endHeight=4921)
        self.assertTrue(validate_acceptance(**e)["passed"])


def rejection_case(mutate):
    def test(self):
        e = evidence()
        mutate(e)
        with self.assertRaises(AcceptanceError):
            validate_acceptance(**e)
    return test


REJECTIONS = {
    "missing_precleanup_completion": lambda e: e.update(completion=None),
    "completion_not_completed": lambda e: e["completion"].update(completed=False),
    "completion_truthy_completed": lambda e: e["completion"].update(completed="true"),
    "completion_missing_exit": lambda e: e["completion"].pop("auditExitCode"),
    "completion_boolean_exit": lambda e: e["completion"].update(auditExitCode=False),
    "completion_nonzero_exit": lambda e: e["completion"].update(auditExitCode=1),
    "completion_stale_nonce": lambda e: e["completion"].update(runID="f" * 32),
    "completion_wrong_root": lambda e: e["completion"].update(moduleRoot=h(99)),
    "completion_different_audit_bytes": lambda e: e["completion"].update(strictAuditSHA256="e" * 64),
    "fixture_different_audit_bytes": lambda e: e["report"].update(strictAuditSHA256="e" * 64),
    "audit_file_digest_missing": lambda e: e.update(audit_sha256=None),
    "fixture_not_content_classified": lambda e: e["report"].update(claimPairContentVerified=False),
    "fixture_cleanup_before_audit": lambda e: e["report"].update(strictAuditPassedBeforeCleanup=False),
    "manifest_stale_nonce": lambda e: e["terminal"].update(runID="f" * 32),
    "fixture_different_honest_claim": lambda e: e["report"].update(targetHonestAssertion=h(99)),
    "fixture_different_false_claim": lambda e: e["report"].update(targetFalseAssertion=h(99)),
    "fixture_different_parent_claim": lambda e: e["report"].update(targetParentAssertion=h(99)),
    "fixture_different_honest_history": lambda e: e["report"].update(expectedHonestHistory=h(99)),
    "fixture_different_false_history": lambda e: e["report"].update(expectedFalseHistory=h(99)),
    "fixture_different_refund_transaction": lambda e: e["report"].update(refundTransaction=h(99)),
    "fixture_different_refund_edge": lambda e: e["report"].update(refundEdge=h(99)),
    "fixture_different_refund_amount": lambda e: e["report"].update(targetRefundAmount="3"),
    "transition_different_block_claim": lambda e: e["audit"]["terminalTransitionBinding"].update(blockClaimEdge=h(99)),
    "transition_different_machine_root": lambda e: e["audit"]["terminalTransitionBinding"].update(machineSubchallengeRoot=h(99)),
    "transition_different_one_step": lambda e: e["audit"]["terminalTransitionBinding"].update(oneStepEdge=h(99)),
    "transition_different_proof_transaction": lambda e: e["audit"]["terminalTransitionBinding"].update(oneStepTransaction=h(99)),
    "nonzero_test_exit": lambda e: e.update(test_exit=1),
    "boolean_test_exit": lambda e: e.update(test_exit=False),
    "missing_named_test": lambda e: e.update(test_log="testing: warning: no tests to run\nPASS\n"),
    "different_named_test": lambda e: e.update(test_log=GOOD_LOG.replace(NAME, NAME + "Other")),
    "skipped_named_test_exit_zero": lambda e: e.update(test_log=GOOD_LOG.replace("--- PASS:", "--- SKIP:")),
    "failed_named_test_exit_zero": lambda e: e.update(test_log=GOOD_LOG.replace("--- PASS:", "--- FAIL:")),
    "failed_subtest_then_passed_parent": lambda e: e.update(test_log=GOOD_LOG.replace("fixture output", "    --- FAIL: " + NAME + "/child (1.00s)")),
    "skipped_subtest_then_passed_parent": lambda e: e.update(test_log=GOOD_LOG.replace("fixture output", "    --- SKIP: " + NAME + "/child (1.00s)")),
    "pass_line_without_run": lambda e: e.update(test_log=GOOD_LOG.split("\n", 1)[1]),
    "run_line_without_completion": lambda e: e.update(test_log="=== RUN   " + NAME + "\nPASS\n"),
    "duplicate_run_log": lambda e: e.update(test_log=GOOD_LOG + GOOD_LOG),
    "missing_final_go_pass": lambda e: e.update(test_log=GOOD_LOG.removesuffix("PASS\n")),
    "package_failed_exit_zero": lambda e: e.update(test_log=GOOD_LOG + "FAIL\n"),
    "stale_prior_fixture_report": lambda e: e["report"].update(runID="c" * 32),
    "missing_fixture_run_id": lambda e: e["report"].pop("runID"),
    "stale_audit_report": lambda e: e["audit"].update(runID="c" * 32),
    "no_run_nonce": lambda e: e.update(run_id=""),
    "missing_audit": lambda e: e.update(audit=None),
    "auditor_failed_exit": lambda e: e.update(audit_exit=1),
    "auditor_exit_unavailable": lambda e: e.update(audit_exit=None),
    "auditor_pending": lambda e: e["audit"].update(passed=False),
    "truthy_audit_pass_string": lambda e: e["audit"].update(passed="true"),
    "target_not_bound": lambda e: e["audit"].update(targetBound=False),
    "input_not_independently_hashed": lambda e: e["audit"].update(terminalInputBytesVerified=False),
    "wrong_terminal_input_digest": lambda e: e["audit"].update(terminalInputSHA256="c" * 64),
    "missing_terminal_input_digest": lambda e: e["audit"].pop("terminalInputSHA256"),
    "audit_module_mismatch": lambda e: e["audit"].update(moduleRoot=h(2)),
    "fixture_module_mismatch": lambda e: e["report"].update(moduleRoot=h(2)),
    "manifest_module_mismatch": lambda e: e["terminal"].update(moduleRoot=h(2)),
    "missing_terminal_transition_binding": lambda e: e["audit"].pop("terminalTransitionBinding"),
    "unverified_terminal_transition": lambda e: e["audit"]["terminalTransitionBinding"].update(verified=False),
    "truthy_transition_verification": lambda e: e["audit"]["terminalTransitionBinding"].update(verified="true"),
    "transition_for_another_terminal_block": lambda e: e["audit"]["terminalTransitionBinding"].update(terminalBlockNumber=4920),
    "nonterminal_disputed_interval": lambda e: e["audit"]["terminalTransitionBinding"].update(startHeight="4919", endHeight="4920"),
    "two_block_disputed_interval": lambda e: e["audit"]["terminalTransitionBinding"].update(startHeight="4919"),
    "same_block_disputed_interval": lambda e: e["audit"]["terminalTransitionBinding"].update(startHeight="4921"),
    "transition_end_after_terminal_block": lambda e: e["audit"]["terminalTransitionBinding"].update(endHeight="4922"),
    "missing_transition_start": lambda e: e["audit"]["terminalTransitionBinding"].pop("startHeight"),
    "missing_manifest_terminal_number": lambda e: e["terminal"].pop("blockNumber"),
    "boolean_manifest_terminal_number": lambda e: e["terminal"].update(blockNumber=True),
    "negative_transition_height": lambda e: e["audit"]["terminalTransitionBinding"].update(startHeight="-1"),
    "noncanonical_transition_height": lambda e: e["audit"]["terminalTransitionBinding"].update(startHeight="04920"),
    "out_of_range_transition_height": lambda e: e["audit"]["terminalTransitionBinding"].update(endHeight=str(2**64)),
    "other_terminal_block_target": lambda e: e["audit"]["terminal"].update(BlockHash=h(12)),
    "other_terminal_batch_target": lambda e: e["audit"]["terminal"].update(Batch=2471),
    "incomplete_four_global_fields": lambda e: e["terminal"]["expectedEndState"].pop("SendRoot"),
    "boolean_uint64": lambda e: e["terminal"]["expectedEndState"].update(Batch=True),
    "out_of_range_uint64": lambda e: e["terminal"]["expectedEndState"].update(Batch=2**64),
    "fixture_terminal_mismatch": lambda e: e["report"].update(terminalComputeBlock=h(12)),
    "wrong_false_claim_mutation": lambda e: e["audit"]["forgedTerminal"].update(BlockHash=h(14)),
    "missing_bound_pair": lambda e: e["audit"].pop("pair"),
    "different_predecessor": lambda e: e["audit"]["pair"].update(sameBeforeStateAndBatch=False),
    "same_rival_assertion": lambda e: e["audit"]["pair"].update(false=h(21)),
    "missing_honest_root": lambda e: e["audit"]["targetRootEdges"].update(honest=[]),
    "multiple_honest_roots": lambda e: e["audit"]["targetRootEdges"].update(honest=[h(8), h(18)]),
    "missing_one_step_proof": lambda e: e["audit"].update(boundOneStepEvents=[]),
    "unrelated_one_step_proof": lambda e: e["audit"]["boundOneStepEvents"][0]["path"][0].update(**{"from": h(99)}),
    "failed_one_step_receipt": lambda e: e["audit"]["boundOneStepEvents"][0].update(receiptStatus="0x0"),
    "fixture_won_unrelated_one_step": lambda e: e["report"].update(oneStepTransaction=h(99)),
    "false_target_confirmed": lambda e: e["audit"]["assertionStates"]["false"].update(status="2"),
    "honest_target_unconfirmed": lambda e: e["audit"]["assertionStates"]["honest"].update(status="1"),
    "unrelated_assertion_confirmation": lambda e: e["audit"]["boundConfirmations"][0].update(hash=h(99)),
    "confirmation_before_proof": lambda e: e["audit"]["boundConfirmations"][0].update(order=["10", "0", "0"]),
    "missing_assertion_confirmation": lambda e: e["audit"].update(boundConfirmations=[]),
    "refund_not_exact": lambda e: e["audit"].update(refundExact=False),
    "missing_collateral_refund": lambda e: e["audit"].update(boundCollateralRefunds=[]),
    "zero_collateral_refund": lambda e: e["audit"]["boundCollateralRefunds"][0].update(amount="0"),
    "negative_collateral_refund": lambda e: e["audit"]["boundCollateralRefunds"][0].update(amount="-1"),
    "wrong_refund_recipient": lambda e: e["audit"]["boundCollateralRefunds"][0].update(receiver=h(7, 20)),
    "refund_transfer_not_exact": lambda e: e["audit"]["boundCollateralRefunds"][0].update(exactTransfer=False),
    "refund_balances_do_not_reconcile": lambda e: e["audit"]["boundCollateralRefunds"][0].update(blockBalancesReconcile=False),
    "refund_before_confirmation": lambda e: e["audit"]["boundCollateralRefunds"][0].update(order=["11", "0", "0"]),
    "refund_not_root_bound": lambda e: e["audit"]["boundCollateralRefunds"][0].update(edge=h(99)),
    "no_audited_layer_zero_refund": lambda e: e["audit"]["boundCollateralRefunds"][0].update(level="1"),
    "no_fixture_refund": lambda e: e["report"].update(honestLayerZeroRefunds=0),
    "engine_policy_changed": lambda e: e["report"].update(enginePolicyChanged=True),
    "strength_not_verified": lambda e: e["report"].update(fullStrengthDecisionVerified=False),
}
for name, mutate in REJECTIONS.items():
    setattr(AcceptanceTests, "test_reject_" + name, rejection_case(mutate))


class BuildReuseTests(unittest.TestCase):
    def setUp(self):
        self.inputs = {"nitro/system_tests/fixture.go": "a" * 64,
                       "nitro/arbos/engine.go": "b" * 64,
                       "engine/stockfish.cpp": "c" * 64,
                       "engine/network.nnue": "d" * 64,
                       "env/GOFLAGS": "", "env/CGO_CFLAGS": "-O2",
                       "buildOptions": "tags=gl3_acceptance,challengetest"}
        self.manifest = {"buildCompleted": True, "buildExitCode": 0,
                         "compiledInputs": copy.deepcopy(self.inputs), "binarySHA256": "e" * 64}

    def test_identical_completed_compiler_and_binary_can_be_reused(self):
        validate_reuse(self.manifest, self.inputs, "e" * 64)

    def test_each_compiled_source_or_environment_change_forces_rebuild(self):
        for key in self.inputs:
            with self.subTest(key=key):
                changed = {**self.inputs, key: "different"}
                with self.assertRaises(AcceptanceError):
                    validate_reuse(self.manifest, changed, "e" * 64)

    def test_added_or_removed_source_forces_rebuild(self):
        for changed in [{**self.inputs, "engine/new.cpp": "f" * 64},
                        {k: v for k, v in self.inputs.items() if not k.endswith("fixture.go")}]:
            with self.subTest(changed=changed):
                with self.assertRaises(AcceptanceError):
                    validate_reuse(self.manifest, changed, "e" * 64)

    def test_modified_binary_forces_rebuild(self):
        with self.assertRaises(AcceptanceError):
            validate_reuse(self.manifest, self.inputs, "f" * 64)

    def test_legacy_unproven_build_manifest_cannot_reuse(self):
        self.manifest.pop("buildCompleted")
        with self.assertRaises(AcceptanceError):
            validate_reuse(self.manifest, self.inputs, "e" * 64)

    def test_failed_build_cannot_reuse(self):
        self.manifest["buildExitCode"] = 1
        with self.assertRaises(AcceptanceError):
            validate_reuse(self.manifest, self.inputs, "e" * 64)

    def test_empty_compiled_snapshot_cannot_reuse(self):
        self.manifest["compiledInputs"] = {}
        with self.assertRaises(AcceptanceError):
            validate_reuse(self.manifest, {}, "e" * 64)


def launch_evidence():
    end = ["0x8d33a6345311761aef5c7ee9e5528350f17beda843d0563cfdd103aeec70d738",
           "0x" + "00" * 32, "2470", "0"]
    interpreter = {"passed": True, "exitCode": 0, "timedOut": False,
        "machineFinished": True, "allFourGlobalStateFieldsMatch": True,
        "actualEnd": end.copy(), "expectedEnd": end.copy(), "moduleRoot": SELECTED_ROOT,
        "machineSHA256": SELECTED_MACHINE, "guestWasmSHA256": SELECTED_GUEST,
        "companionSHA256": SELECTED_COMPANION, "inputSHA256": SELECTED_INPUT,
        "proverSHA256": SELECTED_PROVER, "rawExactFinalSteps": 1000, "rawCounterPlusOne": 1001}
    geometry = {"reviewed": True, "finishedAbsorbingTransitionReviewed": True,
        "kickoffOffsetBindingReviewed": True, "sameSelectedBackendWitnessesReviewed": True,
        "moduleRoot": SELECTED_ROOT, "machineSHA256": SELECTED_MACHINE,
        "interpreterResultSHA256": "a" * 64, "blockHeight": 8192, "numBigStepLevels": 3,
        "bigStepHeight": 1024, "smallStepHeight": 1024,
        "levelHeights": [8192, 1024, 1024, 1024, 1024], "stepsPerBlockCapacity": 2**40,
        "rawExactFinalSteps": 1000, "rawCounterPlusOne": 1001, "kickoffOffset": 1}
    authorization = {"authorized": True, "scope": "PRIVATE_SELECTED_865_LIFECYCLE_ONLY",
        "moduleRoot": SELECTED_ROOT, "interpreterResultSHA256": "a" * 64,
        "geometryReviewSHA256": "b" * 64}
    return dict(interpreter=interpreter, geometry=geometry, authorization=authorization,
                interpreter_sha256="a" * 64, geometry_sha256="b" * 64)


class LaunchPrerequisiteTests(unittest.TestCase):
    def test_exact_reviewed_receipts_allow_only_a_future_private_launch(self):
        result = validate_launch_prerequisites(**launch_evidence())
        self.assertIs(result["passed"], True)
        self.assertIn("not that lifecycle's acceptance", result["scope"])

    def test_finished_boundary_plus_kickoff_at_exact_capacity_is_supported(self):
        e = launch_evidence()
        for k in ["interpreter", "geometry"]:
            e[k].update(rawExactFinalSteps=2**40 - 1, rawCounterPlusOne=2**40)
        self.assertTrue(validate_launch_prerequisites(**e)["passed"])


LAUNCH_REJECTIONS = {
    "interpreter_running": lambda e: e["interpreter"].update(passed=False),
    "interpreter_no_actual_exit": lambda e: e["interpreter"].pop("exitCode"),
    "interpreter_boolean_exit": lambda e: e["interpreter"].update(exitCode=False),
    "interpreter_failed_exit": lambda e: e["interpreter"].update(exitCode=1),
    "interpreter_timed_out": lambda e: e["interpreter"].update(timedOut=True),
    "interpreter_not_finished": lambda e: e["interpreter"].update(machineFinished=False),
    "interpreter_not_all_four": lambda e: e["interpreter"].update(allFourGlobalStateFieldsMatch=False),
    "old_module_root": lambda e: e["interpreter"].update(moduleRoot=h(99)),
    "changed_machine": lambda e: e["interpreter"].update(machineSHA256="c" * 64),
    "changed_go_guest": lambda e: e["interpreter"].update(guestWasmSHA256="c" * 64),
    "changed_companion": lambda e: e["interpreter"].update(companionSHA256="c" * 64),
    "changed_input": lambda e: e["interpreter"].update(inputSHA256="c" * 64),
    "diagnostic_tool_in_place_of_interpreter": lambda e: e["interpreter"].update(proverSHA256="c" * 64),
    "different_global_field": lambda e: e["interpreter"]["actualEnd"].__setitem__(3, "1"),
    "different_original_global": lambda e: (e["interpreter"].update(actualEnd=[h(2), h(0), "2470", "0"], expectedEnd=[h(2), h(0), "2470", "0"])),
    "zero_counter": lambda e: e["interpreter"].update(rawExactFinalSteps=0),
    "sampled_counter_string": lambda e: e["interpreter"].update(rawExactFinalSteps="1000"),
    "wrong_plus_one": lambda e: e["interpreter"].update(rawCounterPlusOne=1002),
    "plus_one_outside_uint64": lambda e: e["interpreter"].update(rawCounterPlusOne=2**64),
    "unreviewed_geometry": lambda e: e["geometry"].update(reviewed=False),
    "unreviewed_finished_self_transition": lambda e: e["geometry"].update(finishedAbsorbingTransitionReviewed=False),
    "unreviewed_kickoff_offset": lambda e: e["geometry"].update(kickoffOffsetBindingReviewed=False),
    "unreviewed_selected_witnesses": lambda e: e["geometry"].update(sameSelectedBackendWitnessesReviewed=False),
    "stale_geometry_module": lambda e: e["geometry"].update(moduleRoot=h(99)),
    "stale_geometry_machine": lambda e: e["geometry"].update(machineSHA256="c" * 64),
    "different_interpreter_receipt": lambda e: e["geometry"].update(interpreterResultSHA256="c" * 64),
    "different_block_height": lambda e: e["geometry"].update(blockHeight=4096),
    "different_big_level_count": lambda e: e["geometry"].update(numBigStepLevels=2),
    "different_big_height": lambda e: e["geometry"].update(bigStepHeight=512),
    "different_small_height": lambda e: e["geometry"].update(smallStepHeight=512),
    "missing_final_small_level": lambda e: e["geometry"].update(levelHeights=[8192, 1024, 1024, 1024]),
    "drift_only_actual_final_small_level": lambda e: e["geometry"].update(levelHeights=[8192, 1024, 1024, 1024, 512]),
    "floating_geometry": lambda e: e["geometry"].update(bigStepHeight=1024.0),
    "floating_capacity": lambda e: e["geometry"].update(stepsPerBlockCapacity=float(2**40)),
    "wrong_capacity": lambda e: e["geometry"].update(stepsPerBlockCapacity=2**50),
    "geometry_wrong_counter": lambda e: e["geometry"].update(rawExactFinalSteps=1001),
    "boolean_kickoff": lambda e: e["geometry"].update(kickoffOffset=True),
    "zero_kickoff": lambda e: e["geometry"].update(kickoffOffset=0),
    "missing_authorization": lambda e: e.update(authorization={}),
    "different_authorization_scope": lambda e: e["authorization"].update(scope="MAINNET"),
    "authorization_stale_root": lambda e: e["authorization"].update(moduleRoot=h(99)),
    "authorization_stale_interpreter": lambda e: e["authorization"].update(interpreterResultSHA256="c" * 64),
    "authorization_stale_geometry": lambda e: e["authorization"].update(geometryReviewSHA256="c" * 64),
    "truthy_authorized": lambda e: e["authorization"].update(authorized="true"),
}

def launch_rejection_case(mutate):
    def test(self):
        e = launch_evidence(); mutate(e)
        with self.assertRaises(AcceptanceError): validate_launch_prerequisites(**e)
    return test

for name, mutate in LAUNCH_REJECTIONS.items():
    setattr(LaunchPrerequisiteTests, "test_reject_" + name, launch_rejection_case(mutate))

# This is only a synthetic arithmetic boundary test, never a real step receipt.
def _overflow(e):
    for k in ["interpreter", "geometry"]:
        e[k].update(rawExactFinalSteps=2**40, rawCounterPlusOne=2**40 + 1)
setattr(LaunchPrerequisiteTests, "test_reject_capacity_overflow_after_kickoff", launch_rejection_case(_overflow))

if __name__ == "__main__":
    unittest.main(verbosity=2)
