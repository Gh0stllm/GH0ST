export const CHAIN_ID = 4663;
export const TOKEN_ADDRESS = '0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559';
export const PUBLIC_RPC = 'https://rpc.mainnet.chain.robinhood.com';
export const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

export function forward(model, tokens, alternate = null) {
  if (tokens.length !== model.contextSize || tokens.some(t => !Number.isInteger(t) || t < 0 || t >= model.vocab.length)) throw new Error(`Choose exactly ${model.contextSize} vocabulary tokens.`);
  const w = model.hiddenSize;
  const activate = n => Math.max(0, Math.min(model.activationMax, n));
  const hidden = Array.from({ length: w }, (_, j) => activate(tokens.reduce((sum, token, position) => sum + (model.embeddings ? model.embeddings[(position * model.vocab.length + token) * w + j] : model[`embedding${position}`][token * w + j]), 0)));
  const expertActivations = model.experts.map((original, i) => {
    const expert = alternate && i === alternate.replaceExpertIndex ? alternate : original;
    return Array.from({ length: w }, (_, row) => activate(Math.trunc(hidden.reduce((sum, h, j) => sum + expert.weights[row * w + j] * h, 0) / model.scale) + expert.bias[row]));
  });
  const merged = hidden.map((_, i) => Math.trunc((expertActivations[0][i] + expertActivations[1][i]) / 2));
  const logits = model.vocab.map((_, row) => Math.trunc(merged.reduce((sum, h, j) => sum + model.headWeights[row * w + j] * h, 0) / model.scale) + model.headBias[row]);
  const token = logits.reduce((best, value, i) => value > logits[best] ? i : best, 0);
  return { hidden, expertActivations, merged, logits, token };
}

export function normalizeTrace(trace) {
  return { hidden: Array.from(trace.hidden, Number), expertActivations: Array.from(trace.expertActivations, row => Array.from(row, Number)), merged: Array.from(trace.merged, Number), logits: Array.from(trace.logits, Number), token: Number(trace.token) };
}

export function assertTrace(actual, expected) {
  if (JSON.stringify(normalizeTrace(actual)) !== JSON.stringify(normalizeTrace(expected))) throw new Error('The chain trace does not match the published integer reference. Paid actions are disabled.');
}

export function assertDeployment(config) {
  if (config.status !== 'live') throw new Error('Mainnet deployment is not configured.');
  if (Number(config.chainId) !== CHAIN_ID || !same(config.token?.address, TOKEN_ADDRESS)) throw new Error('Unexpected network or payment token in the deployment manifest.');
  if (config.rpcUrl && config.rpcUrl !== PUBLIC_RPC) throw new Error('The browser accepts only the public Robinhood RPC.');
  try { if (new URL(config.explorerUrl).protocol !== 'https:') throw new Error(); } catch { throw new Error('The explorer must be a public HTTPS URL.'); }
  if (!config.backbone || config.experts.length < 2 || !config.graphs?.length) throw new Error('The deployment manifest is incomplete.');
  for (const module of [config.backbone, ...config.experts]) {
    for (const key of ['address', 'spaceId', 'weightsHash', 'codeHash', 'beneficiary', 'fee']) if (module[key] == null) throw new Error(`Missing module ${key}.`);
  }
  for (const graph of config.graphs) {
    for (const key of ['address', 'graphId', 'totalFee', 'codeHash', 'expertIds']) if (graph[key] == null) throw new Error(`Missing graph ${key}.`);
    if (graph.expertIds.length !== 2 || graph.expertIds[0] === graph.expertIds[1] || graph.expertIds.some(id => !config.experts.some(e => e.id === id))) throw new Error('Invalid graph expert composition.');
  }
}

export function checkQuote(quote, graph) {
  if (!same(quote[0], graph.graphId) || BigInt(quote[1]) !== BigInt(graph.totalFee)) throw new Error('The graph quote differs from the verified manifest.');
  return { graphId: quote[0], fee: BigInt(quote[1]) };
}

export function verifyInferenceReceipt(receipt, expected, parseLog) {
  if (Number(receipt.status) !== 1 || !same(receipt.to, expected.address) || !same(receipt.from, expected.payer)) throw new Error('The transaction did not succeed for this graph and wallet.');
  const logs = receipt.logs.filter(log => same(log.address, expected.address)).map(log => { try { return parseLog(log); } catch { return null; } }).filter(Boolean);
  const inferences = logs.filter(log => log.name === 'Inference');
  if (inferences.length !== 1) throw new Error('Expected exactly one Inference receipt.');
  const e = inferences[0].args;
  if (!same(e.payer, expected.payer) || !same(e.graphId, expected.graphId) || Number(e.token) !== expected.token || !same(e.inputHash, expected.inputHash) || !same(e.traceHash, expected.traceHash) || BigInt(e.fee) !== BigInt(expected.fee)) throw new Error('The Inference receipt does not match the approved request.');
  const used = logs.filter(log => log.name === 'ModuleUsed');
  if (used.length !== 3) throw new Error('The receipt is missing module payment credits.');
  for (const module of expected.modules) {
    const matches = used.filter(log => same(log.args.module, module.address));
    if (matches.length !== 1) throw new Error('The module receipt is ambiguous.');
    const m = matches[0].args;
    if (!same(m.graphId, expected.graphId) || !same(m.beneficiary, module.beneficiary) || BigInt(m.fee) !== BigInt(module.fee) || !same(m.activationHash, module.activationHash)) throw new Error('A module payment credit differs from the approved graph.');
  }
  return Number(e.token);
}

export function tokenize(text, vocab, contextSize = 2) {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const unknown = words.filter(word => !vocab.includes(word));
  if (unknown.length) throw new Error(`Outside this tiny vocabulary: ${[...new Set(unknown)].join(', ')}. Choose a preset or use the token selectors.`);
  const tokens = words.map(word => vocab.indexOf(word));
  const bos = Math.max(0, vocab.indexOf('<bos>'));
  return { tokens: [...Array(contextSize).fill(bos), ...tokens].slice(-contextSize), words };
}

export function readableError(error) {
  const code = error?.code ?? error?.info?.error?.code;
  if (code === 4001 || code === 'ACTION_REJECTED') return 'Request declined in your wallet. No further action was sent.';
  if (code === 'INSUFFICIENT_FUNDS') return 'Your wallet needs enough tokens for the fee and ETH for network gas.';
  if (code === 'TRANSACTION_REPLACED') return 'The transaction was replaced. Check your wallet and explorer before sending again.';
  return String(error?.shortMessage || error?.reason || error?.message || 'The request could not be completed.').slice(0, 320);
}
