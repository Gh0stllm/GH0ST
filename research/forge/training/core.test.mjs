import test from 'node:test';
import assert from 'node:assert/strict';
import { AbiCoder, keccak256, toUtf8Bytes } from 'ethers';
import {
  MODEL_FORMAT, parseCSV, parseCSVRecords, datasetToCSV, validateDataset, generateNpcDataset,
  splitDataset, prepareTrainingDataset, fitNormalization, normalizeFeatures, inferQuantized, predictQuantized, packWeights,
  trainModel, verifyModel, canonicalJSON, TrainingCancelledError,
} from './core.mjs';

function fixture(shape, weights) {
  return {
    format: MODEL_FORMAT, version: 1, features: Array.from({ length: shape.input }, (_, index) => `f${index}`), labels: Array.from({ length: shape.output }, (_, index) => `class${index}`), shape, weights,
    normalization: { method: 'train-minmax-v1', center: Array(shape.input).fill(0), scale: Array(shape.input).fill(1), minimum: Array(shape.input).fill(-1), maximum: Array(shape.input).fill(1), fitSplit: 'train', inputScale: 256, inputMinimum: -256, inputMaximum: 256 },
  };
}

test('CSV quoting, BOM, CRLF, escaped quotes and exact numeric parsing', () => {
  assert.deepEqual(parseCSVRecords('\uFEFF"a","b"\r\n"a,b","a""b"\r\n'), [['a', 'b'], ['a,b', 'a"b']]);
  const demo = generateNpcDataset({ rows: 72 });
  const csv = datasetToCSV(demo).replace('health,distance,stamina,threat,action', '"health","distance","stamina","threat","action"').replaceAll('\n', '\r\n');
  const parsed = parseCSV('\uFEFF' + csv);
  assert.deepEqual(parsed.rows, demo.rows);
  assert.deepEqual(parsed.featureNames, demo.featureNames);
  assert.equal(parsed.source, 'csv');
});

test('CSV rejects malformed, unknown, empty, non-finite, secret and free-text fields', () => {
  const demo = datasetToCSV(generateNpcDataset({ rows: 72 }));
  for (const malformed of ['', 'a,b\n', 'a,b\n"1,yes\n', 'a,b\n1,"yes"tail\n', 'a,a\n1,2\n', 'a,b\n\n']) assert.throws(() => parseCSV(malformed));
  for (const value of ['', 'NaN', 'Infinity', '1e999', '0x10', '9.2junk', '1e13', 'hello']) {
    assert.throws(() => parseCSV(demo.replace(/\n[^,]+,/, `\n${value},`)), /finite|number|expected/i);
  }
  assert.throws(() => parseCSV(demo.replace('health,', 'private_key,')), /secret|credential/i);
  assert.throws(() => parseCSV(demo.replace(/\n[^,]+,/, `\n0x${'a'.repeat(64)},`)), /private key|credential/i);
  assert.throws(() => parseCSV(demo.replace(',attack', ',this class contains an unsupported long sentence')), /Class labels/i);
  assert.throws(() => parseCSV(demo, { featureColumns: ['health'] }), /Every non-label/);
  assert.throws(() => parseCSV(demo, { labelColumn: 'missing' }), /not found/);
  assert.throws(() => parseCSV('a,b\n' + '1,yes\n'.repeat(5001)), /5000/);
});

test('structured worker datasets reject NaN, shapes, conflicting labels and too few independent examples', () => {
  const demo = generateNpcDataset({ rows: 72 });
  const nan = structuredClone(demo); nan.rows[0].features[0] = NaN;
  assert.throws(() => validateDataset(nan), /finite/);
  const shape = structuredClone(demo); shape.rows[0].features.pop();
  assert.throws(() => validateDataset(shape), /shape/);
  const conflict = structuredClone(demo); conflict.rows.push({ features: [...conflict.rows[0].features], label: (conflict.rows[0].label + 1) % 3 });
  assert.throws(() => validateDataset(conflict), /conflicting/);
  const tiny = structuredClone(demo); tiny.rows = tiny.rows.slice(0, 10);
  assert.throws(() => validateDataset(tiny), /at least 12/);
  const text = structuredClone(demo); text.labels[0] = 'sk-' + 'a'.repeat(40);
  assert.throws(() => validateDataset(text), /not free text or secrets/);
});

