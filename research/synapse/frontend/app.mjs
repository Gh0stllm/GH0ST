import { AbiCoder, BrowserProvider, Contract, Interface, JsonRpcProvider, formatUnits, keccak256 } from 'ethers';
import { CHAIN_ID, PUBLIC_RPC, forward, normalizeTrace, assertTrace, assertDeployment, same, checkQuote, verifyInferenceReceipt, tokenize, readableError } from './core.mjs';

const $ = id => document.getElementById(id);
const all = selector => [...document.querySelectorAll(selector)];
const storageKey = 'gh0st-synapse-pending-v1';
const coder = AbiCoder.defaultAbiCoder();
const tokenABI = ['function decimals() view returns(uint8)', 'function symbol() view returns(string)', 'function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)', 'function approve(address,uint256) returns(bool)'];
const state = { config: null, abi: null, model: null, alternate: null, graphIndex: 0, context: [7, 4], trace: null, origin: 'local', stage: 'hidden', verified: false, busy: false, wallet: null, signer: null, walletProvider: null, wrongChain: false, allowance: 0n, balance: 0n, credits: 0n, sequence: [], pending: null };
const short = value => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—';
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const format = value => formatUnits(BigInt(value), state.config.token.decimals).replace(/\.0$/, '');
const currentGraph = () => state.config.graphs[state.graphIndex];
const moduleList = graph => [state.config.backbone, ...graph.expertIds.map(id => state.config.experts.find(expert => expert.id === id))];
const graphContract = (graph, runner = state.provider) => new Contract(graph.address, state.abi.graph, runner);
const explorer = (kind, value) => `${state.config.explorerUrl.replace(/\/$/, '')}/${kind}/${encodeURIComponent(value)}`;
const link = (kind, value, label = short(value)) => `<a href="${escape(explorer(kind, value))}" target="_blank" rel="noopener noreferrer">${escape(label)} ↗</a>`;

function notice(message, isError = false) { $('notice').textContent = message; $('notice').classList.toggle('error', isError); }
function localTrace() { return forward(state.model, state.context, state.graphIndex === 1 ? state.alternate : null); }
function setBusy(busy) { state.busy = busy; document.body.classList.toggle('loading', busy); renderButtons(); }
function renderButtons() {
  const locked = state.busy || Boolean(state.pending);
  for (const id of ['preview', 'generate']) $(id).disabled = locked || !state.verified;
  $('connect').disabled = state.busy;
  $('connect').textContent = state.wrongChain ? 'Switch to Robinhood' : state.wallet ? short(state.wallet) : 'Connect wallet';
  const ready = state.verified && state.wallet && state.signer && !state.wrongChain && !locked;
  const fee = currentGraph() ? BigInt(currentGraph().totalFee) : 0n;
  $('approve').disabled = !ready || state.allowance === fee || fee === 0n;
  $('approve').textContent = state.allowance > 0n && state.allowance !== fee ? 'Reset old allowance' : state.allowance === fee && fee > 0n ? 'Exact fee approved' : 'Approve exact fee';
  $('infer').disabled = !ready || (fee > 0n && state.allowance !== fee) || state.balance < fee;
  $('claim').disabled = !ready || state.credits === 0n;
  $('refresh').disabled = locked || !state.verified;
  $('resolve-pending').classList.toggle('hidden', !state.pending);
  all('[data-graph], [data-prompt], .flow-node, #reset, #apply-prompt, #token-selectors select').forEach(el => el.disabled = state.busy || Boolean(state.pending));
  if (state.config?.graphs.length === 1) $('graph-alternate').disabled = true;
}

function renderResult() {
  const trace = state.trace;
  $('context-display').textContent = `${state.context.map(i => state.model.vocab[i]).join(' · ')} →`;
  $('prediction').textContent = trace.token === 1 ? '〈end〉' : state.model.vocab[trace.token];
  $('token-id').textContent = `TOKEN ${trace.token}${trace.token === 1 ? ' / EOS' : ''}`;
  $('trace-origin').textContent = state.origin === 'chain' ? 'Verified public read' : state.origin === 'paid' ? 'Confirmed paid receipt' : 'Local reference';
  $('sequence').replaceChildren();
  const words = state.sequence.length ? state.sequence : [...state.context, trace.token];
  words.forEach((token, index) => { const el = document.createElement(index === words.length - 1 ? 'strong' : 'span'); el.textContent = `${index ? ' ' : ''}${state.model.vocab[token]}`; $('sequence').append(el); });
  all('#token-selectors select').forEach((select, i) => select.value = state.context[i]);
  renderTrace();
}

