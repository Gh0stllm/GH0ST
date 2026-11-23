'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

function dependency(name) {
    try {
        return require(name);
    } catch (error) {
        if (error.code !== 'MODULE_NOT_FOUND') throw error;
        return require(join(__dirname, '../../../../chess/node_modules', name));
    }
}
const solc = dependency('solc');
const { Interface, hexlify, id, toQuantity, formatEther } = dependency('ethers');
const chainId = '0x1237';
const genesisHash = '0xaad15f3d702aaea00caf3e9bb56395efe9127bc3b31b24921abf1eee3409305c';
const rpcUrl = 'https://rpc.mainnet.chain.robinhood.com';
const maxGas = 32_000_000n;
const expectedModelSHA256 = 'c08f7a858225992e6aae2a495a46a305ff16c5d4b6677d5225d1cc792c1b8ab9';
const expectedMetadataSHA256 = '96c83b057434ecc4f3fe7886030b2fb3b6813e05ca926f0756bac54ff27794e7';
const useNarrow = process.env.MP1_PACKED_24 === '1';
const addressFor = name => '0x' + id('gh0st.mp1-evm.benchmark.' + name).slice(-40);
const target = addressFor('q5-linear-v1');
const weightAccount = addressFor('blocks.0.qkv.weight-v1');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function compile() {
    const files = ['Mp1Q5Linear.sol', 'Mp1Q5Linear24.sol', 'Mp1Q5Projection.sol'];
    const input = {
        language: 'Solidity',
        sources: Object.fromEntries(files.map(name => [name, { content: readFileSync(join(__dirname, name), 'utf8') }])),
        settings: {
            evmVersion: 'shanghai', viaIR: true, optimizer: { enabled: true, runs: 200 },
            outputSelection: { '*': { '*': ['abi', 'evm.deployedBytecode.object'] } },
        },
    };
    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    const errors = (output.errors || []).filter(entry => entry.severity === 'error');
    assert.equal(errors.length, 0, errors.map(entry => entry.formattedMessage).join('\n'));
    return Object.fromEntries(files.map(name => [name.slice(0, -4), output.contracts[name][name.slice(0, -4)]]));
}

let nextId = 0;
async function rpc(method, params = []) {
    assert(['eth_chainId', 'eth_getBlockByNumber', 'eth_gasPrice', 'eth_getCode', 'eth_call', 'eth_estimateGas'].includes(method),
        'Read-only RPC methods only');
    const requestId = ++nextId;
    const response = await fetch(rpcUrl, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25_000),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
    });
    const body = await response.json();
    if (!response.ok || body.id !== requestId || body.error || !Object.hasOwn(body, 'result')) {
        throw Error(method + ' failed: ' + (body.error?.message ?? response.status));
    }
    return body.result;
}

function makeActivations(tokens, width) {
    const bytes = Buffer.alloc(tokens * width * 4);
    const min = useNarrow ? -8_388_608 : -2_147_483_648;
    const initial = [min, -min - 1, -65_536, 65_536, -1, 1, 0, -2_000_000];
    for (let i = 0; i < initial.length; i++) bytes.writeInt32LE(initial[i], 4 * i);
    let random = 212_451;
    for (let i = initial.length; i < tokens * width; i++) {
        random = (Math.imul(1_664_525, random) + 1_013_904_223) >>> 0;
        bytes.writeInt32LE((random % 2_097_153) - 1_048_576, i * 4);
    }
    return bytes;
}

function expected(activations, weights, tokens, outputs, width, weightStride, byteOffset) {
    const out = Buffer.alloc(tokens * outputs * 8);
    for (let row = 0; row < outputs; row++) {
        for (let token = 0; token < tokens; token++) {
            // The INT32 × signed-five-bit × K sum is exact in JS's 53-bit integer range for every supported K.
            let acc = 0;
            for (let k = 0; k < width; k++) {
                const bit = k * 5;
                const at = byteOffset + row * weightStride + (bit >>> 3);
                const packed = weights[at] | ((weights[at + 1] ?? 0) << 8);
                const w = ((packed >>> (bit & 7)) & 31) - 16;
                acc += activations.readInt32LE((token * width + k) * 4) * w;
            }
            assert(Number.isSafeInteger(acc));
            out.writeBigInt64LE(BigInt(acc), (row * tokens + token) * 8);
        }
    }
    return out;
}

function signedLE(values) {
    const serialized = Buffer.alloc(values.length * 4);
    for (const [offset, value] of values.entries()) serialized.writeInt32LE(value, offset * 4);
    return serialized;
}

