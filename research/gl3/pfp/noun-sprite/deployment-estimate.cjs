'use strict';

const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, renameSync, chmodSync } = require('node:fs');
const { join } = require('node:path');
const { parseArgs } = require('node:util');
const {
    compile, readModel, rpc, stateFor, chainId, genesisHash, maxGas, gasInfo, solc, byteLength,
} = require('./runtime/benchmark.cjs');

let ethers;
try {
    ethers = require('ethers');
} catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    ethers = require('../../gh0st-chess/research/chess/node_modules/ethers');
}
const { AbiCoder, concat, formatEther, getAddress, getCreateAddress, id, keccak256, toBeHex, toQuantity } = ethers;

const maxInitcode = 49_152;
const factoryRuntime = '0x00';
const shardNames = ['mask input weights', 'mask output weights', 'mask parameters', 'planner input weights',
    'planner output weights', 'planner parameters', 'visual-trait lexicon'];

function runtimeCreation(code) {
    // PUSH3 length, PUSH2 17, PUSH1 0, CODECOPY, PUSH3 length, PUSH1 0, RETURN.
    const size = toBeHex(byteLength(code), 3).slice(2);
    return '0x62' + size + '61001160003962' + size + '6000f3' + code.slice(2);
}

function factoryCreation(children) {
    // Each block copies one child initializer and CREATEs it. Verify both the
    // actual child address and runtime hash before continuing. Revert atomically
    // if the nonce, address, constructor or installed bytes differ from the plan.
    const word = number => toBeHex(number, 2).slice(2);
    const bytesPerChild = 82;
    const success = '5f5f5360015ff3'; // MSTORE8(0, STOP), RETURN(0, 1)
    const fail = '5b5f5ffd'; // JUMPDEST; REVERT(0, 0)
    const failAt = bytesPerChild * children.length + success.length / 2;
    let offset = failAt + fail.length / 2;
    const prefix = children.map(child => {
        const size = byteLength(child.data);
        const init = '61' + word(size) + '61' + word(offset) + '5f39' + '61' + word(size) + '5f5ff0';
        const addressCheck = '8073' + child.address.slice(2).toLowerCase() + '141561' + word(failAt) + '57';
        const hashCheck = '3f7f' + child.runtimeCodeHash.slice(2) + '141561' + word(failAt) + '57';
        const block = init + addressCheck + hashCheck;
        assert.equal(block.length / 2, bytesPerChild);
        offset += size;
        return block;
    }).join('');
    const result = concat(['0x' + prefix + success + fail, ...children.map(child => child.data)]);
    assert.equal(byteLength(result), offset);
    assert(byteLength(result) <= maxInitcode, 'Atomic initializer exceeds the 49,152-byte EIP-3860 limit');
    return result;
}

function writeJSON(path, data, privateFile = false) {
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { mode: privateFile ? 0o600 : 0o644 });
    if (privateFile) chmodSync(temporary, 0o600);
    renameSync(temporary, path);
}

