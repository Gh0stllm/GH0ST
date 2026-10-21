"""Recreate the pinned historical int6 export from the pinned public checkpoint.
No inference, retraining, or new quantization policy. Output must match old SHA256.
"""
import argparse, hashlib, json, sys
from pathlib import Path
import numpy as np
from safetensors import safe_open
import torch
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent/'sixbit-optimization'))
from optimize import PIN, encode_matrix

def main():
 p=argparse.ArgumentParser();p.add_argument('--checkpoint',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 assert hashlib.sha256(a.checkpoint.read_bytes()).hexdigest()=='199e9960cd9be797579bd7dfc2b19f72e098e9c4cd3720afd50c815b48080578'
 m=json.loads((ROOT.parent/'sixbit-optimization/weight-manifest.json').read_text())
 a.output.mkdir(parents=True,exist_ok=True);entries=[]
 with safe_open(a.checkpoint,framework='pt',device='cpu') as sf,(a.output/'weights.bin').open('wb') as out:
  out.write(b'FALCON_AFFINE_V1\0')
  for t in m['tensors']:
   x=sf.get_tensor(t['name'])
   if 'group_count' in t:
    v=x.float().numpy().reshape(-1,64)
    o=np.rint(v.min(1).astype(np.float64)*(1<<24)).astype('<i4')
    s=np.maximum(1,np.rint((v.max(1)-v.min(1))*(1<<24)/63)).astype('<u4')
    c=np.clip(np.rint((v-o.astype(np.float32)[:,None]/(1<<24))/(s.astype(np.float32)[:,None]/(1<<24))),0,63).astype(np.uint8)
    bits=((c.reshape(-1,1)>>np.arange(6,dtype=np.uint8))&1).reshape(-1)
    blob=o.tobytes()+s.tobytes()+np.packbits(bits,bitorder='little').tobytes()
    compact,_=encode_matrix(blob,t['group_count']);assert hashlib.sha256(compact).hexdigest()==t['sha256'],t['name']
   else:blob=x.to(torch.bfloat16).view(torch.uint16).numpy().astype('<u2').tobytes();assert hashlib.sha256(blob).hexdigest()==t['sha256']
   assert len(blob)==t['source_byte_count'] and out.tell()==t['source_offset']
   entries.append({**t,'offset':out.tell(),'byte_count':len(blob),'sha256':hashlib.sha256(blob).hexdigest()});out.write(blob)
 raw=(a.output/'weights.bin').read_bytes();digest=hashlib.sha256(raw).hexdigest();assert digest==PIN,digest
 result={'variant':'int6','sha256':digest,'bytes':len(raw),'tensors':entries}
 (a.output/'manifest.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps({'bytes':len(raw),'sha256':digest,'tensors':len(entries),'exact_compact_tensor_hashes_verified':True}),flush=True)
if __name__=='__main__': main()
