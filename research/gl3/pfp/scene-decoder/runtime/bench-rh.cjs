'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { compileKernel } = require('../benchmark.cjs');

function dependency(name) {
    try {
        return require(name);
    } catch (error) {
        if (error.code !== 'MODULE_NOT_FOUND') throw error;
        return require(join(__dirname, '../../../../chess/node_modules', name));
    }
}

const solc = dependency('solc');
const { Interface, concat, formatEther, hexlify, id, keccak256, toQuantity } = dependency('ethers');
const chainId = '0x1237';
const genesisHash = '0xaad15f3d702aaea00caf3e9bb56395efe9127bc3b31b24921abf1eee3409305c';
const maxGas = 32_000_000n;
const rpcUrl = 'https://rpc.mainnet.chain.robinhood.com';
const gasInfo = '0x000000000000000000000000000000000000006c';
const expertBytes = 67_584;
const expertCount = 7;
const modelBytes = 500_000;
const sharedBytes = modelBytes - expertCount * expertBytes;
const uint64Max = (1n << 64n) - 1n;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const methods = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_gasPrice', 'eth_getCode', 'eth_call', 'eth_estimateGas']);

function compileDecoder() {
    const name = 'SceneDecoder.sol';
    const source = readFileSync(join(__dirname, name), 'utf8');
    const input = {
        language: 'Solidity',
        sources: { [name]: { content: source } },
        settings: {
            viaIR: true,
            evmVersion: 'shanghai',
            optimizer: { enabled: true, runs: 200 },
            outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
        },
    };
    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    const errors = (output.errors || []).filter(error => error.severity === 'error');
    assert.equal(errors.length, 0, errors.map(error => error.formattedMessage).join('\n'));
    const decoder = output.contracts[name].SceneDecoder;
    return {
        abi: new Interface(decoder.abi),
        creationCode: '0x' + decoder.evm.bytecode.object,
        sourceSHA256: sha(source),
    };
}

let nextId = 0;
async function rpc(method, params = []) {
    assert(methods.has(method), 'Read-only RPC methods only');
    const requestId = ++nextId;
    const body = JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params });
    for (let attempt = 0; attempt < 3; attempt++) {
        const response = await fetch(rpcUrl, {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(50_000),
            headers: { 'content-type': 'application/json' },
            body,
        });
        if ([429, 502, 503, 504].includes(response.status) && attempt < 2) {
            await response.body?.cancel();
            await delay(400 * (attempt + 1));
            continue;
        }
        assert(response.ok, method + ' HTTP ' + response.status);
        const reply = await response.json();
        assert.equal(reply.id, requestId);
        if (reply.error) {
            const message = reply.error.message || 'RPC error';
            if (/rate limit|too many requests|temporarily unavailable/i.test(message) && attempt < 2) {
                await delay(400 * (attempt + 1));
                continue;
            }
            throw new Error(method + ': ' + message + (reply.error.data ? ' (' + JSON.stringify(reply.error.data) + ')' : ''));
        }
        assert(Object.hasOwn(reply, 'result'));
        return reply.result;
    }
    throw new Error(method + ' exhausted retries');
}

function readModel(path) {
    const bytes = readFileSync(path);
    assert.equal(bytes.length, modelBytes, 'Unexpected trained model size');
    const digest = sha(bytes);
    const shards = [];
    for (let index = 0; index <= expertCount; index++) {
        const start = index * expertBytes;
        const payload = bytes.subarray(start, start + (index < expertCount ? expertBytes : sharedBytes));
        const code = hexlify(Buffer.concat([Buffer.from([0]), payload]));
        shards.push({ index, bytes: payload.length, payloadSHA256: sha(payload), codeHash: keccak256(code), code });
    }
    return { digest, shards };
}

function readVectors(path, digest) {
    const file = readFileSync(path);
    const parsed = JSON.parse(file);
    assert.equal(parsed.modelSha256.replace(/^0x/i, '').toLowerCase(), digest, 'Vectors refer to a different model');
    assert(Array.isArray(parsed.vectors) && parsed.vectors.length > 0, 'No image fixtures');
    for (const vector of parsed.vectors) {
        assert.match(vector.prompt, /^(0|[1-9][0-9]*)$/);
        assert.match(vector.seed, /^(0|[1-9][0-9]*)$/);
        assert(BigInt(vector.prompt) <= uint64Max && BigInt(vector.seed) <= uint64Max);
        assert.match(vector.pixelsHex, /^0x[0-9a-f]{1280}$/i);
        assert.match(vector.paletteHex, /^0x[0-9a-f]{256}$/i);
        assert(Number.isInteger(vector.style) && vector.style >= 0 && vector.style < expertCount);
        assert.equal(Number((BigInt(vector.prompt) >> 8n) & 255n), vector.style, 'Style does not match encoded prompt');
    }
    return { digest: sha(file), vectors: parsed.vectors };
}

function stateFor(entries) {
    return Object.fromEntries(entries.map(({ address, code }) => [address, { code }]));
}

function summarize(samples) {
    const sorted = samples.map(sample => sample.estimatedGas).sort((a, b) => a - b);
    const nearestRank = percentile => sorted[Math.ceil(sorted.length * percentile) - 1];
    return {
        samples: sorted.length,
        styles: [...new Set(samples.map(sample => sample.style))].sort((a, b) => a - b),
        minGas: sorted[0],
        p50Gas: nearestRank(0.5),
        p95Gas: nearestRank(0.95),
        maxGas: sorted.at(-1),
    };
}

