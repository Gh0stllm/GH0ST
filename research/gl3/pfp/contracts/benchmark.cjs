'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { parseArgs } = require('node:util');

function dependency(name) {
    try {
        return require(name);
    } catch (error) {
        if (error.code !== 'MODULE_NOT_FOUND') throw error;
        return require(join(__dirname, '../../../chess/node_modules', name));
    }
}

const solc = dependency('solc');
const { ContractFactory, JsonRpcProvider, getBytes, hexlify, keccak256, ZeroHash } = dependency('ethers');
const { values } = parseArgs({
    options: { synthetic: { type: 'boolean' }, override: { type: 'string' }, 'keep-running': { type: 'boolean' } }
});
const chainId = 4663001;
const modelDirectory = join(__dirname, '../model');
const subjectCount = 12;
const headerBytes = 474;
const budgetGas = 16_777_216n;

function artifact() {
    const filename = 'Gh0stPfp.sol';
    const input = {
        language: 'Solidity',
        sources: { [filename]: { content: readFileSync(join(__dirname, filename), 'utf8') } },
        settings: {
            evmVersion: 'shanghai',
            viaIR: true,
            optimizer: { enabled: true, runs: 200 },
            outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } }
        }
    };
    const build = JSON.parse(solc.compile(JSON.stringify(input)));
    const errors = (build.errors || []).filter(entry => entry.severity === 'error');
    assert.equal(errors.length, 0, errors.map(entry => entry.formattedMessage).join('\n'));
    return build.contracts[filename].Gh0stPfp;
}

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

function syntheticModel() {
    const header = Buffer.alloc(headerBytes);
    for (let offset = 0; offset < 448; offset += 32) {
        Buffer.from(sha256('GH0ST image model test ' + offset), 'hex').copy(header, offset);
    }
    const boundaries = [-2147483648, -16384, -127, -1, 0, 1, 127, 128, 129, 16383, 16384, 16385, 32767, 65535, 16777216, 2147483647];
    boundaries.forEach((value, index) => header.writeInt32LE(value, 384 + index * 4));
    const heads = [];
    let size = 0;
    for (let subject = 0; subject < subjectCount; subject++) {
        const records = 89 + subject * 4;
        const body = Buffer.alloc(256 + records * 6);
        body.fill([0, 0x55, 0xaa][subject % 3], 0, 256);
        for (let index = 0; index < records; index++) {
            const row = 256 + index * 6;
            body.writeUInt16LE(7 * index + 5, row);
            body[row + 2] = index % 3 === 0 ? 255 : index % 16;
            body[row + 3] = body[row + 2] === 255 ? index % 2 : (index * 11 + subject) % 256;
            body[row + 4] = index % 5 === 0 ? 255 : (index + subject) % 16;
            body[row + 5] = body[row + 4] === 255 ? index % 2 : (index * 17 + subject) % 256;
        }
        header.writeUInt16LE(size, 448 + subject * 2);
        size += body.length;
        heads.push(body);
    }
    header.writeUInt16LE(size, 448 + subjectCount * 2);
    return Buffer.concat([header, ...heads]);
}

function evaluate(blob, seed, subject, style) {
    const input = Array.from(getBytes(seed), byte => byte - 128);
    assert.equal(input.length, 16);
    for (let offset = 0; offset < 8; offset++) input.push(((style >>> offset) & 1) ? 127 : -127);
    const hidden = Array.from({ length: 16 }, (_, i) => {
        let value = blob.readInt32LE(384 + i * 4);
        for (let j = 0; j < 24; j++) value += blob.readInt8(i * 24 + j) * input[j];
        return Math.max(0, Math.min(127, Math.floor(value / 128)));
    });

    function active(lane, predicate) {
        if (lane === 255) return predicate;
        return predicate >= 128 ? hidden[lane] < (predicate & 127) : hidden[lane] >= predicate;
    }

    const start = headerBytes + blob.readUInt16LE(448 + subject * 2);
    const end = headerBytes + blob.readUInt16LE(450 + subject * 2);
    const result = Buffer.from(blob.subarray(start, start + 256));
    for (let row = start + 256; row < end; row += 6) {
        const pixel = blob.readUInt16LE(row);
        const foreground = active(blob[row + 2], blob[row + 3]);
        const ivory = active(blob[row + 4], blob[row + 5]);
        const shift = 2 * (pixel % 4);
        const slot = Math.floor(pixel / 4);
        result[slot] = (result[slot] & ~(3 << shift)) | (foreground ? ivory ? 2 : 1 : 0) << shift;
    }
    return hexlify(result);
}

