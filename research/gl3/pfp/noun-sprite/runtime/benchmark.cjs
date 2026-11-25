'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

function dependency(name) {
    try {
        return require(name);
    } catch (error) {
        if (error.code !== 'MODULE_NOT_FOUND') throw error;
        return require(join(__dirname, '../../../gh0st-chess/research/chess/node_modules', name));
    }
}

const solc = dependency('solc');
const { Interface, concat, formatEther, hexlify, id, keccak256, toQuantity } = dependency('ethers');
const rpcURL = 'https://rpc.mainnet.chain.robinhood.com';
const chainId = 4663n;
const genesisHash = '0xaad15f3d702aaea00caf3e9bb56395efe9127bc3b31b24921abf1eee3409305c';
const maxGas = 32_000_000n;
const gasInfo = '0x000000000000000000000000000000000000006c';
const maxCodeBytes = 24_576;
const shardCount = 7;
const fixedShardSizes = [1024, 8192, 1728, 2048, 19_200, 2184];
const lexiconRowSize = 25;
const spriteSize = 48;
const imageBytes = spriteSize * spriteSize * 4;
const supportedMethods = new Set([
    'eth_chainId', 'eth_getBlockByNumber', 'eth_gasPrice', 'eth_getCode', 'eth_getTransactionCount',
    'eth_getBalance', 'eth_call', 'eth_estimateGas',
]);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const byteLength = hex => (hex.length - 2) / 2;
const operation = 'generateAndRecord';
let requestId = 0;

async function rpc(method, params = []) {
    assert(supportedMethods.has(method), 'Only read-only methods are allowed');
    const id = ++requestId;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    for (let attempt = 0; attempt < 4; attempt++) {
        const response = await fetch(rpcURL, {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60_000),
            headers: { 'content-type': 'application/json' }, body,
        });
        if ([429, 502, 503, 504].includes(response.status) && attempt < 3) {
            await response.body?.cancel();
            await delay(500 * (attempt + 1));
            continue;
        }
        assert(response.ok, `${method} HTTP ${response.status}`);
        const reply = await response.json();
        assert.equal(reply.id, id);
        if (reply.error) {
            const message = reply.error.message || 'RPC error';
            if (/rate limit|too many requests|temporarily unavailable/i.test(message) && attempt < 3) {
                await delay(500 * (attempt + 1));
                continue;
            }
            const error = new Error(`${method}: ${message}`);
            error.revertData = reply.error.data;
            throw error;
        }
        assert(Object.hasOwn(reply, 'result'));
        return reply.result;
    }
    throw new Error(`${method} exhausted retries`);
}

function compile() {
    const bundledKernel = join(__dirname, 'PackedLinearFast.sol');
    const files = {
        'NounSprite.sol': join(__dirname, 'NounSprite.sol'),
        'ShapeSpriteRenderer.sol': join(__dirname, 'ShapeSpriteRenderer.sol'),
        'PackedLinearFast.sol': existsSync(bundledKernel)
            ? bundledKernel
            : join(__dirname, '../../gh0st-open-text-rh-20261124/optimization-dense/PackedLinearFast.sol'),
    };
    const sources = Object.fromEntries(Object.entries(files).map(([name, path]) => [name, { content: readFileSync(path, 'utf8') }]));
    const output = JSON.parse(solc.compile(JSON.stringify({
        language: 'Solidity', sources,
        settings: {
            viaIR: true, evmVersion: 'shanghai', optimizer: { enabled: true, runs: 200 },
            outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
        },
    })));
    const errors = (output.errors || []).filter(error => error.severity === 'error');
    assert.equal(errors.length, 0, errors.map(error => error.formattedMessage).join('\n'));
    const contracts = Object.values(output.contracts).flatMap(file => Object.entries(file));
    const build = name => {
        const artifact = contracts.find(([contract]) => contract === name)?.[1];
        assert(artifact?.evm.bytecode.object, `Missing creation bytecode for ${name}`);
        return { abi: new Interface(artifact.abi), creationCode: '0x' + artifact.evm.bytecode.object };
    };
    return {
        decoder: build('NounSprite'),
        kernel: build('PackedLinearFast'),
        sourceSHA256: Object.fromEntries(Object.entries(sources).map(([file, source]) => [file, sha256(source.content)])),
    };
}

