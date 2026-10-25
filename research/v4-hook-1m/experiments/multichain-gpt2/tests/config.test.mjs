// Pure validation tests: importing the worker does not instantiate providers or read keys.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { HERE } from '../scripts/build.mjs';
import { validateConfig, gasLimitForEstimate } from '../scripts/worker.mjs';
import { resolveProductionSelection, validateRuntimeConfig } from '../scripts/verify-deployment.mjs';

const example = JSON.parse(fs.readFileSync(path.join(HERE, 'config/runtime.example.json')));
function validConfig() {
  const config = structuredClone(example);
  config.sessionId = '0x' + '12'.repeat(32);
  for (const [index, chain] of config.chains.entries()) {
    for (const [fieldIndex, field] of ['router', 'engine', 'root'].entries()) {
      chain[field] = '0x' + (index * 3 + fieldIndex + 1).toString(16).padStart(40, '0');
    }
  }
  return config;
}

function optimizedConfig() {
  const base=validConfig();
  const selection=resolveProductionSelection({routeConfiguration:'config/chains.optimized.json',engineContract:'GPT2ShardOptimized'});
  base.routeConfiguration=selection.routeConfiguration;
  base.routeConfigurationSha256=selection.routeConfigurationSha256;
  base.engineContract=selection.engineContract;
  base.chains=selection.configuration.chains.map((expected,index)=>({
    ...structuredClone(example.chains.find(chain=>chain.key===expected.key)),
    stage:index,layerRange:expected.layerRange,maxTransactionGas:expected.maxTransactionGas,
    router:'0x'+(index*3+1).toString(16).padStart(40,'0'),
    engine:'0x'+(index*3+2).toString(16).padStart(40,'0'),
    root:'0x'+(index*3+3).toString(16).padStart(40,'0'),
  }));
  return base;
}

test('fully populated configuration validates without any RPC or signing', () => {
  const config = validConfig(); assert.equal(validateConfig(config), config);
});
test('unconfigured example with null addresses is rejected', () => assert.throws(() => validateConfig(example)));
test('duplicate chains, endpoints and stage keys are rejected', () => {
  for (const field of ['chainId', 'eid', 'key']) {
    const config = validConfig(); config.chains[1][field] = config.chains[0][field];
    assert.throws(() => validateConfig(config), /Duplicate/);
  }
});
test('stage ordering must be contiguous', () => {
  const config = validConfig(); config.chains[2].stage = 4;
  assert.throws(() => validateConfig(config), /contiguous/);
});
test('zero and missing contract addresses are rejected', () => {
  for (const field of ['router', 'engine', 'root']) for (const value of [null, '0x' + '00'.repeat(20)]) {
    const config = validConfig(); config.chains[0][field] = value;
    assert.throws(() => validateConfig(config), /Unconfigured/);
  }
});
test('transaction gas cannot exceed 16777216 or be too small', () => {
  for (const gas of ['16777217', '100000', '-1']) {
    const config = validConfig(); config.chains[0].maxTransactionGas = gas;
    assert.throws(() => validateConfig(config), /gas ceiling/);
  }
});
test('RPC endpoints must be environment variable names', () => {
  for (const name of ['https://example.invalid/rpc', 'rpc key', 'abc', '1_RPC']) {
    const config = validConfig(); config.chains[0].rpcEnv = name;
    assert.throws(() => validateConfig(config), /environment variable/);
  }
});
test('negative fee budgets and invalid confirmation counts are rejected', () => {
  const fee = validConfig(); fee.chains[0].maxMessageFeeWei = '-1'; assert.throws(() => validateConfig(fee));
  const confirmation = validConfig(); confirmation.chains[0].confirmations = 0; assert.throws(() => validateConfig(confirmation));
});

