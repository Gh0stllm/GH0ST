export const DATA_LIMITS = Object.freeze({
  maxBytes: 2_000_000, maxRows: 5000, maxFeatures: 8, maxClasses: 4,
  minClasses: 2, minUniqueRowsPerClass: 12, maxMagnitude: 1e12,
});

const SENSITIVE_HEADER = /(?:^|[\s_.-])(?:password|passwd|secret|private[\s_.-]*key|api[\s_.-]*key|access[\s_.-]*token|auth[\s_.-]*token|mnemonic|seed[\s_.-]*phrase|recovery[\s_.-]*phrase|credential)(?:$|[\s_.-])/i;
const SECRET_VALUE = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{16,}|\b0x[a-fA-F0-9]{64}\b)/;
const NAME = /^[A-Za-z_][A-Za-z0-9_. -]{0,47}$/;
const LABEL = /^[A-Za-z0-9_][A-Za-z0-9_. -]{0,31}$/;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function safeName(value, purpose) {
  if (typeof value !== 'string' || !NAME.test(value) || SENSITIVE_HEADER.test(value)) {
    throw new Error(`${purpose} must be a short ordinary column name. Credentials and secret fields are not supported.`);
  }
  return value;
}

function safeLabel(value) {
  if (typeof value !== 'string' || !LABEL.test(value) || SENSITIVE_HEADER.test(value) || SECRET_VALUE.test(value)) {
    throw new Error('Class labels must be short names or numbers, not free text or secrets.');
  }
  return value;
}

function safeNumber(value, row, column) {
  const trimmed = value.trim();
  if (!NUMBER.test(trimmed)) throw new Error(`Row ${row}, column ${column}: expected a finite number. Empty cells, text, NaN and Infinity are not supported.`);
  const number = Number(trimmed);
  if (!Number.isFinite(number) || Math.abs(number) > DATA_LIMITS.maxMagnitude) {
    throw new Error(`Row ${row}, column ${column}: number must be finite and within ±${DATA_LIMITS.maxMagnitude}.`);
  }
  return Object.is(number, -0) ? 0 : number;
}

/** Strict RFC-4180-style records, including quoted commas and escaped quotes. */
export function parseCSVRecords(text) {
  if (typeof text !== 'string' || text.length === 0) throw new Error('Choose a non-empty CSV file.');
  if (new TextEncoder().encode(text).length > DATA_LIMITS.maxBytes) throw new Error('CSV exceeds the 2 MB browser limit.');
  if (SECRET_VALUE.test(text)) throw new Error('This file appears to contain a credential or private key. Remove secret data before using Forge.');
  text = text.replace(/^\uFEFF/, '');
  const records = [];
  let record = [], value = '', quoted = false, closed = false;
  const finishField = () => { record.push(value); value = ''; closed = false; };
  const finishRecord = () => { finishField(); records.push(record); record = []; };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { value += '"'; index++; }
        else { quoted = false; closed = true; }
      } else value += char;
    } else if (char === '"') {
      if (value !== '' || closed) throw new Error('Malformed CSV: a quote must start a field.');
      quoted = true;
    } else if (char === ',') finishField();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      finishRecord();
    } else if (closed) {
      if (char !== ' ' && char !== '\t') throw new Error('Malformed CSV: unexpected text after a closing quote.');
    } else value += char;
    if (records.length > DATA_LIMITS.maxRows + 1) throw new Error(`CSV exceeds ${DATA_LIMITS.maxRows} rows.`);
  }
  if (quoted) throw new Error('Malformed CSV: unclosed quoted field.');
  if (value !== '' || record.length || closed) finishRecord();
  if (records.length < 2) throw new Error('CSV needs a header and data rows.');
  return records;
}