test('stratified feature groups are disjoint and duplicates never cross splits', () => {
  const dataset = generateNpcDataset({ rows: 90 });
  dataset.rows.push(...structuredClone(dataset.rows.slice(0, 12)));
  const first = splitDataset(dataset, 2026), second = splitDataset(dataset, 2026);
  assert.deepEqual(first.summary, second.summary);
  const all = [...first.train, ...first.validation, ...first.test];
  assert.equal(new Set(all).size, dataset.rows.length);
  assert.equal(all.length, dataset.rows.length);
  const memberships = new Map();
  for (const name of ['train', 'validation', 'test']) for (const id of first[name]) {
    const key = JSON.stringify(dataset.rows[id].features);
    if (memberships.has(key)) assert.equal(memberships.get(key), name);
    else memberships.set(key, name);
  }
  assert.equal(first.summary.duplicateRows, 12);
  for (const counts of Object.values(first.summary.classCounts)) assert.ok(counts.every((count) => count >= 2));
  // Input ordering changes row IDs, but cannot change a feature group's assigned partition.
  const reversed = structuredClone(dataset); reversed.rows.reverse();
  const other = splitDataset(reversed, 2026);
  for (const name of ['train', 'validation', 'test']) assert.deepEqual(other[name].map((id) => JSON.stringify(reversed.rows[id].features)).sort(), first[name].map((id) => JSON.stringify(dataset.rows[id].features)).sort());
});

test('normalization is fitted only to training data and clamps unseen extremes', () => {
  const dataset = generateNpcDataset({ rows: 90 });
  const split = splitDataset(dataset, 2026), before = fitNormalization(split.dataset, split.train);
  for (const id of [...split.validation, ...split.test]) split.dataset.rows[id].features[0] = 1e10 + id;
  const after = fitNormalization(split.dataset, split.train);
  assert.deepEqual(after, before);
  assert.equal(normalizeFeatures(after, [1e12, ...split.dataset.rows[0].features.slice(1)])[0], 256);
  assert.equal(normalizeFeatures(after, [-1e12, ...split.dataset.rows[0].features.slice(1)])[0], -256);
  assert.throws(() => normalizeFeatures(after, [NaN, 0, 0, 0]), /finite/);
});

test('quantized feature collisions cannot leak into validation or final holdout', () => {
  const prepared = prepareTrainingDataset(generateNpcDataset({ rows: 360 }), 42);
  const sets = ['train', 'validation', 'test'].map((name) => new Set(prepared[name].map((id) => JSON.stringify(prepared.rows[id].q8))));
  for (const left of [0, 1]) for (const right of [1, 2]) if (right > left) for (const key of sets[left]) assert.equal(sets[right].has(key), false);
  // Distinct raw rows can still be the same input to a Q8 model: reject an impossible holdout.
  const dense = { featureNames: ['x'], labelName: 'class', labels: ['low', 'high'], rows: Array.from({ length: 2000 }, (_, index) => ({ features: [index], label: Number(index >= 1000) })) };
  assert.throws(() => prepareTrainingDataset(dense, 42), /Too few independent Q8 inputs/);
  // A small number of collisions is explicitly excluded, with every source row accounted for.
  const nearDuplicate = generateNpcDataset({ rows: 90 });
  for (const row of nearDuplicate.rows.slice(0, 6)) nearDuplicate.rows.push({ features: row.features.map((value) => value + 1e-9), label: row.label });
  const result = prepareTrainingDataset(nearDuplicate, 0);
  assert.equal(result.summary.duplicateRows, 0); // All raw feature vectors differ.
  assert.equal(result.summary.excludedRows, 2); // Q8 reveals two cross-partition collisions.
  assert.equal(result.summary.trainRows + result.summary.validationRows + result.summary.testRows + result.summary.excludedRows, nearDuplicate.rows.length);
  const q8Sets = ['train', 'validation', 'test'].map((name) => new Set(result[name].map((id) => JSON.stringify(result.rows[id].q8))));
  for (const key of q8Sets[0]) assert.equal(q8Sets[1].has(key) || q8Sets[2].has(key), false);
  for (const key of q8Sets[1]) assert.equal(q8Sets[2].has(key), false);
});

test('independent hand arithmetic: output-major layout, signed truncation, clipping and lowest tie', () => {
  const model = fixture({ input: 2, hidden: 3, output: 3 }, {
    hiddenWeights: [256, -128, -256, 256, 32767, 32767], hiddenBias: [1, 0, -32768],
    headWeights: [256, 128, -256, -256, 256, 0, 0, 0, 0], headBias: [-1, 100, 5],
  });
  const trace = inferQuantized(model, [128, -256]);
  assert.deepEqual(trace.hidden, [257, 0, 0]);
  assert.deepEqual(trace.logits, [256, -157, 5]);
  assert.equal(trace.classId, 0);
  const fraction = fixture({ input: 1, hidden: 1, output: 2 }, { hiddenWeights: [-1], hiddenBias: [1], headWeights: [-1, 0], headBias: [0, 0] });
  assert.deepEqual(inferQuantized(fraction, [1]).hidden, [1]); // trunc(-1/256) = 0; floor would be -1.
  assert.deepEqual(inferQuantized(fraction, [1]).logits, [0, 0]);
  assert.equal(inferQuantized(fraction, [1]).classId, 0);
  const saturation = fixture({ input: 1, hidden: 1, output: 2 }, { hiddenWeights: [32767], hiddenBias: [32767], headWeights: [32767, -32768], headBias: [32767, -32768] });
  assert.deepEqual(inferQuantized(saturation, [256]).hidden, [32767]);
  assert.deepEqual(inferQuantized(saturation, [256]).logits, [4226815, -4226944]);
  assert.equal(packWeights(fraction), '0xffff0001ffff000000000000');
  assert.throws(() => inferQuantized(model, [257, 0]), /Q8/);
  assert.throws(() => inferQuantized(model, [1.2, 0]), /Q8/);
  assert.throws(() => predictQuantized({ ...model, format: 'LLM' }, [0, 0]), /not LLMs/);
});

