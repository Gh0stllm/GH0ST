import json
from pathlib import Path
import tempfile
import unittest

from s0ul.publish_campaign import publish


class PublicationTests(unittest.TestCase):
    def fixture(self, root):
        result = root / "runs" / "campaign"
        result.mkdir(parents=True)
        root.joinpath("BUILD-STATUS.md").write_text("# Build status\n")
        measurement = {"generation": {"examples": 360, "exact_action_and_arguments_accuracy": 0.5}}
        report = {"status": "completed_after_validation_only_selection",
                  "selection": {"test_used_for_selection": False, "selected_lane": "scratch-42", "selected_checkpoint_sha256": "a" * 64},
                  "selected_challenge": measurement, "baseline_challenge": measurement, "integer_challenge": measurement}
        result.joinpath("campaign-report.json").write_text(json.dumps(report))
        result.joinpath("SUMMARY.md").write_text("# Completed measurements\n")
        result.joinpath("checkpoint.pt").write_bytes(b"not-public-binary")
        return result

    def test_publish_copies_evidence_not_binary_and_preserves_history(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            result = self.fixture(root)
            publish(result, "123", "https://github.com/8tk8m2kv9f-lang/GH0ST/actions/runs/123", project_root=root)
            output = root / "reports" / "hour-123"
            self.assertTrue((output / "campaign-report.json").exists())
            self.assertFalse((output / "checkpoint.pt").exists())
            self.assertIn("same 360-request", (root / "BUILD-STATUS.md").read_text())
            with self.assertRaises(ValueError):
                publish(result, "123", "https://github.com/8tk8m2kv9f-lang/GH0ST/actions/runs/123", project_root=root)

    def test_incomplete_campaign_or_untrusted_target_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            result = self.fixture(root)
            with self.assertRaises(ValueError):
                publish(result, "../123", "https://example.org", project_root=root)
            path = result / "campaign-report.json"
            report = json.loads(path.read_text())
            report["status"] = "running"
            path.write_text(json.dumps(report))
            with self.assertRaises(ValueError):
                publish(result, "123", "https://github.com/8tk8m2kv9f-lang/GH0ST/actions/runs/123", project_root=root)
            self.assertFalse((root / "reports").exists())

    def test_two_hour_publication_uses_label_duration_and_safe_prefix(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            result = self.fixture(root)
            path = result / "campaign-report.json"
            report = json.loads(path.read_text())
            report["campaign_label"] = "two-hour hard"
            report["selection"]["ranked_candidates"] = [
                {"lane": f"lane-{index}", "duration_budget_seconds": 7200} for index in range(3)]
            path.write_text(json.dumps(report))
            url = "https://github.com/8tk8m2kv9f-lang/GH0ST/actions/runs/124"
            with self.assertRaisesRegex(ValueError, "publication-prefix"):
                publish(result, "124", url, project_root=root, publication_prefix="../hard")
            self.assertFalse((root / "reports").exists())
            publish(result, "124", url, project_root=root, publication_prefix="hard")
            destination = root / "reports/hard-124"
            self.assertTrue((destination / "SUMMARY.md").is_file())
            status = (root / "BUILD-STATUS.md").read_text()
            self.assertIn("Two-hour hard campaign", status)
            self.assertIn("7200 seconds", status)
            self.assertIn("reports/hard-124/SUMMARY.md", status)
            self.assertNotIn("one-hour", status)
            self.assertNotIn("original baseline", status)
            self.assertIn("Two-hour hard", (destination / "README.md").read_text())


if __name__ == "__main__":
    unittest.main()
