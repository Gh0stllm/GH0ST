import { AbiCoder, keccak256, toUtf8Bytes } from 'ethers';
import { DATA_LIMITS, parseCSV, parseCSVRecords, validateDataset, datasetToCSV } from './csv.mjs';
export { DATA_LIMITS, parseCSV, parseCSVRecords, validateDataset, datasetToCSV };

export const MODEL_FORMAT = 'GH0ST_FORGE_NUMERIC_MLP_Q8_V1';
export const TRAINING_LIMITS = Object.freeze({ maxEpochs: 300, maxHiddenSize: 16, maxUpdates: 50_000, maxMilliseconds: 120_000 });
const Q = 256, INT16_MIN = -32768, INT16_MAX = 32767;
const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));
const clamp = (number, lower, upper) => Math.max(lower, Math.min(upper, number));
const argmax = (values) => values.reduce((best, value, index) => value > values[best] ? index : best, 0);

export function seededRandom(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values, random) {
  for (let index = values.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [values[index], values[target]] = [values[target], values[index]];
  }
  return values;
}

export function canonicalJSON(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
  throw new Error('Cannot hash unsupported or non-finite metadata.');
}

export async function sha256Canonical(value) {
  if (!globalThis.crypto?.subtle) throw new Error('A secure browser context is required to hash this model. Open the HTTPS website.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJSON(value)));
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Duplicate feature vectors remain together, including when their input rows were reordered. */
export function splitDataset(input, seed = 42) {
  const dataset = validateDataset(input), random = seededRandom(seed);
  const groupMap = new Map();
  dataset.rows.forEach((row, index) => {
    const key = JSON.stringify(row.features);
    if (!groupMap.has(key)) groupMap.set(key, { key, label: row.label, rowIds: [] });
    groupMap.get(key).rowIds.push(index);
  });
  const train = [], validation = [], test = [];
  for (let label = 0; label < dataset.labels.length; label++) {
    const groups = shuffle([...groupMap.values()].filter((group) => group.label === label).sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0), random);
    const testCount = Math.max(2, Math.floor(groups.length * .15));
    const validationCount = Math.max(2, Math.floor(groups.length * .15));
    groups.forEach((group, index) => (index < testCount ? test : index < testCount + validationCount ? validation : train).push(...group.rowIds));
  }
  const summary = {
    totalRows: dataset.rows.length, uniqueFeatureRows: dataset.summary.uniqueFeatureRows, duplicateRows: dataset.summary.duplicateRows,
    trainRows: train.length, validationRows: validation.length, testRows: test.length,
    trainRowIds: [...train].sort((a, b) => a - b), validationRowIds: [...validation].sort((a, b) => a - b), testRowIds: [...test].sort((a, b) => a - b),
    classCounts: { train: dataset.labels.map((_, label) => train.filter((id) => dataset.rows[id].label === label).length), validation: dataset.labels.map((_, label) => validation.filter((id) => dataset.rows[id].label === label).length), test: dataset.labels.map((_, label) => test.filter((id) => dataset.rows[id].label === label).length) },
    method: 'stratified-feature-groups-70-15-15-v1',
  };
  return { dataset, train, validation, test, summary };
}

export function fitNormalization(dataset, trainRowIds) {
  if (!Array.isArray(trainRowIds) || !trainRowIds.length) throw new Error('Normalization needs training rows.');
  const minimum = dataset.featureNames.map((_, feature) => Math.min(...trainRowIds.map((row) => dataset.rows[row].features[feature])));
  const maximum = dataset.featureNames.map((_, feature) => Math.max(...trainRowIds.map((row) => dataset.rows[row].features[feature])));
  return {
    method: 'train-minmax-v1', center: minimum.map((min, feature) => (min + maximum[feature]) / 2),
    scale: minimum.map((min, feature) => maximum[feature] === min ? 1 : (maximum[feature] - min) / 2), minimum, maximum,
    fitSplit: 'train', inputScale: Q, inputMinimum: -Q, inputMaximum: Q,
  };
}

/** Training-only normalization can collapse distinct raw rows to the same Q8 model input. */
export function prepareTrainingDataset(input, seed = 42) {
  const split = splitDataset(input, seed), normalization = fitNormalization(split.dataset, split.train);
  const rows = split.dataset.rows.map((row) => {
    const q8 = normalizeFeatures(normalization, row.features);
    return { ...row, q8, x: q8.map((value) => value / Q) };
  });
  const key = (id) => JSON.stringify(rows[id].q8);
  const trainKeys = new Set(split.train.map(key));
  const originalValidation = [...split.validation], originalTest = [...split.test];
  split.validation = originalValidation.filter((id) => !trainKeys.has(key(id)));
  const validationKeys = new Set(split.validation.map(key));
  split.test = originalTest.filter((id) => !trainKeys.has(key(id)) && !validationKeys.has(key(id)));
  const excludedValidation = originalValidation.filter((id) => trainKeys.has(key(id)));
  const excludedTest = originalTest.filter((id) => trainKeys.has(key(id)) || validationKeys.has(key(id)));
  const classCounts = Object.fromEntries(['train', 'validation', 'test'].map((name) => [name, split.dataset.labels.map((_, label) => split[name].filter((id) => rows[id].label === label).length)]));
  const uniqueQ8ClassCounts = Object.fromEntries(['train', 'validation', 'test'].map((name) => [name, split.dataset.labels.map((_, label) => new Set(split[name].filter((id) => rows[id].label === label).map(key)).size)]));
  if (uniqueQ8ClassCounts.validation.some((count) => count < 2) || uniqueQ8ClassCounts.test.some((count) => count < 2)) throw new Error('Too few independent Q8 inputs remain in validation or test (need at least 2 per class). Similar numeric rows collapse after quantization. Add more varied features or independently different examples.');
  Object.assign(split.summary, {
    trainRows: split.train.length, validationRows: split.validation.length, testRows: split.test.length,
    trainRowIds: [...split.train].sort((a, b) => a - b), validationRowIds: [...split.validation].sort((a, b) => a - b), testRowIds: [...split.test].sort((a, b) => a - b),
    excludedValidationRows: excludedValidation.length, excludedTestRows: excludedTest.length, excludedRows: excludedValidation.length + excludedTest.length,
    excludedValidationRowIds: [...excludedValidation].sort((a, b) => a - b), excludedTestRowIds: [...excludedTest].sort((a, b) => a - b),
    uniqueQ8Rows: new Set(rows.map((row) => JSON.stringify(row.q8))).size,
    classCounts, uniqueQ8ClassCounts, q8CollisionPolicy: 'train-priority-then-validation-exclude-cross-split-collisions-v1',
  });
  return { ...split, normalization, rows };
}

export function normalizeFeatures(modelOrNormalization, features) {
  const normalization = modelOrNormalization.normalization ?? modelOrNormalization;
  if (!normalization || !Array.isArray(normalization.center) || !Array.isArray(normalization.scale) || !Array.isArray(features) || features.length !== normalization.center.length || normalization.scale.length !== features.length) throw new Error('Feature vector has an unsupported shape.');
  return features.map((value, feature) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > DATA_LIMITS.maxMagnitude || !Number.isFinite(normalization.center[feature]) || !Number.isFinite(normalization.scale[feature]) || normalization.scale[feature] <= 0) throw new Error('Feature values and normalization must be finite numbers.');
    return Math.round(clamp((value - normalization.center[feature]) / normalization.scale[feature], -1, 1) * Q) || 0;
  });
}

