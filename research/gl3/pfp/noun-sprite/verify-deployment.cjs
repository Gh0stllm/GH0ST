'use strict';

const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { readFile, rename, unlink, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

let ethers;
try {
    ethers = require('ethers');
} catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    ethers = require('../../gh0st-chess/research/chess/node_modules/ethers');
}
const { AbiCoder, Interface, formatEther, getAddress, getCreateAddress, keccak256 } = ethers;
const chainId = 4663n;
const genesisHash = '0xaad15f3d702aaea00caf3e9bb56395efe9127bc3b31b24921abf1eee3409305c';
const publicRpc = 'https://rpc.mainnet.chain.robinhood.com';
const hosts = new Set(['rpc.mainnet.chain.robinhood.com', 'robinhood-mainnet.g.alchemy.com']);
const methods = new Set([
    'eth_chainId', 'eth_getBlockByNumber', 'eth_getTransactionByHash',
    'eth_getTransactionReceipt', 'eth_getCode', 'eth_call',
]);
const hashPattern = /^0x[0-9a-f]{64}$/i;
const bytesPattern = /^0x(?:[0-9a-f]{2})*$/i;
const quantityPattern = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const childGetters = [
    'firstWeights', 'maskWeights', 'parameters', 'plannerFirstWeights',
    'plannerOutputWeights', 'plannerParameters', 'lexicon', 'kernel',
];
const modelABI = new Interface([
    ...childGetters.map(name => `function ${name}() view returns (address)`),
    'function modelId() view returns (bytes32)',
    'function codeCommitment() view returns (bytes32)',
    'function generate(string prompt, uint64 seed) view returns (bytes rgba)',
]);
const imageBytes = 48 * 48 * 4;
const expectedVectors = 14;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function hash(value, label) {
    assert(typeof value === 'string' && hashPattern.test(value), `${label} must be a 32-byte hash`);
    return value.toLowerCase();
}

function quantity(value, label) {
    assert(typeof value === 'string' && quantityPattern.test(value), `Invalid RPC quantity for ${label}`);
    return BigInt(value);
}

function byteLength(value) {
    assert(typeof value === 'string' && bytesPattern.test(value), 'Invalid data hex');
    return (value.length - 2) / 2;
}

function safeInteger(value, label) {
    const num = Number(value);
    assert(Number.isSafeInteger(num) && num >= 0, `Invalid integer for ${label}`);
    return num;
}

function createReader() {
    let endpoint;
    try {
        endpoint = new URL(process.env.ROBINHOOD_MAINNET_RPC_URL || publicRpc);
    } catch {
        throw new Error('Invalid Robinhood RPC URL');
    }
    assert(endpoint.protocol === 'https:' && hosts.has(endpoint.hostname) &&
        !endpoint.username && !endpoint.password && !endpoint.port && !endpoint.hash,
        'Unexpected Robinhood RPC endpoint');
    let nextId = 0;
    return async function rpc(method, params = []) {
        assert(methods.has(method), 'Read-only RPC method required');
        const id = ++nextId;
        const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
        for (let attempt = 0; attempt < 4; attempt++) {
            const response = await fetch(endpoint, {
                method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45_000),
                headers: { 'content-type': 'application/json' }, body,
            });
            const retry = [429, 502, 503, 504].includes(response.status);
            if (retry && attempt < 3) {
                await response.body?.cancel();
                await delay(500 * (attempt + 1));
                continue;
            }
            assert(response.ok, `${method} received HTTP ${response.status}`);
            const reply = await response.json();
            assert.equal(reply.id, id, `${method} response id changed`);
            if (reply.error) {
                if (/rate limit|too many requests|temporarily unavailable/i.test(reply.error.message ?? '') && attempt < 3) {
                    await delay(500 * (attempt + 1));
                    continue;
                }
                throw new Error(`${method} rejected by Robinhood RPC (code ${reply.error.code ?? 'unknown'})`);
            }
            assert(Object.hasOwn(reply, 'result'), `${method} returned no result`);
            return reply.result;
        }
        throw new Error(`${method} exhausted retries`);
    };
}

