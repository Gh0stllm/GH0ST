'use strict';

// Read-only verifier for the nine direct CREATE transactions of GH0ST64B.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

function dependency(name) {
    try { return require(name); }
    catch (err) {
        if (err.code !== 'MODULE_NOT_FOUND') throw err;
        return require(join(__dirname, '../../../../../chess/node_modules', name));
    }
}

const solc = dependency('solc');
const { Interface, concat, formatEther, getAddress, getCreateAddress, getBytes, keccak256, toQuantity, zeroPadValue } = dependency('ethers');
const root = join(__dirname, '..');
const deployer = getAddress('0x8d6b11cfdf079e27c17e05cb7ea81235887691c6');
const modelId = '0x38ff2be5a522e043afe0964079aefea60d00d44f3c13a9fe30fe00d8f405b144';
const genesisHash = '0xaad15f3d702aaea00caf3e9bb56395efe9127bc3b31b24921abf1eee3409305c';
const runtimeSourceHash = '51fd5cc9bf7b00f4168ef2e2a25654e91051c2493dbc9bb06e11bf8f8a04d851';
const vectorHash = '40d1ca45796599a0090d8b7a98a4440cc53b6f1f7bcf4b708720c775bce10588';
const txCount = 9;
const styleBytes = 69_632;
const maxTxGas = 32_000_000n;
const hex32 = /^0x[0-9a-f]{64}$/i;
const methods = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getTransactionByHash',
    'eth_getTransactionReceipt', 'eth_getCode', 'eth_call']);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));

function compile() {
    const file = 'LayeredScene.sol';
    const source = readFileSync(join(root, file), 'utf8');
    assert.equal(sha(source), runtimeSourceHash, 'Unexpected Solidity source');
    assert.equal(solc.version(), '0.8.30+commit.73712a01.Emscripten.clang');
    const input = {
        language: 'Solidity', sources: { [file]: { content: source } },
        settings: {
            viaIR: true, evmVersion: 'shanghai', optimizer: { enabled: true, runs: 200 },
            outputSelection: { '*': { '': ['ast'], '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode'] } },
        },
    };
    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    const errors = (output.errors || []).filter(row => row.severity === 'error');
    assert.equal(errors.length, 0, errors.map(row => row.formattedMessage).join('\n'));
    const contract = output.contracts[file].LayeredScene;
    const bytecode = contract.evm.deployedBytecode;
    const ast = output.sources[file].ast.nodes.find(node => node.nodeType === 'ContractDefinition' && node.name === 'LayeredScene');
    const declarations = new Map(ast.nodes.filter(node => node.nodeType === 'VariableDeclaration')
        .map(node => [String(node.id), node.name]));
    return {
        abi: new Interface(contract.abi),
        creation: '0x' + contract.evm.bytecode.object,
        runtimeFor(addresses) {
            const runtime = Buffer.from(bytecode.object, 'hex');
            const bindings = new Map(addresses.map((item, i) => [i < 7 ? 'style' + i : 'sharedShard', item]));
            bindings.set('modelId', modelId);
            const bound = new Set();
            for (const [id, sites] of Object.entries(bytecode.immutableReferences)) {
                const name = declarations.get(id);
                assert(bindings.has(name), 'Unexpected immutable');
                const value = Buffer.from(getBytes(zeroPadValue(bindings.get(name), 32)));
                for (const { start, length } of sites) {
                    assert(length === 32 && start + length <= runtime.length);
                    assert(runtime.subarray(start, start + length).every(b => b === 0), 'Expected immutable placeholder');
                    value.copy(runtime, start);
                }
                bound.add(name);
            }
            assert.equal(bound.size, bindings.size, 'Missing immutable reference');
            return runtime;
        },
    };
}

