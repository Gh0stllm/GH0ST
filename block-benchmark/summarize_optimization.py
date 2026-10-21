"""Validate the exact-optimization experiments and write their scoped report."""
import gzip
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parent
RESULTS=ROOT.parent/'results'

def read(name):return json.loads((RESULTS/(name+'.json')).read_text())

def main():
    runs={k:read(n) for k,n in {'scalar':'block-local','previous':'block-swar6-local',
        'kernel':'block-optimized-batch1-local','batched':'block-optimized-batch8-local'}.items()}
    baseline=runs['previous'];best=runs['batched']
    for name,run in runs.items():
        assert run['status']=='passed' and len(run['tokens'])==3 and len(run['deployments'])==356
        assert all(c['passed'] for c in run['checks']) and run['public_transactions_broadcast']==0
        assert sum(x['local_gas_used'] for x in run['deployments'])==run['total_local_deployment_gas']
        for i,t in enumerate(run['tokens']):
            assert len(t['steps'])==383 and all(s['reference_match'] for s in t['steps'])
            assert t['persisted_vectors_checked']==12 and t['output_matches_reference']
            assert t['output_sha256']==baseline['tokens'][i]['output_sha256']
            receipts=t.get('transactions',t['steps'])
            assert t['total_local_gas_used']==t['begin_gas_used']+sum(x['local_gas_used'] for x in receipts)
            assert t['transaction_count']==len(receipts)+1
            if 'transactions' in t:
                assert sum(x['step_count'] for x in receipts)==383
                assert max(x['local_gas_used'] for x in receipts)<16777216
    candidates={}
    for name in ['kernel-sweep-fast6','kernel-sweep-unrolled','kernel-sweep-wide5']:
        sweep=read(name);assert sweep['status']=='passed'
        for v in sweep['variants']:
            assert len(v['cases'])==68 and all(c['matches_reference'] for c in v['cases'])
            candidates[v['contract']]=v
    manifest=json.loads((ROOT/'manifest.json').read_text())
    for shard in manifest['shards']:
        payload=(ROOT/'data'/shard['file']).read_bytes()
        assert hashlib.sha256(payload).hexdigest()==shard['sha256']
    fixture=ROOT/'simulation-cases-optimized-batch8.json.gz'
    assert len(json.loads(gzip.decompress(fixture.read_bytes())))==14
    public=[]
    for n in ['base','robinhood','bsc']:
        p=RESULTS/f'optimized-public-{n}.json'
        if p.exists():
            r=json.loads(p.read_text());assert r['public_transactions_broadcast']==0
            assert r['fixture_sha256']==hashlib.sha256(fixture.read_bytes()).hexdigest()
            public.append(r)
    reductions=[100*(1-b['total_local_gas_used']/a['total_local_gas_used']) for a,b in zip(baseline['tokens'],best['tokens'])]
    totals={k:sum(t['total_local_gas_used'] for t in v['tokens']) for k,v in runs.items()}
    summary={'generated_at':datetime.now(timezone.utc).isoformat(),'model':manifest['model'],
        'public_transactions_broadcast':0,'real_money_spent':0,
        'scope':'first convolution block at three consecutive token positions; not full-model token generation',
        'weights_unchanged':True,'integer_outputs_unchanged':True,
        'selected_contract':'LfmBlockOptimized','selected_arithmetic':'LfmBlockWide5U2',
        'gas_by_variant':{k:[t['total_local_gas_used'] for t in r['tokens']] for k,r in runs.items()},
        'reduction_percent_vs_previous_by_position':reductions,
        'aggregate_reduction_percent_vs_previous':100*(1-totals['batched']/totals['previous']),
        'aggregate_reduction_percent_vs_scalar':100*(1-totals['batched']/totals['scalar']),
        'transaction_count_per_position':52,'step_checks_per_variant':1149,'persisted_vector_checks_per_variant':36,
        'max_local_transaction_gas':best['max_local_transaction_gas'],
        'deployment_gas':best['total_local_deployment_gas'],
        'deployment_gas_increase_vs_previous':best['total_local_deployment_gas']-baseline['total_local_deployment_gas'],
        'public_validation_status':'blocked_by_automatic_approval_review',
        'public_checks':[{'network':r['network'],'status':r['status'],
            'matching_calls':sum(c.get('matches_reference',False) for c in r['cases'])} for r in public]}
    lines=['# Exact Solidity optimization results','',
        '**Subsequent research:** `COMPILED-WEIGHTS-RESULTS.md` records the later 144-million-gas third position, '
        'with a much higher 4,559-contract deployment cost. This report preserves the earlier lower-deployment-cost option.','',
        '**The latest implementation reduces the third-position cost from 1,022,975,335 to 399,282,174 gas (60.97%).** '
        'It is 81.64% below the original scalar implementation for that position. '
        'This is the complete first convolution block at one token position, not a complete generated token or chat reply.','',
        'All full-block totals are local Cancun Anvil transaction receipts. No public transactions were broadcast and no real funds were spent. '
        'The selected version keeps the same 355 data shards, all original int4/Q16 precision and the same integer outputs.','',
        '## Full-block measurements','',
        '| Position | Original scalar | Previous six-lane | New kernel, single steps | New kernel + batches | Reduction vs previous |',
        '| --- | ---: | ---: | ---: | ---: | ---: |']
    for i in range(3):
        vals=[runs[k]['tokens'][i]['total_local_gas_used'] for k in ['scalar','previous','kernel','batched']]
        lines.append('| '+str(i)+' | '+' | '.join(f'{v:,}' for v in vals)+f' | {reductions[i]:.2f}% |')
    lines+=['',f"Across all three positions, gas falls **{summary['aggregate_reduction_percent_vs_previous']:.2f}%** versus the previous six-lane run. "
        'The kernel and batching were measured separately so their savings are not conflated.','',
        '| Deployment / execution property | Result |','| --- | --- |',
        '| Contracts | Same 355 weight/data shards plus one engine |',
        '| Transactions per position | 384 → 52 |',
        '| Computation chunks per position | 383, all checked individually |',
        '| Engine runtime | 6,820 bytes |',
        f"| Maximum local transaction, including deployment | {best['max_local_transaction_gas']:,} gas |",
        f"| Total local deployment gas | {best['total_local_deployment_gas']:,} |",
        f"| Deployment increase vs previous | {summary['deployment_gas_increase_vs_previous']:,} gas |",'',
        '## What changed','',
        '1. **Multiply-and-mask weight unpacking.** Multiplication by a carefully chosen constant spreads packed nibbles into wide lanes, replacing many separate shifts and masks.',
        '2. **Packed accumulation across the row.** Five 48-bit lanes allow partial products to be summed before extracting the desired coefficient. The earlier six-lane version extracted and corrected every group.',
        '3. **One signed correction per row.** Activation bias is accumulated once per projection, and packed weight bias is summed and reduced once per output row.',
        '4. **Measured loop unrolling.** Two ten-input groups per loop won among the tested wide-lane variants. More unrolling was slower in this compiler configuration; those results are retained.',
        '5. **Atomic batches of up to eight steps.** Self-calls retain warm storage access within a transaction and amortize transaction overhead. State and every chunk digest remain observable. A failed batch reverts all its steps.','',
        'The schedule groups chunks within each stage. The last stage also tests requesting eight advances when only one remains; execution stops at completion. '
        'The existing single-step interface remains usable. Different callers can advance the job, while only the owner can supply its next input.','',
        '## Arithmetic bound and verification','',
        'For each group, activations are biased to A=x+2^31 and weights to B=w+8. Activations occupy ascending 48-bit lanes and weights descending lanes. '
        'Coefficient 4 of their product is the desired five-term unsigned dot product. Across a whole row, every coefficient is strictly below '
        '`2560 × 15 × 2^32 < 2^48`. Thus lower coefficients cannot carry into the desired lane, even after summing all groups. '
        'The low 256-bit EVM product preserves bits 192–239 exactly. Remainders use scalar products.','',
        'The signed result for n packed inputs is `C + n*2^34 - 8*sum(A) - 2^31*sum(B)`. '
        'A modulo reduction by `2^48-1` sums the packed weight lanes exactly because the total is below that modulus. '
        'These bounds rely on int32 activations, int4 weights and at most 2560 input columns; widening those limits needs a new proof.','',
        '- Both single-step and batched full-block runs passed 1,149 chunk digests and 36 persisted-vector checks each.',
        '- Each selected full-block run passed 48 randomized/extreme projection probes, 10 integer-square-root cases and 12 SiLU cases.',
        '- Each kernel candidate passed 68 differential cases, including all-minimum/all-maximum int32 activations, -8/7 weights, alternating signs and remainder lengths.',
        '- A real local multi-step transaction ran out of gas; all engine storage and logs rolled back. Its test gas is excluded from inference totals.',
        '- Input authorization, invalid batch sizes, completion rejection, snapshot rollback and deterministic replay passed.',
        '- Every original weight-shard hash is rechecked. No retraining, new quantization or off-chain inference was used.','',
        'These are analytical bounds and differential tests, not a formal verification or security audit. '
        'Exact agreement preserves the existing approximate int4 model; it does not fix the previously measured model-quality limitations.','',
        '## Kernel screening','',
        'Receipt figures here include ABI calldata overhead and omit persistent inference state. They select candidates; full-block receipts above establish application savings.','',
        '| Candidate | 32×1024 projection gas | 16×2560 projection gas | Runtime bytes |',
        '| --- | ---: | ---: | ---: |']
    for name,v in candidates.items():
        gas=[c['gas_used'] for c in v['cases'] if 'gas_used' in c]
        lines.append(f"| {name} | {gas[0]:,} | {gas[3]:,} | {v['runtime_bytes']:,} |")
    lines+=['','## Public-node samples','',
        '**Latest public replay is blocked, not completed.** Automatic approval review rejected sending prototype contract bytecode, '
        'storage overrides and model-derived intermediate state to third-party public RPC nodes. '
        'Local validation is complete; no current public-node compatibility or new fee quote is claimed. '
        'The prepared replay script selects three batches per network: input projection, final feed-forward projection, '
        'and final residual/completion. Any future replay needs approval for that disclosure.','',
        '| Network | Status | Matching calls |','| --- | --- | ---: |']
    for r in public:
        lines.append(f"| {r['network']} | {r['status']} | {sum(c.get('matches_reference',False) for c in r['cases'])}/3 |")
    if len(public)<3:lines.append('| Base / Robinhood / BSC | Blocked by automatic approval review | No completed latest replay |')
    lines+=['','## Research decisions and remaining limits','',
        'The selected implementation adapts multiply/mask bit-spreading techniques and the EVM cold/warm storage rules. '
        'The packing constants and full-row coefficient bound were derived for this model shape and checked in EVM; the sources do not claim these exact benchmark results.','',
        'MODEXP was reviewed as a possible wider-arithmetic route. EIP-7883 raises its pricing and EIP-7823 limits operands to 1024 bytes where activated. '
        'It is not a native matrix-multiplication operation. No MODEXP-based speedup was assumed or claimed, and current adoption was not inferred for every target chain.',
        'Expanded precomputed weights were deferred: the selected approach obtains substantial savings without increasing model-data storage or contract count. '
        'Pruning, lower-rank weights and further quantization would change outputs and need separate quality evaluation; none were silently substituted.','',
        'At 399,282,174 gas, reaching 100 million still needs about 4x further reduction, 10 million about 40x, and 1 million about 399x. '
        'These are required factors, not promised future savings. The remaining thirteen model blocks, attention state, embedding lookup, tokenizer and vocabulary projection '
        'are not integrated. Full-model token cost, reply latency and agent actions remain unmeasured.','',
        '## Reproduce','',
        'From the project root with the previously documented dependencies and Anvil installed:','',
        '```bash','python3 block-benchmark/generate_unrolled.py','node block-benchmark/compile.cjs',
        '.venv/bin/python block-benchmark/kernel_sweep.py --anvil /absolute/path/to/anvil --contracts LfmBlockWide5 LfmBlockWide5U2 LfmBlockWide5U4 LfmBlockWide5U8 --output kernel-sweep-wide5.json',
        '.venv/bin/python block-benchmark/run_local.py --anvil /absolute/path/to/anvil --variant optimized --batch-size 1',
        '.venv/bin/python block-benchmark/run_local.py --anvil /absolute/path/to/anvil --variant optimized --batch-size 8',
        '.venv/bin/python block-benchmark/summarize_optimization.py','```','',
        'Compiler: Solidity 0.8.30, optimizer 200 runs, via IR, Paris bytecode. Local chain: Anvil 1.8.5, Cancun rules. '
        'The local runner accepts no public RPC endpoint. Public scripts permit read-only RPC methods only.','',
        'Primary references consulted October 20, 2026:','',
        '- https://graphics.stanford.edu/~seander/bithacks.html — multiply/mask bit spreading and packed reductions.',
        '- https://docs.soliditylang.org/en/latest/assembly.html — inline assembly and memory discipline.',
        '- https://eips.ethereum.org/EIPS/eip-2929 — transaction-wide cold/warm storage access.',
        '- https://eips.ethereum.org/EIPS/eip-7883 — MODEXP repricing.',
        '- https://eips.ethereum.org/EIPS/eip-7823 — MODEXP operand bounds.',
        '- https://docs.base.org/specifications/transactions/throughput-and-limits — documented transaction limit.','']
    (ROOT.parent/'OPTIMIZATION-RESULTS.md').write_text('\n'.join(lines))
    (RESULTS/'optimization-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary,indent=2))

if __name__=='__main__':main()
