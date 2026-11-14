import assert from 'node:assert/strict';
import { generateNpcDataset, trainModel, verifyModel, predictQuantized } from '../training/core.mjs';
import { compile, constructorArgs, deploymentModelId, ethers, localChain, normalizeTrace, save } from '../runtime/lib.mjs';

// Full creator pipeline on an isolated EVM. No public RPC or wallet is used.
const dataset=generateNpcDataset({seed:41,rows:360});
const result=await trainModel(dataset,{seed:42,epochs:100,hiddenSize:8});
await verifyModel(result.model);
const model=result.model;
const config={inputCount:model.shape.input,hiddenWidth:model.shape.hidden,classCount:model.shape.output,
  featureSchemaHash:model.hashes.featureSchemaHash,labelsHash:model.hashes.labelsHash,
  datasetHash:model.hashes.datasetHash,packedWeights:model.packedWeightsHex};
const artifacts=compile(true),chain=await localChain();
try {
  const signer=chain.signers[0],beneficiary=chain.addresses[0];
  const token=await new ethers.ContractFactory(artifacts.ForgeTestToken.abi,artifacts.ForgeTestToken.bytecode,signer).deploy();
  await token.waitForDeployment();
  const contract=await new ethers.ContractFactory(artifacts.ForgeModel.abi,artifacts.ForgeModel.bytecode,signer).deploy(...constructorArgs(token.target,beneficiary,0n,config));
  const receipt=await contract.deploymentTransaction().wait();
  assert.equal(receipt.status,1);
  assert.equal(await contract.modelHash(),model.hashes.modelHash);
  assert.equal(await contract.weightsHash(),model.hashes.weightsHash);
  assert.equal(await contract.modelId(),deploymentModelId(31337,contract.target,token.target,beneficiary,0n,model.hashes.modelHash));
  let matches=0;
  for(const id of result.splitSummary.testRowIds){
    const expected=predictQuantized(model,dataset.rows[id].features);
    const actual=normalizeTrace(await contract.predict(expected.normalizedQ8));
    assert.deepEqual(actual,{hidden:expected.hidden,logits:expected.logits,classId:expected.classId});
    matches++;
  }
  assert.equal(matches,result.metrics.testRows);
  save('results/training-to-runtime.json',{
    schema:'gh0st-forge-training-runtime-check-v1',passed:true,network:'isolated Ganache chain 31337',publicTransactions:0,
    generatedExample:true,trainingRows:result.splitSummary.trainRows,validationRows:result.splitSummary.validationRows,
    heldoutRows:matches,allHiddenLogitsAndClassesMatch:true,modelHash:model.hashes.modelHash,
    heldoutAccuracy:result.metrics.heldoutAccuracy,majorityBaseline:result.metrics.baselines.majority.testAccuracy,
    singleRuleBaseline:result.metrics.baselines.simpleRule.testAccuracy,localDeploymentGas:String(receipt.gasUsed),
    source:'tests/train-to-runtime.mjs',
  });
  console.log(JSON.stringify({passed:true,heldoutTraces:matches,modelHash:model.hashes.modelHash,publicTransactions:0}));
} finally { await chain.close(); }