function readModel(path) {
    const file = readFileSync(path);
    const manifest = JSON.parse(file);
    assert.match(manifest.modelSha256, /^[0-9a-f]{64}$/);
    assert.equal(manifest.modelId, '0x' + manifest.modelSha256);
    assert.equal(manifest.shards.length, shardCount);
    const data = createHash('sha256');
    const addressFor = label => '0x' + id('gh0st.noun-sprites.rh.' + manifest.modelId + ':' + label).slice(-40);
    const shards = manifest.shards.map((shard, index) => {
        const payload = readFileSync(join(dirname(path), shard.path));
        assert(shard.payloadBytes > 0, `Empty shard ${index}`);
        if (index < fixedShardSizes.length) {
            assert.equal(shard.payloadBytes, fixedShardSizes[index], `Unexpected architecture for shard ${index}`);
        } else {
            assert.equal(shard.payloadBytes % lexiconRowSize, 0, 'Partial lexicon row');
        }
        assert.equal(payload.length, shard.payloadBytes, `Shard ${index} byte count`);
        assert.equal(sha256(payload), shard.sha256, `Shard ${index} SHA-256`);
        data.update(payload);
        const code = hexlify(Buffer.concat([Buffer.from([0]), payload]));
        assert(byteLength(code) <= maxCodeBytes, `Shard ${index} does not fit in a data contract`);
        return { index, address: addressFor('shard-' + index), code, codeHash: keccak256(code), payloadBytes: payload.length, payloadSHA256: shard.sha256 };
    });
    assert.equal(data.digest('hex'), manifest.modelSha256, 'Model manifest digest does not match the ordered shards');
    return {
        addressFor, shards, modelId: manifest.modelId, manifestSHA256: sha256(file),
        modelBytes: shards.reduce((sum, shard) => sum + shard.payloadBytes, 0),
    };
}

function readVectors(path, modelId, selection) {
    const file = readFileSync(path);
    const parsed = JSON.parse(file);
    assert.equal(parsed.modelId, modelId, 'Vectors refer to a different model');
    assert.equal(parsed.modelSha256, modelId.slice(2));
    assert(Array.isArray(parsed.vectors) && parsed.vectors.length > 0, 'No image reference fixtures');
    const pixelPattern = new RegExp(`^0x[0-9a-f]{${imageBytes * 2}}$`, 'i');
    const indexes = selection === undefined
        ? parsed.vectors.map((_, index) => index)
        : selection.split(',').map(index => {
            assert.match(index, /^(0|[1-9][0-9]*)$/, 'Pass zero-based vector indices separated by commas');
            assert(Number(index) < parsed.vectors.length, 'Vector index is out of bounds');
            return Number(index);
        });
    assert.equal(new Set(indexes).size, indexes.length, 'Vector indices must be unique');
    const vectors = indexes.map(index => ({ ...parsed.vectors[index], index }));
    for (const vector of vectors) {
        assert(typeof vector.caption === 'string' && vector.caption.length > 0 && Buffer.byteLength(vector.caption) <= 160, 'Invalid caption');
        assert.match(vector.seed, /^(0|[1-9][0-9]*)$/);
        assert(BigInt(vector.seed) < 2n ** 64n, 'Seed must fit in uint64');
        assert.match(vector.pixelsHex, pixelPattern);
    }
    return { vectors, totalVectors: parsed.vectors.length, digest: sha256(file) };
}

function stateFor(entries) {
    return Object.fromEntries(entries.map(({ address, code }) => [address, { code }]));
}

function runtime(code, address) {
    assert.match(code, /^0x(?:[0-9a-f]{2})+$/i);
    assert(byteLength(code) <= maxCodeBytes, 'Runtime bytecode exceeds the portable EVM contract size limit');
    return { address, code, codeHash: keccak256(code), runtimeBytes: byteLength(code) };
}

