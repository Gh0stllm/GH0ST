import unittest
import numpy as np
from core import windows,make_batch,tensors,freeze_top2

class DataGuards(unittest.TestCase):
    def test_every_known_target_once_with_mid_document_warmup(self):
        ids=list(range(1,401));found=[]
        for row in windows(ids):
            self.assertLessEqual(len(row['ids']),128)
            if row['start']:self.assertTrue(all(v==-100 for v in row['labels'][:64]))
            else:self.assertEqual(row['labels'][1],ids[1])
            found.extend(v for v in row['labels'][1:]if v!=-100)
        self.assertEqual(found,ids[1:])

    def test_unknowns_are_context_not_targets(self):
        row=list(windows([5,0,7]))[0]
        self.assertEqual(row['ids'],[5,0,7]);self.assertEqual(row['labels'],[-100,-100,7])

    def test_source_and_total_hard_caps(self):
        class FakeCorpus:
            def sample(self,*args):return list(windows(list(range(1,100))))[0]
        counts={'grammar':0,'voice':0};rng=np.random.default_rng(1)
        while sum(counts.values())<400 and counts['voice']<100:
            batch,after=make_batch(FakeCorpus(),rng,counts,batch_size=8,total_limit=400,voice_limit=100,voice_boundary=100)
            self.assertTrue(batch);self.assertLessEqual(sum(after.values()),400);self.assertLessEqual(after['voice'],100)
            self.assertEqual(sum(x['targets']for x in batch),sum(after.values())-sum(counts.values()))
            counts=after

    def test_padding_and_sliding_mask(self):
        rows=[list(windows(list(range(1,101))))[0],list(windows([3,4,5]))[0]]
        ids,labels,mask=tensors(rows,128,'cpu')
        self.assertEqual(int(labels[1,3]),-100)
        self.assertLess(float(mask[0,0,80,16]),-1e20)
        self.assertEqual(float(mask[0,0,80,17]),0)
        self.assertLess(float(mask[1,0,2,3]),-1e20)
        self.assertEqual(float(mask[1,0,127,0]),0)
        # Independently enumerate all real-query attention edges.
        for b,length in enumerate((100,3)):
            for query in range(length):
                for key in range(128):
                    self.assertEqual(float(mask[b,0,query,key])==0,
                                     key<length and key<=query and key>query-64)

    def test_only_upper_two_layers_trainable(self):
        import torch
        class Toy(torch.nn.Module):
            def __init__(self):
                super().__init__();self.model=torch.nn.Module()
                self.model.layers=torch.nn.ModuleList([torch.nn.Linear(2,2)for _ in range(4)])
                self.model.norm=torch.nn.LayerNorm(2);self.model.embed_tokens=torch.nn.Embedding(10,2)
        model=Toy();freeze_top2(model)
        for name,param in model.named_parameters():
            self.assertEqual(param.requires_grad,name.startswith(('model.layers.2.','model.layers.3.')))

if __name__=='__main__':unittest.main()