function reviewedArtifacts() {
    const benchmark = json(join(root, 'evidence/robinhood.json'));
    const model = readFileSync(join(root, 'evidence/pack500.bin'));
    const fixtures = readFileSync(join(root, 'evidence/vectors.json'));
    assert.equal(model.length, 500_000);
    assert.equal('0x' + sha(model), modelId, 'Unexpected model bytes');
    assert.equal(model.subarray(7 * styleBytes + 9952, 7 * styleBytes + 9960).toString(), 'GH0ST64B');
    assert.equal(sha(fixtures), vectorHash, 'Unexpected image vectors');
    const vectors = JSON.parse(fixtures).vectors;
    assert.equal(vectors.length, 8);
    const decoder = compile();
    const shards = Array.from({ length: 8 }, (_, i) => {
        const payload = model.subarray(i * styleBytes, (i + 1) * styleBytes);
        assert.equal(payload.length, i < 7 ? styleBytes : 12_576);
        const runtime = Buffer.concat([Buffer.from([0]), payload]);
        const size = runtime.length.toString(16).padStart(6, '0');
        const initcode = '0x62' + size + '61001160003962' + size + '6000f3' + runtime.toString('hex');
        const codeHash = keccak256(runtime);
        assert.equal(codeHash, benchmark.shards[i].codeHash, 'Shard differs from the reviewed benchmark');
        return { name: i < 7 ? 'style-' + i : 'shared', runtime, initcode, codeHash, payloadSHA256: sha(payload) };
    });
    // Reconstruct the benchmark runtime first to verify the compiler and all
    // immutable offsets against the previously simulated contract.
    const simulationAddresses = benchmark.shards.map(shard => shard.address);
    const benchmarkRuntime = decoder.runtimeFor(simulationAddresses);
    assert.equal(keccak256(benchmarkRuntime), benchmark.runtime.codeHash, 'Compiler output differs from benchmark');
    assert.equal(benchmarkRuntime.length, benchmark.runtime.bytes);
    return { decoder, shards, vectors };
}

function transactionHashes(path) {
    const input = json(path);
    const records = Array.isArray(input) ? input : input.transactions ?? input.receipts;
    assert(Array.isArray(records) && records.length === txCount, 'Expected all nine transaction hashes in order');
    const hashes = records.map(item => typeof item === 'string' ? item : item.hash ?? item.transactionHash ?? item.txHash);
    assert(hashes.every(hash => typeof hash === 'string' && hex32.test(hash)), 'Invalid transaction hash');
    const normalized = hashes.map(hash => hash.toLowerCase());
    assert.equal(new Set(normalized).size, txCount, 'Duplicate transaction hashes');
    return normalized;
}

function makeRpc() {
    const endpoint = process.env.ROBINHOOD_MAINNET_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
    let url;
    try { url = new URL(endpoint); } catch { throw new Error('Invalid Robinhood RPC URL'); }
    assert(url.protocol === 'https:' && !url.username && !url.password && !url.hash, 'Invalid Robinhood RPC URL');
    let next = 0;
    return async function rpc(method, params = []) {
        assert(methods.has(method), 'Read-only RPC methods only');
        const id = ++next;
        const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
        for (let attempt = 0; attempt < 4; attempt++) {
            let response;
            try {
                response = await fetch(url, {
                    method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(20_000),
                    headers: { 'content-type': 'application/json' },
                });
            } catch {
                if (attempt === 3) throw new Error(method + ' transport failed');
            }
            if (response?.ok) {
                let reply;
                try { reply = await response.json(); } catch { throw new Error(method + ' returned invalid JSON'); }
                assert.equal(reply.id, id);
                if (!reply.error) {
                    assert(Object.hasOwn(reply, 'result'), method + ' has no result');
                    return reply.result;
                }
                const retryable = attempt < 3 && /rate limit|too many requests|temporarily unavailable/i.test(reply.error.message || '');
                if (!retryable) throw new Error(method + ' RPC error ' + Number(reply.error.code));
            } else if (response) {
                await response.body?.cancel();
                if (attempt === 3 || ![429, 500, 502, 503, 504].includes(response.status)) {
                    throw new Error(method + ' HTTP ' + response.status);
                }
            }
            await delay(700 * (attempt + 1));
        }
        throw new Error(method + ' retry limit reached');
    };
}

