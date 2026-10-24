"""Pure offline instruction-sampler checks: no model load or GPU work."""
import unittest
from sample_instruction_teacher import build_chat, remove_exact_prefix, stop_before_eos, suggested_display_separator


class InstructionSamplerTests(unittest.TestCase):
    def test_exact_leading_copy_only(self):
        self.assertEqual(remove_exact_prefix('I am a machine. I found a key.', 'I am a machine.'),
                         (' I found a key.', True))
        self.assertEqual(remove_exact_prefix(' I am a machine.', 'I am a machine.'),
                         (' I am a machine.', False))
        self.assertEqual(remove_exact_prefix('I am a machine', 'I am a machine.'),
                         ('I am a machine', False))

    def test_first_eos_without_losing_raw_ids(self):
        raw=[4,5,151645,151643,151643]
        self.assertEqual(stop_before_eos(raw,[151645,151643]),([4,5],151645))
        self.assertEqual(raw,[4,5,151645,151643,151643])

    def test_no_eos_keeps_every_generated_id(self):
        self.assertEqual(stop_before_eos([4,5],[151645]),([4,5],None))

    def test_immediate_eos_produces_no_generated_text(self):
        self.assertEqual(stop_before_eos([151645,151643],[151645,151643]),([],151645))

    def test_word_boundary_annotation_does_not_rewrite(self):
        self.assertEqual(suggested_display_separator('I found','a key.'),' ')
        self.assertEqual(suggested_display_separator('I found ','a key.'),'')
        self.assertEqual(suggested_display_separator('I found',', by luck'),'')

    def test_template_always_disables_thinking(self):
        class Tokenizer:
            def apply_chat_template(self,messages,**kwargs):
                if kwargs['enable_thinking'] is not False or kwargs['add_generation_prompt'] is not True:
                    raise AssertionError('Template flags changed')
                return [1,2,3] if kwargs['tokenize'] else 'rendered chat'
        messages,rendered,ids=build_chat(Tokenizer(),'I found a key.')
        self.assertEqual(ids,[1,2,3]);self.assertEqual(rendered,'rendered chat')
        self.assertEqual(messages[0]['role'],'system')
        self.assertIn('I found a key.',messages[1]['content'])


if __name__=='__main__':
    unittest.main()