function validatePlan(input, vectorFile) {
    assert.equal(input.chainId, Number(chainId), 'Frozen plan has the wrong chain');
    assert.equal(input.createValueWei, '0', 'Frozen plan changes ETH value');
    assert.equal(input.kernelReused, false, 'Expected the reviewed nine-child atomic creation');
    assert.equal(input.children?.length, 9, 'Expected nine frozen child accounts');
    const nonce = safeInteger(input.nonce, 'wallet nonce');
    const payer = getAddress(input.payer);
    const factory = getCreateAddress({ from: payer, nonce });
    assert.equal(getAddress(input.factory), factory, 'Frozen factory address differs from wallet nonce');
    const factoryRuntimeCodeHash = hash(input.factoryRuntimeCodeHash, 'factory runtime');
    assert.equal(factoryRuntimeCodeHash, keccak256('0x00'), 'Frozen factory must end with a single STOP byte');
    const payloadKeccak256 = hash(input.payloadKeccak256, 'initializer');
    const initCodeBytes = byteLength(input.data);
    assert(initCodeBytes > 0 && initCodeBytes <= 49_152, 'Initializer exceeds the contract creation limit');
    assert.equal(initCodeBytes, input.initCodeBytes, 'Initializer length differs from the frozen plan');
    assert.equal(keccak256(input.data), payloadKeccak256, 'Initializer hash differs from the frozen plan');
    const children = input.children.map((child, index) => {
        assert.equal(child.nonce, index + 1, 'Unexpected child CREATE nonce');
        const address = getCreateAddress({ from: factory, nonce: child.nonce });
        assert.equal(getAddress(child.address), address, 'Frozen child address differs from CREATE derivation');
        assert(Number.isSafeInteger(child.runtimeBytes) && child.runtimeBytes > 0 && child.runtimeBytes <= 24_576,
            'Invalid frozen child runtime size');
        return { label: child.label, nonce: child.nonce, address, runtimeBytes: child.runtimeBytes,
            runtimeCodeHash: hash(child.runtimeCodeHash, 'child runtime') };
    });
    const model = children[8].address;
    assert.equal(getAddress(input.modelAddress), model, 'Frozen model address is not the last CREATE');
    assert.equal(getAddress(input.kernelAddress), children[7].address, 'Frozen kernel is not CREATE nonce 8');
    const modelId = hash(input.modelId, 'model ID');
    assert.equal(hash(vectorFile.modelId, 'vector model ID'), modelId, 'Image vectors are for a different model');
    assert.equal('0x' + vectorFile.modelSha256, modelId, 'Vector model SHA-256 differs from the model ID');
    const codeCommitment = keccak256(AbiCoder.defaultAbiCoder().encode(
        ['bytes32[7]', 'bytes32'], [children.slice(0, 7).map(child => child.runtimeCodeHash), children[7].runtimeCodeHash],
    ));
    assert.equal(hash(input.codeCommitment, 'code commitment'), codeCommitment, 'Frozen code commitment differs from exact dependencies');
    assert.equal(vectorFile.vectors?.length, expectedVectors, 'Expected the fourteen frozen image vectors');
    const prompts = new Set();
    for (const vector of vectorFile.vectors) {
        assert(typeof vector.caption === 'string' && vector.caption.length > 0, 'Image vector lacks a prompt');
        assert(typeof vector.seed === 'string' && /^\d+$/.test(vector.seed) && BigInt(vector.seed) < 1n << 64n,
            'Image vector has an invalid seed');
        assert.equal(byteLength(vector.pixelsHex), imageBytes, 'Image vector has the wrong RGBA byte length');
        prompts.add(JSON.stringify([vector.caption, vector.seed]));
    }
    assert.equal(prompts.size, expectedVectors, 'Image vectors repeat a prompt and seed');
    return { nonce, payer, factory, model, modelId, codeCommitment, children, factoryRuntimeCodeHash, payloadKeccak256 };
}

async function mapWindow(items, width, fn) {
    const results = [];
    for (let offset = 0; offset < items.length; offset += width) {
        results.push(...await Promise.all(items.slice(offset, offset + width).map(fn)));
    }
    return results;
}

async function canonicalBlock(rpc, number, expectedHash, index, transactionHash) {
    const header = await rpc('eth_getBlockByNumber', [number, false]);
    assert(header && header.number === number, 'Receipt block is unavailable');
    assert.equal(hash(header.hash, 'canonical block'), expectedHash, 'Receipt block is no longer canonical');
    assert.equal(hash(header.transactions?.[index], 'block transaction'), transactionHash,
        'Receipt transaction is absent from the canonical block');
    return header;
}

