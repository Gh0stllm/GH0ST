"""Adversarial controller regressions; execute only on the isolated Linux worker."""
import copy
import platform
from pathlib import Path
import sys
import unittest

if platform.system() != "Linux":
    raise RuntimeError("Run these regressions on Runpod Linux, never the local Mac")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from acceptance_guards import AcceptanceError, validate_acceptance, validate_named_test, validate_reuse


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
                                           "startHeight": "4920", "endHeight": "4921"},
             "terminal": target.copy(), "forgedTerminal": forged,
             "pair": pair, "targetRootEdges": {"honest": [h(8)], "false": [h(9)]},
             "boundOneStepEvents": [{"edge": h(11), "transaction": h(31),
                 "order": ["11", "0", "0"], "receiptStatus": "0x1",
                 "path": [{"from": h(8), "to": h(11), "kind": "bisection-upper"}]}],
             "boundConfirmations": [{"hash": h(21), "transaction": h(32), "order": ["12", "0", "0"]}],
             "assertionStates": {"honest": {"status": "2"}, "false": {"status": "1"}},
             "boundCollateralRefunds": [{"edge": h(8), "level": "0", "transaction": h(33),
                 "stakeToken": h(4, 20), "amount": "500000000000000000", "receiver": h(1, 20),
                 "exactTransfer": True, "blockBalancesReconcile": True,
                 "order": ["13", "0", "0"], "path": []}],
             "completeAssertionBondSettlementAudited": False}
    terminal = {"SHA256": "b" * 64, "bytes": 2574999906, "blockNumber": 4921,
                "moduleRoot": module, "expectedEndState": target.copy()}
    return dict(test_exit=0, test_log=GOOD_LOG, report=report, audit_exit=0, audit=audit,
                terminal=terminal, run_id=run_id, module_root=module)


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


if __name__ == "__main__":
    unittest.main(verbosity=2)
