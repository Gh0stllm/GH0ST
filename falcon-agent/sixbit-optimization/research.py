"""Whole-model lossless compression experiments and scoped rank diagnostics."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import torch
import zstandard as zstd
from optimize import old_codes, pack, unpack

ROOT=Path(__file__).resolve().parent


def entropy(hist):
    h=np.asarray(hist,dtype=np.float64);p=h[h>0]/h.sum();return float(-(p*np.log2(p)).sum())


def main():
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--compact',type=Path,required=True);a=p.parse_args()
    source=(a.source/'weights.bin').read_bytes();m=json.loads((a.source/'manifest.json').read_text())
    data=(a.compact/'weights.bin').read_bytes();cm=json.loads((a.compact/'manifest.json').read_text())
    rows=[];total_hist=np.zeros(64,dtype=np.int64);bit_entropy=0;conditional_bits=0;group_unique=0;groups=0;huffman_bits=0
    streams={name:bytearray(data[:cm['tensors'][0]['offset']]) for name in ['bitplanes','row_delta','symbol_bytes']}
    spectral=[];torch.set_num_threads(4)
    for t,ct in zip(m['tensors'],cm['tensors']):
        blob=source[t['offset']:t['offset']+t['byte_count']];current=data[ct['offset']:ct['offset']+ct['byte_count']]
        if 'group_count' not in t:
            for stream in streams.values():stream.extend(current)
            continue
        g=t['group_count'];c=old_codes(blob,g);hist=np.bincount(c,minlength=64);e=entropy(hist)
        total_hist+=hist;bit_entropy+=len(c)*e
        pair=np.bincount(c[:-1].astype(np.int64)*64+c[1:],minlength=4096).reshape(64,64)
        cond=sum(h.sum()*entropy(h) for h in pair if h.sum())
        conditional_bits+=cond
        unique=len(np.unique(c.reshape(g,64).view('V64')));groups+=g;group_unique+=unique
        import heapq
        heap=list(map(int,hist[hist>0]));heapq.heapify(heap);cost=0
        while len(heap)>1:
            v=heapq.heappop(heap)+heapq.heappop(heap);cost+=v;heapq.heappush(heap,v)
        huffman_bits+=cost
        metadata=current[:-g*48]
        planes=np.packbits(((c[None,:]>>np.arange(6,dtype=np.uint8)[:,None])&1).reshape(-1),bitorder='little').tobytes()
        recovered=(np.unpackbits(np.frombuffer(planes,dtype=np.uint8),bitorder='little').reshape(6,-1)*(1<<np.arange(6))[:,None]).sum(0).astype(np.uint8)
        assert np.array_equal(recovered,c)
        matrix=c.reshape(t['shape']);delta=(matrix.astype(np.int16)-np.roll(matrix,1,axis=0))%64;delta[0]=matrix[0]
        db=pack(delta.reshape(-1),6)
        assert np.array_equal(np.cumsum(unpack(db,6,len(c)).reshape(matrix.shape),axis=0)%64,matrix)
        for name,payload in [('bitplanes',planes),('row_delta',db),('symbol_bytes',c.tobytes())]:
            streams[name].extend(metadata);streams[name].extend(payload)
        rows.append({'tensor':t['name'],'code_count':len(c),'symbol_entropy':e,'conditional_previous_symbol_entropy':cond/max(1,len(c)-1),'unique_64_code_groups':unique,'groups':g})
        if t['name'] in ['model.layers.0.feed_forward.gate_proj.weight','model.layers.0.self_attn.k_proj.weight','model.layers.0.mamba.out_proj.weight','model.embed_tokens.weight']:
            o=np.frombuffer(blob[:g*4],dtype='<i4').astype(np.float64);s=np.frombuffer(blob[g*4:g*8],dtype='<u4').astype(np.float64)
            w=((o[:,None]+s[:,None]*c.reshape(g,64))/(1<<24)).reshape(t['shape'])
            singular=torch.linalg.svdvals(torch.from_numpy(w).float()).double().numpy();energy=np.cumsum(singular**2)/sum(singular**2)
            # Optimistic six-bit low-rank factor budget, ignoring factor scales.
            r=max(1,int(np.prod(t['shape'])/(sum(t['shape'])*15.65)))
            spectral.append({'tensor':t['name'],'rank':len(singular),'rank_at_15_65x_factor_compression':r,'minimum_relative_squared_weight_error_at_that_rank':float(1-energy[r-1]),'rank_for_99_percent_energy':int(np.searchsorted(energy,.99)+1),
                             'scope':'Best real-valued rank-r Frobenius approximation, not task error; no weights replaced or tuned.'})
    compressed=[]
    for name,stream in streams.items():
        raw=bytes(stream);z=zstd.ZstdCompressor(level=19,threads=4).compress(raw)
        assert zstd.ZstdDecompressor().decompress(z)==raw
        path=a.compact/(name+'.zstd');path.write_bytes(z)
        compressed.append({'transform':name,'bytes_before_zstd':len(raw),'bytes_zstd':len(z),'code_deposit_gas_only':len(z)*200,'sha256':hashlib.sha256(z).hexdigest(),'roundtrip_verified':True,
                           'warning':'CPU size experiment only; needs a revised index, independent block framing and on-chain decoder. Not a deployment artifact.'})
        print(json.dumps(compressed[-1]),flush=True)
    count=int(total_hist.sum());remaining=len(data)-count*6//8
    report={'status':'completed','matrix_weights':count,'global_symbol_entropy_bits':entropy(total_hist),'tensor_weighted_symbol_entropy_bits':bit_entropy/count,
            'conditional_previous_symbol_entropy_bits':conditional_bits/(count-len(rows)),
            'ideal_symbol_coded_plus_current_other_bytes':bit_entropy/8+remaining,
            'huffman_codes_plus_current_other_bytes_without_tables':(huffman_bits+7)//8+remaining,
            'groups':groups,'unique_groups_summed_per_tensor':group_unique,'duplicates_within_tensors':groups-group_unique,
            'entropy_caveat':'These are empirical symbol models, not a universal impossibility theorem or bound for all algorithms.',
            'storage_target':{'gas':1000000000,'max_bytes_before_any_overhead':5000000,'max_effective_bits_per_original_parameter':40000000/91131072,
                              'compact_factor_needed_before_overhead':len(data)/5000000},
            'compressed_candidates':compressed,'spectral_diagnostics':spectral,'tensor_results':rows}
    (ROOT/'research-results.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ['tensor_results','compressed_candidates']},indent=2))


if __name__=='__main__':main()
