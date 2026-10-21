"""Exact encodings of a newly quantized int5 export; not int6 equivalence."""
import argparse, hashlib, json, sys
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / 'sixbit-optimization'))
from optimize import bf16, pack, unpack
sys.path.insert(0, str(ROOT.parent))
from quantize_compare import pack_codes, unpack_codes
sys.path.insert(0, str(ROOT.parent / 'research-quality'))
from costs import layout


def bf16_q24(values):
    # A reconstructed five-bit upper endpoint can be close to zero, below the
    # observed exponent range in the old six-bit encoder. Match the Solidity
    # conversion for these finite values, retaining exact offset/scale checks.
    u=np.asarray(values,dtype=np.int64);e=(u >> 7) & 255
    assert np.all(e < 138)
    magnitude=(128+(u & 127)) << np.maximum(e-110,0)
    magnitude >>= np.minimum(np.maximum(110-e,0),63)
    return np.where((u & 32768)!=0,-magnitude,magnitude)


def exact_scale(delta):
    d = np.asarray(delta, dtype=np.int64)
    assert np.all((d > 0) & (d < 31 * (1 << 23)))
    q, r = d // 31, d % 31
    radius = np.where(q >= 1 << 22, 8, np.where(q >= 1 << 21, 4,
             np.where(q >= 1 << 20, 2, np.where(q >= 1 << 19, 1, 0))))
    tie = (r >= 16 - radius) & (r <= 15 + radius)
    return np.maximum(1, np.where(tie, q + (q & 1), (d + 15) // 31))


def parse(blob, g):
    o = np.frombuffer(blob[:g*4], dtype='<i4').astype(np.int64)
    s = np.frombuffer(blob[g*4:g*8], dtype='<u4').astype(np.int64)
    c = unpack_codes(blob[g*8:], 5, g*64).reshape(g, 64)
    return o, s, c


def legacy(o, s, c):
    return np.asarray(o, dtype='<i4').tobytes() + np.asarray(s, dtype='<u4').tobytes() + pack_codes(c, 5)


def encode(o, s, c, mode):
    g = len(o)
    codes = pack(c.reshape(-1,8)[:,::-1].reshape(-1), 5)
    if mode == 'compact':
        lo = bf16(o.astype(np.float32) / (1 << 24))
        hi = bf16((o + s * 31).astype(np.float32) / (1 << 24))
        offsets, maxima = bf16_q24(lo), bf16_q24(hi)
        delta = maxima - offsets
        assert np.array_equal(offsets, o)
        assert np.array_equal(delta.astype(np.float32).astype(np.int64), delta)
        assert np.array_equal(exact_scale(delta), s)
        lb, hb = int(lo.min()), int(hi.min())
        lw, hw = max(1, int(lo.max()-lb).bit_length()), max(1, int(hi.max()-hb).bit_length())
        meta = ((lo.astype(np.uint64)-lb) << hw) | (hi.astype(np.uint64)-hb)
        return b'F5B1'+g.to_bytes(4,'big')+lb.to_bytes(2,'big')+hb.to_bytes(2,'big')+bytes([lw,hw,0,0])+pack(meta,lw+hw)+codes
    assert mode == 'shifted'
    v = int(np.bitwise_or.reduce(np.abs(o)))
    shift = (v & -v).bit_length()-1 if v else 0
    small = o >> shift
    ob = max(abs(int(small.min())), int(small.max())).bit_length()+1
    sb = max(1, int(s.max()).bit_length())
    stride = max(4, (ob+sb+7)//8)
    assert stride in [4,5,6] and sb <= 23 and shift <= 31
    packed = ((small.astype(np.uint64) & ((1 << (stride*8-sb))-1)) << sb) | s.astype(np.uint64)
    return b'F5S1'+g.to_bytes(4,'big')+bytes([stride,shift,sb])+bytes(5)+b''.join(int(v).to_bytes(stride,'big') for v in packed)+codes


def decode(blob):
    g = int.from_bytes(blob[4:8], 'big')
    if blob[:4] == b'F5B1':
        lw, hw = blob[12:14]; n = (g*(lw+hw)+7)//8
        meta = unpack(blob[16:16+n], lw+hw, g)
        lo = int.from_bytes(blob[8:10],'big') + (meta >> hw)
        hi = int.from_bytes(blob[10:12],'big') + (meta & ((1 << hw)-1))
        o = bf16_q24(lo); s = exact_scale(bf16_q24(hi)-o)
    else:
        assert blob[:4] == b'F5S1'
        stride, shift, sb = blob[8:11]; n = g*stride; ob = stride*8-sb
        records = blob[16:16+n]
        values = [int.from_bytes(records[i:i+stride],'big') for i in range(0,n,stride)]
        small = [v >> sb for v in values]
        o = np.array([(v-(1 << ob) if v >> (ob-1) else v) << shift for v in small], dtype=np.int64)
        s = np.array([v & ((1 << sb)-1) for v in values], dtype=np.int64)
    c = unpack(blob[16+n:],5,g*64).reshape(-1,8)[:,::-1].reshape(g,64).astype(np.uint8)
    return legacy(o,s,c)


def main():
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    m=json.loads((a.source/'manifest.json').read_text());raw=(a.source/'weights.bin').read_bytes()
    assert m['variant']=='int5' and hashlib.sha256(raw).hexdigest()==m['sha256']
    report={'status':'running','source_sha256':m['sha256'],'scope':'Exact re-encoding of new int5 weights; NOT unchanged int6 weights','variants':[]}
    for mode in ['compact','shifted']:
        parts=[]; entries=[];cursor=16+32*len(m['tensors']);restored=[raw[:m['tensors'][0]['offset']]]
        for t in m['tensors']:
            original=raw[t['offset']:t['offset']+t['byte_count']]
            blob=encode(*parse(original,t['group_count']),mode) if 'group_count' in t else original
            back=decode(blob) if 'group_count' in t else blob
            assert original==back,t['name'];restored.append(back)
            entries.append({'name':t['name'],'shape':t['shape'],'offset':cursor,'byte_count':len(blob),'sha256':hashlib.sha256(blob).hexdigest(),'matrix':'group_count' in t})
            parts.append(blob);cursor+=len(blob)
        assert b''.join(restored)==raw
        desc=b''
        for e in entries:
            dims=e['shape']+[0]*(4-len(e['shape']))
            desc+=e['offset'].to_bytes(4,'big')+e['byte_count'].to_bytes(4,'big')+b''.join(d.to_bytes(4,'big') for d in dims)+bytes([int(e['matrix']),len(e['shape'])])+bytes(6)
        data=(b'G5COMPT1' if mode=='compact' else b'G5SHIFT1')+len(entries).to_bytes(4,'big')+bytes(4)+desc+b''.join(parts)
        assert len(data)==cursor
        item={'mode':mode,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'exact_int5_source_roundtrip':True,'tensor_count':len(entries),'layouts':[layout(data,24575),layout(data,61439)]}
        folder=a.output/mode;folder.mkdir(parents=True,exist_ok=True)
        (folder/'weights.bin').write_bytes(data)
        manifest={**item,'tensors':entries};(folder/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
        (ROOT/(mode+'-manifest.json')).write_text(json.dumps(manifest,indent=2)+'\n')
        report['variants'].append(item);print(json.dumps(item),flush=True)
    report['status']='completed';(ROOT/'storage-results.json').write_text(json.dumps(report,indent=2)+'\n')


if __name__=='__main__':main()
