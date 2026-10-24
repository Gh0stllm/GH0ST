"""CPU-only sampler guard regression tests; no model imports or generation."""
import unittest
from sample_teacher import batch_count, encode_prompt, filter_candidate, validate_prompt_budget

class SamplerGuards(unittest.TestCase):
    def test_exactly_one_native_boundary_token(self):
        class Tokenizer:
            bos_token_id=eos_token_id=50256
            def __call__(self,text,add_special_tokens):
                self.assert_plain=not add_special_tokens
                return {'input_ids':[40,716]if text=='I am'else[50256,40]}
        tok=Tokenizer()
        self.assertEqual(encode_prompt(tok,'I am'),[50256,40,716])
        self.assertTrue(tok.assert_plain)
        with self.assertRaisesRegex(ValueError,'native BOS/EOS'):
            encode_prompt(tok,'special token')

    def test_prompt_ending_cannot_approve_unfinished_generation(self):
        clean,detail=filter_candidate('I saw the machine. '*20,'it began to',1)
        self.assertIsNone(clean)
        self.assertEqual(detail['reason'],'no_generated_ending')

    def test_prompt_words_cannot_satisfy_generated_word_minimum(self):
        clean,detail=filter_candidate('I saw the machine. '*20,' Yes.',40)
        self.assertIsNone(clean)
        self.assertEqual(detail['reason'],'too_few_generated_words')

    def test_unfinished_tail_does_not_satisfy_word_minimum(self):
        clean,detail=filter_candidate('I began',' here. '+'unfinished '*80,40)
        self.assertIsNone(clean)
        self.assertEqual(detail['retained_generated_words'],1)

    def test_generated_complete_passage_can_be_a_candidate(self):
        continuation=(' I put the key beside the empty screen and waited for a sign. '
                      'The machine asked for another coin so I gave it a button. '
                      'It accepted the button and printed a small picture of a door. '
                      'I kept the picture because the door was clearly better paid than me.')
        clean,detail=filter_candidate('I kept a notebook.',continuation,40)
        self.assertEqual(clean,'I kept a notebook.'+continuation)
        self.assertEqual(detail['reason'],'candidate_pass')
        self.assertGreaterEqual(detail['retained_generated_words'],40)

    def test_candidate_cap_never_rounds_up(self):
        index=0;sizes=[]
        while index<11:
            size=batch_count(index,11,8);sizes.append(size);index+=size
        self.assertEqual(sizes,[8,3]);self.assertEqual(index,11)
        self.assertEqual(batch_count(11,11,8),0)

    def test_prompt_context_boundary(self):
        self.assertEqual(validate_prompt_budget([{'id':'edge'}],[864],160),864)
        with self.assertRaisesRegex(ValueError,'No truncation'):
            validate_prompt_budget([{'id':'too-long'}],[865],160)

if __name__=='__main__':
    unittest.main()