function renderTrace() {
  const trace = state.trace;
  if (!trace) return;
  const stage = state.stage;
  const definitions = {
    hidden: ['SHARED BACKBONE / ENCODE', 'The context becomes a vector.', 'Positional token embeddings are added, then clamped to the published activation range.'],
    expert0: ['EXPERT A / FORWARD', 'One learned transformation.', 'This expert applies its own trained matrix and bias to the shared representation. Signed division truncates toward zero.'],
    expert1: [state.graphIndex ? 'ALTERNATE EXPERT / FORWARD' : 'EXPERT B / FORWARD', state.graphIndex ? 'A different expert. A different path.' : 'A second learned transformation.', 'The backbone stays fixed. This separately deployed expert consumes the same representation space.'],
    merged: ['COMPOSITION / MEAN', 'Two outputs become one.', 'Corresponding expert activations are added and divided by two with exact integer arithmetic.'],
    logits: ['SHARED BACKBONE / PROJECT', 'The highest score becomes the token.', 'These are raw integer logits, not probabilities. Greedy decoding selects the largest value; ties use the first token ID.']
  };
  const [label, title, explanation] = definitions[stage];
  $('stage-label').textContent = label; $('stage-title').textContent = title; $('stage-explanation').textContent = explanation;
  all('.flow-node').forEach(node => node.classList.toggle('selected', node.dataset.stage === stage));
  const values = stage === 'expert0' ? trace.expertActivations[0] : stage === 'expert1' ? trace.expertActivations[1] : trace[stage];
  if (stage === 'logits') {
    $('activation-bars').style.display = 'block';
    const sorted = values.map((value, token) => ({ value, token })).sort((a, b) => b.value - a.value);
    const minimum = Math.min(...values), maximum = Math.max(...values), range = maximum - minimum || 1;
    $('activation-bars').innerHTML = sorted.slice(0, 8).map(({ value, token }) => `<div class="logit-row ${token === trace.token ? 'winner' : ''}"><span>${escape(state.model.vocab[token])}</span><span class="track"><i style="--height:${(value - minimum) / range * 100}%"></i></span><b>${value}</b></div>`).join('');
    $('exact-values').textContent = `All logits by token ID: [${values.join(', ')}]`;
  } else {
    const max = Math.max(...values, 1);
    $('activation-bars').style.display = 'grid';
    $('activation-bars').style.gridTemplateColumns = `repeat(${Math.min(values.length, 16)}, 1fr)`;
    $('activation-bars').innerHTML = values.map((value, index) => `<div class="activation"><div><i style="--height:${value / max * 100}%"></i></div><p><span>h${index}</span><span>${value}</span></p></div>`).join('');
    $('exact-values').textContent = `Raw integers: [${values.join(', ')}] · displayed heights normalized to this vector · activation range 0–${state.model.activationMax}`;
  }
}

function setContext(context, phrase = null) {
  state.context = context; state.sequence = []; state.trace = localTrace(); state.origin = 'local';
  if (phrase !== null) $('prompt').value = phrase;
  renderResult();
  if (state.verified) notice('Context updated. Preview calls the verified graph without a transaction.');
}

async function previewContext(context) {
  if (!state.verified) throw new Error('The deployment must pass verification before public preview.');
  const trace = normalizeTrace(await graphContract(currentGraph()).preview(context));
  const reference = forward(state.model, context, state.graphIndex === 1 ? state.alternate : null);
  try { assertTrace(trace, reference); }
  catch (error) { state.verified = false; $('chain-status').textContent = 'Trace verification failed'; $('chain-status').classList.remove('live'); renderButtons(); throw error; }
  return trace;
}

