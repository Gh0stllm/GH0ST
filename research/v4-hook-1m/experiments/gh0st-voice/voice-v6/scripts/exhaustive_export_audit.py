#!/usr/bin/env python3
"""Exhaustive offline audit of the H224 adaptive-head Q10 export; no network or EVM."""
from pathlib import Path
from decimal import Decimal, localcontext, ROUND_HALF_EVEN
import argparse,hashlib,json,re,time
import numpy as np
from safetensors.numpy import load_file

V6=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--checkpoint',type=Path,default=V6/'training/runs/style-expanded-4m/checkpoint-001006452')
parser.add_argument('--export',dest='export_dir',type=Path,default=V6/'exports/style-selected-1m')
parser.add_argument('--data',type=Path,default=V6/'training/encoded-expanded')
parser.add_argument('--out',type=Path)
args=parser.parse_args()
CHECKPOINT=args.checkpoint.resolve();EXPORT=args.export_dir.resolve();DATA=args.data.resolve()
OUT=args.out or EXPORT/'exhaustive-export-audit.json'
H,V,Q=224,8192,1024
started=time.monotonic();errors=[];checks={};pins={}
def sha(data):return hashlib.sha256(data).hexdigest()
def read(path):
 data=path.read_bytes();key=str(path.relative_to(V6));record={'bytes':len(data),'sha256':sha(data)}
 if key in pins and pins[key]!=record:raise RuntimeError('Input changed: '+key)
 pins[key]=record;return data

def record(name,actual,expected):
 a=np.asarray(actual);e=np.asarray(expected)
 shape_ok=a.shape==e.shape
 mismatch=int(np.count_nonzero(a!=e))if shape_ok else None
 checks[name]={'pass':shape_ok and mismatch==0,'actual_shape':list(a.shape),'expected_shape':list(e.shape),'values_compared':int(e.size),'mismatched_values':mismatch,'actual_min':int(a.min())if a.size else None,'actual_max':int(a.max())if a.size else None}
 if not checks[name]['pass']:errors.append(name)

def expected_q10(value):
 # Explicit nearest-even, rather than the exporter's np.rint implementation.
 scaled=value.astype(np.float64)*Q
 floor=np.floor(scaled);fraction=scaled-floor
 rounded=np.where(fraction<.5,floor,np.where(fraction>.5,floor+1,np.where(np.remainder(floor,2)==0,floor,floor+1)))
 return rounded.astype(np.int64),int(np.count_nonzero(fraction==.5))

def i16(name,shape):
 raw=read(EXPORT/name)
 if len(raw)!=int(np.prod(shape))*2:raise ValueError('Invalid int16 shape/length: '+name)
 return np.frombuffer(raw,dtype='>i2').astype(np.int64).reshape(shape)

manifest=json.loads(read(EXPORT/'manifest.json'))
checkpoint_bytes=read(CHECKPOINT/'model.safetensors')
metadata=json.loads(read(CHECKPOINT/'metadata.json'))
assert sha(checkpoint_bytes)==manifest['checkpoint_sha256']==metadata['weight_sha256']
source=load_file(CHECKPOINT/'model.safetensors')
expected_shapes={'embedding.weight':(8194,224),'wx':(672,224),'wh':(672,224),'wf':(672,6),'bh':(672,),'domain.weight':(2,672),'groups.weight':(128,224),'group_bias.weight':(128,1),'words.weight':(8192,224),'word_bias.weight':(8192,1)}
assert set(source)==set(expected_shapes)
quantized={};tensor_ranges={}
for name,value in source.items():
 assert value.shape==expected_shapes[name]and np.isfinite(value).all(),name
 q,ties=expected_q10(value)
 assert q.min()>=-32768 and q.max()<=32767,name
 quantized[name]=q
 tensor_ranges[name]={'shape':list(q.shape),'values':q.size,'float_min':float(value.min()),'float_max':float(value.max()),'q10_min':int(q.min()),'q10_max':int(q.max()),'half_integer_ties_checked':ties,'nearest_even_matches_numpy_crosscheck':bool(np.array_equal(q,np.rint(value.astype(np.float64)*Q).astype(np.int64)))}
 exp_range=manifest['ranges'][name]
 assert list(q.shape)==exp_range['shape']and int(q.min())==exp_range['min']and int(q.max())==exp_range['max']
