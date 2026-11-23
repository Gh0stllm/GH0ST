'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

function dependency(name) {
    try {
        return require(name);
    } catch (error) {
        if (error.code !== 'MODULE_NOT_FOUND') throw error;
        return require(join(__dirname, '../../../chess/node_modules', name));
    }
}

const solc = dependency('solc');
const { Interface, formatEther, hexlify, id, toQuantity } = dependency('ethers');
const name = 'Mp1Q5Linear24';
const source = readFileSync(join(__dirname, '../mp1-evm/kernel', name + '.sol'), 'utf8');
const chainId = '0x1237';
const genesisHash = '0xaad15f3d702aaea00caf3e9bb56395efe9127bc3b31b24921abf1eee3409305c';
const maxGas = 32_000_000n;
const anchorAddress = label => '0x' + id('gh0st.scene-decoder.benchmark.' + label).slice(-40);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function compile(width) {
    // Specialize the already checked kernel for these widths. Every width is
    // a multiple of 32, preserving the four-group assembly loop.
    const specialized = source
        .replace(/\b192\b/g, (match, offset, original) =>
            original.slice(offset - 4, offset) === 'shl(' ? match : String(width))
        .replace(/\b768\b/g, (match, offset, original) =>
            original.slice(offset - 10, offset) === 'outputs > ' ? match : String(width * 4))
        .replace(/\b120\b/g, String(width * 5 / 8))
        .replace('lt(group, 24)', 'lt(group, ' + width / 8 + ')');
    const input = {
        language: 'Solidity', sources: { 'Kernel.sol': { content: specialized } },
        settings: {
            viaIR: true, evmVersion: 'shanghai', optimizer: { enabled: true, runs: 200 },
            outputSelection: { '*': { '*': ['abi', 'evm.deployedBytecode.object'] } },
        },
    };
    const out = JSON.parse(solc.compile(JSON.stringify(input)));
    const errors = (out.errors || []).filter(error => error.severity === 'error');
    assert.equal(errors.length, 0, errors.map(error => error.formattedMessage).join('\n'));
    const compiled = out.contracts['Kernel.sol'][name];
    return {
        abi: new Interface(compiled.abi),
        code: '0x' + compiled.evm.deployedBytecode.object,
        sourceSHA256: sha(specialized),
    };
}

const methods = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_gasPrice', 'eth_getCode', 'eth_call', 'eth_estimateGas']);
let nextId = 0;
async function rpc(method, params = []) {
    assert(methods.has(method));
    const requestId = ++nextId;
    const response = await fetch('https://rpc.mainnet.chain.robinhood.com', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25_000),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
    });
    const json = await response.json();
    assert(response.ok && json.id === requestId && !json.error, method + ': ' + (json.error?.message || response.status));
    return json.result;
}

function fixture(width, outputs, tokens) {
    let state = 31337;
    const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
    const activations = Buffer.alloc(tokens * width * 4);
    const weights = Buffer.alloc(width * outputs * 5 / 8 + 2);
    const expected = Buffer.alloc(tokens * outputs * 8);
    for (let i = 0; i < tokens * width; i++) activations.writeInt32LE((next() >>> 9) - 4194304, i * 4);
    activations.writeInt32LE(-8388608, 0);
    activations.writeInt32LE(8388607, 4);
    const codes = Array.from({ length: width * outputs }, () => next() >>> 27);
    codes.forEach((code, index) => {
        const bit = index * 5;
        const byte = 1 + (bit >>> 3);
        const shifted = code << (bit & 7);
        weights[byte] |= shifted & 255;
        weights[byte + 1] |= shifted >>> 8;
    });
    for (let output = 0; output < outputs; output++) {
        for (let token = 0; token < tokens; token++) {
            let sum = 0;
            for (let k = 0; k < width; k++) {
                sum += (codes[output * width + k] - 16) * activations.readInt32LE((token * width + k) * 4);
            }
            assert(Number.isSafeInteger(sum));
            expected.writeBigInt64LE(BigInt(sum), (output * tokens + token) * 8);
        }
    }
    return { activations, weights: weights.subarray(0, -1), expected };
}

