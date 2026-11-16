import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from plan_guard import validate


class ReleaseBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.plan = json.loads(Path(__file__).with_name("plan.example.json").read_text())

    def test_rehearsal_is_not_a_production_release(self):
        result = validate(self.plan)
        self.assertTrue(result["validForRequestedMode"])
        self.assertFalse(result["productionReady"])
        self.assertFalse(result["wouldStartServices"])

    def test_mainnet_requires_funding_proof_and_custom_artifacts(self):
        result = validate(self.plan, mode="mainnet")
        self.assertFalse(result["validForRequestedMode"])
        text = " ".join(result["errors"])
        for value in ["unsupported", "hosting authorization", "bond authorization", "custom engine", "matching prover", "twentyGameCostAndLatencyVerified"]:
            self.assertIn(value, text)

    def test_wrong_parent_fails_before_launch(self):
        self.plan["parentChainId"] = 1
        self.assertIn("parent must be Robinhood mainnet chain4663", validate(self.plan)["errors"])

    def test_strength_changes_and_missing_state_are_rejected(self):
        for field, value in [("nodes", 100000), ("nnueBytes", 1), ("threads", 4), ("retainedState", "reset per move")]:
            plan = copy.deepcopy(self.plan)
            plan["enginePolicy"][field] = value
            self.assertFalse(validate(plan)["validForRequestedMode"])

    def test_checkboxes_and_artifact_paths_cannot_bypass_mainnet_block(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact = root / "fixture.bin"
            artifact.write_bytes(b"fixture-not-a-prover")
            rec = {"path": "fixture.bin", "sha256": hashlib.sha256(artifact.read_bytes()).hexdigest()}
            self.plan.update({"childChainId": 123456, "hostingApproval": "fixture", "validatorBondApproval": "fixture",
                              "chainConfig": rec, "customEngineArtifact": rec, "matchingProverArtifact": rec})
            self.plan["evidence"] = {key: True for key in self.plan["evidence"]}
            result = validate(self.plan, root, "mainnet")
            self.assertEqual(result["errors"], ["mainnet start is unsupported by this research-only bundle"])

    def test_invalid_prover_bytes_are_detected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "prover.bin").write_bytes(b"wrong")
            self.plan["matchingProverArtifact"] = {"path": "prover.bin", "sha256": "0" * 64}
            self.assertIn("matching prover SHA256 mismatch", validate(self.plan, root, "mainnet")["errors"])

    def test_public_admin_or_fake_independence_are_rejected(self):
        for field, value in [("publicAdminRPC", True), ("publicMetrics", True), ("sameHostRolesAreIndependent", True)]:
            plan = copy.deepcopy(self.plan)
            plan["operator"][field] = value
            self.assertFalse(validate(plan)["validForRequestedMode"])

    def test_hard_cap_changes_are_rejected(self):
        self.plan["financialCaps"]["totalICP"] = "1250"
        self.assertFalse(validate(self.plan)["validForRequestedMode"])


if __name__ == "__main__":
    unittest.main()