async function measureFixedProjection(model, metadata, compiled, anchor, overrides) {
    const vectors = JSON.parse(readFileSync(join(__dirname, '../reference/evidence/vectors.json'), 'utf8'));
    assert.equal(vectors.format, 'gh0st-mp1-q5-q16-v1');
    const projectionAddress = addressFor('q5-projection-v1');
    assert.equal(await rpc('eth_getCode', [projectionAddress, anchor]), '0x');
    const code = compiled.evm.deployedBytecode.object;
    const coder = new Interface(compiled.abi);
    const samples = [];
    for (const vector of [vectors.linearQkv, vectors.linearFc2]) {
        const pointer = addressFor(vector.name + '.fixed-projection-v1');
        assert.equal(await rpc('eth_getCode', [pointer, anchor]), '0x');
        const tensor = metadata.tensors.find(item => item.name === vector.name + '.weight');
        const bias = metadata.tensors.find(item => item.name === vector.name + '.bias');
        assert.equal(tensor.dtype, 'int5');
        assert.equal(tensor.group, 192);
        assert.equal(bias.dtype, 'float32');
        const outputs = vector.outputQ16.length;
        const width = tensor.shape[1];
        assert.equal(width, vector.inputQ16.length);
        const first = vector.firstOutputChannel;
        const weightsOffset = tensor.offset + first * width * 5 / 8;
        const scaleOffset = tensor.scaleOffset + first * width / 192 * 2;
        const biasOffset = bias.offset + first * 4;
        const weightBytes = outputs * width * 5 / 8;
        const scaleBytes = outputs * width / 192 * 2;
        const data = Buffer.concat([Buffer.from([0]),
            model.subarray(weightsOffset, weightsOffset + weightBytes),
            model.subarray(scaleOffset, scaleOffset + scaleBytes),
            model.subarray(biasOffset, biasOffset + outputs * 4),
        ]);
        const state = {
            ...overrides,
            [projectionAddress]: { code: '0x' + code },
            [pointer]: { code: hexlify(data) },
        };
        const inputs = signedLE(vector.inputQ16);
        const result = signedLE(vector.outputQ16);
        const args = [hexlify(inputs), target,
            [pointer, 1, 1 + weightBytes, 1 + weightBytes + scaleBytes, width, outputs]];
        const call = operation => ({ to: projectionAddress, gas: toQuantity(maxGas), data: coder.encodeFunctionData(operation, args) });
        const returned = await rpc('eth_call', [call('measure'), anchor, state]);
        const [value, used] = coder.decodeFunctionResult('measure', returned);
        assert.equal(value, hexlify(result), 'The scaled integer output differs from the reference');
        const estimate = BigInt(await rpc('eth_estimateGas', [call('project'), anchor, state]));
        assert(estimate <= maxGas && used < estimate);
        const sample = {
            tensor: vector.name, prompt: vectors.prompt, seed: vectors.seed,
            tokens: 1, width, outputs, groups: width / 192,
            firstOutputChannel: first, inputSHA256: sha(inputs), outputSHA256: sha(result),
            scaledProjectionMatchesReference: true, executionGas: Number(used), estimatedGas: Number(estimate),
        };
        samples.push(sample);
        console.log(JSON.stringify(sample));
    }
    return { runtimeSHA256: sha(Buffer.from(code, 'hex')), samples };
}