async function verifyLive() {
  assertDeployment(state.config);
  state.provider = new JsonRpcProvider(PUBLIC_RPC, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
  if (Number(BigInt(await state.provider.send('eth_chainId', []))) !== CHAIN_ID) throw new Error('The public RPC returned the wrong network.');
  const checkCode = async item => { if (!same(keccak256(await state.provider.getCode(item.address)), item.codeHash)) throw new Error(`Runtime code mismatch at ${short(item.address)}.`); };
  await Promise.all([state.config.backbone, ...state.config.experts].map(async (module, i) => {
    await checkCode(module);
    const contract = new Contract(module.address, i === 0 ? state.abi.backbone : state.abi.expert, state.provider);
    const [space, weights, beneficiary, fee] = await Promise.all([contract.spaceId(), contract.weightsHash(), contract.beneficiary(), contract.fee()]);
    if (!same(space, module.spaceId) || !same(weights, module.weightsHash) || !same(beneficiary, module.beneficiary) || BigInt(fee) !== BigInt(module.fee)) throw new Error('A module differs from the deployment manifest.');
  }));
  await Promise.all(state.config.graphs.map(async graph => {
    await checkCode(graph);
    const contract = graphContract(graph);
    const [quote, token, backbone] = await Promise.all([contract.quote(), contract.paymentToken(), contract.backbone()]);
    checkQuote(quote, graph);
    if (!same(token, state.config.token.address) || !same(backbone, state.config.backbone.address)) throw new Error('The graph uses an unexpected token or backbone.');
    const modules = moduleList(graph);
    await Promise.all(modules.map(async (module, i) => {
      const [beneficiary, fee, hash] = await Promise.all([contract.beneficiaries(i), contract.fees(i), contract.moduleCodeHashes(i)]);
      if (!same(beneficiary, module.beneficiary) || BigInt(fee) !== BigInt(module.fee) || !same(hash, module.codeHash)) throw new Error('The graph fee routing differs from the manifest.');
      if (i > 0 && !same(await contract.experts(i - 1), module.address)) throw new Error('The graph expert order differs from the manifest.');
    }));
  }));
  const token = new Contract(state.config.token.address, tokenABI, state.provider);
  if (Number(await token.decimals()) !== Number(state.config.token.decimals)) throw new Error('Payment token decimals do not match the manifest.');
  state.verified = true;
  state.trace = await previewContext(state.context); state.origin = 'chain';
  $('chain-status').textContent = 'Robinhood mainnet · verified'; $('chain-status').classList.add('live');
  notice('Mainnet contracts, module identities, fee routing, and this exact integer trace are verified. Preview is free.');
  renderResult(); renderDeployment(); await refreshWallet();
}

function renderDeployment() {
  if (!state.config) return;
  const graph = currentGraph();
  if (!graph) return;
  const fee = BigInt(graph.totalFee);
  $('fee-total').textContent = `${format(fee)} ${state.config.token.symbol}`;
  const modules = moduleList(graph);
  $('fee-rows').innerHTML = modules.map((module, i) => `<tr><td>${escape(i === 0 ? 'Shared backbone' : module.name || `Expert ${i === 1 ? 'A' : 'B'}`)}<br><small>${link('address', module.address)}</small></td><td>${link('address', module.beneficiary)}</td><td>${escape(format(module.fee))} ${escape(state.config.token.symbol)}</td><td>${state.wallet && same(module.beneficiary, state.wallet) ? 'Included below' : '—'}</td></tr>`).join('');
  $('deployment-details').innerHTML = `Network: Robinhood Chain / ${CHAIN_ID}<br>Graph: ${link('address', graph.address, graph.address)}<br>Graph ID: ${escape(graph.graphId)}<br>Payment token: ${link('address', state.config.token.address, state.config.token.address)}<br>Representation space: ${escape(state.config.backbone.spaceId)}<br>Fee cap: ${escape(format(fee))} ${escape(state.config.token.symbol)} / next token<br>Quote deadline: 10 minutes from the latest chain block<br>Confirmation requirement: ${Math.max(1, Number(state.config.confirmations) || 1)}<br>Explorer links expose public blockchain records.`;
  $('proof-links').replaceChildren();
  for (const proof of state.config.proofs || []) { try { const url = new URL(proof.url); if (!['https:', 'http:'].includes(url.protocol)) continue; const a = document.createElement('a'); a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = `${proof.label} ↗`; $('proof-links').append(a); } catch {} }
  if (state.config.repositoryUrl) { try { const url = new URL(state.config.repositoryUrl); if (url.protocol === 'https:') $('source-link').href = url.href; } catch {} }
}

async function refreshWallet() {
  if (!state.verified) return renderButtons();
  checkQuote(await graphContract(currentGraph()).quote(), currentGraph());
  renderDeployment();
  if (state.wallet && !state.wrongChain) {
    const token = new Contract(state.config.token.address, tokenABI, state.provider);
    [state.allowance, state.balance, state.credits] = await Promise.all([token.allowance(state.wallet, currentGraph().address), token.balanceOf(state.wallet), graphContract(currentGraph()).credits(state.wallet)]);
    $('wallet-status').textContent = `${short(state.wallet)} · ${format(state.balance)} ${state.config.token.symbol} available · ${format(state.allowance)} approved for this graph${state.balance < BigInt(currentGraph().totalFee) ? ' · insufficient token balance' : ''}`;
    $('credits-label').textContent = `${format(state.credits)} ${state.config.token.symbol} claimable by ${short(state.wallet)} on this graph.`;
  } else {
    state.allowance = 0n; state.balance = 0n; state.credits = 0n;
    $('wallet-status').textContent = state.wrongChain ? 'Your wallet is on another network. Switch to Robinhood to use the paid path.' : 'Connect a wallet to use the paid path.';
    $('credits-label').textContent = 'Connect a beneficiary wallet to inspect its credits.';
  }
  renderButtons();
}

async function connect() {
  if (!window.ethereum) throw new Error('No Ethereum wallet was found. Open this page in your wallet browser or install an Ethereum wallet.');
  if (state.wrongChain) {
    try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${CHAIN_ID.toString(16)}` }] }); }
    catch (error) { if (Number(error.code) !== 4902) throw error; await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: `0x${CHAIN_ID.toString(16)}`, chainName: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [PUBLIC_RPC], blockExplorerUrls: [state.config.explorerUrl] }] }); }
  }
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  state.wallet = accounts[0] || null;
  state.wrongChain = Number(BigInt(await window.ethereum.request({ method: 'eth_chainId' }))) !== CHAIN_ID;
  if (!state.wrongChain && state.wallet) { state.walletProvider = new BrowserProvider(window.ethereum, undefined, { cacheTimeout: -1 }); state.signer = await state.walletProvider.getSigner(state.wallet); }
  await refreshWallet(); renderButtons();
}

function persistPending(value) {
  state.pending = value;
  try { if (value) localStorage.setItem(storageKey, JSON.stringify(value)); else localStorage.removeItem(storageKey); }
  catch { if (value) notice('A transaction was submitted. Keep this page open while its receipt is checked.', true); }
  renderButtons();
}

async function waitTransaction(tx, type, expected = null) {
  persistPending({ hash: tx.hash, type, graphIndex: state.graphIndex, expected, wallet: state.wallet });
  notice(`${type} submitted. Waiting for ${Math.max(1, Number(state.config.confirmations) || 1)} confirmation(s). ${tx.hash}`);
  const receipt = await tx.wait(Math.max(1, Number(state.config.confirmations) || 1), 120000);
  await acceptReceipt(receipt);
}

async function acceptReceipt(receipt) {
  if (!state.pending) throw new Error('No saved request exists for this receipt.');
  const pending = state.pending;
  if (!same(receipt.hash, pending.hash)) throw new Error('Receipt hash differs from the submitted transaction.');
  if (Number(receipt.status) !== 1) { persistPending(null); throw new Error('The transaction reverted. Network gas may have been spent; the requested action did not complete.'); }
  if (pending.type === 'Paid inference') {
    const token = verifyInferenceReceipt(receipt, pending.expected, log => new Interface(state.abi.graph).parseLog(log));
    state.context = pending.expected.context; state.graphIndex = pending.graphIndex; state.trace = forward(state.model, state.context, state.graphIndex === 1 ? state.alternate : null); state.origin = 'paid'; state.sequence = [...state.context, token]; renderResult();
  } else if (pending.type === 'Credit withdrawal') {
    if (!same(receipt.to, pending.expected.address) || !same(receipt.from, pending.expected.payer)) throw new Error('The withdrawal receipt targets a different graph or beneficiary.');
    const iface = new Interface(state.abi.graph);
    const withdrawals = receipt.logs.filter(log => same(log.address, pending.expected.address)).map(log => { try { return iface.parseLog(log); } catch { return null; } }).filter(event => event?.name === 'Withdrawal');
    if (withdrawals.length !== 1 || !same(withdrawals[0].args.beneficiary, pending.expected.payer) || BigInt(withdrawals[0].args.amount) !== BigInt(pending.expected.amount)) throw new Error('The withdrawal credit does not match the requested claim.');
  } else {
    if (!same(receipt.to, state.config.token.address) || !same(receipt.from, pending.wallet)) throw new Error('The approval receipt targets a different token or wallet.');
  }
  $('receipt').classList.remove('hidden');
  $('receipt').innerHTML = `<strong>${escape(pending.type)} confirmed</strong><p>${link('tx', receipt.hash, receipt.hash)}</p><p>Block ${receipt.blockNumber}${pending.type === 'Paid inference' ? ` · token ${pending.expected.token}: ${escape(state.model.vocab[pending.expected.token])} · ${escape(format(pending.expected.fee))} ${escape(state.config.token.symbol)} credited across all 3 modules` : ''}</p>`;
  persistPending(null); await refreshWallet();
  notice(`${pending.type} confirmed and receipt checked.${pending.type.includes('Approval') ? ' Paid inference still requires a separate click.' : ''}`);
}

async function resolvePending() {
  if (!state.pending) return;
  const receipt = await state.provider.getTransactionReceipt(state.pending.hash);
  if (!receipt) return notice('The transaction is still pending or unavailable from this RPC. No new payment will be sent. Check the transaction in your wallet or explorer.');
  const confirmations = await receipt.confirmations();
  if (confirmations < Math.max(1, Number(state.config.confirmations) || 1)) return notice('The transaction is mined and is waiting for the required confirmations.');
  await acceptReceipt(receipt);
}

async function assertWallet() {
  if (!state.verified || !state.wallet || !state.signer || state.pending) throw new Error('Connect the correct wallet and resolve any pending transaction first.');
  const accounts = await window.ethereum.request({ method: 'eth_accounts' });
  if (!same(accounts[0], state.wallet) || Number(BigInt(await window.ethereum.request({ method: 'eth_chainId' }))) !== CHAIN_ID) throw new Error('The connected wallet or network changed. Reconnect before continuing.');
  return checkQuote(await graphContract(currentGraph()).quote(), currentGraph());
}

async function approve() {
  const quote = await assertWallet();
  const token = new Contract(state.config.token.address, tokenABI, state.signer);
  const current = await token.allowance(state.wallet, currentGraph().address);
  if (current === quote.fee) return refreshWallet();
  const amount = current > 0n ? 0n : quote.fee;
  const tx = await token.approve(currentGraph().address, amount);
  await waitTransaction(tx, amount === 0n ? 'Approval reset' : 'Approval');
}

async function infer() {
  const graph = currentGraph(), quote = await assertWallet();
  await refreshWallet();
  if ((quote.fee > 0n && state.allowance !== quote.fee) || state.balance < quote.fee) throw new Error('Approve exactly the quoted fee and ensure you have enough tokens.');
  const context = [...state.context], trace = await previewContext(context);
  const block = await state.provider.getBlock('latest');
  const deadline = Number(block.timestamp) + 600;
  const iface = new Interface(state.abi.graph);
  const traceType = iface.getFunction('preview').outputs[0];
  const hiddenType = traceType.components.find(part => part.name === 'hidden');
  const contextType = iface.getFunction('inferPaid').inputs[0];
  const modules = moduleList(graph).map((module, i) => ({ ...module, activationHash: i === 0 ? keccak256(coder.encode([hiddenType, 'int256[]'], [trace.hidden, trace.logits])) : keccak256(coder.encode([hiddenType], [trace.expertActivations[i - 1]])) }));
  const expected = { address: graph.address, payer: state.wallet, graphId: quote.graphId, fee: quote.fee.toString(), context, token: trace.token, inputHash: keccak256(coder.encode([contextType], [context])), traceHash: keccak256(coder.encode([traceType], [trace])), modules };
  const tx = await graphContract(graph, state.signer).inferPaid(context, quote.graphId, quote.fee, deadline);
  await waitTransaction(tx, 'Paid inference', expected);
}

async function claim() {
  await assertWallet(); await refreshWallet();
  if (state.credits === 0n) throw new Error('This wallet has no credits in the selected graph.');
  const tx = await graphContract(currentGraph(), state.signer).withdraw();
  await waitTransaction(tx, 'Credit withdrawal', { address: currentGraph().address, payer: state.wallet, amount: state.credits.toString() });
}

async function action(fn) {
  if (state.busy) return;
  setBusy(true);
  try { await fn(); }
  catch (error) { notice(`${readableError(error)}${state.pending ? ' A submitted transaction remains unresolved. Use “Check pending transaction” before another paid action.' : ''}`, true); }
  finally { setBusy(false); }
}

async function initialize() {
  try {
    const raw = {};
    const [config, model, alternate, abi] = await Promise.all(['deployment.json', 'model.json', 'alternate-expert.json', 'abi.json'].map(async file => { const response = await fetch(`./${file}`, { cache: 'no-store' }); if (!response.ok) throw new Error(`Could not load ${file}.`); raw[file] = await response.text(); return JSON.parse(raw[file]); }));
    for (const [file, expected] of [['model.json', config.modelSha256], ['alternate-expert.json', config.alternateExpertSha256]]) {
      if (expected) { const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw[file])))].map(byte => byte.toString(16).padStart(2, '0')).join(''); if (digest !== expected) throw new Error(`The published ${file} hash differs from the deployment manifest.`); }
    }
    Object.assign(state, { config, model, alternate, abi });
    const defaultPrompt = config.defaultPrompt || alternate.demonstration.words.filter(word => word !== '<bos>').join(' ');
    $('prompt').value = defaultPrompt;
    state.context = tokenize(defaultPrompt, model.vocab, model.contextSize).tokens;
    state.trace = localTrace();
    $('model-description').textContent = `A tiny research model. ${model.vocab.length} vocabulary tokens. A ${model.contextSize}-token context. ${model.hiddenSize} hidden activations.`;
    $('research-note').textContent = `This original ${model.metrics?.parameterCount ? `${model.metrics.parameterCount.toLocaleString()}-parameter, ` : ''}${model.vocab.length}-token model demonstrates composable inference with a ${model.contextSize}-token context and ${model.hiddenSize} hidden activations. It makes the complete computation inspectable on-chain.${model.metrics?.heldOut ? ` Held-out next-token accuracy: ${(model.metrics.heldOut.integerTop1Accuracy * 100).toFixed(2)}%; unseen-context accuracy: ${(model.metrics.heldOut.unseenContextIntegerAccuracy * 100).toFixed(2)}%. These are narrow-domain measurements on the same authored grammar.` : ''}`;
    $('trace-scale').textContent = `Q${Math.log2(model.scale)} / SCALE ${model.scale}`;
    $('encode-shape').textContent = `${model.contextSize} tokens → ${model.hiddenSize} values`; $('project-shape').textContent = `${model.hiddenSize} values → ${model.vocab.length} logits`;
    $('vocab').textContent = model.vocab.map((word, i) => `${i}:${word}`).join(' · ');
    $('context-help').textContent = `Only the last ${model.contextSize} tokens are used. Shorter inputs begin with <bos>.`;
    $('token-selectors').innerHTML = state.context.map((token, i) => `<label>POSITION ${i + 1}<select aria-label="Context token ${i + 1}">${model.vocab.map((word, id) => `<option value="${id}" ${id === token ? 'selected' : ''}>${id} · ${escape(word)}</option>`).join('')}</select></label>`).join('');
    all('#token-selectors select').forEach(select => select.addEventListener('change', () => { const context = all('#token-selectors select').map(el => Number(el.value)); setContext(context, context.map(token => model.vocab[token]).join(' ')); }));
    $('token-selectors').style.gridTemplateColumns = `repeat(${Math.min(model.contextSize, 4)},1fr)`;
    const presets = [defaultPrompt, model.vocab.includes('predicts') ? 'the model predicts' : 'ghost builds', 'robinhood is', ''];
    all('[data-prompt]').forEach((button, index) => { button.dataset.prompt = presets[index]; button.textContent = presets[index] || 'from the start'; button.addEventListener('click', () => { try { setContext(tokenize(button.dataset.prompt, model.vocab, model.contextSize).tokens, button.dataset.prompt); } catch (error) { notice(readableError(error), true); } }); });
    const applyPrompt = () => { try { setContext(tokenize($('prompt').value, model.vocab, model.contextSize).tokens); } catch (error) { notice(readableError(error), true); } };
    $('apply-prompt').addEventListener('click', applyPrompt); $('prompt').addEventListener('keydown', event => { if (event.key === 'Enter' && !state.busy && !state.pending) applyPrompt(); });
    all('[data-graph]').forEach((button, index) => button.addEventListener('click', () => action(async () => { state.graphIndex = index; all('[data-graph]').forEach((el, i) => el.classList.toggle('selected', i === index)); $('expert-b-name').textContent = index ? 'Alternate' : 'Transform'; $('expert-b-label').textContent = index ? '03 / EXPERT B′' : '03 / EXPERT B'; state.sequence = []; state.trace = localTrace(); state.origin = 'local'; if (state.verified) { state.trace = await previewContext(state.context); state.origin = 'chain'; await refreshWallet(); } renderResult(); notice((index ? 'One expert changed. The backbone and first expert stay fixed.' : 'The original two experts are selected.') + (state.verified ? ' This is a verified public preview.' : ' These are local reference values; mainnet is not configured.')); })));
    all('[data-stage]').forEach(button => button.addEventListener('click', () => { state.stage = button.dataset.stage; renderTrace(); }));
    $('connect').addEventListener('click', () => action(connect)); $('refresh').addEventListener('click', () => action(refreshWallet));
    $('preview').addEventListener('click', () => action(async () => { state.trace = await previewContext(state.context); state.origin = 'chain'; state.sequence = []; renderResult(); notice('Public preview verified against the exact integer reference. No transaction was sent.'); }));
    $('generate').addEventListener('click', () => action(async () => { let context = [...state.context]; const sequence = [...context]; for (let i = 0; i < 12; i++) { const trace = await previewContext(context); sequence.push(trace.token); state.trace = trace; state.context = [...context]; state.origin = 'chain'; state.sequence = [...sequence]; renderResult(); if (trace.token === 1) { notice(`Sequence reached <eos> after ${i + 1} free read call(s). No transaction was sent.`); return; } context = [...context.slice(1), trace.token]; } notice('Stopped after 12 free read calls. The model did not reach <eos> in that window.'); }));
    $('reset').addEventListener('click', () => setContext(tokenize($('prompt').value, model.vocab, model.contextSize).tokens));
    $('approve').addEventListener('click', () => action(approve)); $('infer').addEventListener('click', () => action(infer)); $('claim').addEventListener('click', () => action(claim)); $('resolve-pending').addEventListener('click', () => action(resolvePending));
    if (window.ethereum?.on) {
      window.ethereum.on('accountsChanged', accounts => { state.wallet = accounts[0] || null; state.signer = null; state.allowance = 0n; state.balance = 0n; notice('Wallet account changed. Reconnect before a paid action.'); renderButtons(); });
      window.ethereum.on('chainChanged', () => { state.wrongChain = true; state.signer = null; state.allowance = 0n; notice('Wallet network changed. Reconnect on Robinhood before a paid action.'); renderButtons(); });
    }
    renderResult(); renderButtons();
    try { const pending = JSON.parse(localStorage.getItem(storageKey)); if (pending?.hash && pending.graphIndex < config.graphs.length) { state.pending = pending; state.graphIndex = pending.graphIndex; renderButtons(); } } catch {}
    if (config.status !== 'live') { $('chain-status').textContent = 'Mainnet manifest pending'; notice('Deployment is not configured. The displayed computation is the published local integer reference. Mainnet preview and paid actions remain disabled.'); return; }
    setBusy(true); await verifyLive(); if (state.pending) notice('A prior submitted transaction is unresolved. Use “Check pending transaction” before any paid action.');
  } catch (error) { state.verified = false; $('chain-status').textContent = 'Verification unavailable'; notice(readableError(error), true); }
  finally { setBusy(false); }
}

initialize();