export function validateModel(model) {
  if (!model || model.format !== MODEL_FORMAT || model.version !== 1) throw new Error('Unsupported model. Forge accepts its fixed numeric Q8 classifier format, not LLMs or arbitrary model files.');
  const { input, hidden, output } = model.shape ?? {};
  if (![input, hidden, output].every(Number.isInteger) || input < 1 || input > 8 || hidden < 1 || hidden > 16 || output < 2 || output > 4 || !Array.isArray(model.features) || model.features.length !== input || !Array.isArray(model.labels) || model.labels.length !== output) throw new Error('Unsupported model dimensions.');
  // Reuse dataset name/class validation without accepting arbitrary text in an import.
  if (new Set(model.features).size !== input || new Set(model.labels).size !== output || model.features.some((name) => typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_. -]{0,47}$/.test(name)) || model.labels.some((name) => typeof name !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_. -]{0,31}$/.test(name))) throw new Error('Invalid model feature names or class labels.');
  const lengths = { hiddenWeights: hidden * input, hiddenBias: hidden, headWeights: output * hidden, headBias: output };
  for (const [name, length] of Object.entries(lengths)) {
    if (!Array.isArray(model.weights?.[name]) || model.weights[name].length !== length || model.weights[name].some((value) => !Number.isInteger(value) || value < INT16_MIN || value > INT16_MAX)) throw new Error(`Invalid int16 model array: ${name}.`);
  }
  const normalization = model.normalization;
  if (!normalization || normalization.method !== 'train-minmax-v1' || normalization.fitSplit !== 'train' || normalization.inputScale !== Q || normalization.inputMinimum !== -Q || normalization.inputMaximum !== Q) throw new Error('Unsupported normalization format.');
  for (const name of ['center', 'scale', 'minimum', 'maximum']) if (!Array.isArray(normalization[name]) || normalization[name].length !== input || normalization[name].some((value) => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > DATA_LIMITS.maxMagnitude)) throw new Error('Invalid normalization parameters.');
  for (let feature = 0; feature < input; feature++) {
    const minimum = normalization.minimum[feature], maximum = normalization.maximum[feature];
    if (minimum > maximum || normalization.center[feature] !== (minimum + maximum) / 2 || normalization.scale[feature] !== (minimum === maximum ? 1 : (maximum - minimum) / 2)) throw new Error('Normalization parameters do not match training min/max scaling.');
  }
  if (model.quantization !== undefined && (model.quantization.scale !== Q || model.quantization.integerType !== 'int16' || model.quantization.byteOrder !== 'big-endian' || model.quantization.matrixOrder !== 'output-major' || model.quantization.hiddenActivation !== 'relu-clip-32767' || model.quantization.division !== 'truncate-toward-zero-after-dot-product' || model.quantization.tieBreak !== 'lowest-class-index' || canonicalJSON(model.quantization.layout) !== canonicalJSON(['hiddenWeights', 'hiddenBias', 'headWeights', 'headBias']))) throw new Error('Unsupported quantization metadata.');
  normalizeFeatures(model, Array(input).fill(0));
  return model;
}

