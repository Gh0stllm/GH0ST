import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np

from build_grammar_pairs import build
from engine import Corpus, Stream, tensor_batch
from model import V, BOS, UNK
from prepare import parse


class FixedRng:
    def choice(self,values,p=None):return values[0]
    def integers(self,n):return 0


class FakeCorpus:
    def __init__(self):
        self.rows={'train':{'original':[{'id':'one','words':np.array([10,11,12,13,14]),
            'punct':np.array([0,0,2,0,2]),'domain':0,
            'grammar_pairs':np.array([[0,20],[1,21],[3,23],[4,24]])}]}}


def write_json(path,value):path.write_text(json.dumps(value)+'\n')
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


class IntegrationTests(unittest.TestCase):
    def test_chunk_offsets_row_flattening_and_document_reset(self):
        stream=Stream(FakeCorpus(),FixedRng(),batch=2,width=3,mixture={'original':1.})
        first,_=stream.next('cpu')
        self.assertEqual(first['grammar_positions'].tolist(),[0,1,3,4])
        self.assertEqual(first['grammar_good_tokens'].tolist(),[10,11,10,11])
        self.assertEqual(first['grammar_bad_tokens'].tolist(),[20,21,20,21])
        self.assertEqual(first['resets'].tolist(),[[True,False,False],[True,False,False]])
        second,_=stream.next('cpu')
        self.assertEqual(second['y'].tolist(),[[13,14,10],[13,14,10]])
        self.assertEqual(second['x'].tolist(),[[12,13,BOS],[12,13,BOS]])
        self.assertEqual(second['grammar_positions'].tolist(),[0,1,2,3,4,5])
        self.assertEqual(second['grammar_good_tokens'].tolist(),[13,14,10,13,14,10])
        self.assertEqual(second['resets'].tolist(),[[False,False,True],[False,False,True]])
        for batch in (first,second):
            self.assertEqual(batch['y'].reshape(-1)[batch['grammar_positions']].tolist(),
                             batch['grammar_good_tokens'].tolist())

    def test_missing_pairs_are_empty_int64(self):
        corpus=FakeCorpus();del corpus.rows['train']['original'][0]['grammar_pairs']
        batch,_=Stream(corpus,FixedRng(),1,3,{'original':1.}).next('cpu')
        for name in ('grammar_positions','grammar_bad_tokens','grammar_good_tokens'):
            self.assertEqual(batch[name].numel(),0)
            self.assertEqual(str(batch[name].dtype),'torch.int64')

    def test_builder_parser_alignment_and_corpus_train_only(self):
        with tempfile.TemporaryDirectory()as temp:
            path=Path(temp)
            prefix=['i','am','here','we','are','ready','is','has','had','made','the','box',
                    'make','makes','can','write','writes','wrote','writing','an','a','apple']
            vocabulary=prefix+[f'word{n}'for n in range(V-len(prefix))]
            write_json(path/'vocabulary.json',vocabulary);index={w:i for i,w in enumerate(vocabulary)}
            text='I am here. We are ready. I had made the box. I can write. An apple.'
            words,punct=parse(text)
            doc={'id':'train-one','split':'train','kind':'original','domain':0,'text':text,
                 'token_ids':[index.get(w,UNK)for w in words],'punctuation':punct}
            (path/'train.jsonl').write_text(json.dumps(doc)+'\n')
            for split in ('validation','test'):
                (path/f'{split}.jsonl').write_text(json.dumps(doc|{'id':split+'-one','split':split})+'\n')
            write_json(path/'counts.json',{'original':[1]*V})
            write_json(path/'manifest.json',{'vocabulary_sha256':sha(path/'vocabulary.json'),
                'artifacts':{name:{'sha256':sha(path/name)}for name in ('train.jsonl','validation.jsonl','test.jsonl')}})
            sidecar=path/'pairs.json';result=build(path/'train.jsonl',path/'vocabulary.json',sidecar)
            self.assertEqual(result['counts']['negative_pairs'],7)
            self.assertEqual(result['counts']['excluded_by_rule'],{'perfect_participle':2,'article_sound':1})
            corpus=Corpus(path,grammar_pairs=sidecar)
            expected=sorted([[1,index[w]]for w in ('is','has')]+[[4,index[w]]for w in ('is','has')]+
                            [[13,index[w]]for w in ('writes','wrote','writing')])
            self.assertEqual(corpus.rows['train']['original'][0]['grammar_pairs'].tolist(),expected)
            self.assertNotIn('grammar_pairs',corpus.rows['validation']['original'][0])
            val=corpus.validation_batches(np.random.default_rng(3),'cpu',1,1)['original'][0]
            self.assertEqual(val['grammar_positions'].numel(),0)
            bad=json.loads(sidecar.read_text());bad['vocabulary_sha256']='0'*64
            write_json(path/'bad-pairs.json',bad)
            with self.assertRaises(AssertionError):Corpus(path,grammar_pairs=path/'bad-pairs.json')
            unfiltered=json.loads(sidecar.read_text());unfiltered['allowed_rules'].append('article_sound')
            write_json(path/'unfiltered-pairs.json',unfiltered)
            with self.assertRaises(AssertionError):Corpus(path,grammar_pairs=path/'unfiltered-pairs.json')
            # Same raw text with drifted encoded punctuation must not build.
            doc['punctuation'][0]=2
            (path/'train.jsonl').write_text(json.dumps(doc)+'\n')
            with self.assertRaises(ValueError):build(path/'train.jsonl',path/'vocabulary.json',path/'drift-pairs.json')


if __name__=='__main__':unittest.main()