async function main() {
    const [modelPath, vectorsPath, evidencePath] = process.argv.slice(2);
    assert(evidencePath, 'Usage: node bench-rh.cjs MODEL.bin VECTORS.json EVIDENCE.json');
    const model = readModel(modelPath);
    const fixture = readVectors(vectorsPath, model.digest);
    const modelId = '0x' + model.digest;
    const addressFor = label => '0x' + id('gh0st.scene-decoder.full.bench.' + model.digest + ':' + label).slice(-40);
    const target = addressFor('decoder');
    const decoder = compileDecoder();
    const kernels = [96, 32].map(width => {
        const built = compileKernel(width);
        return {
            width, address: addressFor('width-' + width), code: built.code,
            sourceSHA256: built.sourceSHA256, codeHash: keccak256(built.code),
        };
    });
    const shards = model.shards.map(shard => ({ ...shard, address: addressFor('shard-' + shard.index) }));
    const [network, genesis, head, priceResult] = await Promise.all([
        rpc('eth_chainId'), rpc('eth_getBlockByNumber', ['0x0', false]),
        rpc('eth_getBlockByNumber', ['latest', false]), rpc('eth_gasPrice'),
    ]);
    assert.equal(network, chainId);
    assert.equal(genesis.hash, genesisHash);
    const anchor = head.number;
    const gasPriceWei = BigInt(priceResult);
    assert(gasPriceWei > 0n);
    const accounts = [...shards, ...kernels];
    const networkGasLimit = await rpc('eth_call', [
        { to: gasInfo, data: id('getMaxTxGasLimit()').slice(0, 10) }, anchor,
    ]);
    assert.equal(BigInt(networkGasLimit), maxGas);
    for (const address of [...accounts.map(account => account.address), target]) {
        assert.equal(await rpc('eth_getCode', [address, anchor]), '0x', 'Benchmark address is already deployed');
    }
    const constructor = decoder.abi.encodeDeploy([
        shards.map(shard => shard.address), shards.map(shard => shard.codeHash),
        kernels[0].address, kernels[1].address, kernels.map(kernel => kernel.codeHash), modelId,
    ]);
    // Complete constructor code runs against all eight temporary weight shards and both kernels.
    // The returned bytes are the actual runtime with the checked addresses and model ID pinned.
    const runtime = await rpc('eth_call', [
        { data: concat([decoder.creationCode, constructor]), gas: toQuantity(maxGas) }, anchor, stateFor(accounts),
    ]);
    assert.match(runtime, /^0x[0-9a-f]+$/i);
    const runtimeAccount = { address: target, code: runtime };
    const samples = [];
    const operation = 'generateAndRecord';
    assert(decoder.abi.getFunction(operation));
    for (const vector of fixture.vectors) {
        // Only the selected expert and the shared data can be read by one call.
        const state = stateFor([runtimeAccount, ...kernels, shards[vector.style], shards[expertCount]]);
        const encode = decoder.abi.encodeFunctionData(operation, [vector.prompt, vector.seed]);
        const call = { to: target, gas: toQuantity(maxGas), data: encode };
        const [result, gas] = await Promise.all([
            rpc('eth_call', [call, anchor, state]),
            rpc('eth_estimateGas', [call, anchor, state]),
        ]);
        const [pixels, palette] = decoder.abi.decodeFunctionResult(operation, result);
        assert.equal(pixels, vector.pixelsHex.toLowerCase(), 'Pixel mismatch for ' + vector.caption);
        assert.equal(palette, vector.paletteHex.toLowerCase(), 'Palette mismatch for ' + vector.caption);
        const estimate = BigInt(gas);
        assert(0n < estimate && estimate <= maxGas, 'Complete image exceeds maximum transaction gas');
        const sample = {
            caption: vector.caption, split: vector.split, prompt: vector.prompt, seed: vector.seed, style: vector.style,
            matchesReference: true, imageHash: keccak256(concat([pixels, palette])),
            pixelsSHA256: sha(Buffer.from(pixels.slice(2), 'hex')),
            paletteSHA256: sha(Buffer.from(palette.slice(2), 'hex')),
            estimatedGas: Number(estimate), estimatedETHAtSampledPrice: formatEther(estimate * gasPriceWei),
            gasBelowTransactionCap: Number(maxGas - estimate),
        };
        samples.push(sample);
        console.log(JSON.stringify(sample));
    }
    assert.equal((await rpc('eth_getBlockByNumber', [anchor, false])).hash, head.hash, 'Pinned Robinhood block changed');
    const evidence = {
        kind: 'read-only-robinhood-complete-inference',
        scope: 'Each estimate covers a single complete generateAndRecord call, including its image-hash event. State overrides supply undeployed model shards and runtime. No transaction was broadcast. Deployment, future gas-price changes and any frontend fee policy are excluded.',
        chainId: Number(BigInt(network)), block: Number(BigInt(anchor)), blockHash: head.hash,
        blockTimestamp: new Date(Number(BigInt(head.timestamp)) * 1000).toISOString(),
        gasPriceWei: gasPriceWei.toString(), blockBaseFeeWei: BigInt(head.baseFeePerGas).toString(),
        maxTransactionGas: Number(maxGas), compiler: solc.version(), modelBytes, modelId, operation,
        vectorsSHA256: fixture.digest, runtime: {
            address: target, codeHash: keccak256(runtime), bytes: (runtime.length - 2) / 2, sourceSHA256: decoder.sourceSHA256,
        },
        kernels: kernels.map(({ code, ...kernel }) => kernel),
        shards: shards.map(({ code, ...shard }) => shard),
        summary: summarize(samples),
        samples,
    };
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify(evidence.summary));
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