test('fixed seeded training reproduces weights, hashes and every measured score', async () => {
  const dataset = generateNpcDataset({ rows: 180, seed: 43 }), progress = [];
  const first = await trainModel(dataset, { seed: 2026, epochs: 30 }, { onProgress: (value) => progress.push(value) });
  const second = await trainModel(dataset, { seed: 2026, epochs: 30 });
  assert.deepEqual(first, second);
  assert.ok(progress.length >= 2);
  assert.equal(progress.at(-1).epoch, 30);
  assert.ok(progress.every((value) => !('testAccuracy' in value) && !('heldoutAccuracy' in value)));
  const { metrics, model, splitSummary } = first;
  assert.equal(metrics.confusionMatrix.flat().reduce((a, b) => a + b), splitSummary.testRows);
  const correct = metrics.confusionMatrix.reduce((sum, row, index) => sum + row[index], 0);
  assert.equal(metrics.heldoutAccuracy, correct / splitSummary.testRows);
  assert.equal(metrics.quantizedAccuracy, metrics.heldoutAccuracy);
  assert.ok(metrics.quantizationAgreement >= 0 && metrics.quantizationAgreement <= 1);
  assert.equal(metrics.baselines.majority.testAccuracy, 1 / 3);
  const abiHash = keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32', 'uint8', 'uint8', 'uint8', 'bytes32', 'bytes32', 'bytes32', 'bytes32'], [keccak256(toUtf8Bytes(MODEL_FORMAT)), model.shape.input, model.shape.hidden, model.shape.output, model.hashes.featureSchemaHash, model.hashes.labelsHash, model.hashes.datasetHash, keccak256(model.packedWeightsHex)]));
  assert.equal(model.hashes.modelHash, abiHash);
  assert.equal((await verifyModel(model)).valid, true);
  const tampered = structuredClone(model); tampered.weights.hiddenWeights[0]++;
  await assert.rejects(() => verifyModel(tampered), /mismatch/);
  const changedNormalization = structuredClone(model); changedNormalization.normalization.center[0]++;
  await assert.rejects(() => verifyModel(changedNormalization), /Normalization|mismatch/);
  const changedLabel = structuredClone(model); changedLabel.labels[0] = 'changed';
  await assert.rejects(() => verifyModel(changedLabel), /mismatch/);
  const changedQuantization = structuredClone(model); changedQuantization.quantization.division = 'floor';
  await assert.rejects(() => verifyModel(changedQuantization), /quantization/);
  assert.equal(canonicalJSON({ z: 1, a: [2, 3] }), '{"a":[2,3],"z":1}');
});

test('training policy fixes epochs and fits normalization to the declared training partition', async () => {
  const dataset = generateNpcDataset({ rows: 90, seed: 12 });
  const first = await trainModel(dataset, { seed: 8, epochs: 10 });
  const split = splitDataset(dataset, 8);
  // Replace only heldout values within their existing group ordering. Preparation is isolated
  // below by checking fitted normalization, and direct same-training runs are deterministic.
  const originalTrain = split.train.map((id) => dataset.rows[id]);
  const actualTrain = first.splitSummary.trainRowIds.map((id) => dataset.rows[id]);
  assert.deepEqual(new Set(actualTrain), new Set(originalTrain));
  const norm = fitNormalization(dataset, split.train);
  for (const id of split.test) dataset.rows[id].features[0] += 1000;
  assert.deepEqual(fitNormalization(dataset, split.train), norm);
  assert.equal(first.model.training.evaluationPolicy, 'test-once-after-fixed-training');
  assert.equal(first.model.training.fixedEpochs, true);
});

test('training cancellation and finite budgets reject without exporting a model', async () => {
  const dataset = generateNpcDataset({ rows: 72 });
  await assert.rejects(() => trainModel(dataset, { epochs: 301 }), /1–300/);
  await assert.rejects(() => trainModel(dataset, { hiddenSize: 17 }), /1–16/);
  await assert.rejects(() => trainModel(dataset, { learningRate: NaN }), /Learning rate/);
  await assert.rejects(() => trainModel(dataset, { seed: -1 }), /Seed/);
  let cancel = false;
  await assert.rejects(() => trainModel(dataset, { epochs: 100 }, { onProgress: () => { cancel = true; }, shouldCancel: () => cancel }), TrainingCancelledError);
  await assert.rejects(() => trainModel(dataset, {}, { shouldCancel: () => true }), TrainingCancelledError);
});
