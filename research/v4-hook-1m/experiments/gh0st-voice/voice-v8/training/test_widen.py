"""Small independent dimension/mapping regressions for offline widening."""
import unittest
import torch

from widen import validate, widen, audit_mapping, audit_function, jitter


def fixture():
    h,v,p,g,d = 4,12,5,3,2
    rng = torch.Generator().manual_seed(515)
    shapes = {name:(3*h,h)for name in ('wx1','wh1','wx2','wh2')}
    shapes.update({'embedding.weight':(v+2,h),'punct_embedding.weight':(p,h),
        'wf':(3*h,6),'bh1':(3*h,),'bh2':(3*h,),'domain.weight':(d,3*h),
        'groups.weight':(g,h),'words.weight':(v,h),'punct_head.weight':(p,h),
        'group_bias.weight':(g,1),'word_bias.weight':(v,1),'punct_bias':(p,),
        'word_punct_bias.weight':(v,p)})
    return {name:torch.randn(shape,generator=rng)*.2 for name,shape in shapes.items()}


class WidenTests(unittest.TestCase):
    def test_integer_factors_preserve_full_outputs(self):
        original = fixture()
        untouched = {k:v.clone()for k,v in original.items()}
        for factor in (1,2,3,4):
            wide = widen(original,factor)
            self.assertEqual(validate(wide)['hidden_width'],4*factor)
            self.assertEqual(audit_mapping(original,wide,factor)['status'],'PASS')
            self.assertEqual(audit_function(original,wide,factor,steps=32)['status'],'PASS')
        for name in original:
            self.assertTrue(torch.equal(original[name],untouched[name]))

    def test_gate_order_and_feature_scaling(self):
        original = fixture()
        original['bh1'] = torch.arange(12,dtype=torch.float32)
        original['wf'] = torch.arange(72,dtype=torch.float32).reshape(12,6)
        wide = widen(original,3)
        self.assertEqual(wide['bh1'].tolist(),[n for n in range(12)for _ in range(3)])
        self.assertTrue(torch.equal(wide['wf'][0],original['wf'][0]))
        self.assertTrue(torch.equal(wide['wf'][12],original['wf'][4]))

    def test_jitter_is_explicit_and_leaves_scalar_priors_unchanged(self):
        original = fixture()
        wide = widen(original,2)
        before = {k:v.clone()for k,v in wide.items()}
        report = jitter(wide,2,.0001,5)
        self.assertEqual(report['status'],'POST_CLONE_PERTURBATION_NOT_FUNCTION_PRESERVING')
        self.assertFalse(torch.equal(before['wx1'],wide['wx1']))
        for name in ('group_bias.weight','word_bias.weight','punct_bias','word_punct_bias.weight','wf','domain.weight'):
            self.assertTrue(torch.equal(before[name],wide[name]))


if __name__ == '__main__':
    torch.set_num_threads(1)
    unittest.main()