async function batched(items, width, action) {
    const results = [];
    for (let start = 0; start < items.length; start += width) {
        results.push(...await Promise.all(items.slice(start, start + width).map((item, i) => action(item, start + i))));
    }
    return results;
}

function checkedReceipt(hash, tx, receipt, i) {
    assert(tx && receipt, 'Missing transaction or receipt for ' + hash);
    assert.equal(tx.hash, hash);
    assert.equal(receipt.transactionHash, hash);
    assert.equal(tx.blockHash, receipt.blockHash);
    assert.equal(tx.blockNumber, receipt.blockNumber);
    assert.equal(receipt.status, '0x1', 'Deployment reverted at item ' + i);
    assert.equal(tx.to, null, 'Expected direct contract creation');
    assert.equal(receipt.to, null, 'Expected creation receipt');
    assert.equal(BigInt(tx.value), 0n, 'Unexpected transfer value');
    if (tx.chainId !== undefined && tx.chainId !== null) assert.equal(BigInt(tx.chainId), 4663n);
    const from = getAddress(tx.from);
    assert.equal(from, deployer, 'Unexpected deployment sender');
    assert.equal(getAddress(receipt.from), from);
    const nonce = BigInt(tx.nonce);
    const address = getCreateAddress({ from, nonce });
    assert.equal(getAddress(receipt.contractAddress), address, 'Unexpected created address');
    const gas = BigInt(receipt.gasUsed);
    const gasPrice = BigInt(receipt.effectiveGasPrice);
    assert(gas > 0n && gas <= BigInt(tx.gas) && BigInt(tx.gas) <= maxTxGas);
    assert(gasPrice > 0n);
    return { from, nonce, address, gas, gasPrice, gasFee: gas * gasPrice, tx, receipt };
}

