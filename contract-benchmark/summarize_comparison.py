"""Render the recorded chain comparison without making network requests."""
import json
from decimal import Decimal
from pathlib import Path

from compare_chains import write_comparison

ROOT = Path(__file__).resolve().parent.parent
reports = {name: json.loads((ROOT / "results" / f"comparison-{name}.json").read_text())
           for name in ("base", "robinhood")}
if any(r["status"] != "complete_read_only_simulation" for r in reports.values()):
    raise SystemExit("Both network reports must be complete before summarizing")
comparison = write_comparison(reports, ROOT / "results")
b, r = reports["base"], reports["robinhood"]
ops = comparison["operations"]
labels = {
    "kernel_deployment": "Kernel deployment",
    "weight_shard_deployment": "2,048-byte weight shard deployment",
    "four_row_dot": "Four-row calculation",
    "four_row_dot_and_first_commit": "Calculation plus first result commitment",
}
reduction = Decimal(ops["four_row_dot_and_first_commit"]["base_fee_reduction_percent"])
lines = [
    "# Base versus Robinhood: identical Solidity computation",
    "",
    f"Base's estimated fee was **{reduction:.1f}% lower** for the four-row calculation plus its first result commitment in these snapshots. Both chains returned the expected outputs, commitment and deployment runtimes. This supports testing the Solidity implementation further on Base; it does not establish full LFM inference feasibility or unlock the Stylus port.",
    "",
    "**No public contracts were deployed. No transaction was signed or broadcast. Zero ETH was spent.**",
    "",
    "## Estimated fees",
    "",
    "All amounts are ETH, including the relevant data fee. These are estimates from node simulations, not paid receipts.",
    "",
    "| Operation | Base | Robinhood | Base reduction |",
    "| --- | ---: | ---: | ---: |",
]
for op, label in labels.items():
    item = ops[op]
    lines.append(f"| {label} | {Decimal(item['base_eth']):.12f} | {Decimal(item['robinhood_eth']):.12f} | {Decimal(item['base_fee_reduction_percent']):.1f}% |")
bt = b["tiny_setup_plus_first_commit"]["total_fee_estimate_wei"]
rt = r["tiny_setup_plus_first_commit"]["total_fee_estimate_wei"]
lines += [
    f"| Both deployments plus first computation/commitment | {Decimal(bt)/Decimal(10**18):.12f} | {Decimal(rt)/Decimal(10**18):.12f} | {(Decimal(rt)-Decimal(bt))*100/Decimal(rt):.1f}% |",
    "",
    "The setup row adds the two deployments and the computation with a commitment. The plain computation is an alternative, not an additional transaction in that total.",
    "",
    "## Snapshot provenance",
    "",
    "| Network | Chain ID | Block | Block timestamp (UTC) | Modeled gas price (wei/gas) |",
    "| --- | ---: | ---: | --- | ---: |",
]
for name, item in reports.items():
    price = item.get("modeled_gas_price_wei", item["quoted_gas_price_wei"])
    lines.append(f"| {name.title()} | {item['chain_id']} | {item['block_number']} | {item['block_timestamp_utc']} | {price:,} |")
lines += [
    "",
    f"The two pinned block timestamps are {comparison['snapshot_separation_seconds']:.0f} seconds apart. Each network's computation and oracle reads use its own fixed block. Gas-price quotes are sampled nearby because `eth_gasPrice` has no block parameter. The script uses the greater of the quote and the pinned block's base fee and records any adjustment. The initial Robinhood attempt rejected a lower quote; its error record is retained, and the completed run uses this explicit rule.",
    "",
    "## Method and checks",
    "",
    "- Both networks use the same compiled Solidity bytecode, four real quantized LFM weight rows and the same 1,024-element activation fixture. The complete simulation input has SHA-256 `" + b["input_sha256"] + "`.",
    "- Correct integer outputs: `207214, -150983, 410232, -109613`. Both networks also returned the expected commitment and exact kernel/shard runtime bytes from simulated contract creation (four checks per network).",
    "- The kernel, immutable weight data and dummy account funding are supplied as temporary RPC state overrides. Those addresses identify simulated contracts and are not deployment claims.",
    "- Robinhood: `eth_estimateGas × modeled gas price`; its estimator bundles execution and L1 data fees.",
    f"- Base: `eth_estimateGas × modeled gas price + GasPriceOracle.getL1Fee(unsigned transaction) + GasPriceOracle.getOperatorFee(estimated gas)`. Oracle version `{b['fee_oracle_version']}`; operator fee returned zero for all four operations. The raw report also records its L1 upper-estimate method.",
    "- Base oracle inputs are unsigned EIP-1559 transaction encodings, with no signature or key. Their serializer was checked against the independent eth-account transaction hash implementation for all four transaction shapes. Transaction nonces are modeled as 0 and 1 for deployments, and 2 for either computation option.",
    "- Raw gas estimates differ slightly between nodes. Estimator margins and different data-fee accounting prevent treating raw gas ratios as execution-speed ratios.",
    "",
    "## What this does not demonstrate",
    "",
    "This is 4,096 integer multiply-accumulates. The contract does not rescale outputs, execute nonlinear functions, tokenize text, produce a model token, preserve a complete activation checkpoint, or run an autonomous agent. The input activations are a test fixture. Four-row costs must not be multiplied by the entire parameter count and presented as a measured token cost.",
    "",
    "Base's documented smart-contract execution path is EVM; it does not provide the Arbitrum Stylus runtime used by our Rust/Wasm build. A move to Base therefore supports the Solidity approach. It does not solve new Stylus activation on Robinhood. Robinhood can already execute this same Solidity approach.",
    "",
    "Base documents a 16,777,216-gas maximum for ordinary transactions. A complete inference implementation would need bounded, resumable execution where necessary; hundreds of deployments do not remove per-transaction or chain throughput limits. No inference latency or throughput was measured here.",
    "",
    "## Decision and next gate",
    "",
    "Retain Robinhood compatibility and use Base as a candidate for the next Solidity benchmark. Before deploying the full model or choosing a permanent chain, implement and measure one complete LFM block, including deterministic scaling, nonlinearities and persistent intermediate state; then measure a full next-token pass and quantization quality. Acceptable reply cost and latency remain product decisions.",
    "",
    "## Reproduce",
    "",
    "From the package root with the contract benchmark dependencies installed:",
    "",
    "```bash",
    ".venv/bin/python contract-benchmark/compare_chains.py",
    ".venv/bin/python contract-benchmark/summarize_comparison.py",
    "```",
    "",
    "The first command makes only read-only RPC calls. The second renders saved results. Public RPC errors remain errors; no local values are silently substituted for missing mainnet results. Block hashes, exact values, unsigned oracle inputs and call timing are retained in `results/comparison-*.json`.",
    "",
    "## Primary references",
    "",
    "- https://docs.base.org/specifications/reference/smart-contracts",
    "- https://docs.base.org/specifications/transactions/network-fees",
    "- https://docs.base.org/specifications/base-protocol/execution/predeploys",
    "- https://docs.base.org/specifications/transactions/throughput-and-limits",
    "- https://github.com/ethereum-optimism/optimism/blob/develop/packages/contracts-bedrock/src/L2/GasPriceOracle.sol",
    "- https://docs.robinhood.com/chain/gas-and-fees/",
]
(ROOT / "CHAIN-COMPARISON.md").write_text("\n".join(lines) + "\n")
