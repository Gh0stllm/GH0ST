'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

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
const rpcURL = 'https://rpc.mainnet.chain.robinhood.com';
const chainId = '0x1237';
const genesisHash = '0xaad15f3d702aaea00caf3e9bb56395efe9127bc3b31b24921abf1eee3409305c';
const maxGas = 32_000_000n;
const maxCodeBytes = 98_304;
const gasInfo = '0x000000000000000000000000000000000000006c';
const format = 'GH0ST64B';
const styles = 7;
const styleBytes = 69_632;
const sharedBytes = 12_576;
const modelBytes = styles * styleBytes + sharedBytes;
const headerOffset = styles * styleBytes + 9952;
const imageBytes = 2560;
const paletteBytes = 128;
const uint64Max = (1n << 64n) - 1n;
const methods = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_gasPrice', 'eth_getCode', 'eth_call', 'eth_estimateGas']);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

let nextId = 0;
let rpcActive = 0;
const rpcWaiting = [];
async function rpc(method, params = []) {
    if (rpcActive < 4) rpcActive++;
    else await new Promise(resolve => rpcWaiting.push(resolve));
    try {
        return await request(method, params);
    } finally {
        const next = rpcWaiting.shift();
        if (next) next();
        else rpcActive--;
    }
}

async function request(method, params) {
    assert(methods.has(method), 'Read-only RPC methods only');
    const requestId = ++nextId;
    const body = JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params });
    for (let attempt = 0; attempt < 5; attempt++) {
        const response = await fetch(rpcURL, {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(50_000),
            headers: { 'content-type': 'application/json' },
            body,
        });
        if ([429, 502, 503, 504].includes(response.status) && attempt < 4) {
            const retryAfter = Number(response.headers.get('retry-after'));
            await response.body?.cancel();
            await delay(Math.max(Math.min(retryAfter || 0, 10) * 1000, 700 * (attempt + 1)) + (requestId % 7) * 90);
            continue;
        }
        assert(response.ok, method + ' HTTP ' + response.status);
        const reply = await response.json();
        assert.equal(reply.id, requestId);
        if (reply.error) {
            const message = reply.error.message || 'RPC error';
            if (/rate limit|too many requests|temporarily unavailable/i.test(message) && attempt < 4) {
                await delay(700 * (attempt + 1) + (requestId % 7) * 90);
                continue;
            }
            throw new Error(method + ': ' + message + (reply.error.data ? ' (' + JSON.stringify(reply.error.data) + ')' : ''));
        }
        assert(Object.hasOwn(reply, 'result'));
        return reply.result;
    }
    throw new Error(method + ' exhausted retries');
}

function compileDecoder() {
    const file = 'LayeredScene.sol';
    const source = readFileSync(join(__dirname, file), 'utf8');
    const input = {
        language: 'Solidity', sources: { [file]: { content: source } },
        settings: {
            viaIR: true, evmVersion: 'shanghai',
            optimizer: { enabled: true, runs: 200 },
            outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
        },
    };
    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    const errors = (output.errors || []).filter(error => error.severity === 'error');
    assert.equal(errors.length, 0, errors.map(error => error.formattedMessage).join('\n'));
    const contract = output.contracts[file].LayeredScene;
    return {
        abi: new Interface(contract.abi),
        creationCode: '0x' + contract.evm.bytecode.object,
        sourceSHA256: sha(source),
    };
}

function readModel(path) {
    const bytes = readFileSync(path);
    assert.equal(bytes.length, modelBytes, 'Unexpected model byte count');
    assert.equal(bytes.subarray(headerOffset, headerOffset + format.length).toString('ascii'), format, 'Invalid model header');
    const shards = [];
    for (let index = 0; index <= styles; index++) {
        const start = index * styleBytes;
        const payload = bytes.subarray(start, start + (index < styles ? styleBytes : sharedBytes));
        assert(payload.length + 1 <= maxCodeBytes);
        const code = hexlify(Buffer.concat([Buffer.from([0]), payload]));
        shards.push({ index, bytes: payload.length, payloadSHA256: sha(payload), codeHash: keccak256(code), code });
    }
    return { digest: sha(bytes), shards };
}

function readVectors(path, digest) {
    const file = readFileSync(path);
    const parsed = JSON.parse(file);
    assert.equal(parsed.modelSha256.replace(/^0x/i, '').toLowerCase(), digest, 'Vectors refer to a different model');
    assert(Array.isArray(parsed.vectors) && parsed.vectors.length > 0, 'No image fixtures');
    const fixedHex = bytes => new RegExp('^0x[0-9a-f]{' + bytes * 2 + '}$', 'i');
    const packedPattern = fixedHex(imageBytes);
    const palettePattern = fixedHex(paletteBytes);
    for (const vector of parsed.vectors) {
        assert.match(vector.prompt, /^(0|[1-9][0-9]*)$/);
        assert.match(vector.seed, /^(0|[1-9][0-9]*)$/);
        assert(BigInt(vector.prompt) <= uint64Max && BigInt(vector.seed) <= uint64Max);
        assert.match(vector.pixelsHex, packedPattern);
        assert.match(vector.paletteHex, palettePattern);
        assert(Number.isInteger(vector.style) && vector.style >= 0 && vector.style < styles);
        assert.equal(Number((BigInt(vector.prompt) >> 8n) & 255n), vector.style, 'Style does not match encoded prompt');
    }
    return { digest: sha(file), vectors: parsed.vectors };
}

