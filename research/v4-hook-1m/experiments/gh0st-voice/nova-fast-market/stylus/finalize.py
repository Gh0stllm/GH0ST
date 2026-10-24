"""Bind local WASM numerical evidence to exact sources and compiled artifacts."""
from pathlib import Path
import hashlib,json,shutil
P=Path(__file__).resolve().parent
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
sourcefiles=['export-raw.py','export-packed3.py','make-probes.py','benchmark-wasm.mjs','test-probes.mjs','test-meter-entry.mjs','benchmark-packed3.mjs','test-packed3-probes.mjs','test-packed3-meter-entry.mjs','wasm-kernel/Cargo.toml','wasm-kernel/src/lib.rs','wasm-packed3/Cargo.toml','wasm-packed3/src/lib.rs','reproduce-local.sh','finalize.py','test-packed3-seed-entry.mjs','review-delta-packed.py']
report={'status':'PASS_LOCAL_NUMERICAL_TESTS_ONLY','public_transactions':0,'chain_rpc_calls':0,'checkpoint_sha256':'904e4ee0426dc62c06b5551db19d2ee40d0c0c618fdb62c4a49a39af80d390d3','sources':{name:sha(P/name)for name in sourcefiles},'variants':{},'claims':{'same_quantized_model':True,'stylus_gas_measured_by_this_script':False,'v4_hook_integrated':False,'ten_sentences_per_second_on_chain_proven':False,'production_immutable_catalogs_bound':False}}
A=P/'artifacts';A.mkdir(exist_ok=True)
for crate,prefix in [('wasm-kernel',''),('wasm-packed3','packed3-')]:
 rows=json.loads((P/(prefix+'wasm-results.json')).read_text());probes=json.loads((P/(prefix+'wasm-probe-results.json')).read_text());entry=json.loads((P/(prefix+'meter-entry-parity.json')).read_text())
 assert rows['status']=='PASS_EXACT_REFERENCE_PARITY' and probes['status']=='PASS' and entry['status']=='PASS_LOCAL_UNMETERED_ENTRYPOINT'
 binaryname='nova_wasm_kernel.wasm'if crate=='wasm-kernel'else'nova_wasm_packed3.wasm'
 source=P/crate/'target/wasm32-unknown-unknown/release'/binaryname
 meter=P/crate/'target-meter/wasm32-unknown-unknown/release'/binaryname
 assert sha(source)==rows['wasm_sha256'] and sha(meter)==entry['wasm_sha256']
 names=[crate+'.wasm',crate+'-entrypoint.wasm']
 for src,dst in zip([source,meter],names):shutil.copyfile(src,A/dst)
 report['variants'][crate]={'source_sha256':sha(P/crate/'src/lib.rs'),'numerical_wasm':{'path':'artifacts/'+names[0],'sha256':sha(source),'bytes':source.stat().st_size},'meter_entry_wasm':{'path':'artifacts/'+names[1],'sha256':sha(meter),'bytes':meter.stat().st_size},'neural_words_checked':rows['total_neural_words'],'additional_exact_vectors':len(probes['checks']),'rejected_invalid_inputs':len(probes['rejects']),'reference_report_sha256':sha(P/(prefix+'wasm-results.json')),'probe_report_sha256':sha(P/(prefix+'wasm-probe-results.json')),'meter_entry_report_sha256':sha(P/(prefix+'meter-entry-parity.json'))}
seed_report=P/'packed3-seed-entry-parity.json'
if seed_report.exists():
 seeds=json.loads(seed_report.read_text());src=P/'wasm-packed3/target-meter-seeds/wasm32-unknown-unknown/release/nova_wasm_packed3.wasm';assert seeds['status']=='PASS_UNMETERED_LOCAL_SEED_ENTRYPOINT' and sha(src)==seeds['wasm_sha256'];shutil.copyfile(src,A/'wasm-packed3-seed-entrypoint.wasm');report['seed_entrypoint']={'path':'artifacts/wasm-packed3-seed-entrypoint.wasm','sha256':sha(src),'seeds_tested':len(seeds['cases']),'report_sha256':sha(seed_report)}
kernel=P.parent/'kernels/wasm-unroll'
if (kernel/'seed-entry-parity.json').exists():
 seed=json.loads((kernel/'seed-entry-parity.json').read_text());fixed=next(r for r in json.loads((kernel/'artifacts.json').read_text())if r['unroll']==32)
 fixed_file=kernel/'artifacts/nova-unroll32-fixed.wasm';seed_file=kernel/'artifacts/nova-unroll32-seeds.wasm'
 assert sha(fixed_file)==fixed['meterWasmSha256'] and sha(seed_file)==seed['wasm_sha256']
 assert seed['status']=='PASS_UNMETERED_LOCAL_SEED_ENTRYPOINT' and len(seed['cases'])==16
 for src,name in [(fixed_file,'nova-unroll32-fixed.wasm'),(seed_file,'nova-unroll32-seeds.wasm')]:shutil.copyfile(src,A/name)
 report['selected_offline_meter_candidate']={'name':'unroll32-packed3','same_checkpoint':True,'sentence_scope':'Zero hidden state/BOS reset; fixed features;16seeds; no arbitrary-context or continuous-story guarantee.','fixed_source_path':'../kernels/wasm-unroll/32/src/lib.rs','fixed_source_sha256':sha(kernel/'32/src/lib.rs'),'seed_source_path':'../kernels/wasm-unroll/32-seeds/src/lib.rs','seed_source_sha256':sha(kernel/'32-seeds/src/lib.rs'),'fixed_artifact':{'path':'artifacts/nova-unroll32-fixed.wasm','sha256':sha(fixed_file),'bytes':fixed_file.stat().st_size},'seed_artifact':{'path':'artifacts/nova-unroll32-seeds.wasm','sha256':sha(seed_file),'bytes':seed_file.stat().st_size},'reports':{name:sha(kernel/name)for name in ['unroll32-results.json','unroll32-probe-results.json','seed-entry-parity.json']},'full_swap_integrated':False}
for directory in ['raw-model','packed3-model']:
 file=P/directory/'manifest.json';meta=json.loads(file.read_text());meta['optimization_status']='LOCAL_UNMETERED_WASM_PARITY_ONLY_NOT_STYLUS_GAS_VALIDATED';file.write_text(json.dumps(meta,indent=2)+'\n')
(P/'BUILD-MANIFEST.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':report['status'],'variants':list(report['variants'])}))