test('optimized route accepts audited optimized engine and 30M only on Monad',()=>{
  const config=optimizedConfig();
  assert.equal(validateConfig(config),config);
  assert.equal(config.chains[3].key,'monad');
  assert.equal(config.chains[3].maxTransactionGas,'30000000');
  for(const chain of config.chains){
    const copy=structuredClone(config);
    copy.chains[chain.stage].maxTransactionGas=chain.key==='monad'?'30000001':'16777217';
    assert.throws(()=>validateConfig(copy),/gas ceiling/);
  }
});

test('engine selection rejects mocks and arbitrary contracts',()=>{
  for(const engineContract of ['MockGPT2Shard','OApp','../GPT2ShardOptimized','']){
    const config=validConfig();config.engineContract=engineContract;
    assert.throws(()=>validateConfig(config),/CONFIG_ENGINE_NOT_ALLOWED/);
  }
  const config=validConfig();config.chains[1].engineContract='GPT2ShardOptimized';
  assert.throws(()=>validateConfig(config),/Chain engine differs/);
});

test('route selection rejects external JSON and changed source hashes',()=>{
  for(const routeConfiguration of ['../config/chains.json','/tmp/chains.json','https://example.invalid/config.json']){
    const config=validConfig();config.routeConfiguration=routeConfiguration;
    assert.throws(()=>validateConfig(config),/CONFIG_ROUTE_FILE_NOT_ALLOWED/);
  }
  const config=optimizedConfig();config.routeConfigurationSha256='00'.repeat(32);
  assert.throws(()=>validateConfig(config),/CONFIG_ROUTE_FILE_HASH/);
});

test('optimized route cannot silently use baseline chain order or altered layer coverage',()=>{
  const baseline=validConfig();baseline.routeConfiguration='config/chains.optimized.json';
  assert.throws(()=>validateConfig(baseline),/Trusted route identity/);
  const config=optimizedConfig();config.chains[3].layerRange=[3,12];
  assert.throws(()=>validateConfig(config),/Trusted layer range/);
});

test('verifier accepts optimized route/engine only with exact expected chain identity and gas caps',()=>{
  const config=optimizedConfig();config.verificationFile='verified.json';
  for(const chain of config.chains){
    chain.routerDeploymentTx='0x'+'ab'.repeat(32);chain.engineDeploymentTx='0x'+'cd'.repeat(32);
  }
  const selected=resolveProductionSelection(config);
  const plan={modelId:config.modelId,routeId:config.routeId,stages:selected.configuration.chains};
  assert.equal(validateRuntimeConfig(config,plan),config);
  const changed=structuredClone(config);changed.chains[3].maxTransactionGas='30000001';
  assert.throws(()=>validateRuntimeConfig(changed,plan),/CONFIG_TRANSACTION_GAS/);
  const wrong=structuredClone(config);wrong.chains[3].engineContract='GPT2Shard';
  assert.throws(()=>validateRuntimeConfig(wrong,plan),/CONFIG_CHAIN_ENGINE/);
});

test('worker rejects an arbitrary model ID even with valid-looking addresses',()=>{
  const config=validConfig();config.modelId='0x'+'34'.repeat(32);
  assert.throws(()=>validateConfig(config),/canonical complete GPT-2/);
});

test('Monad declared gas uses rounded 1 percent plus 1000 while other chains keep prior padding',()=>{
  assert.equal(gasLimitForEstimate(1000000n,2000000n,true),1011000n);
  assert.equal(gasLimitForEstimate(1000000n,2000000n,false),1110000n);
  assert.equal(gasLimitForEstimate(101n,2000n,true),1103n);
  assert.equal(gasLimitForEstimate('1000000','1005000',true),1005000n);
  assert.equal(gasLimitForEstimate(30000000n,30000000n,true),30000000n);
});

test('gas padding rejects invalid or oversized estimates and never silently expands the cap',()=>{
  for(const value of [0n,-1n,2000001n])assert.throws(()=>gasLimitForEstimate(value,2000000n,true));
  assert.throws(()=>gasLimitForEstimate(1000000n,1005000n,false),/Padded gas/);
});
