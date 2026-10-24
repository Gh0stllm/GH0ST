import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest

from prepare import parse,UNK,V
from prepare_distillation import prepare,PINNED_VOCABULARY_SHA256


def write(path,value):path.write_text(json.dumps(value)+'\n')
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


class DistillationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.base=self.root/'base';self.base.mkdir()
        source=Path(__file__).resolve().parents[2]/'voice-v7/training/encoded-curriculum'
        for name in ('vocabulary.json','vocabulary.bin'):shutil.copyfile(source/name,self.base/name)
        vocabulary=json.loads((self.base/'vocabulary.json').read_text());self.index={w:i for i,w in enumerate(vocabulary)}
        self.assertEqual(sha(self.base/'vocabulary.json'),PINNED_VOCABULARY_SHA256)
        texts={'train':'I made a small note.','validation':'I saw a quiet room.','test':'I heard the bell.'}
        for split,text in texts.items():
            words,punct=parse(text)
            row={'id':'base-'+split,'group_id':'base-family-'+split,'split':split,'kind':'original',
                 'domain':0,'text':text,'token_ids':[self.index.get(w,UNK)for w in words],'punctuation':punct}
            (self.base/f'{split}.jsonl').write_text(json.dumps(row)+'\n')
        write(self.base/'counts.json',{'original':[0]*V,'adult':[0]*V,'curriculum':[0]*V})
        write(self.base/'manifest.json',{'vocabulary_sha256':sha(self.base/'vocabulary.json'),
            'statistics':{s:{}for s in texts},'artifacts':{f'{s}.jsonl':{'sha256':sha(self.base/f'{s}.jsonl')}for s in texts}})
        prompts=[{'id':'prompt-'+s,'split':s,'group_id':'teacher-family-'+s}for s in texts]
        self.prompts=self.root/'prompts.jsonl';self.prompts.write_text(''.join(json.dumps(r)+'\n'for r in prompts))
        self.candidates=self.root/'candidate-paragraphs.jsonl'
        candidates=[{'id':'teacher-train','prompt_id':'prompt-train','text':'I kept a zzzzrareword beside the door.'},
                    {'id':'teacher-validation','prompt_id':'prompt-validation','text':'I left the room before the light changed.'},
                    {'id':'teacher-test','prompt_id':'prompt-test','text':'I waited for the quiet bell.'},
                    {'id':'unapproved','prompt_id':'prompt-train','text':'This paragraph must remain outside the corpus.'}]
        self.candidates.write_text(''.join(json.dumps(r)+'\n'for r in candidates))
        self.approved=self.root/'approved.json';write(self.approved,[r['id']for r in candidates[:3]])

    def tearDown(self):self.temp.cleanup()

    def run_prepare(self,name='out'):
        return prepare(self.base,self.candidates,self.prompts,self.approved,self.root/name)

    def test_exact_approvals_base_preservation_ancestry_and_oov(self):
        result=self.run_prepare();out=self.root/'out'
        self.assertEqual(result['selected_count'],3)
        for split in ('train','validation','test'):
            self.assertTrue((out/f'{split}.jsonl').read_bytes().startswith((self.base/f'{split}.jsonl').read_bytes()))
            rows=[json.loads(line)for line in (out/f'{split}.jsonl').read_text().splitlines()]
            self.assertEqual(len(rows),2)
            teacher=rows[1]
            self.assertEqual(teacher['split'],split);self.assertEqual(teacher['group_id'],'teacher-family-'+split)
            self.assertEqual(teacher['kind'],'teacher');self.assertEqual(teacher['domain'],0)
            self.assertNotEqual(teacher['id'],'unapproved')
        self.assertEqual(result['teacher_statistics']['train']['unknown_words'],1)
        self.assertEqual((out/'vocabulary.bin').read_bytes(),(self.base/'vocabulary.bin').read_bytes())
        counts=json.loads((out/'counts.json').read_text())
        self.assertEqual(counts['original'],[0]*V)
        self.assertEqual(sum(counts['teacher']),result['teacher_statistics']['train']['words']-1)

    def test_missing_approval_id_rejected_before_output(self):
        write(self.approved,['does-not-exist'])
        with self.assertRaises(ValueError):self.run_prepare()
        self.assertFalse((self.root/'out').exists())

    def test_conflicting_ancestry_and_duplicate_text_rejected(self):
        rows=[json.loads(line)for line in self.candidates.read_text().splitlines()]
        rows[0]['split']='test';self.candidates.write_text(''.join(json.dumps(r)+'\n'for r in rows))
        with self.assertRaises(ValueError):self.run_prepare('conflict')
        rows[0].pop('split');rows[0]['text']='I made a small note.'
        self.candidates.write_text(''.join(json.dumps(r)+'\n'for r in rows))
        with self.assertRaises(ValueError):self.run_prepare('duplicate')
        self.assertFalse((self.root/'duplicate').exists())

    def test_wrong_vocabulary_and_cross_split_prompt_family_rejected(self):
        (self.base/'vocabulary.json').write_text('[]\n')
        with self.assertRaises(ValueError):self.run_prepare('wrong-vocabulary')
        source=Path(__file__).resolve().parents[2]/'voice-v7/training/encoded-curriculum/vocabulary.json'
        shutil.copyfile(source,self.base/'vocabulary.json')
        prompts=[json.loads(line)for line in self.prompts.read_text().splitlines()]
        prompts[1]['group_id']=prompts[0]['group_id']
        self.prompts.write_text(''.join(json.dumps(r)+'\n'for r in prompts))
        with self.assertRaises(ValueError):self.run_prepare('group-overlap')


if __name__=='__main__':unittest.main()
