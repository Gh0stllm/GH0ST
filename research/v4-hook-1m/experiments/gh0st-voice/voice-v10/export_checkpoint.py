"""Export retrained N0VA weights to the tested signed Solidity layout, locally."""
import argparse
import hashlib
import json
import math
import re
from pathlib import Path

import numpy as np
from safetensors.numpy import load_file

HERE = Path(__file__).resolve().parent
VOICE = HERE.parent
RUNTIME = VOICE/'nova-fast-market/evm32-round2'
SHA = lambda b: hashlib.sha256(b).hexdigest()


def pack40(a):
    assert a.min() >= -(2**39) and a.max() < 2**39
    return ((a.astype(np.uint64)[..., None] >> np.array([32,24,16,8,0], dtype=np.uint64)) & 255).astype(np.uint8).tobytes()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--checkpoint', type=Path, required=True)
    p.add_argument('--data', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    assert not a.out.exists(), 'Export directory already exists'
    raw = load_file(a.checkpoint/'model.safetensors')
    q = {}
    for name, arr in raw.items():
        assert np.isfinite(arr).all(), name
        quant = np.rint(arr.astype(np.float64)*1024).astype(np.int64)
        assert quant.min() >= -32768 and quant.max() <= 32767, name
        q[name] = quant
    assert q['embedding.weight'].shape == (8194,384)
    assert sum(x.size for x in q.values()) == 8175493
    a.out.mkdir(parents=True)
    i16 = lambda x: x.astype('>i2').tobytes()
    matrices = {'core':np.concatenate([q['wh1'],q['wx2'],q['wh2']]),
                'groups':q['groups.weight'],'words':q['words.weight'],
                'punctuation':q['punct_head.weight']}
    biases = {'core':None,'groups':q['group_bias.weight'][:,0],
              'words':q['word_bias.weight'][:,0],'punctuation':q['punct_bias']}
    report = {'scope':'UNFORKED_LOCAL_ONLY','status':'RUNNING','matrices':{},
              'all_q10_weights_preserved':True,'packing_changes_precision':False}
    vectors = [np.zeros(384,dtype=np.int64),np.full(384,-1024),np.full(384,1024),
               np.tile([-1024,1024],192),np.random.default_rng(101).integers(-1024,1025,384)]
    mask = (1<<256)-1
    B, half = 1<<25, 1<<24
    packed_vectors = [[sum(int(v) << (25*j) for j,v in enumerate(vec[k*10:(k+1)*10])) & mask
                       for k in range(39)] for vec in vectors]
    total_decoded = total_dots = 0
    blobs = {}
    for name,matrix in matrices.items():
        schedule = [19,20] if name == 'core' else [26,13]
        split = schedule[0]*10
        bounds = 1024*np.stack([np.abs(matrix[:,:split]).sum(1),np.abs(matrix[:,split:]).sum(1)],axis=1)
        assert int(bounds.max()) < half, (name,'signed packing bound',int(bounds.max()),half)
        body = bytearray()
        for ri,row in enumerate(matrix):
            packed = [sum(int(w) << (25*(9-j)) for j,w in enumerate(row[k*10:(k+1)*10])) & mask for k in range(39)]
            for k,pv in enumerate(packed):
                for j,w in enumerate(row[k*10:(k+1)*10]):
                    exponent=25*(9-j)
                    digit=((pv+(1<<(exponent-1)))>>exponent)&(B-1) if exponent else pv&(B-1)
                    assert (digit^half)-half == int(w)
                    total_decoded+=1
            for vec,pvec in zip(vectors,packed_vectors):
                result=0;start=0
                for n in schedule:
                    acc=sum(pvec[k]*packed[k] for k in range(start,start+n)) & mask
                    digit=(((acc+(1<<224)) & mask)>>225)&(B-1)
                    result+=(digit^half)-half;start+=n
                assert result == int(row@vec), (name,ri)
                total_dots+=1
            body.extend(b''.join(v.to_bytes(32,'big') for v in packed))
            body.extend(int(row.sum()).to_bytes(32,'big',signed=True))
            body.extend(max(0,-int(row.min())).to_bytes(32,'big',signed=True))
            if biases[name] is not None: body.extend(int(biases[name][ri]).to_bytes(32,'big',signed=True))
        if name == 'core':
            assert len(body)==3456*1312
            body=b''.join(body[i:i+18*1312]+bytes(384) for i in range(0,len(body),18*1312))
            body+=i16(q['wf'])+i16(q['bh2'])
        elif name == 'punctuation':
            body+=i16(q['word_punct_bias.weight'])+pack40(q['punct_embedding.weight']@q['wx1'].T)
        blobs[name+'.bin']=bytes(body)
        report['matrices'][name]={'rows':len(matrix),'schedule':schedule,'max_coefficient_abs':int(bounds.max()),'exclusive_limit':half}
    # Compute the same int40 embedding projection in bounded batches.
    fused=bytearray()
    for start in range(0,8193,128):
        fused.extend(pack40(q['embedding.weight'][start:min(start+128,8193)]@q['wx1'].T+(q['bh1']+q['domain.weight'][0])[None,:]*1024))
    blobs['fused.bin']=bytes(fused)
    vocab=json.loads((a.data/'vocabulary.json').read_text())
    assert len(set(vocab))==8192 and all(len(w)<=32 and re.fullmatch(r"[a-z]+(?:'[a-z]+)*",w) for w in vocab)
    blobs['vocabulary.json']=(a.data/'vocabulary.json').read_bytes()
    blobs['vocabulary.bin']=b''.join(w.encode().ljust(32,b'\0') for w in vocab)
    assert blobs['vocabulary.bin']==(a.data/'vocabulary.bin').read_bytes()
    blobs['sigmoid-delta.bin']=(VOICE/'nova-fast-market/selected/sigmoid-delta.bin').read_bytes()
    blobs['exp-q32.bin']=b''.join(round(math.exp(-i/16)*2**32).to_bytes(8,'big') for i in range(257))
    expected=json.loads((RUNTIME/'profile/signed/manifest.json').read_text())
    for name,data in blobs.items():
        if name.endswith('.bin'): assert len(data)==expected['artifacts'][name]['bytes'], name
        (a.out/name).write_bytes(data)
    np.savez(a.out/'reference.npz',**{k:v.astype(np.int16) for k,v in q.items()})
    source=(RUNTIME/'model/GRU2PackedModel.sol').read_bytes()
    (a.out/'GRU2PackedModel.sol').write_bytes(source)
    manifest={'scope':'LOCAL_ONLY_RETRAINED_CANDIDATE','parameters':8175493,'hidden_per_layer':384,
              'checkpoint_sha256':SHA((a.checkpoint/'model.safetensors').read_bytes()),
              'data_manifest_sha256':SHA((a.data/'manifest.json').read_bytes()),
              'model_domain':'GH0ST_GRU2_SIGNED10_BITS25_ALIGNED18_H384_Q10_LOCAL_V1',
              'source_sha256':SHA(source),'clipped_weights':0,'quantization':'nearest Q10 int16',
              'mainnet_actions':0,'reference_sha256':SHA((a.out/'reference.npz').read_bytes()),
              'artifacts':{k:{'bytes':len(v),'sha256':SHA(v)} for k,v in blobs.items()}}
    report.update(status='PASS_EXACT_SIGNED_LAYOUT',decoded_weights=total_decoded,scalar_dot_cases=total_dots,
                  checkpoint_sha256=manifest['checkpoint_sha256'])
    (a.out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (a.out/'packing-proof.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'status':report['status'],'checkpoint':manifest['checkpoint_sha256'],
                      'decoded_weights':total_decoded,'scalar_dot_cases':total_dots}))


if __name__=='__main__':main()
