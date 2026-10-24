#!/usr/bin/env python3
"""Small local parser/sampler/cache checks; never trains a model."""
import json,tempfile
from pathlib import Path
import numpy as np
import torch
from prepare_cache import prepare
from common import RESEARCH,Streams,load_model,mask_for,free_generate

def main():
    torch.set_num_threads(2)
    with tempfile.TemporaryDirectory(prefix='gh0st-large-v3-test-') as directory:
        root=Path(directory);data=root/'data';data.mkdir()
        for i,split in enumerate(['train','validation','test']):
            rows=[{'id':f'{split}-a','split':split,'source_kind':'authored','text':['"i see a tree in the sky."','"i hear a river by the moon."','"i found a key beside the door."'][i]},
                  {'id':f'{split}-c','split':split,'source_kind':'compositional','family_id':split,'text':['the small bird waits for a quiet day.','the bright cloud brings a gentle wind.','the old stone holds a tiny light.'][i]}]
            (data/f'{split}.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows))
        meta=prepare(data,root/'cache',RESEARCH/'experiments/simplestories-v2/model-cache')
        assert meta==prepare(data,root/'cache',RESEARCH/'experiments/simplestories-v2/model-cache')
        streams=Streams(root/'cache');rng=np.random.default_rng(123);counts={'authored':0,'compositional':0}
        for _ in range(200):
            batch=streams.batch('train',rng,16)
            for i,quoted in enumerate(batch[4]):
                assert batch[0][i].numel()==128
                assert (batch[1][i,:1 if quoted else 64]==-100).all()
                if quoted:assert batch[0][i,0]==3
            for kind in batch[3]:counts[kind]+=1
        assert .36<counts['authored']/sum(counts.values())<.44
        assert all(1 not in a for a in streams.arrays.values())
        for split,text in zip(['train','validation','test'],['a blue bird lives in a tree.','the boy finds a key by the sea.','the girl watches the wind move clouds.']):
            with (data/f'{split}.jsonl').open('a') as out:out.write(json.dumps({'id':split+'-p','split':split,'source_kind':'public_domain','family_id':split,'text':text})+'\n')
        public=prepare(data,root/'cache-public',RESEARCH/'experiments/simplestories-v2/model-cache')
        three=Streams(root/'cache-public');mix={'authored':0,'compositional':0,'public_domain':0}
        for _ in range(200):
            batch=three.batch('train',rng,16,authored=.3,public_domain=.1)
            for kind in batch[3]:mix[kind]+=1
        assert .26<mix['authored']/3200<.34 and .07<mix['public_domain']/3200<.13
        assert set(public['streams']['train'])==set(mix)
    model,tok=load_model(RESEARCH/'experiments/simplestories-v2/model-cache');model.eval()
    ids=torch.tensor([[3,120,8,50,93,1784,94,1784,2]*9])[:,:80]
    with torch.no_grad():
        full=model(input_ids=ids,attention_mask=mask_for(ids.shape[1]),use_cache=False).logits
        cache=None
        for position in range(ids.shape[1]):
            mask=torch.full((1,1,1,position+1),torch.finfo(torch.float32).min);mask[:,:,:,-64:]=0
            out=model(input_ids=ids[:,position:position+1],attention_mask=mask,past_key_values=cache,use_cache=True,position_ids=torch.tensor([[position]]));cache=out.past_key_values
            if position in [0,1,15,63,64,79]:torch.testing.assert_close(out.logits[:,0],full[:,position],atol=5e-5,rtol=1e-5)
    probe=free_generate(model,tok,(0,42),32)
    assert all(len(x['tokens'])==32 for x in probe['streams'])
    report={'status':'PASS','cache_reuse':True,'no_inserted_eos':True,'source_mix':counts,'three_source_mix':mix,'quote_seed_labels':True,'incremental_sliding_attention_matches_full':True,'probe_never_stops_early':True}
    Path(__file__).with_name('pipeline-selftest.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))
if __name__=='__main__':main()
