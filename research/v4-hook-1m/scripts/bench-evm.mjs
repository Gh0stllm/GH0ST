import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import { keccak256 } from 'ethers';
import { base, compilationSettings, compileResearch, createFixture, params } from '../tests/evm/helpers.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const compiled = compileResearch();
const fixture = await createFixture(compiled);
const measurements = [];
const measure = async (name, send) => {
  const transaction = await send();
  const receipt = await transaction.wait();
  measurements.push({ name, gas_used: receipt.gasUsed.toString(), transaction_hash: receipt.hash,
    intrinsic_gas_included: true, scope: 'local callback harness transaction, not a complete v4 swap or neural inference' });
};

try {
  await measure('baseline_beforeSwap_without_policy', () => fixture.manager.driveBeforeSwap(fixture.key, params, '0x'));
  const policy = await fixture.policy();
  await measure('mock_publisher_attestation_storage_only', () => fixture.source.publish(policy));
  await measure('accepted_policy_first_beforeSwap', () => fixture.manager.driveBeforeSwap(fixture.key, params, '0x'));
  await measure('accepted_policy_reused_beforeSwap', () => fixture.manager.driveBeforeSwap(fixture.key, params, '0x'));
  await measure('accepted_policy_beforeSwap_plus_afterSwap_new_sample', () => fixture.manager.driveCallbackCycle(fixture.key, params, 10, '0x'));
  await (await fixture.source.setMode(3)).wait();
  await measure('gas_exhausting_source_baseline_beforeSwap', () => fixture.manager.driveBeforeSwap(fixture.key, params, '0x', { gasLimit: 180_000 }));
  await (await fixture.source.setMode(0)).wait();
  await fixture.rpc.request({ method: 'evm_increaseTime', params: [301] });
  await fixture.rpc.request({ method: 'evm_mine', params: [] });
  await measure('expired_policy_baseline_beforeSwap', () => fixture.manager.driveBeforeSwap(fixture.key, params, '0x'));

  const artifact = compiled.contracts['contracts/GH0STPolicyHook.sol'].GH0STPolicyHook;
  const sourceFiles = ['contracts/GH0STPolicyHook.sol', 'contracts/IFinalizedPolicySource.sol', 'tests/evm/ResearchHarness.sol'];
  const report = {
    schema_version: 1,
    generated_at_utc: new Date().toISOString(),
    status: 'LOCAL_RESEARCH_ONLY',
    scope: 'Bounded cached-policy hook consumer; mock publisher attestation; no trained model executes in this harness.',
    chain: 'In-process Ganache Shanghai; no public network transactions',
    compiler: { version: solc.version(), ...compilationSettings },
    dependencies: JSON.parse(readFileSync(path.join(base, 'package.json'), 'utf8')).devDependencies,
    hook_runtime_bytes: artifact.evm.deployedBytecode.object.length / 2,
    hook_template_runtime_keccak256: keccak256('0x' + artifact.evm.deployedBytecode.object),
    actual_deployed_hook_runtime_keccak256: keccak256(await fixture.provider.getCode(await fixture.hook.getAddress())),
    deployment_gas_including_test_factory: fixture.deployment.gasUsed.toString(),
    source_sha256: Object.fromEntries(sourceFiles.map(file => [file, sha256(readFileSync(path.join(base, file)))])),
    config: { minimum_fee: fixture.config.minimumFee, maximum_fee: fixture.config.maximumFee,
      fallback_fee: fixture.config.fallbackFee, maximum_tick_drift: fixture.config.maximumTickDrift,
      maximum_policy_age_seconds: fixture.config.maximumPolicyAgeSeconds, source_gas_cap: 60_000, snapshots: 64 },
    limitations: [
      'V4CallbackHarness uses upstream Hooks.sol and the StateLibrary read layout, but implements no AMM math, liquidity, unlocking, or token settlement.',
      'MockAttestedPolicySource restricts its publisher but does not verify inference or complete model inputs.',
      'Snapshot hash binds sampled tick metadata; the full time-series input hash is an unverified source assertion.',
      'Snapshot sampling and tick drift checks are not proof of manipulation resistance.',
      'Measurements include transaction intrinsic gas and harness bookkeeping; they are not incremental production swap overhead.',
      'No Robinhood deployment, chain-specific fee estimate, full-model EVM inference, or performance/alpha claim is made.',
    ],
    measurements,
  };
  const json = JSON.stringify(report, null, 2) + '\n';
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex !== -1) {
    if (!process.argv[outputIndex + 1]) throw new Error('--output requires a filename');
    writeFileSync(process.argv[outputIndex + 1], json);
    console.log(`Wrote local EVM research report to ${process.argv[outputIndex + 1]}`);
  } else process.stdout.write(json);
} finally { await fixture.close(); }