export function parseCSV(text, { labelColumn, featureColumns } = {}) {
  const records = parseCSVRecords(text);
  const header = records[0].map((cell) => cell.trim());
  if (header.length < 2 || header.length > DATA_LIMITS.maxFeatures + 1) throw new Error('Use 1–8 numeric feature columns and one class label column.');
  header.forEach((name) => safeName(name, 'Header'));
  if (new Set(header).size !== header.length) throw new Error('CSV column names must be unique.');
  const chosenLabel = labelColumn ?? header[header.length - 1];
  const labelIndex = header.indexOf(chosenLabel);
  if (labelIndex < 0) throw new Error('Selected label column was not found.');
  const features = featureColumns ?? header.filter((name) => name !== chosenLabel);
  if (!Array.isArray(features) || features.length !== header.length - 1 || new Set(features).size !== features.length || features.some((name) => name === chosenLabel || !header.includes(name))) {
    throw new Error('Every non-label column must be selected as a numeric feature. Remove unsupported columns from the CSV.');
  }
  const indexes = features.map((name) => header.indexOf(name));
  const values = records.slice(1).map((cells, index) => {
    if (cells.length !== header.length) throw new Error(`Row ${index + 2}: expected ${header.length} cells.`);
    const label = safeLabel(cells[labelIndex].trim());
    return { features: indexes.map((column) => safeNumber(cells[column], index + 2, column + 1)), label };
  });
  const labels = [...new Set(values.map((row) => row.label))].sort();
  return validateDataset({
    featureNames: features, labelName: chosenLabel, labels,
    rows: values.map((row) => ({ features: row.features, label: labels.indexOf(row.label) })), source: 'csv',
  });
}

/** Revalidate structured worker messages; never trust a parsed object supplied by a caller. */
export function validateDataset(dataset) {
  if (!dataset || typeof dataset !== 'object' || !Array.isArray(dataset.featureNames) || !Array.isArray(dataset.labels) || !Array.isArray(dataset.rows)) throw new Error('Unsupported dataset shape. Upload a numeric CSV.');
  const featureNames = [...dataset.featureNames];
  if (featureNames.length < 1 || featureNames.length > DATA_LIMITS.maxFeatures) throw new Error('Use 1–8 numeric features.');
  featureNames.forEach((name) => safeName(name, 'Feature'));
  if (new Set(featureNames).size !== featureNames.length) throw new Error('Feature names must be unique.');
  const labelName = safeName(dataset.labelName ?? 'label', 'Label column');
  if (featureNames.includes(labelName)) throw new Error('Label column cannot also be a feature.');
  const labels = [...dataset.labels];
  if (labels.length < DATA_LIMITS.minClasses || labels.length > DATA_LIMITS.maxClasses || new Set(labels).size !== labels.length) throw new Error('Use 2–4 distinct classes.');
  labels.forEach(safeLabel);
  if (dataset.rows.length > DATA_LIMITS.maxRows || dataset.rows.length === 0) throw new Error(`Use at most ${DATA_LIMITS.maxRows} non-empty rows.`);
  const rows = dataset.rows.map((row, index) => {
    if (!row || !Array.isArray(row.features) || row.features.length !== featureNames.length || !Number.isInteger(row.label) || row.label < 0 || row.label >= labels.length) throw new Error(`Row ${index + 1}: unsupported feature or label shape.`);
    if (row.features.some((value) => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > DATA_LIMITS.maxMagnitude)) throw new Error(`Row ${index + 1}: features must be finite numbers within ±${DATA_LIMITS.maxMagnitude}.`);
    return { features: row.features.map((value) => Object.is(value, -0) ? 0 : value), label: row.label };
  });
  const groups = new Map();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index], key = JSON.stringify(row.features);
    if (groups.has(key) && groups.get(key).label !== row.label) throw new Error(`Row ${index + 1}: identical features have conflicting labels. Resolve contradictory rows first.`);
    if (!groups.has(key)) groups.set(key, { label: row.label, count: 0 });
    groups.get(key).count++;
  }
  const uniqueClassCounts = labels.map((_, label) => [...groups.values()].filter((group) => group.label === label).length);
  if (uniqueClassCounts.some((count) => count < DATA_LIMITS.minUniqueRowsPerClass)) throw new Error(`Each class needs at least ${DATA_LIMITS.minUniqueRowsPerClass} different feature rows for separate train, validation and test splits.`);
  return {
    featureNames, labelName, labels, rows, source: dataset.source === 'generated' ? 'generated' : 'csv',
    summary: { rows: rows.length, features: featureNames.length, classes: labels.length, classCounts: labels.map((_, label) => rows.filter((row) => row.label === label).length), uniqueClassCounts, uniqueFeatureRows: groups.size, duplicateRows: rows.length - groups.size },
  };
}

export function datasetToCSV(dataset) {
  const checked = validateDataset(dataset);
  const quote = (value) => /[",\r\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value);
  return [
    [...checked.featureNames, checked.labelName].map(quote).join(','),
    ...checked.rows.map((row) => [...row.features, checked.labels[row.label]].map(quote).join(',')),
  ].join('\n') + '\n';
}
