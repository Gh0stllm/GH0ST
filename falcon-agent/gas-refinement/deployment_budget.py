"""Reproduce deployment size budgets from existing measured GH0ST artifacts.

No new model, inference result, deployment receipt, or compression claim is made.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
storage = json.loads((ROOT / 'storage-results.json').read_text())
research = json.loads((ROOT.parent / 'sixbit-optimization/research-results.json').read_text())
fixed = next(v for v in storage['variants'] if v['name'] == 'fixed')
deployment = next(v for v in fixed['layouts'] if v['payload_limit'] == 61439)
total = deployment['modeled_weight_shard_deployment_gas']
deposit = fixed['bytes'] * 200
parameters = research['matrix_weights']
budgets = [10_000_000_000, 5_000_000_000, 1_000_000_000, 100_000_000]
report = {
    'scope': 'Arithmetic analysis of existing measurements; no new gas reduction implemented',
    'gas_schedule': '200 gas per deployed runtime-code byte; standard EVM code deposit',
    'fixed_format': {
        'file_bytes': fixed['bytes'],
        'modeled_weight_deployment_60kib': total,
        'payload_code_deposit_only': deposit,
        'payload_deposit_share_percent': 100 * deposit / total,
        'all_other_modeled_weight_deployment_gas': total - deposit,
        'maximum_reduction_if_all_other_costs_disappeared_percent': 100 * (total - deposit) / total,
    },
    'matrix_only_idealized_precision_sizes': [
        {'bits_per_weight': bits, 'matrix_parameters': parameters,
         'bytes_before_metadata_and_nonmatrix_tensors': (parameters * bits + 7) // 8,
         'code_deposit_only': 200 * ((parameters * bits + 7) // 8),
         'quality': 'Unmeasured hypothetical representation; changing precision changes weights'}
        for bits in [6, 4, 3, 2, 1]
    ],
    'deployment_targets': [
        {'target_gas': gas, 'maximum_code_bytes_before_all_other_costs': gas // 200,
         'minimum_size_reduction_vs_fixed_percent': 100 * (1 - (gas // 200) / fixed['bytes'])}
        for gas in budgets
    ],
    'existing_lossless_evidence': {
        'best_measured_transformed_zstd_bytes': min(v['bytes_zstd'] for v in research['compressed_candidates']),
        'empirical_symbol_entropy_bits': research['global_symbol_entropy_bits'],
        'huffman_estimated_bytes_excluding_tables': research['huffman_codes_plus_current_other_bytes_without_tables'],
        'caveat': 'CPU compression or coding analysis only; no matching on-chain decoder. Empirical entropy is not a universal compression lower bound.',
    },
    'excluded_as_solutions_under_existing_requirements': [
        'Merkle commitment plus resupplied weights changes direct contract-state availability',
        'New-chain genesis allocation changes chain requirement',
        'Deploying only some weights postpones the remaining full-model bill',
        'Cheaper gas prices change currency cost, not gas units',
    ],
    'public_transactions_broadcast': 0,
}
(ROOT / 'deployment-budget.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
