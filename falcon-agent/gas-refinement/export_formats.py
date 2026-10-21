"""Exact alternative metadata exports and modeled deployment costs.

Model binaries stay outside the repository. No public network calls or signing.
"""
import argparse,hashlib,json,sys
from pathlib import Path
import numpy as np
from benchmark import source,tensor,shifted,predecoded,fixed,encode_matrix,legacy
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent/'research-quality'))
from costs import layout
sys.path.insert(0,str(ROOT.parent/'sixbit-optimization'))
from optimize import unpack

def decode(blob):
 g=int.from_bytes(blob[4:8],'big');magic=blob[:4]
 if magic==b'F6P1':
  stride=7;records=blob[16:16+g*stride]
  o=np.array([int.from_bytes(records[i:i+4],'big',signed=True) for i in range(0,len(records),7)],dtype='<i4')
  s=np.array([int.from_bytes(records[i+4:i+7],'big') for i in range(0,len(records),7)],dtype='<u4')
 elif magic in [b'F6S1',b'F6F1']:
  stride,shift,sb=blob[8:11] if magic==b'F6S1' else (5,blob[8],21)
  records=blob[16:16+g*stride];ob=stride*8-sb
  v=[int.from_bytes(records[i:i+stride],'big') for i in range(0,len(records),stride)]
  offsets=[n>>sb for n in v];offsets=[(n-(1<<ob) if n>>(ob-1) else n)<<shift for n in offsets]
  assert all(-(1<<31)<=n<(1<<31) for n in offsets)
  o=np.array(offsets,dtype='<i4');s=np.array([n&((1<<sb)-1) for n in v],dtype='<u4')
 else:raise ValueError('unknown format')
 c=unpack(blob[16+g*stride:],6,g*64).reshape(-1,8)[:,::-1].reshape(-1).astype(np.uint8)
 return legacy(o,s,c)

def main():
 p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 raw,m=source(a.source);report={'status':'running','source_sha256':m['sha256'],'scope':'Exact metadata re-encoding; modeled Cancun creation gas, not live chain fees','excludes':['engine','tokenizer','controller','shard address directory','chain-specific data fees'],'variants':[]}
 for name,encoder,magic in [('shifted',shifted,b'G6SHIFT1'),('predecoded',predecoded,b'G6PREDC1'),('fixed',fixed,b'G6FIXED1')]:
  folder=a.output/name;folder.mkdir(parents=True,exist_ok=True);parts=[];entries=[];cursor=16+32*len(m['tensors']);restored=[raw[:m['tensors'][0]['offset']]]
  for t in m['tensors']:
   original=raw[t['offset']:t['offset']+t['byte_count']]
   if 'group_count' in t:
    o,s,c=tensor(raw,t);compact,_=encode_matrix(original,t['group_count']);blob=encoder(o,s,compact);back=decode(blob)
   else:blob=back=original
   assert back==original,t['name'];restored.append(back)
   entries.append({'name':t['name'],'shape':t['shape'],'offset':cursor,'byte_count':len(blob),'sha256':hashlib.sha256(blob).hexdigest(),'matrix':bool('group_count' in t)});parts.append(blob);cursor+=len(blob)
  assert b''.join(restored)==raw
  descriptors=b''
  for e in entries:
   shape=e['shape'];dims=shape+[0]*(4-len(shape))
   descriptors+=e['offset'].to_bytes(4,'big')+e['byte_count'].to_bytes(4,'big')+b''.join(d.to_bytes(4,'big') for d in dims)+bytes([int(e['matrix']),len(shape)])+bytes(6)
  data=magic+len(entries).to_bytes(4,'big')+bytes(4)+descriptors+b''.join(parts);assert len(data)==cursor
  result={'name':name,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'exact_source_roundtrip':True,'tensor_count':len(entries),'layouts':[layout(data,24575),layout(data,61439)]}
  (folder/'weights.bin').write_bytes(data);(folder/'manifest.json').write_text(json.dumps({**result,'tensors':entries},indent=2)+'\n')
  (ROOT/(name+'-manifest.json')).write_text(json.dumps({**result,'tensors':entries},indent=2)+'\n');report['variants'].append(result)
  print(json.dumps(result),flush=True)
 report['status']='completed';(ROOT/'storage-results.json').write_text(json.dumps(report,indent=2)+'\n')
if __name__=='__main__':main()