function summary(samples, gasPriceWei) {
    const ordered = samples.map(sample => sample.estimatedGas).sort((left, right) => left - right);
    const percentile = fraction => ordered[Math.ceil(ordered.length * fraction) - 1];
    const minGas = ordered[0];
    const largest = ordered.at(-1);
    return {
        samples: ordered.length, minGas, medianGas: percentile(0.5), p95Gas: percentile(0.95), maxGas: largest,
        minETH: formatEther(BigInt(minGas) * gasPriceWei), maxETH: formatEther(BigInt(largest) * gasPriceWei),
        gasRemainingAtMax: Number(maxGas - BigInt(largest)),
    };
}

async function main() {
    const experiment = dirname(__dirname);
    const [manifestPath = join(experiment, 'manifest.json'), vectorsPath = join(experiment, 'vectors.json'), evidencePath = join(experiment, 'robinhood.json'), selection] = process.argv.slice(2);
    const model = readModel(manifestPath);
    const reference = readVectors(vectorsPath, model.modelId, selection);
    const { decoder, kernel, sourceSHA256 } = compile();
    const target = model.addressFor('decoder');
    const kernelAddress = model.addressFor('kernel');
    const emptyAddresses = [...model.shards.map(shard => shard.address), target, kernelAddress];
    assert.equal(new Set(emptyAddresses).size, emptyAddresses.length);

    const network = await rpc('eth_chainId');
    assert.equal(BigInt(network), chainId, 'Wrong Robinhood chain ID');
    const [genesis, head, quotedPrice] = await Promise.all([
        rpc('eth_getBlockByNumber', ['0x0', false]), rpc('eth_getBlockByNumber', ['latest', false]), rpc('eth_gasPrice'),
    ]);
    assert.equal(genesis.hash, genesisHash, 'Wrong Robinhood genesis hash');
    assert(head?.hash, 'Robinhood returned no current block');
    const gasPriceWei = BigInt(quotedPrice);
    assert(gasPriceWei > 0n);
    const gas = toQuantity(maxGas);
    const blockCap = await rpc('eth_call', [{ to: gasInfo, data: id('getMaxTxGasLimit()').slice(0, 10) }, head.number]);
    assert.equal(BigInt(blockCap), maxGas, 'Robinhood transaction gas cap changed');
    for (let index = 0; index < emptyAddresses.length; index += 4) {
        const batch = emptyAddresses.slice(index, index + 4);
        await Promise.all(batch.map(async address => {
            assert.equal(await rpc('eth_getCode', [address, head.number]), '0x', 'A temporary contract address has live code');
        }));
    }

    const kernelAccount = runtime(await rpc('eth_call', [{ data: kernel.creationCode, gas }, head.number]), kernelAddress);
    const modelAccounts = [...model.shards, kernelAccount];
    const constructor = decoder.abi.encodeDeploy([
        model.shards.map(shard => shard.address), model.shards.map(shard => shard.codeHash),
        kernelAccount.address, kernelAccount.codeHash, model.modelId,
    ]);
    // Return actual constructor-generated bytecode including immutable addresses, hashes, and model ID.
    const decoderAccount = runtime(await rpc('eth_call', [
        { data: concat([decoder.creationCode, constructor]), gas }, head.number, stateFor(modelAccounts),
    ]), target);
    const state = stateFor([...modelAccounts, decoderAccount]);
    const testedHeads = new Map([[head.number, head.hash]]);
    const samples = [];
    let sampleHead = head;

    const unknownNounPrompt = 'zwchqvptkgmxrb';
    const unknownNounSelector = decoder.abi.getError('NoKnownNoun').selector;
    const unknownNounData = decoder.abi.encodeFunctionData(operation, [unknownNounPrompt, 7]);
    await assert.rejects(
        rpc('eth_call', [{ to: target, gas, data: unknownNounData }, head.number, state]),
        error => error.revertData === unknownNounSelector,
        'The unknown noun must revert with NoKnownNoun()',
    );

    async function measureImage(vector) {
        const data = decoder.abi.encodeFunctionData(operation, [vector.caption, vector.seed]);
        for (let attempt = 0; attempt < 3; attempt++) {
            const params = [{ to: target, gas, data }, sampleHead.number, state];
            const [call, estimate] = await Promise.allSettled([rpc('eth_call', params), rpc('eth_estimateGas', params)]);
            const failures = [call, estimate].filter(result => result.status === 'rejected');
            if (failures.length) {
                const permanent = failures.find(result => !/layer stale|missing trie node/i.test(result.reason.message));
                if (permanent || attempt === 2) throw (permanent ?? failures[0]).reason;
                sampleHead = await rpc('eth_getBlockByNumber', ['latest', false]);
                continue;
            }
            const [pixels] = decoder.abi.decodeFunctionResult(operation, call.value);
            assert.equal(pixels, vector.pixelsHex.toLowerCase(), `Generated RGBA differs for ${vector.caption}`);
            const used = BigInt(estimate.value);
            assert(used > 0n && used <= maxGas, 'Complete image estimate exceeds the transaction cap');
            testedHeads.set(sampleHead.number, sampleHead.hash);
            return {
                index: vector.index, caption: vector.caption, seed: vector.seed, split: vector.split, subject: vector.subject,
                block: Number(BigInt(sampleHead.number)), blockHash: sampleHead.hash,
                exactRGBAReferenceMatch: true, imageKeccak256: keccak256(pixels), imageSHA256: sha256(Buffer.from(pixels.slice(2), 'hex')),
                estimatedGas: Number(used), estimatedFeeWei: (used * gasPriceWei).toString(),
                estimatedETHAtSampledPrice: formatEther(used * gasPriceWei),
                gasBelowTransactionCap: Number(maxGas - used),
            };
        }
        throw new Error('No Robinhood block supported both full call and gas estimate');
    }

    for (const vector of reference.vectors) {
        const sample = await measureImage(vector);
        samples.push(sample);
        console.log(JSON.stringify(sample));
    }
    for (const [number, hash] of testedHeads) {
        assert.equal((await rpc('eth_getBlockByNumber', [number, false])).hash, hash, 'Read-only benchmark block changed');
    }

    const withoutCode = ({ code, ...account }) => account;
    const evidence = {
        kind: 'read-only-robinhood-noun-to-sprite',
        scope: 'Robinhood mainnet eth_call and eth_estimateGas run the complete EVM path from raw text through parsing, learned layout prediction, shape inference, composition, RGBA output and the output hash event. Temporary code overrides stand in for undeployed contracts. No transaction was broadcast.',
        costBasis: 'Per-image ETH estimates multiply the full recording-call gas estimate by the starting Robinhood eth_gasPrice quote. Inclusion-time prices and posting costs can vary. Deployment costs are outside these estimates.',
        chainId: Number(chainId), genesisHash, block: Number(BigInt(head.number)), blockHash: head.hash,
        blockTimestamp: new Date(Number(BigInt(head.timestamp)) * 1000).toISOString(),
        gasPriceWei: gasPriceWei.toString(), blockBaseFeeWei: BigInt(head.baseFeePerGas).toString(),
        maxTransactionGas: Number(maxGas), compiler: solc.version(), sourceSHA256,
        imageWidth: spriteSize, imageHeight: spriteSize, imageBytes, operation,
        modelId: model.modelId, modelBytes: model.modelBytes, manifestSHA256: model.manifestSHA256,
        vectorsSHA256: reference.digest, referenceVectors: reference.totalVectors,
        unknownNoun: { caption: unknownNounPrompt, error: 'NoKnownNoun()', selector: unknownNounSelector, block: Number(BigInt(head.number)) },
        contracts: { decoder: withoutCode(decoderAccount), kernel: withoutCode(kernelAccount), shards: model.shards.map(withoutCode) },
        summary: summary(samples, gasPriceWei), samples,
    };
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({ evidencePath, block: evidence.block, gasPriceWei: evidence.gasPriceWei, ...evidence.summary }));
}

module.exports = { compile, readModel, rpc, stateFor, chainId, genesisHash, maxGas, gasInfo, solc, byteLength, sha256 };

if (require.main === module) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
