"""Read-only CPU forward/backward checks on the original checkpoint; no optimizer step."""
import os,unittest
os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1'
import torch
from core import BASE,freeze_top2,windows,frozen_hashes
from train import ce,samples

class ActualModelChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from transformers import AutoModelForCausalLM,AutoTokenizer
        torch.set_num_threads(2)
        cls.model=AutoModelForCausalLM.from_pretrained(BASE,local_files_only=True,trust_remote_code=False,attn_implementation='eager',dtype=torch.float32)
        cls.tok=AutoTokenizer.from_pretrained(BASE,local_files_only=True,trust_remote_code=False)
        cls.trainable=freeze_top2(cls.model)

    def test_padding_is_finite_and_frozen_parameters_have_no_gradients(self):
        self.assertEqual(self.trainable,360704)
        self.assertEqual(sum(p.numel()for p in self.model.parameters()),1235968)
        before=frozen_hashes(self.model)
        rows=[list(windows(self.tok.encode('I found a key beside the pool.',add_special_tokens=False)))[0],
              list(windows(self.tok.encode('I waited.',add_special_tokens=False)))[0]]
        loss,count=ce(self.model,rows,'cpu');self.assertTrue(bool(torch.isfinite(loss)))
        self.assertEqual(count,sum(r['targets']for r in rows))
        (loss/count).backward()
        for _,p in self.model.named_parameters():
            if p.requires_grad:self.assertIsNotNone(p.grad);self.assertTrue(bool(torch.isfinite(p.grad).all()))
            else:self.assertIsNone(p.grad)
        self.assertEqual(frozen_hashes(self.model),before)
        self.model.zero_grad(set_to_none=True)

    def test_short_raw_sampler_retains_all_tokens(self):
        report=samples(self.model,self.tok,3)
        self.assertEqual(len(report['streams']),4)
        self.assertTrue(all(len(r['generated_token_ids'])==3 for r in report['streams']))

if __name__=='__main__':unittest.main()