/** Matches Solidity signed integer division: truncate the sum toward zero once per affine row. */
export function inferQuantized(model, featuresQ8) {
  validateModel(model);
  const { input, hidden: hiddenSize, output } = model.shape ?? {};
  if (!Array.isArray(featuresQ8) || featuresQ8.length !== input || featuresQ8.some((value) => !Number.isInteger(value) || value < -Q || value > Q)) throw new Error('Normalized features must be Q8 integers in [-256, 256].');
  const { hiddenWeights, hiddenBias, headWeights, headBias } = model.weights;
  const hidden = Array.from({ length: hiddenSize }, (_, row) => {
    let sum = 0;
    for (let feature = 0; feature < input; feature++) sum += hiddenWeights[row * input + feature] * featuresQ8[feature];
    return clamp(Math.trunc(sum / Q) + hiddenBias[row], 0, INT16_MAX);
  });
  const logits = Array.from({ length: output }, (_, row) => {
    let sum = 0;
    for (let feature = 0; feature < hiddenSize; feature++) sum += headWeights[row * hiddenSize + feature] * hidden[feature];
    return Math.trunc(sum / Q) + headBias[row];
  });
  const classId = argmax(logits);
  return { classId, label: model.labels[classId], normalizedQ8: [...featuresQ8], hidden, logits };
}

export function predictQuantized(model, features) {
  validateModel(model);
  return inferQuantized(model, normalizeFeatures(model, features));
}

