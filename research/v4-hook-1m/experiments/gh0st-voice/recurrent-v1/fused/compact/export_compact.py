"""Prepare a compact resident image from a completed exact-fusion export."""
import argparse,hashlib,json
from pathlib import Path

p=argparse.ArgumentParser();p.add_argument('--fused-dir',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
assert not a.out.exists();source=json.loads((a.fused_dir/'manifest.json').read_text())
assert source['fused_precomputation']['all_entries_roundtrip']
a.out.mkdir(parents=True);sha=lambda b:hashlib.sha256(b).hexdigest()
core=(a.fused_dir/'core.bin').read_bytes();assert len(core)==284610
assert sha(core)==source['artifacts']['core.bin']['sha256']
resident=core[140450:284080];assert len(resident)==143630
(a.out/'core.bin').write_bytes(resident)
artifacts={'core.bin':{'bytes':len(resident),'sha256':sha(resident)}}
for name in ['nodes.bin','vocabulary.bin','vocabulary.json','sigmoid-delta.bin','fused.bin']:
    raw=(a.fused_dir/name).read_bytes();assert sha(raw)==source['artifacts'][name]['sha256']
    (a.out/name).symlink_to((a.fused_dir/name).resolve())
    artifacts[name]={'bytes':len(raw),'sha256':sha(raw)}
manifest={**source,'artifacts':artifacts,'source_original_artifacts':source['artifacts'],
    'model_domain':'GH0ST_RECURRENT_WORD_H265_Q10_COMPACT_LOCAL_V1',
    'core_order':['wh','wf'],'core_value_offsets':{'wh':0,'wf':70225},
    'compiled_from_trained_parameters':4492256,'resident_directly_stored_original_parameters':2250621,
    'derived_input_values':2171145,'omitted_runtime_blobs':['original wx','original bh','original embeddings'],
    'source_fused_manifest_sha256':sha((a.fused_dir/'manifest.json').read_bytes()),
    'source_fused_directory':str(a.fused_dir.resolve()),
    'status':'PREPARED_NOT_EVM_TESTED','parameter_claim':'Compiled from a4,492,256-parameter model; resident direct+derived values are not independent learned parameters.'}
manifest['fused_precomputation']={**source['fused_precomputation'],'original_parameter_blobs_retained':False}
(a.out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'status':manifest['status'],'resident_binary_bytes':sum(v['bytes']for k,v in artifacts.items()if k.endswith('.bin'))}))