async function startAnvil() {
    const child = spawn(process.env.ANVIL_BIN || 'anvil', [
        '--host', '127.0.0.1', '--port', '0', '--accounts', '1',
        '--chain-id', String(chainId), '--hardfork', 'shanghai', '--gas-limit', '32000000'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
        const port = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Anvil startup timed out')), 10000);
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', data => {
                stdout = (stdout + data).slice(-8192);
                const address = stdout.match(/Listening on 127\.0\.0\.1:(\d+)/);
                if (address) { clearTimeout(timeout); resolve(address[1]); }
            });
            child.stderr.on('data', data => { stderr = (stderr + data).slice(-4096); });
            child.on('error', error => { clearTimeout(timeout); reject(error); });
            child.on('exit', code => {
                clearTimeout(timeout);
                reject(new Error('Anvil exited ' + code + (stderr ? '\n' + stderr : '')));
            });
        });
        return { child, url: 'http://127.0.0.1:' + port };
    } catch (error) {
        child.kill();
        throw error;
    }
}

function testVectors() {
    return Array.from({ length: subjectCount * 3 }, (_, index) => {
        const seedBytes = index === 0 ? '00'.repeat(16) : index === 1 ? 'ff'.repeat(16) : sha256('GH0ST image parity ' + index).slice(0, 32);
        return { seed: '0x' + seedBytes, subject: index % subjectCount, style: (index * 83) % 256 };
    });
}

function summary(values) {
    const ordered = [...values].sort((a, b) => Number(a - b));
    return { samples: ordered.length, min: Number(ordered[0]), median: Number(ordered[Math.floor(ordered.length / 2)]), max: Number(ordered.at(-1)) };
}

