# Browser training core

This is a small numeric classifier, not an LLM or a general model importer. The browser keeps CSV rows in memory, trains in a dedicated worker, evaluates a fixed final holdout, and exports a JSON package. Training makes no network requests and requires no training service or local installation. The site bundles the `ethers` cryptographic helpers; there are no machine-learning dependencies.

## CSV limits

Use a header, 1–8 finite numeric feature columns, and one class column (the last column by default). There must be 2–4 short class names and at least 12 different feature vectors per class. Limits: 5,000 rows, 2 MB, absolute numeric values at most 1e12. Missing values, text features, NaN/Infinity, malformed quoting, contradictory exact duplicates, private-key-like values, and credential column names are rejected. Do not upload personal information or secrets. Secret-pattern checks are a narrow rejection filter, not an assurance that every possible secret can be identified.

Quoted fields, escaped quotes, LF/CRLF, and a UTF-8 BOM are supported. Every non-label column must be numeric; the core does not silently discard unsupported columns.

## APIs

```js
import {
  parseCSV, generateNpcDataset, datasetToCSV,
  trainModel, predictQuantized, inferQuantized, verifyModel,
} from './core.mjs';

const dataset = parseCSV(csvText, { labelColumn: 'action' });
// Or generate an explicitly synthetic, balanced numeric NPC example:
const demo = generateNpcDataset({ seed: 41, rows: 360 });
const result = await trainModel(dataset, {
  seed: 42, epochs: 100, hiddenSize: 8, learningRate: .025, batchSize: 32,
}, {
  onProgress: ({ epoch, epochs, loss, trainingAccuracy, validationAccuracy }) => {},
  shouldCancel: () => false,
});
const trace = predictQuantized(result.model, [70, 20, 80, 30]);
// trace = {classId,label,normalizedQ8,hidden,logits}
await verifyModel(result.model);
```

`parseCSV` returns `{featureNames,labelName,labels,rows:[{features,label}],source,summary}`. `label` is a zero-based class index. `datasetToCSV` exports a valid dataset without performance claims.

The website should create the bundled `train-worker.mjs` as a module worker. Send `{type:'train',requestId,dataset,options}`. Responses use the same request ID and are:

- `{type:'progress',requestId,progress:{epoch,epochs,loss,trainingAccuracy,validationAccuracy}}`.
- `{type:'result',requestId,result}`.
- `{type:'error',requestId,error:{name,message}}`.
- `{type:'cancelled',requestId}` after `{type:'cancel',requestId}`.

A second concurrent train request is rejected. Cancellation yields control during training and never returns a completed model for the cancelled job. Worker termination is also safe. Limits are 300 epochs, 16 hidden units, 50,000 updates and two minutes per run. Progress scores describe the current floating-point training weights; all final primary accuracy fields describe the quantized exported model.

## Leakage controls and measured results

Stratification groups exact raw feature duplicates before a seeded 70/15/15 split (at least two validation/test groups per class). Each feature's center and scale are fitted from training rows only. Values are clipped to `[-1,1]` and rounded to Q8 integers `[-256,256]` before training. Distinct raw rows can become identical Q8 model inputs: validation rows matching training inputs are excluded, and test rows matching training or retained validation inputs are excluded. At least two distinct retained Q8 vectors per class must remain in both holdouts, otherwise the run fails with an explanation. The exported split summary accounts for excluded rows and lists every partition's original zero-based row IDs. `classCounts` counts rows; `uniqueQ8ClassCounts` separately counts independent normalized inputs.

Adam trains for exactly the requested epoch count. Validation is reported but does not choose weights or stop training. Final test scores are calculated after the last update. Majority and one-feature threshold baselines are fitted only on training rows and evaluated on the same retained holdouts. The confusion matrix has true classes as rows and predicted classes as columns. Floating-point and quantized test accuracy and their prediction agreement are reported separately, using the same normalized Q8 inputs.

The result is `{model,metrics,splitSummary,packedWeightsHex,hashes,warnings}`. Its model includes the measured evaluation and split recipe; it includes no source dataset rows. Reported scores describe one dataset split and are not a deployment receipt or general-quality claim. The generated game data has no prefilled benchmark score.

## Numeric format and commitments

The architecture is one affine hidden layer with ReLU and a linear classification head. Weight matrices are flat, output-major arrays. All weights/biases are signed int16 Q8. The hidden layer computes `clip(trunc(sum(weight*input)/256)+bias,0,32767)`. The head computes `trunc(sum(weight*hidden)/256)+bias`. Division truncates toward zero, and equal logits select the lowest class index. Hidden activations are int16-bounded; final logits can exceed int16 and remain exact JavaScript integers within this architecture's bound.

`model.weights` contains `hiddenWeights`, `hiddenBias`, `headWeights`, `headBias`. Packed bytes concatenate those arrays in that order, signed int16, big-endian. `model.shape` is `{input,hidden,output}`. `inferQuantized(model,q8Inputs)` skips raw-feature normalization but validates shape and range. `predictQuantized` normalizes raw feature values first.

`featureSchemaHash`, `labelsHash`, and `datasetHash` are SHA-256 commitments to canonical JSON with sorted object keys. The feature schema includes feature names and every train-fitted normalization parameter. The dataset commitment includes feature names, label column, label mapping, and original row order. `weightsHash` is Keccak-256 of the packed bytes. `modelHash` matches the runtime contract exactly:

```text
keccak256(abi.encode(
  keccak256(UTF8("GH0ST_FORGE_NUMERIC_MLP_Q8_V1")),
  uint8(input), uint8(hidden), uint8(output),
  featureSchemaHash, labelsHash, datasetHash, weightsHash
))
```

`verifyModel` checks the fixed format, supported dimensions, numeric arrays, normalization, and all supplied commitments. It cannot verify omitted dataset rows or turn imported accuracy into a fresh evaluation. A changed normalization, feature order, label mapping, weight or commitment fails verification. Training settings and evaluation reports are exported for review but are not fields in the runtime's model hash.

Run focused checks with `node --test training/*.test.mjs` from `research/forge`.
