"""Combine completed quality, storage and local EVM evidence."""
import hashlib, json
from pathlib import Path

ROOT=Path(__file__).resolve().parent
quality=json.loads((ROOT/'quality-results.json').read_text())
storage=json.loads((ROOT/'storage-results.json').read_text())
kernel=json.loads((ROOT/'kernel-results.json').read_text())
assert all(x['status']=='completed' for x in [quality,storage,kernel])
assert kernel['source_sha256']==storage['source_sha256']==quality['variants'][2]['export']['sha256']
assert len(kernel['matrices'])==217 and kernel['rows_verified']==165440 and kernel['tiles']==2600
assert kernel['weight_elements']==90996736
report={
    'status':'completed','selected_sixbit_manifests_changed':False,'public_transactions_broadcast':0,
    'quality':[{k:v for k,v in row.items() if k not in ['cases','export','seconds']} for row in quality['variants']],
    'historical_generation_matches_out_of_32':quality['historical_generation_matches_out_of_32'],
    'storage':storage['variants'],
    'matrix_receipt_gas':kernel['usage_gas'],
    'matrix_count':len(kernel['matrices']),'verified_rows_per_kernel':kernel['rows_verified'],
    'edge_checks':len(kernel['edge_checks']),'malformed_rejections':len(kernel['malformed_rejections']),
    'deployment_samples_matching_model':len(kernel['deployment_samples']),
    'dilation_checks':kernel['dilation_checks'],'scale_boundary_checks':kernel['scale_boundary_checks'],
    'kernel_deployments':kernel['kernel_deployments'],
    'source_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(ROOT.glob('*.sol'))},
    'limitations':['Small reused development prompt set; agreement is not accuracy',
                   'Weight-dequantized CPU float32 quality evaluation, not EVM inference',
                   'Complete weight-deployment gas modeled, not publicly executed',
                   'Full on-chain model and cross-shard scheduler remain unimplemented'],
}
(ROOT/'measurement-summary.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