function stateFor(entries) {
    return Object.fromEntries(entries.map(({ address, code }) => [address, { code }]));
}

function shardCreationCode(code) {
    // 17-byte init code: copy everything after the initializer and return it.
    const size = ((code.length - 2) / 2).toString(16).padStart(6, '0');
    return '0x62' + size + '61001160003962' + size + '6000f3' + code.slice(2);
}

function summarize(samples, gasPriceWei) {
    const sorted = samples.map(sample => sample.estimatedGas).sort((a, b) => a - b);
    const nearestRank = percentile => sorted[Math.ceil(sorted.length * percentile) - 1];
    const quote = gas => formatEther(BigInt(gas) * gasPriceWei);
    const byStyle = [];
    for (const style of [...new Set(samples.map(sample => sample.style))].sort((a, b) => a - b)) {
        const gas = samples.filter(sample => sample.style === style).map(sample => sample.estimatedGas);
        const minGas = Math.min(...gas);
        const maxGas = Math.max(...gas);
        byStyle.push({ style, samples: gas.length, minGas, maxGas, minETH: quote(minGas), maxETH: quote(maxGas) });
    }
    return {
        samples: sorted.length, styles: byStyle,
        minGas: sorted[0],
        p50Gas: nearestRank(0.5),
        p95Gas: nearestRank(0.95),
        maxGas: sorted.at(-1),
        minETH: quote(sorted[0]),
        maxETH: quote(sorted.at(-1)),
    };
}