async function main() {
    const { values } = parseArgs({ options: {
        payer: { type: 'string' }, kernel: { type: 'string', multiple: true },
        evidence: { type: 'string', default: join(__dirname, 'deployment-estimate.json') },
        plan: { type: 'string', default: join(__dirname, 'deployment-unsigned.json') },
    } });
    assert(values.payer, 'Usage: node deployment-estimate.cjs --payer PUBLIC_ADDRESS [--kernel PUBLIC_ADDRESS]');
    const payer = getAddress(values.payer);
    const model = readModel(join(__dirname, 'manifest.json'));
    const verified = JSON.parse(readFileSync(join(__dirname, 'robinhood.json')));
    assert.equal(verified.modelId, model.modelId, 'Mainnet inference evidence is for a different model');
    const { decoder, kernel, sourceSHA256 } = compile();
    assert.deepEqual(sourceSHA256, verified.sourceSHA256, 'Solidity differs from the verified inference run');
    assert.equal(solc.version(), verified.compiler, 'Compiler differs from the verified inference run');

    assert.equal(BigInt(await rpc('eth_chainId')), chainId, 'Wrong Robinhood chain ID');
    const [genesis, head, quote, pendingNonce] = await Promise.all([
        rpc('eth_getBlockByNumber', ['0x0', false]), rpc('eth_getBlockByNumber', ['latest', false]),
        rpc('eth_gasPrice'), rpc('eth_getTransactionCount', [payer, 'pending']),
    ]);
    assert.equal(genesis.hash, genesisHash, 'Wrong Robinhood genesis');
    assert(head?.hash && head.baseFeePerGas, 'Missing pinned Robinhood block');
    const block = head.number;
    const [nonceHex, balanceHex, cap, senderCode] = await Promise.all([
        rpc('eth_getTransactionCount', [payer, block]), rpc('eth_getBalance', [payer, block]),
        rpc('eth_call', [{ to: gasInfo, data: id('getMaxTxGasLimit()').slice(0, 10) }, block]),
        rpc('eth_getCode', [payer, block]),
    ]);
    assert.equal(senderCode, '0x', 'This review expects a direct transaction from a regular wallet');
    assert.equal(BigInt(cap), maxGas, 'Robinhood transaction cap changed');
    assert.equal(BigInt(nonceHex), BigInt(pendingNonce), 'Wallet has unconfirmed transactions; wait before preparing a review');
    const nonce = Number(BigInt(nonceHex));
    assert(Number.isSafeInteger(nonce), 'Wallet nonce too large');
    const factory = getCreateAddress({ from: payer, nonce });
    const oneCall = data => ({ from: payer, gas: toQuantity(maxGas), nonce: toQuantity(nonce), value: '0x0', data });
    const kernelRuntime = await rpc('eth_call', [oneCall(kernel.creationCode), block]);
    assert.equal(keccak256(kernelRuntime), verified.contracts.kernel.codeHash, 'Kernel bytecode differs from the verified inference run');

    const known = [verified.contracts.kernel.address, ...(values.kernel ?? [])].map(getAddress);
    const kernelCandidates = await Promise.all([...new Set(known)].map(async address => {
        const code = await rpc('eth_getCode', [address, block]);
        return { address, runtimeCodeHash: code === '0x' ? null : keccak256(code) };
    }));
    const reused = kernelCandidates.find(item => item.runtimeCodeHash === verified.contracts.kernel.codeHash);
    const child = (label, nonce, data, runtime) => ({
        label, nonce, address: getCreateAddress({ from: factory, nonce }), data, runtime,
        runtimeCodeHash: keccak256(runtime), runtimeBytes: byteLength(runtime),
    });
    const shards = model.shards.map((shard, index) => child(shardNames[index], index + 1, runtimeCreation(shard.code), shard.code));
    const kernelChild = reused ? { ...reused, label: 'shared packed-math kernel', runtime: kernelRuntime } :
        child('shared packed-math kernel', shards.length + 1, kernel.creationCode, kernelRuntime);
    const constructor = decoder.abi.encodeDeploy([
        shards.map(shard => shard.address), shards.map(shard => shard.runtimeCodeHash),
        kernelChild.address, kernelChild.runtimeCodeHash, model.modelId,
    ]);
    const codeCommitment = keccak256(AbiCoder.defaultAbiCoder().encode(
        ['bytes32[7]', 'bytes32'], [shards.map(shard => shard.runtimeCodeHash), kernelChild.runtimeCodeHash],
    ));
    const modelData = concat([decoder.creationCode, constructor]);
    const dependencies = [...shards, ...(reused ? [] : [kernelChild])];
    const modelRuntime = await rpc('eth_call', [
        oneCall(modelData), block, stateFor(dependencies.map(({ address, runtime }) => ({ address, code: runtime }))),
    ]);
    assert.equal(byteLength(modelRuntime), verified.contracts.decoder.runtimeBytes, 'Model runtime length changed');
    const modelChild = child('noun-to-sprite model', dependencies.length + 1, modelData, modelRuntime);
    const children = [...dependencies, modelChild];

    const emptyAddresses = [factory, ...children.map(item => item.address)];
    for (let index = 0; index < emptyAddresses.length; index += 2) {
        await Promise.all(emptyAddresses.slice(index, index + 2).map(async address => {
            const [code, nonce] = await Promise.all([
                rpc('eth_getCode', [address, block]), rpc('eth_getTransactionCount', [address, block]),
            ]);
            assert(code === '0x' && BigInt(nonce) === 0n, `CREATE address already occupied: ${address}`);
        }));
    }

    const data = factoryCreation(children);
    const tx = oneCall(data);
    // This is the exact wallet creation, with no state override. Any wrong
    // address, failed CREATE or wrong runtime hash reverts the entire call.
    const [runtime, estimate] = await Promise.all([
        rpc('eth_call', [tx, block]), rpc('eth_estimateGas', [tx, block]),
    ]);
    assert(runtime === factoryRuntime, 'Atomic creation did not complete');
    const estimateGas = Number(BigInt(estimate));
    assert(Number.isSafeInteger(estimateGas) && estimateGas > 0 && BigInt(estimateGas) <= maxGas);
    const [chainCheck, nonceCheck, latestNonce, lastQuote] = await Promise.all([
        rpc('eth_getBlockByNumber', [block, false]), rpc('eth_getTransactionCount', [payer, 'pending']),
        rpc('eth_getTransactionCount', [payer, 'latest']), rpc('eth_gasPrice'),
    ]);
    assert.equal(chainCheck.hash, head.hash, 'Pinned block changed');
    assert(BigInt(nonceCheck) === BigInt(nonceHex) && BigInt(latestNonce) === BigInt(nonceHex), 'Wallet nonce changed during review preparation');
    assert(BigInt(lastQuote) > 0n && BigInt(quote) > 0n);
    const gasPriceWei = BigInt(lastQuote);
    const baseFeeWei = BigInt(head.baseFeePerGas).toString();
    const fee = BigInt(estimateGas) * gasPriceWei;
    const payloadKeccak256 = keccak256(data);
    const quotedBlock = Number(BigInt(block));
    const quotedBlockHash = head.hash;
    const accounts = children.map(({ data, runtime, ...summary }) => ({ ...summary, initCodeBytes: byteLength(data) }));
    const factoryRuntimeCodeHash = keccak256(factoryRuntime);
    const review = {
        payer, nonce, factory, modelAddress: modelChild.address, chainId: Number(chainId), modelId: model.modelId,
        quotedBlock, quotedBlockHash, estimateGas, gasPriceWei: gasPriceWei.toString(), baseFeeWei,
        data, payloadKeccak256, children: accounts, factoryRuntimeCodeHash, codeCommitment,
        kernelAddress: kernelChild.address, kernelReused: Boolean(reused), balanceWei: BigInt(balanceHex).toString(),
        startGasPriceWei: BigInt(quote).toString(), estimatedFeeWei: fee.toString(),
        createValueWei: '0', initCodeBytes: byteLength(data), transactionGasCap: Number(maxGas),
    };
    const evidence = {
        kind: 'read-only-robinhood-atomic-noun-sprite-deployment-estimate',
        scope: 'Exact wallet-specific atomic creation checked by eth_call and eth_estimateGas on Robinhood mainnet. The full simulator call used no code or state overrides. The creation code verified every child address and deployed code hash. No transaction was broadcast.',
        chainId: Number(chainId), genesisHash, quotedBlock, quotedBlockHash,
        blockTimestamp: new Date(Number(BigInt(head.timestamp)) * 1000).toISOString(),
        modelId: model.modelId, modelBytes: model.modelBytes, compiler: solc.version(), sourceSHA256,
        directTransactions: 1, childrenCreated: children.length, kernelReused: Boolean(reused),
        kernelCandidatesChecked: kernelCandidates.length, initCodeBytes: byteLength(data), maxInitCodeBytes: maxInitcode,
        estimateGas, gasPriceWei: gasPriceWei.toString(), baseFeeWei, transactionGasCap: Number(maxGas),
        estimatedFeeWei: fee.toString(), estimatedETH: formatEther(fee),
    };
    writeJSON(values.plan, review, true);
    writeJSON(values.evidence, evidence);
    console.log(JSON.stringify(evidence));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