assert sum(q.size for q in quantized.values())==4014560==manifest['parameters']
# All directly represented tensor values, including the complete reference inputs.
record('all_runtime_embedding_rows',i16('original-embedding.bin',(8193,H)),quantized['embedding.weight'][:8193])
record('all_input_projection_weights',i16('original-wx.bin',(672,H)),quantized['wx'])
record('all_input_biases',i16('original-bh.bin',(672,)),quantized['bh'])
record('both_domain_rows_reference',i16('original-domain.bin',(2,672)),quantized['domain.weight'])
core=i16('core.bin',(154560,))
record('all_core_recurrent_weights',core[:150528].reshape(672,H),quantized['wh'])
record('all_core_feature_weights',core[150528:].reshape(672,6),quantized['wf'])
groups=i16('groups.bin',(128,225));words=i16('words.bin',(8192,225))
record('all_group_weights',groups[:,:H],quantized['groups.weight'])
record('all_group_biases',groups[:,H:],quantized['group_bias.weight'])
record('all_word_weights',words[:,:H],quantized['words.weight'])
record('all_word_biases',words[:,H:],quantized['word_bias.weight'])
# Decode every signed40 five-byte integer independently of exporter byte shifts.
fused_raw=read(EXPORT/'fused.bin');assert len(fused_raw)==8193*672*5
b=np.frombuffer(fused_raw,dtype=np.uint8).reshape(-1,5).astype(np.int64)
decoded=b[:,0].copy()
for column in range(1,5):decoded=decoded*256+b[:,column]
decoded=np.where(decoded >= (1<<39),decoded-(1<<40),decoded).reshape(8193,672)
assert decoded.min()>=-(1<<39)and decoded.max()<(1<<39)
expected=quantized['embedding.weight'][:8193]@quantized['wx'].T+(quantized['bh']+quantized['domain.weight'][0])[None,:]*Q
record('all_fused_signed40_values',decoded,expected)
assert expected.size==5505696
assert int(decoded.min())==manifest['fused_min']and int(decoded.max())==manifest['fused_max']
# No training-only UNK row can be addressed or packed; domain0 is the actual folded row.
unknown={'source_embedding_rows':8194,'runtime_embedding_rows':8193,'runtime_output_rows':8192,'BOS_input_id':8192,'UNK_training_input_id':8193,'UNK_row_values_excluded':224,'original_embedding_bytes':len(read(EXPORT/'original-embedding.bin')),'fused_rows':decoded.shape[0],'pass':True}
wrong_domain=quantized['embedding.weight'][:8193]@quantized['wx'].T+(quantized['bh']+quantized['domain.weight'][1])[None,:]*Q
wrong_domain_differences=int(np.count_nonzero(decoded!=wrong_domain))
assert wrong_domain_differences>0
# Every vocabulary slot, padding byte and output ID is verified against encoded data.
vocabulary=json.loads(read(EXPORT/'vocabulary.json'))
expected_vocabulary=json.loads(read(DATA/'vocabulary.json'))
data_manifest=json.loads(read(DATA/'manifest.json'))
assert sha((DATA/'manifest.json').read_bytes())==manifest['data_manifest_sha256']
assert vocabulary==expected_vocabulary and len(vocabulary)==V and len(set(vocabulary))==V
vocab_raw=read(EXPORT/'vocabulary.bin');assert len(vocab_raw)==V*32
padding_checked=0
for index,word in enumerate(vocabulary):
 assert re.fullmatch(r"[a-z]+(?:'[a-z]+)*(?:[.!?])?",word),index
 encoded=word.encode('ascii');assert 1<=len(encoded)<=32
 slot=vocab_raw[index*32:(index+1)*32]
 assert slot[:len(encoded)]==encoded and slot[len(encoded):]==bytes(32-len(encoded)),index
 padding_checked+=32-len(encoded)
assert vocab_raw==read(DATA/'vocabulary.bin')
vocab_report={'pass':True,'all_rows_compared':V,'unique_words':len(set(vocabulary)),'nonempty_ascii_words':True,'max_word_bytes':max(len(w)for w in vocabulary),'padding_bytes_verified':padding_checked,'BOS_or_UNK_output_slots':0,'matches_encoded_expanded_vocabulary':True}
# Independent high-precision reconstruction of both tables, including all entries.
with localcontext()as context:
 context.prec=60
 sigmoid_expected=[];exp_expected=[]
 for i in range(257):
  exponent=(-Decimal(i)/Decimal(16)).exp()
  sigmoid_expected.append(int((Decimal(65536)/(Decimal(1)+exponent)).quantize(Decimal(1),rounding=ROUND_HALF_EVEN))-32768)
  exp_expected.append(int((Decimal(2**32)*exponent).quantize(Decimal(1),rounding=ROUND_HALF_EVEN)))