async function main() {
    const [modelPath, vectorsPath, evidencePath] = process.argv.slice(2);
    assert(evidencePath, 'Usage: node bench-rh.cjs MODEL.bin VECTORS.json EVIDENCE.json');
    const model = readModel(modelPath);
    const fixture = readVectors(vectorsPath, model.digest);
    const modelId = '0x' + model.digest;
    const addressFor = label => '0x' + id('gh0st.layered-scene.robinhood.v3.' + model.digest + ':' + label).slice(-40);
    const target = addressFor('decoder');
    const decoder = compileDecoder();
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
    const networkGasLimit = await rpc('eth_call', [
        { to: gasInfo, data: id('getMaxTxGasLimit()').slice(0, 10) }, anchor,
    ]);
    assert.equal(BigInt(networkGasLimit), maxGas);
    for (const address of [...shards.map(shard => shard.address), target]) {
        assert.equal(await rpc('eth_getCode', [address, anchor]), '0x', 'Benchmark address is already deployed');
    }
    const constructor = decoder.abi.encodeDeploy([
        shards.map(shard => shard.address), shards.map(shard => shard.codeHash), modelId,
    ]);
    const decoderCreation = concat([decoder.creationCode, constructor]);
    // The actual constructor validates all eight data contracts and pins the
    // addresses in the returned runtime. All temporary code expires with the call.
    const runtime = await rpc('eth_call', [
        { data: decoderCreation, gas: toQuantity(maxGas) }, anchor, stateFor(shards),
    ]);
    assert.match(runtime, /^0x[0-9a-f]+$/i);
    const runtimeAccount = { address: target, code: runtime };
    const testedHeads = new Map([[anchor, head.hash]]);
    const operation = 'generateAndRecord';
    assert(decoder.abi.getFunction(operation));

    async function measureImage(vector, sampleHead) {
        const state = stateFor([runtimeAccount, shards[vector.style], shards[styles]]);
        const data = decoder.abi.encodeFunctionData(operation, [vector.prompt, vector.seed]);
        const call = { to: target, gas: toQuantity(maxGas), data };
        const [result, gas] = await Promise.all([
            rpc('eth_call', [call, sampleHead.number, state]),
            rpc('eth_estimateGas', [call, sampleHead.number, state]),
        ]);
        const [pixels, palette] = decoder.abi.decodeFunctionResult(operation, result);
        assert.equal(pixels, vector.pixelsHex.toLowerCase(), 'Pixel mismatch for ' + vector.caption);
        assert.equal(palette, vector.paletteHex.toLowerCase(), 'Palette mismatch for ' + vector.caption);
        const estimate = BigInt(gas);
        assert(0n < estimate && estimate <= maxGas, 'Complete image exceeds maximum transaction gas');
        return {
            caption: vector.caption, split: vector.split, prompt: vector.prompt, seed: vector.seed, style: vector.style,
            block: Number(BigInt(sampleHead.number)), blockHash: sampleHead.hash,
            matchesReference: true, imageHash: keccak256(concat([pixels, palette])),
            pixelsSHA256: sha(Buffer.from(pixels.slice(2), 'hex')),
            paletteSHA256: sha(Buffer.from(palette.slice(2), 'hex')),
            estimatedGas: Number(estimate), estimatedETHAtSampledPrice: formatEther(estimate * gasPriceWei),
            gasBelowTransactionCap: Number(maxGas - estimate),
        };
    }

    async function measureCreation(tx, sampleHead) {
        const params = [{ data: tx.creationCode, gas: toQuantity(maxGas) }, sampleHead.number];
        if (tx.overrides) params.push(tx.overrides);
        const estimate = BigInt(await rpc('eth_estimateGas', params));
        assert(0n < estimate && estimate <= maxGas, 'Deployment exceeds maximum transaction gas');
        return {
            name: tx.name, shardIndex: tx.shardIndex,
            block: Number(BigInt(sampleHead.number)), blockHash: sampleHead.hash,
            payloadBytes: tx.payloadBytes, runtimeBytes: (tx.code.length - 2) / 2,
            creationBytes: (tx.creationCode.length - 2) / 2,
            creationSHA256: sha(Buffer.from(tx.creationCode.slice(2), 'hex')),
            runtimeCodeHash: keccak256(tx.code),
            estimatedGas: Number(estimate), estimatedETHAtSampledPrice: formatEther(estimate * gasPriceWei),
            gasBelowTransactionCap: Number(maxGas - estimate),
        };
    }

    async function measureBatches(items, measure) {
        const samples = [];
        let sampleHead = head;
        for (let start = 0; start < items.length; start += 2) {
            const batch = items.slice(start, start + 2);
            for (let attempt = 0; ; attempt++) {
                const rows = await Promise.allSettled(batch.map(item => measure(item, sampleHead)));
                const failures = rows.filter(row => row.status === 'rejected');
                if (!failures.length) {
                    testedHeads.set(sampleHead.number, sampleHead.hash);
                    for (const { value } of rows) {
                        samples.push(value);
                        console.log(JSON.stringify(value));
                    }
                    break;
                }
                const permanent = failures.find(row => !/layer stale|missing trie node/i.test(row.reason.message));
                if (permanent || attempt >= 2) throw (permanent ?? failures[0]).reason;
                sampleHead = await rpc('eth_getBlockByNumber', ['latest', false]);
            }
        }
        return samples;
    }

    const deploymentTxs = shards.map(shard => ({
        name: shard.index === styles ? 'shared model data' : 'style model data',
        shardIndex: shard.index, payloadBytes: shard.bytes, code: shard.code, creationCode: shardCreationCode(shard.code),
    }));
    deploymentTxs.push({
        name: 'inference contract', code: runtime, creationCode: decoderCreation, overrides: stateFor(shards),
    });
    const [samples, deployments] = await Promise.all([
        measureBatches(fixture.vectors, measureImage), measureBatches(deploymentTxs, measureCreation),
    ]);
    for (const [number, hash] of testedHeads) {
        assert.equal((await rpc('eth_getBlockByNumber', [number, false])).hash, hash, 'Pinned Robinhood block changed');
    }
    const deploymentGas = deployments.reduce((sum, tx) => sum + tx.estimatedGas, 0);
    const evidence = {
        kind: 'read-only-robinhood-complete-inference', format, imageWidth: 64, imageHeight: 64, imageBytes,
        scope: 'Read-only estimates cover one complete generateAndRecord call including its hash event, and nine individual contract creations. State overrides supply undeployed code. No transaction was broadcast. ETH equivalents use the initial sampled gas price.',
        chainId: Number(BigInt(network)), block: Number(BigInt(anchor)), blockHash: head.hash,
        blockTimestamp: new Date(Number(BigInt(head.timestamp)) * 1000).toISOString(),
        gasPriceWei: gasPriceWei.toString(), blockBaseFeeWei: BigInt(head.baseFeePerGas).toString(),
        maxTransactionGas: Number(maxGas), compiler: solc.version(), modelBytes, modelId, operation,
        vectorsSHA256: fixture.digest, runtime: {
            address: target, codeHash: keccak256(runtime), bytes: (runtime.length - 2) / 2, sourceSHA256: decoder.sourceSHA256,
        },
        shards: shards.map(({ code, ...shard }) => shard),
        summary: summarize(samples, gasPriceWei),
        samples,
        deployment: {
            scope: 'Eight direct STOP-prefixed data-contract creates and one create for the exact inference bytecode with constructor arguments. Each estimate is for its own transaction. A frontend and any future fee policy are outside this benchmark.',
            transactions: deployments.length,
            totalGas: deploymentGas,
            totalETHAtSampledPrice: formatEther(BigInt(deploymentGas) * gasPriceWei),
            maxGasPerTransaction: Math.max(...deployments.map(tx => tx.estimatedGas)),
            estimates: deployments,
        },
    };
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({
        inference: evidence.summary,
        deployment: {
            transactions: evidence.deployment.transactions, totalGas: evidence.deployment.totalGas,
            totalETHAtSampledPrice: evidence.deployment.totalETHAtSampledPrice,
            maxGasPerTransaction: evidence.deployment.maxGasPerTransaction,
        },
    }));
}

module.exports = { compileDecoder, readModel, shardCreationCode };

if (require.main === module) {
    main().catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