async function verifyDeployment(rpc, transactionHash, input, vectorFile) {
    const transaction = hash(transactionHash, 'transaction');
    const plan = validatePlan(input, vectorFile);
    const [network, genesis, receipt] = await Promise.all([
        rpc('eth_chainId'), rpc('eth_getBlockByNumber', ['0x0', false]),
        rpc('eth_getTransactionReceipt', [transaction]),
    ]);
    assert.equal(quantity(network, 'chain identity'), chainId, 'Wrong Robinhood chain ID');
    assert.equal(hash(genesis?.hash, 'genesis'), genesisHash, 'Wrong Robinhood genesis hash');
    if (receipt === null) return null;
    assert.equal(quantity(receipt.status, 'receipt status'), 1n, 'Atomic deployment reverted');
    assert.equal(hash(receipt.transactionHash, 'receipt transaction'), transaction, 'Wrong receipt');
    assert.equal(receipt.to, null, 'Receipt is not a contract creation');
    assert.equal(getAddress(receipt.from), plan.payer, 'Receipt originates from an unexpected wallet');
    assert.equal(getAddress(receipt.contractAddress), plan.factory, 'Receipt factory differs from the frozen plan');
    const blockNumber = quantity(receipt.blockNumber, 'receipt block number');
    const index = safeInteger(quantity(receipt.transactionIndex, 'receipt transaction index'), 'receipt transaction index');
    const blockHash = hash(receipt.blockHash, 'receipt block');
    const [header, liveTx] = await Promise.all([
        canonicalBlock(rpc, receipt.blockNumber, blockHash, index, transaction),
        rpc('eth_getTransactionByHash', [transaction]),
    ]);
    assert(liveTx, 'Included deployment transaction is unavailable');
    assert.equal(hash(liveTx.hash, 'included transaction'), transaction, 'Wrong included transaction');
    assert.equal(hash(liveTx.blockHash, 'transaction block'), blockHash, 'Transaction and receipt disagree on the inclusion block');
    assert.equal(quantity(liveTx.blockNumber, 'transaction block number'), blockNumber, 'Transaction and receipt disagree on block number');
    assert.equal(quantity(liveTx.transactionIndex, 'transaction index'), BigInt(index), 'Transaction and receipt disagree on index');
    assert.equal(quantity(liveTx.chainId, 'signed chain ID'), chainId, 'Included transaction was signed for another chain');
    assert.equal(liveTx.to, null, 'Included transaction did not create a contract');
    assert.equal(getAddress(liveTx.from), plan.payer, 'Included transaction has an unexpected signer');
    assert.equal(quantity(liveTx.nonce, 'signed nonce'), BigInt(plan.nonce), 'Included transaction has an unexpected nonce');
    assert.equal(quantity(liveTx.value, 'signed value'), 0n, 'Included transaction moved ETH value');
    assert.equal(keccak256(liveTx.input), plan.payloadKeccak256, 'Included initializer differs from the reviewed transaction');
    const gasUsed = quantity(receipt.gasUsed, 'gas used');
    const effectiveGasPrice = quantity(receipt.effectiveGasPrice, 'effective gas price');
    assert(gasUsed > 0n && gasUsed <= quantity(liveTx.gas, 'transaction gas limit'), 'Invalid deployment gas receipt');
    if (liveTx.maxFeePerGas != null) {
        assert(effectiveGasPrice <= quantity(liveTx.maxFeePerGas, 'signed max fee'), 'Effective gas price exceeds the signed maximum');
    }
    const codeTargets = [{ label: 'atomic factory', address: plan.factory, runtimeBytes: 1,
        runtimeCodeHash: plan.factoryRuntimeCodeHash }, ...plan.children];
    await mapWindow(codeTargets, 4, async target => {
        const code = await rpc('eth_getCode', [target.address, receipt.blockNumber]);
        assert.equal(byteLength(code), target.runtimeBytes, `Unexpected runtime length for ${target.label}`);
        assert.equal(keccak256(code), target.runtimeCodeHash, `Unexpected runtime hash for ${target.label}`);
    });
    const expectedGetters = [...childGetters.map((name, i) => [name, plan.children[i].address]),
        ['modelId', plan.modelId], ['codeCommitment', plan.codeCommitment]];
    const call = async (name, args = []) => {
        const data = modelABI.encodeFunctionData(name, args);
        const returned = await rpc('eth_call', [{ to: plan.model, data }, receipt.blockNumber]);
        return modelABI.decodeFunctionResult(name, returned)[0];
    };
    const getters = Object.fromEntries(await mapWindow(expectedGetters, 4, async ([name, expected]) => {
        const actual = await call(name);
        assert.equal(actual, expected, `Model ${name} differs from the frozen plan`);
        return [name, actual];
    }));
    const vectors = await mapWindow(vectorFile.vectors, 3, async vector => {
        const output = await call('generate', [vector.caption, BigInt(vector.seed)]);
        assert(output.toLowerCase() === vector.pixelsHex.toLowerCase(), `On-chain pixels differ for prompt ${vector.caption}`);
        return { prompt: vector.caption, seed: vector.seed, pixels: imageBytes / 4,
            pixelBytes: byteLength(output), pixelKeccak256: keccak256(output) };
    });
    const finality = async label => {
        try {
            const head = await rpc('eth_getBlockByNumber', [label, false]);
            if (head?.number == null) return null;
            return safeInteger(quantity(head.number, `${label} head`), `${label} head`);
        } catch {
            return null;
        }
    };
    const [safeBlock, finalizedBlock] = await Promise.all([
        finality('safe'), finality('finalized'),
        canonicalBlock(rpc, receipt.blockNumber, blockHash, index, transaction),
    ]);
    const block = safeInteger(blockNumber, 'receipt block number');
    const feeWei = gasUsed * effectiveGasPrice;
    return {
        schema: 'gh0st.noun-sprite-deployment-evidence.v1', status: 'verified-deployment', observedAt: new Date().toISOString(),
        scope: 'Canonical Robinhood mainnet receipt, live code and real contract calls at receipt block; no state overrides.',
        chainId: Number(chainId), genesisHash, transactionHash: transaction, deployer: plan.payer,
        nonce: plan.nonce, factory: plan.factory, contract: plan.model, modelAddress: plan.model,
        modelId: plan.modelId, codeCommitment: plan.codeCommitment, runtimeCodeHash: plan.children[8].runtimeCodeHash,
        payloadKeccak256: plan.payloadKeccak256,
        blockNumber: block, blockHash, transactionIndex: index,
        blockTimestamp: new Date(safeInteger(quantity(header.timestamp, 'block timestamp'), 'block timestamp') * 1000).toISOString(),
        gasUsed: safeInteger(gasUsed, 'gas used'), effectiveGasPriceWei: effectiveGasPrice.toString(),
        feeWei: feeWei.toString(), feeETH: formatEther(feeWei), safeBlock, finalizedBlock,
        safe: safeBlock !== null && safeBlock >= block, finalized: finalizedBlock !== null && finalizedBlock >= block,
        verifiedRuntimeCount: codeTargets.length, verifiedVectorCount: vectors.length, code: codeTargets, getters, vectors,
    };
}

