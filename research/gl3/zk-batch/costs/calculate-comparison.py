"""Recalculate measured cost components from the exported Runpod evidence.

Usage: python3 calculate-comparison.py --root ../ --output comparison.json
Parent-chain fees here are private fixture fees; public price scenarios are
explicitly illustrative. No network calls, transaction signing or broadcasts.
"""
import argparse
import json
from decimal import Decimal
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = args.root
    load = lambda name: json.loads((root / name).read_text())
    quote = load('costs/compute-quote.json')
    proof = load('source-evaluation/complete16/measurement-summary.json')
    sdk = load('source-evaluation/complete16/sdk-result.json')
    bundle = load('source-evaluation/complete16/evm-proof.json')
    nitro = load('nitro-baseline/evidence/result.json')
    nitro_exit = load('nitro-baseline/evidence/actual-exit.json')
    verifier = load('nitro-baseline/verifier/parent-evidence/verifier-result.json')
    assert sdk['passed'] and sdk['actualExitCode'] == 0
    assert proof['actualExitCode'] == 0 and proof['cleanupRemainingCount'] == 0
    assert bundle['nativeVerified'] and bundle['proofKind'] == 'Groth16'
    assert bundle['transactions'] == 16 and bundle['chainId'] == 9
    assert bundle['publicValues'] == bundle['nativeExpectedPublicValues']
    assert not bundle['mockProof'] and not bundle['networkProver']
    assert nitro['passed'] and nitro_exit['exitCode'] == 0
    assert verifier['passed'] and len(verifier['negatives']) == 3
    assert all(row['status'] == 0 for row in verifier['negatives'])
    assert all(int(row['l2ComputeGasUsed']) < 7000000 for row in verifier['negatives'])
    hourly = Decimal(str(quote['computeUSDPerHour']))

    def rental(seconds):
        return str(Decimal(str(seconds)) / Decimal(3600) * hourly)

    verification_gas = int(verifier['verification']['gasUsed'])
    da = verifier['dataAvailability']
    da_gas = int(da['gasUsed'])
    nitro_gas = int(nitro['posting']['parentReceiptGasUsed'])
    # This scenario is explicitly not a fresh public-chain quote or paid fee.
    example_wei_per_gas = 20000000
    eth = lambda gas: str(Decimal(gas * example_wei_per_gas) / Decimal(10**18))
    result = {
        'schema': 'gh0st.gl3.zk-nitro-measured-comparison.v1',
        'workload': '16 identical signed ERC20 calls, matching prestate/outcomes/gas',
        'quote': quote,
        'proof': {
            'coldFullGroth16Seconds': proof['fullProofColdCallSeconds'],
            'wholeRunnerSeconds': proof['outerSeconds'],
            'coldCallFullPodComputeUSD': rental(proof['fullProofColdCallSeconds']),
            'wholeRunnerFullPodComputeUSD': rental(proof['outerSeconds']),
            'peakSampledOwnedRSSBytes': proof['peakSampledOwnedRSSBytes'],
            'warmProofMeasured': False,
            'coldOfficialCircuitFetchIncluded': True,
            'verifierGas': verification_gas,
            'separateUncompressedDAReceiptGas': da_gas,
            'sumTwoParentTransactionsGas': verification_gas + da_gas,
            'sumTwoParentTransactionsComputeGas':
                int(verifier['verification']['l2ComputeGasUsed']) + int(da['l2ComputeGasUsed']),
            'sumTwoParentTransactionsPosterGas':
                int(verifier['verification']['l1PosterGasUsed']) + int(da['l1PosterGasUsed']),
            'oneOffVerifierDeploymentGas': int(verifier['deployment']['gasUsed']),
            'twoTransactionParentGasRatioToNitroPosting':
                str(Decimal(verification_gas + da_gas) / Decimal(nitro_gas)),
        },
        'nitro': {
            'sequencingMilliseconds': nitro['sequencing']['wallMilliseconds'],
            'sequencingWindowFullPodComputeUSD': rental(
                Decimal(str(nitro['sequencing']['wallMilliseconds'])) / 1000),
            'postTriggerToFollowerMilliseconds':
                nitro['validation']['postTriggerToObservedReplayMilliseconds'],
            'postingReplayWindowFullPodComputeUSD': rental(
                Decimal(str(nitro['validation']['postTriggerToObservedReplayMilliseconds'])) / 1000),
            'wholeJobIncludingSetupSeconds': nitro_exit['seconds'],
            'wholeJobFullPodComputeUSD': rental(nitro_exit['seconds']),
            'parentPostingGas': nitro_gas,
            'parentComputeGas': int(nitro['posting']['parentL2ComputeGasUsed']),
            'parentPosterGas': int(nitro['posting']['parentL1PosterGasUsed']),
            'compressedBatchBytes': nitro['posting']['batchDataBytes'],
        },
        'illustrativeParentGasScenario': {
            'weiPerGas': example_wei_per_gas,
            'scope': 'Historical same-day R44 observation, not a fresh/all-in Robinhood quote',
            'nitroPostingETH': eth(nitro_gas),
            'proofVerificationETH': eth(verification_gas),
            'separateUncompressedDAETH': eth(da_gas),
            'twoTransactionProofPlusDAETH': eth(verification_gas + da_gas),
        },
        'boundaries': [
            'Compute values allocate the entire existing pod to each named elapsed window; not actual separately billed jobs.',
            'Parallel windows overlap and must not be added as independent rentals.',
            'Nitro sequencing/posting are separate observation windows, not a single measured combined latency.',
            'Cold ZK call includes official parameter fetch; warm proof latency/cost was not measured.',
            'Nitro data is compressed; the ZK data-only transaction publishes uncompressed raw calls. This is not an optimized equal-compression DA comparison.',
            'Verification plus separate DA is a sum of two actual transactions, not gas for a completed rollup coordinator.',
            'Private parent posting-price initialization differs: ZK receipts have zero poster gas, while the Nitro receipt has a nonzero poster component. Actual compute/poster components are reported separately.',
            'Setup/build/storage/tax/RPC/backup, production state acceptance, bridge and withdrawals are outside these components.',
            'The proved guest executes Ethereum EVM calls; Stylus/WASM and LLM inference are not proved by this benchmark.',
        ],
        'allExecutionOnRunpod': True,
        'productionRollupAccepted': False,
        'publicTransactionsSubmitted': 0,
    }
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
