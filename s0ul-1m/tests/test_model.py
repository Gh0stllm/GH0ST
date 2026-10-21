import unittest
import torch
from s0ul.model import ModelConfig, S0ULModel


class ModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(2)

    def test_exact_parameter_budget_and_tying(self):
        model = S0ULModel()
        self.assertEqual(model.parameter_count(), 984192)
        self.assertEqual(ModelConfig().expected_parameters(), 984192)
        self.assertEqual(sum(t.numel() for t in model.state_dict().values()), 984192)
        self.assertFalse(any("bias" in name for name, _ in model.named_parameters()))
        self.assertFalse(any("rope" in name for name in model.state_dict()))

    def test_future_tokens_cannot_change_prefix(self):
        torch.manual_seed(13)
        model = S0ULModel().eval()
        a = torch.tensor([[1, 14, 28, 39, 40]])
        b = torch.tensor([[1, 14, 28, 99, 100]])
        with torch.no_grad():
            self.assertTrue(torch.allclose(model(a)[:, :3], model(b)[:, :3], atol=1e-6, rtol=1e-6))

    def test_deterministic_generation_restores_mode(self):
        model = S0ULModel()
        prompt = torch.tensor([[1, 9, 3]])
        self.assertTrue(torch.equal(model.generate(prompt, 3), model.generate(prompt, 3)))
        self.assertTrue(model.training)
        self.assertTrue(torch.equal(model.generate(prompt, 0), prompt))
        with self.assertRaises(ValueError):
            model.generate(prompt, 126)

    def test_invalid_configuration_and_sequence(self):
        with self.assertRaises(ValueError):
            ModelConfig(dim=127)
        model = S0ULModel()
        with self.assertRaises(ValueError):
            model(torch.zeros((1, 129), dtype=torch.long))
        with self.assertRaises(ValueError):
            model(torch.zeros((1, 0), dtype=torch.long))

    def test_gradients_reduce_training_loss(self):
        torch.manual_seed(4)
        model = S0ULModel(ModelConfig(dim=32, n_layers=2, n_heads=2, hidden_dim=64))
        optimizer = torch.optim.AdamW(model.parameters(), lr=0.005)
        x = torch.tensor([[1, 20, 3, 44, 45], [1, 21, 3, 46, 47]])
        y = torch.tensor([[-100, -100, 44, 45, 2], [-100, -100, 46, 47, 2]])
        first = None
        for _ in range(20):
            optimizer.zero_grad(set_to_none=True)
            loss = torch.nn.functional.cross_entropy(model(x).flatten(0, 1), y.flatten(), ignore_index=-100)
            if first is None:
                first = loss.item()
            loss.backward()
            optimizer.step()
        self.assertLess(loss.item(), first * 0.3)


if __name__ == "__main__":
    unittest.main()