async function main() {
    const [, , modelDirectory, evidenceFile] = process.argv;
    assert(modelDirectory && evidenceFile, 'Usage: node benchmark.cjs PATH_TO_Q5_DIRECTORY EVIDENCE_JSON');
    const metadataBytes = readFileSync(join(modelDirectory, 'm-p1.json'));
    const metadata = JSON.parse(metadataBytes);
    const model = readFileSync(join(modelDirectory, 'm-p1.bin'));
    assert.equal(sha(model), expectedModelSHA256);
    assert.equal(sha(metadataBytes), expectedMetadataSHA256);
    const tensor = metadata.tensors.find(item => item.name === 'blocks.0.qkv.weight');
    assert.deepEqual(tensor.shape, [576, 192]);
    assert.equal(tensor.dtype, 'int5');
    assert.equal(tensor.group, 192);
    const weights = model.subarray(tensor.offset, tensor.offset + tensor.length);
    const shard = Buffer.concat([Buffer.from([0]), weights]);
    const contracts = compile();
    const built = useNarrow ? contracts.Mp1Q5Linear24 : contracts.Mp1Q5Linear;
    const code = '0x' + built.evm.deployedBytecode.object;
    if (process.env.MP1_COMPILE_ONLY === '1') {
        console.log(JSON.stringify({ compiler: solc.version(), codeBytes: (code.length - 2) / 2 }));
        return;
    }
    const abi = new Interface(built.abi);
    const [network, genesis, head, gasPrice, txGasLimit] = await Promise.all([
        rpc('eth_chainId'), rpc('eth_getBlockByNumber', ['0x0', false]),
        rpc('eth_getBlockByNumber', ['latest', false]), rpc('eth_gasPrice'),
        rpc('eth_call', [{ to: '0x000000000000000000000000000000000000006c', data: id('getMaxTxGasLimit()').slice(0, 10) }, 'latest']),
    ]);
    assert.equal(network, chainId);
    assert.equal(genesis.hash, genesisHash);
    assert.equal(BigInt(txGasLimit), maxGas);
    const anchor = head.number;
    for (const address of [target, weightAccount]) {
        assert.equal(await rpc('eth_getCode', [address, anchor]), '0x', 'Override address already deployed');
    }
    const overrides = {
        [target]: { code },
        [weightAccount]: { code: hexlify(shard) },
    };
    const rows = [];
    const outputFile = resolve(evidenceFile);
    const evidence = {
        kind: 'read-only-robinhood-state-override-kernel-measurement',
        kernel: useNarrow ? 'Mp1Q5Linear24' : 'Mp1Q5Linear',
        chainId: Number(BigInt(network)), block: Number(BigInt(anchor)), blockHash: head.hash,
        gasPriceWei: BigInt(gasPrice).toString(), blockBaseFeeWei: BigInt(head.baseFeePerGas).toString(),
        maxTransactionGas: Number(maxGas), compiler: solc.version(), runtimeBytes: (code.length - 2) / 2,
        runtimeSHA256: sha(Buffer.from(code.slice(2), 'hex')), packedModelSHA256: sha(model),
        weights: { tensor: tensor.name, shape: tensor.shape, sha256: sha(weights) },
        input: 'Raw tile timing uses deterministic signed test rows including the supported extrema; scaled projections use first-forward-pass fixed-point reference fixtures.',
        limits: 'Linear operators only. Nonlinearities, all other operators, and checkpoint fees are outside these measurements.',
        samples: rows,
    };
    const save = () => writeFileSync(outputFile, JSON.stringify(evidence, null, 2) + '\n');
    const cases = [[13, 64], [13, 128], [32, 64], [32, 128]];
    if (useNarrow) cases.push([13, 256], [32, 256]);
    for (const [tokens, outputs] of cases) {
        const width = tensor.shape[1];
        const stride = width * 5 / 8;
        const activation = makeActivations(tokens, width);
        const args = [hexlify(activation), weightAccount, 1, stride, width, outputs];
        const control = expected(activation, weights, tokens, outputs, width, stride, 0);
        const meterData = abi.encodeFunctionData('measure', args);
        const directData = abi.encodeFunctionData('linearRaw', args);
        const directCall = { to: target, gas: toQuantity(maxGas), data: directData };
        const macs = tokens * width * outputs;
        let evidence = { tokens, outputs, width, macs };
        try {
            const measured = await rpc('eth_call', [{ to: target, gas: toQuantity(maxGas), data: meterData }, anchor, overrides]);
            const [result, executionGas] = abi.decodeFunctionResult('measure', measured);
            assert.equal(result, hexlify(control), 'Integer tile does not match the independent oracle');
            const estimate = BigInt(await rpc('eth_estimateGas', [directCall, anchor, overrides]));
            assert(estimate <= maxGas && executionGas < estimate);
            evidence = { ...evidence,
                activationSHA256: sha(activation), rawSumsSHA256: sha(control), matchesIntegerOracle: true,
                executionGas: Number(executionGas), estimatedGas: Number(estimate),
                executionGasPerMAC: Number(executionGas) / macs, estimatedGasPerMAC: Number(estimate) / macs,
                estimatedETHAtSampledPrice: formatEther(estimate * BigInt(gasPrice)),
            };
        } catch (error) {
            if (!/out of gas|gas required exceeds allowance/i.test(error.message)) throw error;
            evidence = { ...evidence, hitGasLimit: Number(maxGas) };
        }
        rows.push(evidence);
        console.log(JSON.stringify(evidence));
        save();
    }
    assert(rows.some(row => row.matchesIntegerOracle));
    if (useNarrow) {
        const overflow = makeActivations(1, 192);
        overflow.writeInt32LE(8_388_608, 0);
        const overflowCall = {
            to: target, gas: toQuantity(maxGas),
            data: abi.encodeFunctionData('linearRaw', [hexlify(overflow), weightAccount, 1, 120, 192, 1]),
        };
        await assert.rejects(rpc('eth_call', [overflowCall, anchor, overrides]), /revert/i);
        evidence.rejectedOutsideSigned24 = true;
    }
    evidence.fixedProjection = await measureFixedProjection(model, metadata, contracts.Mp1Q5Projection, anchor, overrides);
    const confirmed = await rpc('eth_getBlockByNumber', [anchor, false]);
    assert.equal(confirmed.hash, head.hash);
    save();
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
