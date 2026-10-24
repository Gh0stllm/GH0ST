"""CPU-only checks against the pinned local Qwen tokenizer; no model weights loaded."""
import json
import unittest
from pathlib import Path
from sample_instruction_teacher import build_chat

BASE=Path(__file__).resolve().parent


class ActualTokenizerPrefillTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from transformers import AutoTokenizer
        cls.tok=AutoTokenizer.from_pretrained(BASE/'qwen-cache',local_files_only=True,trust_remote_code=False)
        cls.prompts=[json.loads(line)for line in (
            BASE.parent.parent/'voice-v7/evaluation/teacher-review/teacher-validation-prompts.jsonl'
        ).read_text().splitlines()if line.strip()]

    def test_all_frozen_prefixes_remain_exact_and_unclosed(self):
        for row in self.prompts:
            with self.subTest(prompt=row['id']):
                messages,rendered,ids=build_chat(self.tok,row['prompt'],'assistant-prefill')
                self.assertEqual(messages[-1],{'role':'assistant','content':row['prompt']})
                self.assertTrue(rendered.endswith(row['prompt']))
                self.assertEqual(self.tok.decode(ids,skip_special_tokens=False),rendered)
                assistant_tail=rendered.rsplit('<|im_start|>assistant\n',1)[1]
                # Qwen's native disabled-thinking marker occurs before the supplied prefix.
                self.assertEqual(assistant_tail,'<think>\n\n</think>\n\n'+row['prompt'])
                self.assertNotIn(ids[-1],(self.tok.eos_token_id,self.tok.pad_token_id))

    def test_quoted_user_rendering_is_unchanged(self):
        row=self.prompts[0]
        messages,rendered,ids=build_chat(self.tok,row['prompt'])
        old=self.tok.apply_chat_template(messages,tokenize=False,add_generation_prompt=True,
                                         enable_thinking=False,return_dict=False)
        self.assertEqual(rendered,old)
        self.assertEqual(self.tok.decode(ids,skip_special_tokens=False),old)


if __name__=='__main__':
    unittest.main()