async function main() {
    const [transactionsPath, outputPath] = process.argv.slice(2);
    assert(transactionsPath, 'Usage: node verify.cjs tx-hashes.json [evidence.json], or --check-artifacts');
    const { decoder, shards, vectors } = reviewedArtifacts();
    if (transactionsPath === '--check-artifacts') {
        console.log(JSON.stringify({ modelId, shards: shards.map(shard => shard.codeHash), fixtures: vectors.length }));
        return;
    }
    const hashes = transactionHashes(transactionsPath);
    const rpc = makeRpc();
    const [chain, genesis] = await Promise.all([
        rpc('eth_chainId'), rpc('eth_getBlockByNumber', ['0x0', false]),
    ]);
    assert.equal(BigInt(chain), 4663n, 'Wrong chain ID');
    assert.equal(genesis.hash, genesisHash, 'Wrong Robinhood genesis');
    const items = await batched(hashes, 2, async (hash, i) => checkedReceipt(hash, ...await Promise.all([
        rpc('eth_getTransactionByHash', [hash]), rpc('eth_getTransactionReceipt', [hash]),
    ]), i));
    for (const [index, item] of items.entries()) {
        assert.equal(item.from, items[0].from, 'Mixed deployment senders');
        assert.equal(item.nonce, items[0].nonce + BigInt(index), 'Non-consecutive deployment nonces');
    }
    const addressOrder = items.slice(0, 8).map(item => item.address);
    const contractAddress = items[8].address;
    const engineInitcode = concat([decoder.creation,
        decoder.abi.encodeDeploy([addressOrder, shards.map(shard => shard.codeHash), modelId])]);
    const engineRuntime = decoder.runtimeFor(addressOrder);
    const contracts = [...shards, { name: 'inference', runtime: engineRuntime, initcode: engineInitcode, codeHash: keccak256(engineRuntime) }];
    const head = await rpc('eth_getBlockByNumber', ['latest', false]);
    const receiptBlocks = [...new Set(items.map(item => item.receipt.blockNumber))];
    const canonicalBlocks = new Map(await batched(receiptBlocks, 4, async number => {
        const block = await rpc('eth_getBlockByNumber', [number, false]);
        assert(block.hash && BigInt(head.number) >= BigInt(number));
        return [number, block.hash];
    }));
    const deployment = await batched(contracts, 3, async (contract, i) => {
        const { address, nonce, gas, gasPrice, gasFee, tx, receipt } = items[i];
        assert.equal(canonicalBlocks.get(receipt.blockNumber), receipt.blockHash, 'Receipt block is not canonical');
        assert.equal(keccak256(tx.input), keccak256(contract.initcode), 'Wrong creation data for ' + contract.name);
        const code = await rpc('eth_getCode', [address, head.number]);
        assert.equal(keccak256(code), contract.codeHash, 'Wrong live bytecode for ' + contract.name);
        return {
            name: contract.name, transactionHash: hashes[i], address, nonce: nonce.toString(),
            blockNumber: Number(BigInt(receipt.blockNumber)), blockHash: receipt.blockHash,
            codeHash: contract.codeHash, codeBytes: contract.runtime.length,
            ...(contract.payloadSHA256 ? { payloadSHA256: contract.payloadSHA256 } : {}),
            gasUsed: Number(gas), effectiveGasPriceWei: gasPrice.toString(), feeWei: gasFee.toString(), feeETH: formatEther(gasFee),
        };
    });
    async function call(name, args = []) {
        const response = await rpc('eth_call', [
            { to: contractAddress, data: decoder.abi.encodeFunctionData(name, args), gas: toQuantity(maxTxGas) }, head.number,
        ]);
        return decoder.abi.decodeFunctionResult(name, response);
    }
    assert.equal((await call('modelId'))[0], modelId, 'Wrong live model ID');
    const samples = await batched(vectors, 2, async fixture => {
        const [pixels, palette] = await call('generate', [fixture.prompt, fixture.seed]);
        assert.equal(keccak256(pixels), keccak256(fixture.pixelsHex), 'Wrong pixels for ' + fixture.caption);
        assert.equal(keccak256(palette), keccak256(fixture.paletteHex), 'Wrong palette for ' + fixture.caption);
        return {
            caption: fixture.caption, style: fixture.style, prompt: fixture.prompt, seed: fixture.seed,
            imageHash: keccak256(concat([pixels, palette])), pixelsSHA256: sha(getBytes(pixels)),
            paletteSHA256: sha(getBytes(palette)), matchesReference: true,
        };
    });
    assert.equal((await rpc('eth_getBlockByNumber', [head.number, false])).hash, head.hash, 'Verification block changed');
    const totalFee = items.reduce((sum, item) => sum + item.gasFee, 0n);
    const evidence = {
        kind: 'robinhood-mainnet-deployment-and-live-view-verification',
        scope: 'Nine successful canonical creation receipts and a byte-for-byte match against eight reference images using deployed code.',
        chainId: 4663, modelId, modelBytes: 500_000, format: 'GH0ST64B', width: 64, height: 64,
        deployerAddress: items[0].from, contractAddress, codeHash: contracts[8].codeHash,
        verificationBlock: Number(BigInt(head.number)), verificationBlockHash: head.hash,
        runtimeSourceSHA256: runtimeSourceHash, vectorsSHA256: vectorHash,
        totalGasUsed: items.reduce((sum, item) => sum + Number(item.gas), 0),
        totalFeeWei: totalFee.toString(), totalFeeETH: formatEther(totalFee),
        deployment, samples,
    };
    const output = JSON.stringify(evidence, null, 2) + '\n';
    if (outputPath) writeFileSync(outputPath, output);
    else process.stdout.write(output);
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