async function main() {
    const evidencePath = process.argv[2] ?? join(__dirname, 'robinhood-dense.json');
    const [network, genesis, head, gasPrice, gasLimit] = await Promise.all([
        rpc('eth_chainId'), rpc('eth_getBlockByNumber', ['0x0', false]),
        rpc('eth_getBlockByNumber', ['latest', false]), rpc('eth_gasPrice'),
        rpc('eth_call', [{ to: '0x000000000000000000000000000000000000006c', data: id('getMaxTxGasLimit()').slice(0, 10) }, 'latest']),
    ]);
    assert.equal(network, chainId);
    assert.equal(genesis.hash, genesisHash);
    assert.equal(BigInt(gasLimit), maxGas);
    const anchor = head.number;
    const kernels = new Map([32, 96].map(width => [width, compile(width)]));
    const shapes = [
        { layer: 'scene conditioning', width: 96, outputs: 512, tokens: 1, repetitions: 2 },
        { layer: 'pointwise mixing', width: 32, outputs: 32, tokens: 64, repetitions: 2 },
        { layer: 'patch logits', width: 32, outputs: 64, tokens: 64, repetitions: 1 },
    ];
    const samples = await Promise.all(shapes.map(async shape => {
        const { width, outputs, tokens, repetitions } = shape;
        const built = kernels.get(width);
        const { activations, weights, expected } = fixture(width, outputs, tokens);
        const target = anchorAddress('width-' + width);
        const weightsAccount = anchorAddress('data-' + width + '-' + outputs);
        for (const result of await Promise.all([target, weightsAccount].map(account => rpc('eth_getCode', [account, anchor])))) {
            assert.equal(result, '0x');
        }
        const state = { [target]: { code: built.code }, [weightsAccount]: { code: hexlify(weights) } };
        const args = [hexlify(activations), weightsAccount, 1, width * 5 / 8, width, outputs];
        const call = operation => ({ to: target, gas: toQuantity(maxGas), data: built.abi.encodeFunctionData(operation, args) });
        const [result, estimate] = await Promise.all([
            rpc('eth_call', [call('measure'), anchor, state]),
            rpc('eth_estimateGas', [call('linearRaw'), anchor, state]),
        ]);
        const [sums, executionGas] = built.abi.decodeFunctionResult('measure', result);
        assert.equal(sums, hexlify(expected));
        assert(executionGas < BigInt(estimate) && BigInt(estimate) <= maxGas);
        return {
            ...shape, macs: width * outputs * tokens * repetitions,
            estimatedGasPerCall: Number(BigInt(estimate)), executionGasPerCall: Number(executionGas),
            weightsSHA256: sha(weights), inputSHA256: sha(activations), outputSHA256: sha(expected),
            sourceSHA256: built.sourceSHA256, runtimeSHA256: sha(Buffer.from(built.code.slice(2), 'hex')),
            matchesIntegerOracle: true,
        };
    }));
    assert.equal((await rpc('eth_getBlockByNumber', [anchor, false])).hash, head.hash);
    const denseGas = samples.reduce((sum, sample) => sum + sample.estimatedGasPerCall * sample.repetitions, 0);
    const evidence = {
        kind: 'read-only Robinhood state-override estimates for standalone dense layers using synthetic weights',
        scope: 'The subtotal includes the separate call overhead and excludes spatial mixing, rescaling, biases, prompt processing, patch selection, pixel output and any writes.',
        chainId: Number(BigInt(network)), block: Number(BigInt(anchor)), blockHash: head.hash,
        compiler: solc.version(), gasPriceWei: BigInt(gasPrice).toString(), maxTransactionGas: Number(maxGas),
        denseGasSubtotal: denseGas, denseCostETHAtSampledPrice: formatEther(BigInt(denseGas) * BigInt(gasPrice)), samples,
    };
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify(evidence));
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