async function writeEvidence(path, evidence) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    try {
        await rename(temporary, path);
    } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
    }
}

async function main() {
    const [transactionHash, planPath = join(__dirname, 'deployment-unsigned.json'),
        outPath = join(__dirname, 'deployment-verified.json'), ...extra] = process.argv.slice(2);
    assert(transactionHash && extra.length === 0,
        'Usage: node verify-deployment.cjs TX_HASH [deployment-unsigned.json [deployment-verified.json]]');
    const [planBytes, vectorBytes] = await Promise.all([readFile(planPath), readFile(join(__dirname, 'vectors.json'))]);
    const evidence = await verifyDeployment(createReader(), transactionHash, JSON.parse(planBytes), JSON.parse(vectorBytes));
    if (evidence === null) {
        console.log(JSON.stringify({ status: 'awaiting-receipt', transactionHash: transactionHash.toLowerCase() }));
        process.exitCode = 2;
        return;
    }
    await writeEvidence(outPath, { ...evidence, planSHA256: sha256(planBytes), vectorSourceSHA256: sha256(vectorBytes) });
    const { status, chainId: network, contract, factory, blockNumber, feeETH, gasUsed, verifiedVectorCount, safe, finalized } = evidence;
    console.log(JSON.stringify({ status, chainId: network, transactionHash: evidence.transactionHash,
        contract, factory, blockNumber, gasUsed, feeETH, verifiedVectorCount, safe, finalized }));
}

if (require.main === module) {
    main().catch(error => {
        console.error(JSON.stringify({ status: 'verification-held', reason: error.message }));
        process.exitCode = 1;
    });
}

module.exports = { validatePlan, verifyDeployment };