export function packWeights(model) {
  const values = ['hiddenWeights', 'hiddenBias', 'headWeights', 'headBias'].flatMap((name) => model.weights[name]);
  const bytes = new Uint8Array(values.length * 2), view = new DataView(bytes.buffer);
  values.forEach((value, index) => {
    if (!Number.isInteger(value) || value < INT16_MIN || value > INT16_MAX) throw new Error('Packed weights must be signed int16.');
    view.setInt16(index * 2, value, false);
  });
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function computeModelHashes(model, datasetHash) {
  const featureSchema = { version: 1, features: model.features, normalization: model.normalization };
  const [featureSchemaHash, labelsHash] = await Promise.all([sha256Canonical(featureSchema), sha256Canonical(model.labels)]);
  const packedWeightsHex = packWeights(model), weightsHash = keccak256(packedWeightsHex);
  const modelHash = keccak256(AbiCoder.defaultAbiCoder().encode(
    ['bytes32', 'uint8', 'uint8', 'uint8', 'bytes32', 'bytes32', 'bytes32', 'bytes32'],
    [keccak256(toUtf8Bytes(MODEL_FORMAT)), model.shape.input, model.shape.hidden, model.shape.output, featureSchemaHash, labelsHash, datasetHash, weightsHash],
  ));
  return { featureSchema, packedWeightsHex, hashes: { datasetHash, featureSchemaHash, labelsHash, weightsHash, modelHash } };
}

/** Verifies what the package commits to; a dataset commitment cannot prove omitted rows or scores. */
export async function verifyModel(model) {
  validateModel(model);
  if (!model.hashes || !['datasetHash', 'featureSchemaHash', 'labelsHash', 'weightsHash', 'modelHash'].every((name) => /^0x[0-9a-fA-F]{64}$/.test(model.hashes[name] ?? ''))) throw new Error('Model package is missing valid bytes32 commitments.');
  const computed = await computeModelHashes(model, model.hashes.datasetHash);
  for (const [name, hash] of Object.entries(computed.hashes)) if (model.hashes[name].toLowerCase() !== hash) throw new Error(`Model package commitment mismatch: ${name}.`);
  if (model.packedWeightsHex !== undefined && model.packedWeightsHex.toLowerCase() !== computed.packedWeightsHex) throw new Error('Model package packed weights do not match its integer arrays.');
  if (model.modelHash !== undefined && model.modelHash.toLowerCase() !== computed.hashes.modelHash) throw new Error('Model package top-level hash does not match its commitments.');
  if (model.dataHash !== undefined && model.dataHash.toLowerCase() !== computed.hashes.datasetHash) throw new Error('Model package dataset hash does not match its commitments.');
  if (model.featureSchema !== undefined && canonicalJSON(model.featureSchema) !== canonicalJSON(computed.featureSchema)) throw new Error('Model package feature schema does not match its normalization.');
  return { valid: true, model, warnings: ['Hashes and numeric model structure were verified. Imported evaluation scores are a report, not a rerun.', 'The original dataset is absent; its commitment cannot independently establish dataset contents or heldout accuracy.'] };
}

function floatForward(weights, shape, features) {
  const hidden = Array.from({ length: shape.hidden }, (_, row) => {
    let sum = weights.hiddenBias[row];
    for (let feature = 0; feature < shape.input; feature++) sum += weights.hiddenWeights[row * shape.input + feature] * features[feature];
    return clamp(sum, 0, INT16_MAX / Q);
  });
  const logits = Array.from({ length: shape.output }, (_, row) => {
    let sum = weights.headBias[row];
    for (let feature = 0; feature < shape.hidden; feature++) sum += weights.headWeights[row * shape.hidden + feature] * hidden[feature];
    return sum;
  });
  return { hidden, logits, classId: argmax(logits) };
}

function accuracy(rows, classify) {
  let correct = 0;
  for (const row of rows) if (classify(row) === row.label) correct++;
  return rows.length ? correct / rows.length : 0;
}

function majority(counts) { return argmax(counts); }
function fitStump(rows, featureNames, labels) {
  const totalCounts = labels.map((_, label) => rows.filter((row) => row.label === label).length);
  const majorityClass = majority(totalCounts);
  let best = { featureIndex: 0, threshold: rows[0].features[0], leftClass: majorityClass, rightClass: majorityClass, correct: totalCounts[majorityClass] };
  for (let feature = 0; feature < featureNames.length; feature++) {
    const sorted = [...rows].sort((left, right) => left.features[feature] - right.features[feature]);
    const leftCounts = labels.map(() => 0), rightCounts = [...totalCounts];
    for (let index = 0; index < sorted.length - 1; index++) {
      leftCounts[sorted[index].label]++; rightCounts[sorted[index].label]--;
      if (sorted[index].features[feature] === sorted[index + 1].features[feature]) continue;
      const leftClass = majority(leftCounts), rightClass = majority(rightCounts);
      const correct = leftCounts[leftClass] + rightCounts[rightClass];
      if (correct > best.correct) best = { featureIndex: feature, threshold: (sorted[index].features[feature] + sorted[index + 1].features[feature]) / 2, leftClass, rightClass, correct };
    }
  }
  return { majorityClass, stump: best };
}

function evaluate(rows, model, floatWeights) {
  const confusionMatrix = model.labels.map(() => model.labels.map(() => 0));
  let quantizedCorrect = 0, floatCorrect = 0, agreement = 0;
  for (const row of rows) {
    const q = inferQuantized(model, row.q8), f = floatForward(floatWeights, model.shape, row.x);
    confusionMatrix[row.label][q.classId]++;
    quantizedCorrect += Number(q.classId === row.label); floatCorrect += Number(f.classId === row.label); agreement += Number(q.classId === f.classId);
  }
  return { rows: rows.length, quantizedAccuracy: quantizedCorrect / rows.length, floatAccuracy: floatCorrect / rows.length, quantizationAgreement: agreement / rows.length, confusionMatrix };
}

function optionsWithLimits(options, rowCount) {
  const values = { seed: 42, epochs: 100, hiddenSize: 8, learningRate: .025, batchSize: 32, ...options };
  if (!Number.isInteger(values.seed) || values.seed < 0 || values.seed > 0xffffffff) throw new Error('Seed must be a whole number between 0 and 4294967295.');
  if (!Number.isInteger(values.epochs) || values.epochs < 1 || values.epochs > TRAINING_LIMITS.maxEpochs) throw new Error('Use 1–300 epochs.');
  if (!Number.isInteger(values.hiddenSize) || values.hiddenSize < 1 || values.hiddenSize > 16) throw new Error('Use 1–16 hidden units.');
  if (typeof values.learningRate !== 'number' || !Number.isFinite(values.learningRate) || values.learningRate < .0001 || values.learningRate > .1) throw new Error('Learning rate must be between 0.0001 and 0.1.');
  if (!Number.isInteger(values.batchSize) || values.batchSize < 8 || values.batchSize > 128) throw new Error('Batch size must be an integer between 8 and 128.');
  if (Math.ceil(rowCount / values.batchSize) * values.epochs > TRAINING_LIMITS.maxUpdates) throw new Error('This training budget is too large. Reduce rows or epochs.');
  return { seed: values.seed, epochs: values.epochs, hiddenSize: values.hiddenSize, learningRate: values.learningRate, batchSize: values.batchSize };
}

export class TrainingCancelledError extends Error {
  constructor() { super('Training cancelled. No model was exported.'); this.name = 'TrainingCancelledError'; }
}

/** Fixed-epoch Adam. Validation is reported only; neither test rows nor validation select weights. */
export async function trainModel(input, options = {}, { onProgress = () => {}, shouldCancel = () => false } = {}) {
  const started = Date.now(), split = prepareTrainingDataset(input, options.seed ?? 42);
  const dataset = split.dataset, settings = optionsWithLimits(options, split.train.length);
  const normalization = split.normalization, random = seededRandom(settings.seed ^ 0xa5a5a5a5);
  const shape = { input: dataset.featureNames.length, hidden: settings.hiddenSize, output: dataset.labels.length };
  const rows = split.rows;
  const train = split.train.map((id) => rows[id]), validation = split.validation.map((id) => rows[id]);
  const weights = {
    hiddenWeights: Array.from({ length: shape.input * shape.hidden }, () => (random() * 2 - 1) * Math.sqrt(6 / shape.input)), hiddenBias: Array(shape.hidden).fill(.01),
    headWeights: Array.from({ length: shape.hidden * shape.output }, () => (random() * 2 - 1) * Math.sqrt(6 / (shape.hidden + shape.output))), headBias: Array(shape.output).fill(0),
  };
  const names = Object.keys(weights), firstMoment = {}, secondMoment = {};
  for (const name of names) { firstMoment[name] = weights[name].map(() => 0); secondMoment[name] = weights[name].map(() => 0); }
  let updates = 0;
  const checkBudget = () => {
    if (shouldCancel()) throw new TrainingCancelledError();
    if (Date.now() - started > TRAINING_LIMITS.maxMilliseconds) throw new Error('The two-minute browser training budget was reached. Reduce rows or epochs and try again.');
  };
  checkBudget();
  for (let epoch = 1; epoch <= settings.epochs; epoch++) {
    const order = shuffle(Array.from({ length: train.length }, (_, index) => index), random);
    let epochLoss = 0;
    for (let start = 0; start < order.length; start += settings.batchSize) {
      checkBudget();
      const gradients = Object.fromEntries(names.map((name) => [name, weights[name].map(() => 0)]));
      const count = Math.min(settings.batchSize, order.length - start);
      for (let item = start; item < start + count; item++) {
        const row = train[order[item]], forward = floatForward(weights, shape, row.x);
        const maxLogit = Math.max(...forward.logits), exponentials = forward.logits.map((value) => Math.exp(value - maxLogit));
        const denominator = exponentials.reduce((sum, value) => sum + value, 0), delta = exponentials.map((value, label) => value / denominator - Number(label === row.label));
        epochLoss += -Math.log(Math.max(1e-12, exponentials[row.label] / denominator));
        const hiddenDelta = Array(shape.hidden).fill(0);
        for (let output = 0; output < shape.output; output++) {
          gradients.headBias[output] += delta[output];
          for (let hidden = 0; hidden < shape.hidden; hidden++) {
            gradients.headWeights[output * shape.hidden + hidden] += delta[output] * forward.hidden[hidden];
            hiddenDelta[hidden] += delta[output] * weights.headWeights[output * shape.hidden + hidden];
          }
        }
        for (let hidden = 0; hidden < shape.hidden; hidden++) {
          if (forward.hidden[hidden] <= 0 || forward.hidden[hidden] >= INT16_MAX / Q) continue;
          gradients.hiddenBias[hidden] += hiddenDelta[hidden];
          for (let feature = 0; feature < shape.input; feature++) gradients.hiddenWeights[hidden * shape.input + feature] += hiddenDelta[hidden] * row.x[feature];
        }
      }
      updates++;
      for (const name of names) for (let index = 0; index < weights[name].length; index++) {
        const gradient = clamp(gradients[name][index] / count + (name.endsWith('Weights') ? .0001 * weights[name][index] : 0), -5, 5);
        firstMoment[name][index] = .9 * firstMoment[name][index] + .1 * gradient;
        secondMoment[name][index] = .999 * secondMoment[name][index] + .001 * gradient * gradient;
        const correctedFirst = firstMoment[name][index] / (1 - .9 ** updates), correctedSecond = secondMoment[name][index] / (1 - .999 ** updates);
        weights[name][index] = clamp(weights[name][index] - settings.learningRate * correctedFirst / (Math.sqrt(correctedSecond) + 1e-8), INT16_MIN / Q, INT16_MAX / Q);
      }
      if (updates % 100 === 0) await yieldToBrowser();
    }
    if (epoch === 1 || epoch % 5 === 0 || epoch === settings.epochs) onProgress({ epoch, epochs: settings.epochs, loss: epochLoss / train.length, trainingAccuracy: accuracy(train, (row) => floatForward(weights, shape, row.x).classId), validationAccuracy: accuracy(validation, (row) => floatForward(weights, shape, row.x).classId) });
    await yieldToBrowser();
    checkBudget();
  }
  const quantizedWeights = Object.fromEntries(names.map((name) => [name, weights[name].map((value) => clamp(Math.round(value * Q), INT16_MIN, INT16_MAX) || 0)]));
  const model = {
    format: MODEL_FORMAT, version: 1, kind: 'numeric-classifier', features: [...dataset.featureNames], labels: [...dataset.labels], normalization, shape, weights: quantizedWeights,
    quantization: { scale: Q, integerType: 'int16', byteOrder: 'big-endian', layout: ['hiddenWeights', 'hiddenBias', 'headWeights', 'headBias'], matrixOrder: 'output-major', hiddenActivation: 'relu-clip-32767', division: 'truncate-toward-zero-after-dot-product', tieBreak: 'lowest-class-index' },
    training: { ...settings, optimizer: 'adam-v1', fixedEpochs: true, normalizationFit: 'train-only', evaluationPolicy: 'test-once-after-fixed-training', inputRounding: 'nearest-Q8-before-training' },
  };
  validateModel(model);
  // Final holdout enters evaluation only after all optimizer updates have finished.
  const test = split.test.map((id) => rows[id]);
  const evaluated = { train: evaluate(train, model, weights), validation: evaluate(validation, model, weights), test: evaluate(test, model, weights) };
  const fittedBaseline = fitStump(train, dataset.featureNames, dataset.labels), majorityClass = fittedBaseline.majorityClass, stump = fittedBaseline.stump;
  const stumpClassify = (row) => row.features[stump.featureIndex] <= stump.threshold ? stump.leftClass : stump.rightClass;
  const baselineScores = (classify) => ({ trainAccuracy: accuracy(train, classify), validationAccuracy: accuracy(validation, classify), testAccuracy: accuracy(test, classify) });
  const baselines = {
    majority: { label: dataset.labels[majorityClass], ...baselineScores(() => majorityClass) },
    simpleRule: { feature: dataset.featureNames[stump.featureIndex], featureIndex: stump.featureIndex, threshold: stump.threshold, leftLabel: dataset.labels[stump.leftClass], rightLabel: dataset.labels[stump.rightClass], ...baselineScores(stumpClassify) },
  };
  const metrics = {
    heldoutAccuracy: evaluated.test.quantizedAccuracy, validationAccuracy: evaluated.validation.quantizedAccuracy, trainingAccuracy: evaluated.train.quantizedAccuracy,
    floatAccuracy: evaluated.test.floatAccuracy, quantizedAccuracy: evaluated.test.quantizedAccuracy, quantizationAgreement: evaluated.test.quantizationAgreement,
    confusionMatrix: evaluated.test.confusionMatrix, confusionMatrixLabels: [...dataset.labels], testRows: test.length, splits: evaluated, baselines,
    comparison: { beatsMajority: evaluated.test.quantizedAccuracy > baselines.majority.testAccuracy, beatsSimpleRule: evaluated.test.quantizedAccuracy > baselines.simpleRule.testAccuracy },
  };
  const datasetHash = await sha256Canonical({ featureNames: dataset.featureNames, labelName: dataset.labelName, labels: dataset.labels, rows: dataset.rows });
  const commitment = await computeModelHashes(model, datasetHash);
  Object.assign(model, commitment, { dataHash: datasetHash, modelHash: commitment.hashes.modelHash,
    hashAlgorithms: { featureSchema: 'SHA-256 canonical JSON sorted keys', labels: 'SHA-256 canonical JSON sorted keys', dataset: 'SHA-256 canonical JSON sorted keys', weights: 'Keccak-256 packed int16 big-endian', model: 'Keccak-256 ABI metadata and commitment tuple' },
    evaluation: metrics, splitSummary: split.summary,
  });
  checkBudget();
  const warnings = [
    'Heldout accuracy describes this split only. It is not deployment proof or a claim about general model quality.',
    'Features are normalized in the browser using training rows only; on-chain inference receives the resulting bounded Q8 integers.',
  ];
  if (dataset.source === 'generated') warnings.push('This is generated game-NPC data. Every displayed score is measured again during this run.');
  if (dataset.summary.duplicateRows) warnings.push(`${dataset.summary.duplicateRows} duplicate rows were grouped to prevent identical features crossing splits.`);
  if (split.summary.excludedRows) warnings.push(`${split.summary.excludedRows} validation/test rows were excluded because their normalized Q8 inputs also appeared in an earlier split.`);
  if (!metrics.comparison.beatsSimpleRule) warnings.push('The tiny network did not beat the single-rule baseline on the final holdout.');
  return { model, metrics, splitSummary: split.summary, packedWeightsHex: model.packedWeightsHex, hashes: model.hashes, warnings };
}

/** Explicitly generated numeric game data, never a prefilled performance claim. */
export function generateNpcDataset({ seed = 41, rows = 360 } = {}) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isInteger(rows) || rows < 72 || rows > DATA_LIMITS.maxRows) throw new Error('Generate 72–5000 demo rows with a uint32 seed.');
  const random = seededRandom(seed), targets = [Math.floor(rows / 3), Math.floor(rows / 3), rows - 2 * Math.floor(rows / 3)];
  const counts = [0, 0, 0], examples = [];
  let attempts = 0;
  while (examples.length < rows && attempts++ < rows * 100) {
    const health = Math.round(random() * 1000) / 10, distance = Math.round(random() * 1000) / 10, stamina = Math.round(random() * 1000) / 10;
    const threat = Math.round(random() * 1000) / 10;
    // Interacting thresholds make a single feature rule an intentionally limited baseline.
    const label = health < 24 || (threat > 64 && stamina < 45) ? 2 : distance < 52 && stamina > 27 && health > 38 ? 0 : 1;
    if (counts[label] >= targets[label]) continue;
    examples.push({ features: [health, distance, stamina, threat], label }); counts[label]++;
  }
  if (examples.length !== rows) throw new Error('Demo generation could not fill every class; choose another seed.');
  return validateDataset({ featureNames: ['health', 'distance', 'stamina', 'threat'], labelName: 'action', labels: ['attack', 'patrol', 'retreat'], rows: shuffle(examples, random), source: 'generated' });
}