sigmoid=np.frombuffer(read(EXPORT/'sigmoid-delta.bin'),dtype='>u2').astype(np.int64)
exponential=np.frombuffer(read(EXPORT/'exp-q32.bin'),dtype='>u8').astype(np.int64)
record('all_sigmoid_table_entries',sigmoid,np.array(sigmoid_expected,dtype=np.int64))
record('all_exponential_table_entries',exponential,np.array(exp_expected,dtype=np.int64))
assert len(sigmoid)==len(exponential)==257
assert sigmoid[0]==0 and sigmoid[-1]==32768 and np.all(np.diff(sigmoid)>=0)
assert exponential[0]==2**32 and exponential[-1]>0 and np.all(np.diff(exponential)<0)
contract=read(EXPORT/'AdaptiveGRUWordModel.sol').decode()
for name,payload in [('SIGMOID_DELTA',read(EXPORT/'sigmoid-delta.bin')),('EXP_Q32',read(EXPORT/'exp-q32.bin'))]:
 found=re.search(name+r'\s*=\s*hex"([0-9a-f]+)"',contract)
 assert found and bytes.fromhex(found.group(1))==payload,name
assert f'SOURCE_MODEL_PARAMETERS = {sum(q.size for q in quantized.values())}'in contract
assert 'block.chainid != 31337'in contract
assert 'previous>8192'in contract and 'token >= VOCABULARY'in contract
for kind in ['artifacts','reference_only_sources']:
 for name,expected_file in manifest[kind].items():
  actual=read(EXPORT/name)
  assert len(actual)==expected_file['bytes']and sha(actual)==expected_file['sha256'],name
# Re-read all inputs after computation to prove the audited bytes did not move.
for relative,pin in list(pins.items()):
 actual=(V6/relative).read_bytes()
 assert sha(actual)==pin['sha256']and len(actual)==pin['bytes'],relative
report={'status':'PASS'if not errors else'FAIL','auditor_sha256':sha(Path(__file__).read_bytes()),'scope':'Exhaustive offline checkpoint-to-export numeric, packing and vocabulary audit. No EVM, network, mainnet, or language-quality claim.','checkpoint':str(CHECKPOINT),'export':str(EXPORT),'quantization':'Manual floor/fraction nearest-even Q10 on every source float; crosschecked against numpy.rint. No clipping.','source_parameter_count':4014560,'source_tensors_quantized':len(source),'source_values_quantized':sum(q.size for q in quantized.values()),'direct_export_tensor_values_compared':sum(x['values_compared']for k,x in checks.items()if k not in ['all_fused_signed40_values','all_sigmoid_table_entries','all_exponential_table_entries']),'fused_values_compared':5505696,'fusion':'For every row0..8192 and column0..671, decode signed40 and compare int64 embeddingQ10 @ wxQ10.T + (bhQ10 + domain0Q10)*1024. No division occurs before packing.','fused_range':{'min':int(decoded.min()),'max':int(decoded.max()),'width_bits':40,'wrong_domain1_mismatches':wrong_domain_differences},'source_tensor_ranges':tensor_ranges,'checks':checks,'training_only_unknown':unknown,'vocabulary':vocab_report,'lookup_tables':{'sigmoid_entries':257,'sigmoid_bytes':514,'sigmoid_nondecreasing':True,'sigmoid_endpoints':[int(sigmoid[0]),int(sigmoid[-1])],'exp_entries':257,'exp_bytes':2056,'exp_strictly_decreasing':True,'exp_positive_tail':True,'exp_endpoints':[int(exponential[0]),int(exponential[-1])],'matches_contract_constants':True,'generation':'60-digit Decimal exponential; nearest-even integer rounding, every entry compared.'},'input_hashes':pins,'input_files_unchanged_after_audit':True,'errors':errors,'seconds':time.monotonic()-started}
OUT.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k]for k in ['status','source_values_quantized','direct_export_tensor_values_compared','fused_values_compared','fused_range','vocabulary','seconds']},indent=2))
if errors:raise SystemExit(1)
