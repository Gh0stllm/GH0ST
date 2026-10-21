"""Validate benchmark records and generate the consolidated, scoped report."""
import gzip
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent
RESULTS = PROJECT/'results'


def read(name):
    return json.loads((RESULTS/f'{name}.json').read_text())


def main():
    scalar, swar, swar6 = read('block-local'), read('block-swar-local'), read('block-swar6-local')
    quality, tools, precision = read('quality-sweep'), read('tool-quality'), read('precision-stress')
    manifest = json.loads((ROOT/'manifest.json').read_text())
    prices = read('spot-prices')
    networks = [read('block-public-'+n) for n in ['base','robinhood','bsc']]
    assert scalar['status']==swar['status']==swar6['status']=='passed'
    assert quality['status']==tools['status']==precision['status']=='complete'
    for item in manifest['shards']:
        payload = (ROOT/'data'/item['file']).read_bytes()
        assert len(payload)==item['bytes'] and hashlib.sha256(payload).hexdigest()==item['sha256']
    for run in [scalar,swar,swar6]:
        assert len(run['deployments'])==356
        assert all(c['passed'] for c in run['checks'])
        assert sum(d['local_gas_used'] for d in run['deployments'])==run['total_local_deployment_gas']
        assert run['public_transactions_broadcast']==0
        for t in run['tokens']:
            assert len(t['steps'])==383 and t['transaction_count']==384
            assert all(s['reference_match'] for s in t['steps'])
            assert t['output_matches_reference'] and t['persisted_vectors_checked']==12
            assert t['begin_gas_used']+sum(s['local_gas_used'] for s in t['steps'])==t['total_local_gas_used']
    assert [t['output_sha256'] for t in scalar['tokens']]==[t['output_sha256'] for t in swar['tokens']]
    assert [t['output_sha256'] for t in scalar['tokens']]==[t['output_sha256'] for t in swar6['tokens']]
    assert all(precision['original_three_fixture_hashes_unchanged'])
    for v in precision['variants']:
        assert len(v['cases'])==256 and not v['overflows']
    fixture = ROOT/'simulation-cases-swar.json.gz'
    fixtures = json.loads(gzip.decompress(fixture.read_bytes()))
    assert len(fixtures)==15
    fixture_hash = hashlib.sha256(fixture.read_bytes()).hexdigest()
    for n in networks:
        assert n['status']=='complete_read_only_sample_validation', (n['network'],n['status'])
        assert n['fixture_sha256']==fixture_hash and len(n['cases'])==15
        assert all(c.get('matches_reference') for c in n['cases'])
        assert n['public_transactions_broadcast']==0
    reductions = [100*(1-b['total_local_gas_used']/a['total_local_gas_used']) for a,b in zip(scalar['tokens'],swar['tokens'])]
    aggregate_reduction = 100*(1-sum(t['total_local_gas_used'] for t in swar['tokens'])/sum(t['total_local_gas_used'] for t in scalar['tokens']))
    swar6_reduction = 100*(1-sum(t['total_local_gas_used'] for t in swar6['tokens'])/sum(t['total_local_gas_used'] for t in swar['tokens']))
    latest_gas = swar6['tokens'][2]['total_local_gas_used']
    summary = {'generated_at':datetime.now(timezone.utc).isoformat(),'model':manifest['model'],
        'public_transactions_broadcast':0,'public_money_spent':0,
        'complete_model_inference_implemented':False,'onchain_agent_actions_implemented':False,
        'local_deployments_per_variant':356,'consecutive_positions_per_variant':3,
        'step_digest_matches_per_variant':1149,'persisted_vector_checks_per_variant':36,
        'optimized_gas_reduction_percent_by_position':reductions,
        'aggregate_gas_reduction_percent':aggregate_reduction,'native_tool_checks':[],
        'six_lane_local_gas_by_position':[t['total_local_gas_used'] for t in swar6['tokens']],
        'six_lane_additional_reduction_percent':swar6_reduction,
        'six_lane_public_validation_performed':False,
        'gas_target_factors_from_six_lane_position_2':{str(t):latest_gas/t for t in [100000000,10000000,1000000]},
        'public_sample_calls_passed':45,'chain_costs':[]}
    lines = [
        '# LFM on-chain feasibility: test results', '',
        '**Later optimization:** `OPTIMIZATION-RESULTS.md` records the subsequent exact wide-lane and batching implementation, '
        'which lowers the third-position total to 399,282,174 gas. `COMPILED-WEIGHTS-RESULTS.md` records a later '
        '143,986,402-gas variant with substantially higher deployment costs. Tables below retain their original variant and fee-snapshot scope.', '',
        'The complete first LFM convolution block works as resumable Solidity contracts. '
        'The present implementation remains expensive even after a substantial arithmetic optimization. '
        'Full on-chain chat and agent actions are not implemented.', '',
        'All public interactions were read-only node simulations. Real ETH/BNB spent: **0**. '
        'The 356 deployments per variant occurred only in disposable local Anvil chains.', '',
        f"Model: `{manifest['model']['model_id']}`, revision `{manifest['model']['revision']}`.",
        'The original tests were performed on October 19, 2026 UTC; the six-lane follow-up was run on October 20. '
        'Exact timestamps, blocks, inputs and outputs are in the JSON records.', '',
        '## Arithmetic and persistent state', '',
        '| Test | Measured result |', '| --- | --- |',
        '| Complete layer-zero execution | 3 consecutive token positions in each of scalar, four-lane and six-lane EVM implementations |',
        '| Integer-reference agreement | 1,149/1,149 step digests and 36/36 persisted vector checks per implementation |',
        '| On-chain data layout | 355 immutable data shards plus 1 engine; 6,098,948 payload bytes for this block |',
        '| Progress transactions | 384 per token position in this block |',
        f'| Arithmetic optimization | {aggregate_reduction:.2f}% lower total computation gas across the three positions |',
        '| Additional correctness | 48 randomized/extreme projection cases; 10 square-root and 12 SiLU boundary cases |',
        '| Input and recovery behavior | Unauthorized/active input replacement rejected; actual step rollback and deterministic replay passed |',
        '| Public-node validation | 15 sampled steps each on Base, Robinhood and BSC matched; 45/45 total |', '',
        '| Position | Scalar gas | Four-lane gas | Reduction |', '| --- | ---: | ---: | ---: |',
    ]
    for i,(a,b) in enumerate(zip(scalar['tokens'],swar['tokens'])):
        lines.append(f"| {i} | {a['total_local_gas_used']:,} | {b['total_local_gas_used']:,} | {reductions[i]:.2f}% |")
    lines += ['',f"Four-lane local deployment consumed **{swar['total_local_deployment_gas']:,} gas** in total. "
        f"The largest observed transaction, including deployment, used **{swar['max_local_transaction_gas']:,} gas**. "
        'That is below Base\'s documented 16,777,216 per-transaction maximum. Splitting computation fits transaction limits; it does not erase total gas.', '',
        'The three EVM fixtures are the first three template tokens `[1, 6, 6423]`. They are not a complete user message. '
        'The separate numerical sweep below covers more varied text but runs in the CPU integer reference.', '',
        '## Six-lane Solidity optimization follow-up', '',
        '`LfmBlockSwar6.sol` packs six int4/int32 products into each 256-bit multiplication using 40-bit lanes. '
        'It preserves the same weight files, integer precision, rounding, state layout and transaction schedule. '
        'The runtime code is 6,263 bytes; all measurements below are disposable local Anvil receipts.', '',
        '| Position | Four-lane gas | Six-lane gas | Additional reduction |', '| --- | ---: | ---: | ---: |']
    for i,(a,b) in enumerate(zip(swar['tokens'],swar6['tokens'])):
        reduction=100*(1-b['total_local_gas_used']/a['total_local_gas_used'])
        lines.append(f"| {i} | {a['total_local_gas_used']:,} | {b['total_local_gas_used']:,} | {reduction:.2f}% |")
    lines += ['',f'Across all three positions, the new layout saves **{swar6_reduction:.2f}%** beyond the four-lane version. '
        'All 1,149 step digests and 36 persisted-vector checks match the integer reference. '
        'The 48 randomized/extreme projection checks, nonlinear boundaries, access checks and rollback/replay also pass. '
        'This is exact agreement with the existing quantized implementation, not an improvement in its model quality.', '',
        f"Six-lane total deployment used **{swar6['total_local_deployment_gas']:,} gas** across 356 contracts. "
        f"The largest transaction used **{swar6['max_local_transaction_gas']:,} gas**. "
        'Fifteen public-simulation fixtures were captured, but no public-node validation or new fee pricing was run for this variant. '
        'The chain fee table below still describes the four-lane version.', '',
        '### What would lower gas targets require?', '',
        f'Using position 2 of the six-lane run ({latest_gas:,} gas) as the comparison:', '',
        '| Target for this single block/position | Additional reduction factor required |', '| --- | ---: |']
    for target in [100000000,10000000,1000000]:
        lines.append(f'| {target:,} gas | {latest_gas/target:.1f}x |')
    lines += ['', 'The current 384-transaction schedule has 8,064,000 gas of basic transaction overhead alone '
        '(384 times 21,000), before calldata, arithmetic, storage and other execution. Batching could change this schedule; '
        'this is a bound on the present design, not a universal lower bound for inference.', '',
        'Further exact optimizations worth measuring include precomputed weight layouts, amortizing activation reads across '
        'more rows, and lower-overhead arithmetic loops. Pre-expanded weights trade cheaper execution for more data and deployment gas. '
        'These are research candidates, not demonstrated savings or a plan guaranteed to reach 100 million gas. '
        'Nothing measured here supports a 100x or 1,000x reduction from ordinary Solidity tuning. '
        'Thousands of gas for this full block is not a credible target. A much smaller model, structured reduction of its arithmetic, '
        'or chain-supported native inference execution would change the design and need separate quality/cost measurements. '
        'No off-chain inference has been substituted.', '',
        '## Chain fee comparison', '',
        '**The unit below is one convolution block at one token position. It is not the price of a full model token or chat reply.** '
        'All numbers use the measured 4-bit implementation; an 8-bit Solidity block has not been benchmarked.', '',
        '| Network | Initial block | Gas price (gwei) | Planning cost across the 3 positions | Indicative USD |',
        '| --- | ---: | ---: | --- | ---: |']
    for n in networks:
        unit=n['native_currency']; costs=[x['total_fee_wei']/1e18 for x in n['planning_per_block_position']]
        fx=prices[unit+'_USD']; usd=[x*fx for x in costs]
        summary['chain_costs'].append({'network':n['network'],'currency':unit,'native_min':min(costs),
            'native_max':max(costs),'indicative_usd_min':min(usd),'indicative_usd_max':max(usd),
            'initial_block':n['block_number'],'gas_price_wei':n['modeled_gas_price_wei']})
        label = 'BSC' if n['network']=='bsc' else n['network'].title()
        lines.append(f"| {label} | {n['block_number']:,} | {n['modeled_gas_price_wei']/1e9:.6f} | "
            f"{min(costs):.6f}–{max(costs):.6f} {unit} | ${min(usd):.2f}–${max(usd):.2f} |")
    lines += ['',f"USD conversion uses indicative ETH ${prices['ETH_USD']:,.2f} and BNB ${prices['BNB_USD']:,.2f}, recorded "
        f"{prices['recorded_at_utc']}. Prices and fee snapshots were sampled separately and can change.", '',
        'Planning totals use the complete local receipt sum, a 5% cushion (or a larger sampled estimator ratio if needed), '
        'and the sampled chain gas price. Base adds separately queried L1 upper estimates; its operator-fee probes were zero. '
        'Robinhood estimates already bundle L1 data costs. BSC uses BNB. Deployment is excluded. '
        'These are modeled fees, not public receipts or guaranteed maximums.', '',
        'BSC pruned the original pinned state during the first attempt. The successful rerun pins a fresh block for each case. '
        'Base\'s first attempt encountered a transient RPC/proxy error and was rerun. Original attempts are retained. '
        'This comparison does not measure network inclusion time, application concurrency, or throughput under congestion.', '',
        '## Precision and model usefulness', '',
        'The first-block integer CPU reference was tested on four 64-token sequences, including task instructions, numbers, code-like '
        'text and multilingual text. Convolution state persists within each sequence. All 256 positions completed without int32 overflow at each precision.', '',
        '| First-block weight precision | Mean relative L2 output error vs float32 | Worst error | Mean cosine similarity |',
        '| --- | ---: | ---: | ---: |']
    for v in precision['variants']:
        lines.append(f"| int{v['bits']} per row | {100*v['relative_l2_error']['mean']:.2f}% | "
            f"{100*v['relative_l2_error']['max']:.2f}% | {v['cosine_similarity']['mean']:.6f} |")
    lines += ['', 'Relative L2 error is a numerical vector error, not a percentage of wrong answers. '
        'Errors in later blocks and final token selection are not measured by this first-block comparison.', '',
        'Full-model CPU tests separately quantized/dequantized the unique 2D weights while keeping floating-point runtime arithmetic. '
        'The native tool suite offered four functions: set_goal, create_task, complete_task and get_task. It used twelve exact-call cases '
        'and four cases expecting no call. No generated call was executed.', '',
        '| Full-model weight variant | Exact requested calls | No-call cases | Packed 2D weights + scales + other fp32 parameters |',
        '| --- | ---: | ---: | ---: |']
    for v,q in zip(tools['variants'],quality['variants']):
        assert v['name']==q['name']
        size=q['ideal_2d_payload_bytes']+q['float32_scale_bytes']+q['other_parameter_float32_bytes']
        a=v['action_checks'];b=v['no_call_checks']
        summary['native_tool_checks'].append({'variant':v['name'],'exact_calls':a,'no_call':b,'ideal_parameter_bytes':size})
        lines.append(f"| {v['name']} | {a['passed']}/{a['total']} | {b['passed']}/{b['total']} | {size/1e6:.2f} MB |")
    lines += ['', 'These parameter sizes exclude tokenizer data, runtime code and persistent inference state. Storing the full model in '
        'payloads the size of the tested shards would require thousands of contracts; the 356 deployments cover only the first block.', '',
        'These are small deterministic smoke tests, not a representative benchmark. Some failures were formatting or capitalization '
        'differences; others incorrectly claimed that an available tool did not exist. The original model also failed five of twelve exact-call cases. '
        'The 8-bit variant matched its aggregate score but is not thereby established as reliable enough for a complex autonomous agent.', '',
        'The two 4-bit methods tested here degraded performance. This does not establish that every 4-bit method, calibration scheme, '
        'fine-tune or inference implementation would behave the same. The grouped method uses naive groupwise rounding, not an advanced calibrated quantizer.', '',
        'The separate thirteen-prompt suite tested greeting, factual recall, arithmetic, strict output formatting, state lookup and one native tool call. '
        'Its strict automated pass counts were 2/9, 2/9, 1/9 and 1/9 in the same order. '
        'For example, the baseline computed 43 correctly but failed a request for only the number because it added explanation. '
        'Those scores must not be described as general reasoning accuracy. All raw outputs are included.', '',
        '## Bugs, constraints and incomplete work', '',
        '- Fixed Solidity integer square root for input 2 and probe-row scale alignment for non-word-aligned byte strides.',
        '- Widened CPU convolution intermediates to avoid an int64 reference overflow for extreme values; the original three output hashes are unchanged.',
        '- Rollback/replay uses local chain snapshots. It is not an application-level abort/resume feature. The prototype has no cancel/reset method; an overflowing active job can stall the instance.',
        '- Only one sequence is supported, with owner-supplied embeddings. No tokenizer, token-ID input validation, embedding lookup, remaining blocks, attention cache, vocabulary projection or decoder is integrated.',
        '- No wallet actions, goal/task contracts, action grammar, permissions for actions, or funds-handling logic were implemented or audited.',
        '- No full model token, chat reply, mainnet deployment, end-to-end latency or parallel execution was tested. A large number of contracts does not create extra base-chain computation capacity.',
        '- The earlier Robinhood mainnet and testnet probes recorded an activationGas value of uint64 max. New Stylus activation was not attempted; the configured pause was not bypassed. Base does not provide the same Stylus runtime path.',
        '- This is experimental benchmark code, not a security audit or production release.', '',
        '## Recommended decision', '',
        'Keep Base as the lowest-fee development target among these measured snapshots. Preserve the fully-on-chain runtime goal, '
        'but do not treat this 230M Solidity implementation as ready for a complex chat product. The measured first-block cost is already high, '
        'and the model still needs thirteen more blocks plus its vocabulary projection and all integration work.', '',
        'For LFM research, use int8 as the next accuracy baseline and measure an int8 kernel before assuming its costs. '
        'The model also needs a larger task-specific tool evaluation and likely adaptation. Further work should establish a complete next-token pass '
        'locally before funding a full network deployment. A substantially smaller task-specific model or a chain-supported efficient inference runtime '
        'would be a separate design decision; neither has been silently substituted for LFM.', '',
        '## Reproduction and evidence', '',
        'See `block-benchmark/README.md` for commands, arithmetic, fee formulas and file mappings. '
        'All weight-shard hashes and result totals are checked by `block-benchmark/summarize_results.py`. '
        'The complete local logs, public RPC observations, generated outputs and initial failed attempts are included.', '',
        'Primary technical sources:', '',
        '- https://huggingface.co/LiquidAI/LFM2.5-230M',
        '- https://ethereum.org/developers/docs/gas/',
        '- https://docs.base.org/specifications/transactions/throughput-and-limits',
        '- https://docs.base.org/specifications/transactions/network-fees',
        '- https://docs.base.org/specifications/base-protocol/execution/predeploys',
        '- https://docs.robinhood.com/chain/gas-and-fees/',
        '- https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/',
        '- https://github.com/OffchainLabs/stylus-sdk-rs/blob/v0.10.10/stylus-tools/src/core/activation.rs', '',
    ]
    (PROJECT/'TEST-RESULTS.md').write_text('\n'.join(lines))
    (RESULTS/'test-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary,indent=2))


if __name__=='__main__': main()