async function main() {
    const mode = values.synthetic ? 'synthetic' : 'trained';
    const blob = values.synthetic ? syntheticModel() : readFileSync(join(modelDirectory, 'image-model.bin'));
    assert(blob.length >= 3546 && blob.length <= 24_575);
    const examples = testVectors();
    if (!values.synthetic) {
        const golden = JSON.parse(readFileSync(join(modelDirectory, 'image-vectors.json'), 'utf8'));
        if (golden.modelSHA256) assert.equal(golden.modelSHA256, sha256(blob));
        assert(golden.vectors.length > 0);
        examples.push(...golden.vectors);
    }
    const expectedModelHash = keccak256(blob);
    const build = artifact();
    const { child, url } = await startAnvil();
    const provider = new JsonRpcProvider(url, { name: 'gl3-benchmark-loopback', chainId }, {
        batchMaxCount: 1, pollingInterval: 50, cacheTimeout: -1
    });
    try {
        assert.equal((await provider.getNetwork()).chainId, BigInt(chainId));
        const signer = await provider.getSigner(0);
        const factory = new ContractFactory(build.abi, build.evm.bytecode.object, signer);
        const deployment = await factory.getDeployTransaction(blob, expectedModelHash);
        const invalidLength = await factory.getDeployTransaction(blob.subarray(1), expectedModelHash);
        const invalidHash = await factory.getDeployTransaction(blob, ZeroHash);
        await assert.rejects(provider.call(invalidLength), { code: 'CALL_EXCEPTION' });
        await assert.rejects(provider.call(invalidHash), { code: 'CALL_EXCEPTION' });
        const invalidTable = Buffer.from(blob);
        invalidTable[448] = 1;
        const invalidBaseline = Buffer.from(blob);
        invalidBaseline[474] = 3;
        const invalidIndex = Buffer.from(blob);
        const patchSubject = Array.from({ length: subjectCount }, (_, subject) => subject).find(subject =>
            blob.readUInt16LE(450 + subject * 2) - blob.readUInt16LE(448 + subject * 2) > 256);
        assert(patchSubject !== undefined, 'Model needs some input-dependent pixels');
        const firstPatch = 730 + blob.readUInt16LE(448 + patchSubject * 2);
        invalidIndex.writeUInt16LE(1024, firstPatch);
        const invalidLane = Buffer.from(blob);
        invalidLane[firstPatch + 2] = 16;
        for (const malformed of [invalidTable, invalidBaseline, invalidIndex, invalidLane]) {
            const invalid = await factory.getDeployTransaction(malformed, keccak256(malformed));
            await assert.rejects(provider.call(invalid), { code: 'CALL_EXCEPTION' });
        }
        assert(deployment.data.length / 2 - 1 < 49_152);

        const generator = await factory.deploy(blob, expectedModelHash);
        const deploymentReceipt = await generator.deploymentTransaction().wait();
        assert.equal(deploymentReceipt.status, 1);
        const address = await generator.getAddress();
        const code = await provider.getCode(address);
        const dataAddress = await generator.weights();
        const shards = [{ address: dataAddress, code: await provider.getCode(dataAddress) }];
        assert.equal(await generator.modelHash(), expectedModelHash);
        assert.equal(shards[0].code, '0x00' + blob.toString('hex'));
        await assert.rejects(generator.generate(ZeroHash.slice(0, 34), subjectCount, 0), { code: 'CALL_EXCEPTION' });
        if (values.override) {
            writeFileSync(values.override, JSON.stringify({
                generator: address, code, shards, abi: build.abi,
                deployment: [{ id: 'generator-and-weights', initCode: deployment.data, usesShards: false }],
                modelSHA256: sha256(blob), packedModelSHA256: sha256(blob)
            }, null, 2) + '\n');
        }
        if (values['keep-running']) {
            console.error(JSON.stringify({ localRpc: url, generator: address, modelHash: expectedModelHash }));
        }

        const readGas = [];
        const recordGas = [];
        const outputs = new Set();
        const perSubjectRecordGas = Array.from({ length: subjectCount }, () => []);
        for (const [index, example] of examples.entries()) {
            const { seed, subject, style } = example;
            const expected = evaluate(blob, seed, subject, style);
            if (example.pixels !== undefined) assert.equal(expected, example.pixels, 'Golden model reference mismatch at vector ' + index);
            const pixels = await generator.generate(seed, subject, style);
            assert.equal(pixels, expected, 'Contract model reference mismatch at vector ' + index);
            assert.equal(getBytes(pixels).length, 256);
            outputs.add(pixels);

            if (index < 24) {
                const estimated = await generator.generate.estimateGas(seed, subject, style);
                readGas.push(estimated);
                const transaction = await generator.record(seed, subject, style);
                const receipt = await transaction.wait();
                assert.equal(receipt.status, 1);
                assert(receipt.gasUsed < budgetGas);
                const [event] = receipt.logs.map(log => generator.interface.parseLog(log)).filter(Boolean);
                assert.equal(event.name, 'ImageGenerated');
                assert.equal(event.args.seed, seed);
                assert.equal(event.args.subject, BigInt(subject));
                assert.equal(event.args.style, BigInt(style));
                assert.equal(event.args.imageHash, keccak256(pixels));
                recordGas.push(receipt.gasUsed);
                perSubjectRecordGas[subject].push(receipt.gasUsed);
            }
        }
        assert(outputs.size > 1);
        console.log(JSON.stringify({
            benchmark: 'GH0ST PFP isolated Anvil EVM', mode, compiler: solc.version(), evmVersion: 'shanghai',
            model: { bytes: blob.length, sha256: sha256(blob), keccak256: expectedModelHash },
            deployment: { transactions: 1, executionGas: Number(deploymentReceipt.gasUsed),
                initCodeBytes: getBytes(deployment.data).length, generatorCodeBytes: getBytes(code).length,
                shardCodeBytes: shards.map(shard => getBytes(shard.code).length) },
            parity: { vectors: examples.length, distinctOutputs: outputs.size, bytesPerImage: 256 },
            generateGas: summary(readGas), recordGas: summary(recordGas),
            recordGasBySubject: perSubjectRecordGas.map(summary)
        }, null, 2));
        if (values['keep-running']) {
            await new Promise(resolve => {
                function stop() {
                    process.off('SIGINT', stop);
                    process.off('SIGTERM', stop);
                    child.off('exit', stop);
                    resolve();
                }
                process.once('SIGINT', stop);
                process.once('SIGTERM', stop);
                child.once('exit', stop);
            });
        }
    } finally {
        provider.destroy();
        child.kill();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
