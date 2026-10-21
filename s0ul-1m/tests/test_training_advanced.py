import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest

import torch

from s0ul.model import ModelConfig, S0ULModel
from s0ul.train_advanced import HardReplay, response_losses, balanced_selection, build_parser, learning_rate_for_step, learning_rate_for_elapsed, make_optimizer, run_training


class AdvancedTrainingTests(unittest.TestCase):
    def records(self, path):
        path.mkdir()
        for split, prompts in (("train", ("Check my ETH balance.", "Read GH0ST for me.", "Do nothing.", "Wait.")),
                               ("validation", ("Get my ETH balance.", "Never act."))):
            rows = [{"id": f"{split}-{i}", "split": split, "prompt": prompt,
                     "response": "BALANCE|SELF|ETH" if i < (2 if split == "train" else 1) else "WAIT"}
                    for i, prompt in enumerate(prompts)]
            (path / f"{split}.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))
        # Any accidental test read would fail JSON parsing immediately.
        (path / "test.jsonl").write_text("THIS FILE MUST NEVER BE READ")

    def args(self, data, output, *extra):
        return build_parser().parse_args([
            "--data", str(data), "--output", str(output), "--steps", "6", "--batch-size", "2",
            "--threads", "1", "--eval-every", "2", "--warmup-steps", "1", "--seed", "17",
            "--selection-examples", "2", "--patience", "0", *extra])

    def test_schedule_endpoints_and_norm_decay_groups(self):
        self.assertEqual(learning_rate_for_step(1, 10, 2, 0.001, 0.1), 0.0005)
        self.assertEqual(learning_rate_for_step(2, 10, 2, 0.001, 0.1), 0.001)
        self.assertAlmostEqual(learning_rate_for_step(10, 10, 2, 0.001, 0.1), 0.0001)
        model = S0ULModel(ModelConfig(dim=16, n_layers=1, n_heads=2, hidden_dim=32))
        optimizer = make_optimizer(model, 0.001, 0.01)
        groups = {group["weight_decay"]: group["params"] for group in optimizer.param_groups}
        self.assertTrue(all(parameter.ndim >= 2 for parameter in groups[0.01]))
        self.assertTrue(all(parameter.ndim == 1 for parameter in groups[0.0]))
        self.assertEqual(sum(len(group["params"]) for group in optimizer.param_groups), len(list(model.parameters())))

    def test_balanced_subset_is_deterministic_and_covers_classes(self):
        rows = [{"id": f"{action}-{i}", "response": action} for action in ("WAIT", "REFUSE|unsafe", "TASK_LIST|SELF") for i in range(5)]
        first = balanced_selection(rows, 6, 42)
        self.assertEqual(first, balanced_selection(rows, 6, 42))
        self.assertEqual({action: sum(row["response"] == action for row in first)
                          for action in ("WAIT", "REFUSE|unsafe", "TASK_LIST|SELF")},
                         {"WAIT": 2, "REFUSE|unsafe": 2, "TASK_LIST|SELF": 2})
        with self.assertRaises(ValueError):
            balanced_selection(rows, 2, 42)

    def test_elapsed_schedule_and_real_short_duration(self):
        self.assertEqual(learning_rate_for_elapsed(5, 100, 10, 0.001, 0.1), 0.0005)
        self.assertEqual(learning_rate_for_elapsed(10, 100, 10, 0.001, 0.1), 0.001)
        self.assertAlmostEqual(learning_rate_for_elapsed(100, 100, 10, 0.001, 0.1), 0.0001)
        config = ModelConfig(dim=16, n_layers=1, n_heads=2, hidden_dim=32)
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            root = Path(directory)
            self.records(root / "data")
            report = run_training(self.args(root / "data", root / "timed", "--steps", "1000000",
                                           "--duration-seconds", "0.08", "--warmup-seconds", "0.01"), model_config=config)
            self.assertEqual(report["status"], "duration_completed")
            self.assertGreaterEqual(report["elapsed_seconds"], 0.08)
            self.assertTrue(report["duration_budget_complete"])
            self.assertFalse(report["planned_schedule_complete"])
            self.assertGreater(report["timings"]["validation_seconds"], 0)
            self.assertGreaterEqual(report["timings"]["optimizer_compute_seconds"], 0)

    def test_hard_replay_uses_training_loss_and_retains_uniform_coverage(self):
        import random
        replay = HardReplay(6, fraction=0.5, size=2)
        replay.observe([0, 1, 2, 3], [1.0, 3.0, 2.0, 4.0])
        replay.refresh()
        self.assertEqual(replay.pool, [3, 1])
        # Every batch has exactly half uniform draws with an unchanged RNG stream.
        first_rng, expected_rng = random.Random(13), random.Random(13)
        sampled = replay.sample(first_rng, 10)
        expected_uniform = [expected_rng.randrange(6) for _ in range(5)]
        self.assertEqual(sampled[:5], expected_uniform)
        self.assertTrue(set(sampled[5:]) <= {1, 3})
        replay.observe([3], [0.0])
        self.assertAlmostEqual(replay.scores[3], 3.6)
        restored = HardReplay(6, fraction=0.5, size=2)
        restored.load_state_dict(replay.state_dict())
        self.assertEqual(restored.state_dict(), replay.state_dict())
        with self.assertRaises(ValueError):
            replay.observe([0], [float("nan")])

    def test_response_losses_ignore_prompt_and_padding(self):
        logits = torch.tensor([[[0., 0.], [0., 5.], [5., 0.]],
                               [[5., 0.], [0., 0.], [0., 0.]]])
        targets = torch.tensor([[-100, 1, 0], [0, -100, -100]])
        loss = response_losses(logits, targets)
        expected = torch.nn.functional.cross_entropy(torch.tensor([[0., 5.]]), torch.tensor([1]))
        self.assertTrue(torch.allclose(loss, torch.tensor([expected, expected])))
        with self.assertRaises(ValueError):
            response_losses(logits, torch.full_like(targets, -100))

    def test_hard_training_options_reject_invalid_values(self):
        config = ModelConfig(dim=16, n_layers=1, n_heads=2, hidden_dim=32)
        for flag, value in (("--label-smoothing", "1"), ("--label-smoothing", "-0.1"),
                            ("--hard-replay-fraction", "0.6"), ("--hard-replay-size", "0")):
            with self.assertRaises(ValueError):
                run_training(self.args("unused", "unused", flag, value), model_config=config)

    def test_resume_matches_uninterrupted_optimizer_rng_and_weights(self):
        self._assert_resume_matches()

    def test_resume_with_hard_replay_and_label_smoothing_matches_exactly(self):
        self._assert_resume_matches("--hard-replay-fraction", "0.5", "--hard-replay-size", "2",
                                    "--label-smoothing", "0.05")

    def _assert_resume_matches(self, *extra):
        config = ModelConfig(dim=16, n_layers=1, n_heads=2, hidden_dim=32)
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            root = Path(directory)
            self.records(root / "data")
            complete = run_training(self.args(root / "data", root / "complete", *extra), model_config=config)
            interrupted = run_training(self.args(root / "data", root / "partial", "--max-run-steps", "3", *extra), model_config=config)
            self.assertEqual(interrupted["status"], "interrupted")
            self.assertFalse(interrupted["planned_schedule_complete"])
            resumed = run_training(self.args(root / "data", root / "resumed", "--resume",
                                            str(root / "partial" / "last-training-state.pt"), *extra), model_config=config)
            self.assertTrue(resumed["planned_schedule_complete"])
            self.assertFalse(resumed["test_read_or_used_for_selection"])
            left = torch.load(root / "complete" / "last-training-state.pt", weights_only=True)
            right = torch.load(root / "resumed" / "last-training-state.pt", weights_only=True)
            for name in left["model_state_dict"]:
                self.assertTrue(torch.equal(left["model_state_dict"][name], right["model_state_dict"][name]), name)
            for parameter_id in left["optimizer_state_dict"]["state"]:
                for field, value in left["optimizer_state_dict"]["state"][parameter_id].items():
                    self.assertTrue(torch.equal(value, right["optimizer_state_dict"]["state"][parameter_id][field]))
            self.assertEqual(left["rng_state"]["python_sampler"], right["rng_state"]["python_sampler"])
            self.assertTrue(torch.equal(left["rng_state"]["torch"], right["rng_state"]["torch"]))
            self.assertEqual(left["counters"], right["counters"])
            self.assertEqual(left["hard_replay"], right["hard_replay"])
            self.assertEqual(complete["best"], resumed["best"])
            self.assertEqual(left["window"], right["window"])
            for left_event, right_event in zip(left["history"], right["history"]):
                self.assertEqual({key: value for key, value in left_event.items() if key != "elapsed_seconds"},
                                 {key: value for key, value in right_event.items() if key != "elapsed_seconds"})

    def test_resume_rejects_changed_schedule_and_mutated_validation(self):
        config = ModelConfig(dim=16, n_layers=1, n_heads=2, hidden_dim=32)
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            root = Path(directory)
            self.records(root / "data")
            run_training(self.args(root / "data", root / "partial", "--max-run-steps", "2"), model_config=config)
            resume = str(root / "partial" / "last-training-state.pt")
            with self.assertRaisesRegex(ValueError, "identity mismatch"):
                run_training(self.args(root / "data", root / "bad-schedule", "--resume", resume, "--steps", "8"), model_config=config)
            path = root / "data" / "validation.jsonl"
            path.write_text(path.read_text().replace("Never act.", "Do not act."))
            with self.assertRaisesRegex(ValueError, "identity mismatch"):
                run_training(self.args(root / "data", root / "bad-data", "--resume", resume), model_config=config)


if __name__ == "__main__":
    unittest.main()
