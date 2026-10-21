"""Verify compiled-weight provenance and report execution/deployment trade-offs."""
import hashlib,json,math
from datetime import datetime,timezone
from pathlib import Path
from eth_utils import keccak
from compiled_weights import ROOT,decode_rows,runtime

def read(name):return json.loads((ROOT.parent/'results'/(name+'.json')).read_text())

def main():
    old=read('block-optimized-batch8-local');new=read('block-compiled-batch8-local');scalar=read('block-local')
    kernel=read('compiled-weight-kernels')
    assert old['status']==new['status']==kernel['status']=='passed'
    assert len(new['tokens'])==3 and len(new['deployments'])==4559
    assert all(c['passed'] for c in new['checks'])
    assert new['public_transactions_broadcast']==0 and new['public_eth_spent']=='0'
    assert sum(d['local_gas_used'] for d in new['deployments'])==new['total_local_deployment_gas']
    assert len(kernel['cases'])==71
    assert all(c.get('matches_reference') or c.get('expected_overflow_rejected') for c in kernel['cases'])
    manifest=json.loads((ROOT/'compiled-weight-manifest.json').read_text())
    original=json.loads((ROOT/'manifest.json').read_text())
    assert manifest['original_manifest_sha256']==hashlib.sha256((ROOT/'manifest.json').read_bytes()).hexdigest()
    assert len(manifest['programs'])==4192
    # Regenerate every program from its corresponding original int4 rows.
    regenerated=0
    for index,shard in enumerate(original['shards'][:352]):
        cols=1024 if index<288 else 2560
        payload=(ROOT/'data'/shard['file']).read_bytes()
        assert hashlib.sha256(payload).hexdigest()==shard['sha256']
        decoded=decode_rows(payload,shard['rows'],cols)
        entry=manifest['logical_shards'][index]
        covered=[]
        for p in manifest['programs'][entry['first_program']:entry['first_program']+entry['program_count']]:
            code=(ROOT/'compiled-weight-data'/p['file']).read_bytes()
            assert p['logical_shard']==index and p['columns']==cols
            assert code==runtime(decoded[p['row']:p['row']+p['rows']],cols)
            assert hashlib.sha256(code).hexdigest()==p['sha256'] and '0x'+keccak(code).hex()==p['codehash']
            assert len(code)==p['bytes'] and len(code)<=24576
            covered.extend(range(p['row'],p['row']+p['rows']));regenerated+=1
        assert covered==list(range(shard['rows']))
    assert regenerated==4192
    for i,t in enumerate(new['tokens']):
        assert len(t['steps'])==383 and all(s['reference_match'] for s in t['steps'])
        assert t['output_matches_reference'] and t['persisted_vectors_checked']==12
        assert t['output_sha256']==old['tokens'][i]['output_sha256']==scalar['tokens'][i]['output_sha256']
        assert t['transaction_count']==52 and len(t['transactions'])==51
        assert sum(x['step_count'] for x in t['transactions'])==383
        assert t['total_local_gas_used']==t['begin_gas_used']+sum(x['local_gas_used'] for x in t['transactions'])
    extra=new['total_local_deployment_gas']-old['total_local_deployment_gas']
    savings=[a['total_local_gas_used']-b['total_local_gas_used'] for a,b in zip(old['tokens'],new['tokens'])]
    reductions=[100*s/a['total_local_gas_used'] for s,a in zip(savings,old['tokens'])]
    groups={k:[d for d in new['deployments'] if d['kind']==k] for k in ['shard','weight_program','program_book','engine']}
    summary={'generated_at':datetime.now(timezone.utc).isoformat(),'model':manifest['model'],
        'scope':'one complete first convolution block at three token positions; not full-model token generation',
        'public_transactions_broadcast':0,'real_money_spent':0,'public_replay_attempted_this_round':False,
        'compiled_gas_by_position':[t['total_local_gas_used'] for t in new['tokens']],
        'previous_gas_by_position':[t['total_local_gas_used'] for t in old['tokens']],
        'additional_reduction_percent_by_position':reductions,
        'aggregate_additional_reduction_percent':100*sum(savings)/sum(t['total_local_gas_used'] for t in old['tokens']),
        'gas_saved_per_tested_position':savings,'original_deployment_gas':old['total_local_deployment_gas'],
        'compiled_deployment_gas':new['total_local_deployment_gas'],'additional_deployment_gas':extra,
        'gas_only_break_even_positions':[math.ceil(extra/s) for s in savings],
        'contracts':{k:len(v) for k,v in groups.items()},'total_contracts':4559,
        'program_runtime_bytes':manifest['total_runtime_bytes'],'programs_regenerated_and_verified':regenerated,
        'max_runtime_bytes':max(p['bytes'] for p in manifest['programs']),
        'max_local_transaction_gas':new['max_local_transaction_gas'],
        'step_checks':1149,'persisted_vector_checks':36,'kernel_test_cases':71,
        'weights_and_integer_outputs_unchanged':True,'transaction_count_per_position':52}
    lines=['# Compiling fixed weights into executable contracts','',
        '**The third-position cost falls from 399,282,174 to 143,986,402 gas: another 63.94% reduction.** '
        'This is 93.38% below the original scalar implementation for the same position. '
        'The result covers the complete first convolution block, not full-model token generation or a chatbot.','',
        'All measurements are disposable local Cancun Anvil receipts. No real funds were spent. '
        'No public RPC replay was attempted in this round; the earlier disclosure approval remains unresolved.','',
        '## Full-block comparison','',
        '| Position | Previous batched Solidity | Executable weights | Reduction |',
        '| --- | ---: | ---: | ---: |']
    for i,(a,b) in enumerate(zip(old['tokens'],new['tokens'])):
        lines.append(f"| {i} | {a['total_local_gas_used']:,} | {b['total_local_gas_used']:,} | {reductions[i]:.2f}% |")
    lines+=['',f"Aggregate reduction across the three positions: **{summary['aggregate_additional_reduction_percent']:.2f}%**. "
        'The first position pays more to initialize previously empty state slots. '
        'All versions execute the same 383 computation chunks; the batched variants use 52 transactions per position.','',
        '## The deployment trade-off','',
        '| Property | Previous version | Executable-weight version |','| --- | ---: | ---: |',
        '| Contracts | 356 | 4,559 |',
        f"| Deployment gas | {old['total_local_deployment_gas']:,} | {new['total_local_deployment_gas']:,} |",
        '| Extra model-derived executable code | — | 77,813,728 bytes |',
        f"| Largest observed transaction | {old['max_local_transaction_gas']:,} | {new['max_local_transaction_gas']:,} |",'',
        f"The new layout adds **{extra:,} deployment gas** and saves **{savings[2]:,} gas per tested block position**. "
        '**Gas-only break-even is 65 block-position executions**, assuming the measured savings continue. '
        'This is not 65 complete generated tokens or conversations. It excludes differing gas prices over time, chain-specific data fees, '
        'deployment compression, congestion and financing costs. A monetary break-even has not been measured.','',
        'The previous 356-contract implementation remains available. For a small number of executions its lower deployment cost can outweigh '
        'the new version\'s execution savings. No public deployment was chosen or funded.','',
        '## What runs on chain','',
        'The compiler converts fixed int4 weights into immediate constants in ordinary EVM bytecode. Each program performs straight-line '
        'packed multiplication, signed correction, row scaling and int32 overflow checks. The Solidity engine prepares activations from its '
        'own stored intermediate vectors and calls the programs with STATICCALL. Programs return computed row outputs. '
        'No model output, intermediate answer or inference result is calculated offline for execution.','',
        'There are 4,192 executable weight programs: up to three 1024-column rows or one 2560-column row per program. '
        'Their maximum runtime size is 19,845 bytes. Eleven immutable data books contain 52-byte address/codehash records. '
        'The engine commits to the books and checks each target program\'s expected code hash before executing it. '
        'The original 355 data shards remain deployed for provenance and the unchanged nonlinear operators. One engine brings the total to 4,559.','',
        'The weight programs are generated EVM contracts; the coordinator, normalization, convolution, activation and state handling remain Solidity. '
        'The offline step is code generation from fixed weights, like compilation. All input-dependent arithmetic remains in smart-contract execution.','',
        '## Exactness and checks','',
        'The same five-lane, 48-bit coefficient representation is used. Columns are padded with zero-weight/zero-activation terms to a multiple of five. '
        'A row has at most 2560 actual or padded terms, so each accumulated polynomial coefficient is below `2560 * 15 * 2^32 < 2^48`. '
        'The selected coefficient is extracted after all groups are summed; signed corrections and Q24 scale division retain the previous rounding.','',
        '- 1,149/1,149 computation digests and 36/36 persisted vectors matched the existing integer reference across three consecutive positions.',
        '- 71 focused generated-program cases passed: real model rows, randomized inputs, int32 extremes, signs, padding, zero, negative truncation and overflow rejection.',
        '- Each non-overflow program case rejected truncated, empty and overlong raw input. Four representative programs were actually deployed and their runtime bytes checked.',
        '- Every one of the 4,192 generated programs was independently regenerated from its corresponding original row data and matched byte-for-byte; all hashes and row coverage were checked.',
        '- A deliberately changed program was rejected by the engine\'s codehash check; restoring the exact code restored valid execution.',
        '- Unauthorized input replacement, input lengths, batch limits, completed jobs, nonlinear boundaries and projection probes passed.',
        '- A real local out-of-gas batch reverted all engine storage and logs. Snapshot rollback/replay also passed. Extra test gas is excluded from inference totals.','',
        'This is differential testing and deterministic regeneration, not a formal verification or security audit. '
        'Weight provenance is established by the reproducible build and manifest; the engine does not reconstruct all source weights on chain to prove the compilation. '
        'Exact agreement preserves the prior int4 approximation and its known quality limitations.','',
        '## Research assessment','',
        'The research considered preprocessing fixed matrices, lookup-based matrix-vector algorithms, and restructuring quantized weights to reduce unpacking. '
        'The selected EVM implementation specializes the program to fixed weights. It removes interpretation and runtime weight decoding; it does not claim an asymptotically faster matrix algorithm.','',
        'The FLUTE paper provides an example of restructuring fixed quantized weights to reduce unpacking on GPUs. Its reported speedups do not apply directly to EVM. '
        'Williams\' preprocessing results concern abstract computational models; no asymptotic bound from that paper is treated as an EVM gas prediction. '
        'Only the local contract measurements above establish this implementation\'s savings.','',
        'Runtime range-aware packing and lookup-table approaches remain unimplemented candidates. They are not included in the claimed savings. '
        'A smaller model, pruning or further quantization would change model outputs; none was substituted here.','',
        '## Remaining scope','',
        'This still implements only the first of fourteen model blocks with supplied input embeddings. Tokenization, embedding lookup, attention/KV state, '
        'the remaining blocks, vocabulary projection, decoding and agent actions are not integrated. No full-model token price or reply latency is established. '
        'The 144-million figure is the third measured block position; it must not be presented as a complete LLM reply cost.','',
        '## Reproduction','',
        'Use the pinned dependencies and Anvil described in block-benchmark/README.md. From the project root:','',
        '```bash',
        '.venv/bin/python block-benchmark/compiled_weights.py',
        'node block-benchmark/compile.cjs',
        '.venv/bin/python block-benchmark/check_compiled_weights.py --anvil /absolute/path/to/anvil',
        '.venv/bin/python block-benchmark/run_local.py --anvil /absolute/path/to/anvil --variant compiled --batch-size 8',
        '.venv/bin/python block-benchmark/summarize_codeweights.py',
        '```','',
        'The local harness deploys all 4,559 contracts using disposable simulator accounts. It accepts no public RPC URL. '
        'Raw reports are results/compiled-weight-kernels.json and results/block-compiled-batch8-local.json. '
        'The previous compiled artifact and relevant sources are preserved in block-benchmark/prior-optimized-baseline/. '
        'The new virtual projection hook slightly changes recompiled older engines; their historical receipts correspond to the archived bytecode.','',
        'Primary references consulted October 20, 2026:','',
        '- https://arxiv.org/abs/2407.10960 — FLUTE, restructuring quantized weights to reduce unpacking.',
        '- https://people.csail.mit.edu/rrw/mat-vec3.pdf — fixed-matrix preprocessing and computational-model limits.',
        '- https://eips.ethereum.org/EIPS/eip-170 — maximum contract runtime size.',
        '- https://eips.ethereum.org/EIPS/eip-3860 — initcode size and metering.',
        '- https://docs.soliditylang.org/en/latest/assembly.html — inline assembly and memory discipline.','']
    (ROOT.parent/'COMPILED-WEIGHTS-RESULTS.md').write_text('\n'.join(lines))
    (ROOT.parent/'results/compiled-weight-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary,indent=2))

if __name__=='__main__':main()
