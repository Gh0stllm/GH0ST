import { formatUnits, getAddress } from 'ethers';
import { parseCSV, parseCSVRecords, generateNpcDataset, datasetToCSV, predictQuantized, verifyModel } from '../training/core.mjs';
import { escapeHTML as esc, parseFee, same, readableError, downloadFile, EXPLORER } from './core.mjs';
import { ForgeWallet } from './wallet.mjs';
const $=id=>document.getElementById(id),all=selector=>Array.from(document.querySelectorAll(selector));
const STORE='gh0st-forge-model-v1';
const state={dataset:null,csv:null,datasetName:'',model:null,result:null,modelPackage:null,raw:[],trace:null,traceStage:'logits',origin:'Browser preview',training:false,busy:false,requestId:null,worker:null,losses:[],wallet:null,artifact:null,source:null};
const pct=value=>`${(Number(value)*100).toFixed(1)}%`;
const short=value=>value?`${String(value).slice(0,8)}…${String(value).slice(-6)}`:'—';
const pretty=value=>Number(value).toLocaleString(undefined,{maximumFractionDigits:3});
function notice(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);}
function locked(){return state.busy||Boolean(state.wallet?.pending);}
function renderButtons(){
  const w=state.wallet,l=w?.live,lock=locked();
  $('connect').disabled=state.busy;$('connect').innerHTML=w?.wallet?`${esc(short(w.wallet))} <span>↗</span>`:'Connect wallet <span>↗</span>';
  $('load-example').disabled=state.training||lock;$('csv-upload').disabled=state.training||lock;$('label-column').disabled=state.training||lock;
  for(const id of ['hidden-size','epochs','seed'])$(id).disabled=state.training||lock;
  $('train-button').disabled=!state.dataset||state.training||lock;$('train-button').classList.toggle('hidden',state.training);$('cancel-training').classList.toggle('hidden',!state.training);
  $('estimate-deploy').disabled=!state.model||!w?.wallet||!w?.signer||state.training||lock;
  let fee=null;try{fee=parseFee($('prediction-fee').value)}catch{}
  const e=w?.estimate;
  $('deploy-button').disabled=!state.model||!w?.signer||state.training||lock||fee===null||!e||e.modelHash!==state.model.hashes.modelHash||e.fee!==String(fee)||!same(e.wallet,w.wallet)||Date.now()-e.created>300000;
  $('beneficiary').textContent=w?.wallet||'Connect your wallet';$('gas-estimate').textContent=w?.estimateText()||'Estimate after training';
  $('model-name').disabled=state.training||lock;$('prediction-fee').disabled=state.training||lock;
  $('model-upload').disabled=state.training||lock;$('model-address').disabled=state.training||lock;$('creation-hash').disabled=state.training||lock;$('verify-model').disabled=!state.model||state.training||lock;
  $('live-controls').classList.toggle('hidden',!l);
  $('chain-preview').disabled=!l||state.training||lock;
  $('approve-fee').disabled=!l||!l.creationVerified||!w.signer||state.training||lock||l.fee===0n||w.allowance===l.fee;
  $('approve-fee').textContent=l&&w.allowance>0n&&w.allowance!==l.fee?'Reset old allowance':l&&l.fee>0n&&w.allowance===l.fee?'Exact fee approved':'Approve exact fee';
  $('paid-infer').disabled=!l||!l.creationVerified||!w.signer||state.training||lock||(l.fee>0n&&w.allowance!==l.fee)||w.balance<l.fee;
  $('withdraw').disabled=!l||!l.creationVerified||!w.signer||state.training||lock||w.credits===0n;
  $('refresh-model').disabled=!l||state.training||state.busy;$('export-model').disabled=!l||state.training||lock;
  $('resolve-pending').classList.toggle('hidden',!w?.pending);$('resolve-pending').disabled=state.busy;
  all('#sliders input, #reset-inputs, [data-download]').forEach(el=>el.disabled=state.training||lock);
  if(l){
    $('live-id').textContent=l.modelId;$('live-fee').textContent=w.feeText(l.fee);$('live-beneficiary').textContent=l.beneficiary;
    $('wallet-state').textContent=w.wallet?`${short(w.wallet)} · ${w.feeText(w.balance)} available · ${w.feeText(w.allowance)} approved for this model${w.balance<l.fee?' · insufficient GH0ST balance':''}`:'Connect your wallet for recorded predictions and fee claims.';
    $('credits').textContent=w.wallet?`${w.feeText(w.credits)} claimable by ${short(w.wallet)} on this model.`:'Connect your wallet to view credits.';
  }
}
async function action(fn){if(state.busy)return;state.busy=true;renderButtons();try{await fn()}catch(error){notice(`${readableError(error)}${state.wallet?.pending?' A submitted transaction remains unresolved. Use “Check pending transaction” before sending another.':''}`,true)}finally{state.busy=false;renderButtons()}}
function resetModel(){
  state.model=null;state.result=null;state.modelPackage=null;state.trace=null;state.raw=[];
  if(state.wallet){state.wallet.live=null;state.wallet.estimate=null;state.wallet.allowance=0n;state.wallet.balance=0n;state.wallet.credits=0n;}
  $('results').classList.add('hidden');$('playground').classList.add('hidden');$('model-fingerprint').textContent='Train a model to create its fingerprint.';$('live-status').textContent='No deployed model loaded. Browser training needs no wallet.';$('model-address').value='';
}
function drawDataset(){
  const d=state.dataset;if(!d)return;
  $('dataset-info').classList.remove('hidden');$('dataset-name').textContent=state.datasetName;
  $('dataset-shape').textContent=`${d.rows.length} rows · ${d.featureNames.length} inputs`;
  const headers=[...d.featureNames,d.labelName];
  $('dataset-preview').innerHTML=`<table><thead><tr>${headers.map(n=>`<th>${esc(n)}</th>`).join('')}</tr></thead><tbody>${d.rows.slice(0,4).map(r=>`<tr>${r.features.map(n=>`<td>${esc(pretty(n))}</td>`).join('')}<td>${esc(d.labels[r.label])}</td></tr>`).join('')}</tbody></table>`;
  $('dataset-summary').textContent=`${d.labels.length} classes: ${d.labels.join(', ')}. ${d.source==='generated'?'Generated example data. ':''}Showing the first 4 rows. ${d.summary?.duplicateRows||0} duplicate feature rows.`;
  $('training-state').textContent='Ready to train';$('training-message').textContent='Your data is ready.';renderNetwork(d.featureNames.length,Number($('hidden-size').value),d.labels.length);renderButtons();
}
function renderNetwork(input=3,hidden=8,output=3){
  const layers=[input,Math.min(hidden,16),output];
  $('network-dots').innerHTML=layers.map((n,layer)=>`<div>${Array.from({length:n},(_,i)=>`<i style="--n:${layer*4+i}"></i>`).join('')}</div>`).join('');
}
function setLabelOptions(headers,selected){$('label-column').replaceChildren(...headers.map(name=>{const o=document.createElement('option');o.value=name;o.textContent=name;o.selected=name===selected;return o}));}
function acceptDataset(dataset,name,csv=null){resetModel();state.dataset=dataset;state.datasetName=name;state.csv=csv;setLabelOptions(csv?parseCSVRecords(csv)[0].map(s=>s.trim()):[dataset.labelName],dataset.labelName);drawDataset();$('train-progress').value=0;$('epoch-count').textContent=`0 / ${$('epochs').value} EPOCHS`;notice(`${name}: ${dataset.rows.length} rows ready. Training runs only in this browser.`);}
async function loadCSV(file){
  if(!file)return;if(file.size>2_000_000)throw new Error('Choose a CSV smaller than 2 MB.');
  const csv=await file.text(),headers=parseCSVRecords(csv)[0].map(s=>s.trim());
  const candidates=[headers.at(-1),...headers.slice(0,-1)];let dataset,firstError;
  for(const name of candidates){try{dataset=parseCSV(csv,{labelColumn:name});break}catch(error){firstError??=error}}
  if(!dataset){resetModel();state.csv=csv;state.dataset=null;state.datasetName=file.name;setLabelOptions(headers,headers.at(-1));$('dataset-info').classList.remove('hidden');$('dataset-name').textContent=file.name;$('dataset-shape').textContent='Choose label column';$('dataset-preview').replaceChildren();$('dataset-summary').textContent='All other columns must contain finite numeric values.';renderButtons();throw firstError;}
  acceptDataset(dataset,file.name,csv);
}
function startTraining(){
  if(!state.dataset||locked()||state.training)return;
  const seed=Number($('seed').value),epochs=Number($('epochs').value),hiddenSize=Number($('hidden-size').value);
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new Error('Use a whole-number seed between 0 and 4294967295.');
  state.training=true;state.losses=[];state.requestId=crypto.randomUUID();resetModel();
  state.worker=new Worker('./worker.js',{type:'module'});
  state.worker.onmessage=event=>{
    const m=event.data;if(m.requestId!==state.requestId)return;
    if(m.type==='progress')renderProgress(m.progress);
    else if(m.type==='result')finishTraining(m.result);
    else if(m.type==='cancelled'){endTraining();$('training-state').textContent='Stopped';$('training-message').textContent='Training stopped.';notice('Training stopped. No model from this run was exported.');}
    else if(m.type==='error'){endTraining();$('training-state').textContent='Training failed';notice(m.error?.message||'Training could not finish.',true)}
  };
  state.worker.onerror=error=>{endTraining();notice(error.message||'The training worker could not start.',true)};
  state.worker.postMessage({type:'train',requestId:state.requestId,dataset:state.dataset,options:{seed,epochs,hiddenSize}});
  $('training-state').textContent='Training locally';$('training-message').textContent='Learning from training rows…';$('train-progress').value=0;$('train-progress').max=epochs;$('train').classList.add('is-training');renderButtons();notice('Training on this device. Your held-out test rows are reserved until the final epoch.');
}
function endTraining(){state.training=false;state.worker?.terminate();state.worker=null;$('train').classList.remove('is-training');renderButtons()}
function renderProgress(p){
  $('train-progress').value=p.epoch;$('train-progress').max=p.epochs;$('epoch-count').textContent=`${p.epoch} / ${p.epochs} EPOCHS`;
  $('training-message').textContent=`Loss ${Number(p.loss).toFixed(4)} · validation ${pct(p.validationAccuracy)}`;
  state.losses.push([p.epoch,p.loss]);const max=Math.max(...state.losses.map(p=>p[1]),.001);
  const points=state.losses.map(([x,y])=>`${(x/p.epochs*500).toFixed(1)},${(58-y/max*52).toFixed(1)}`).join(' ');
  $('loss-chart').innerHTML=`<path d="M0 63H500" stroke="#34362c"/><polyline points="${points}" fill="none" stroke="#eac18a" stroke-width="1.7"/>`;
}
async function finishTraining(result){
  try{
    await verifyModel(result.model);state.result={...result,measuredAt:new Date().toISOString()};state.model=result.model;state.modelPackage=makePackage();
    endTraining();$('training-state').textContent='Training complete';$('training-message').textContent='Finished. Test split evaluated.';$('train-progress').value=$('train-progress').max;
    setupModel();renderMetrics();saveModel();
    notice(`Training complete. Quantized held-out accuracy ${pct(result.metrics.heldoutAccuracy)} on ${result.splitSummary.testRows} unseen rows. ${result.warnings.join(' ')}`);
    $('results').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(error){endTraining();notice(readableError(error),true)}
}
function makePackage(){return {format:'gh0st-forge-package-v1',name:$('model-name').value.trim()||'My Forge model',model:state.model,report:state.result?{metrics:state.result.metrics,splitSummary:state.result.splitSummary,warnings:state.result.warnings,measuredAt:state.result.measuredAt}:state.modelPackage?.report, deployment:state.wallet?.live?{chainId:4663,address:state.wallet.live.address,modelId:state.wallet.live.modelId,beneficiary:state.wallet.live.beneficiary,fee:String(state.wallet.live.fee),transactionHash:state.wallet.live.transactionHash}:undefined};}
function saveModel(){try{state.modelPackage=makePackage();localStorage.setItem(STORE,JSON.stringify(state.modelPackage))}catch{notice('The model is ready. Browser storage is unavailable; download your package before closing this page.')}}
function setupModel(){
  const model=state.model;state.raw=[...model.normalization.center];$('playground').classList.remove('hidden');renderSliders();renderPreview();
  $('model-fingerprint').innerHTML=`MODEL HASH<br>${esc(model.hashes.modelHash)}<br><br>${model.shape.input} inputs → ${model.shape.hidden} hidden → ${model.shape.output} classes<br>${(model.packedWeightsHex.length-2)/2} bytes of packed int16 weights<br>Dataset commitment: ${esc(short(model.hashes.datasetHash))}`;
  renderButtons();
}
function renderMetrics(){
  const r=state.result,m=r.metrics,s=r.splitSummary;$('results').classList.remove('hidden');$('result-meta').textContent=`${s.testRows} held-out rows · measured in this run`;
  const cells=[['HELD-OUT ACCURACY',pct(m.heldoutAccuracy),'Quantized weights · unseen rows'],['MAJORITY BASELINE',pct(m.baselines.majority.testAccuracy),`Always predict ${m.baselines.majority.label}`],['SINGLE-RULE BASELINE',pct(m.baselines.simpleRule.testAccuracy),`One split on ${m.baselines.simpleRule.feature}`],['Q8 / FLOAT AGREEMENT',pct(m.quantizationAgreement),'Both models on the same test rows']];
  $('metrics').innerHTML=cells.map(([label,value,note])=>`<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`).join('');
  $('confusion').innerHTML=`<table class="confusion-table"><thead><tr><th>ACTUAL ↓ / PREDICTED →</th>${state.model.labels.map(l=>`<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>${m.confusionMatrix.map((row,i)=>`<tr><th>${esc(state.model.labels[i])}</th>${row.map((n,j)=>`<td class="${i===j?'diagonal':''}">${n}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  $('split-summary').textContent=`${s.trainRows} train / ${s.validationRows} validation / ${s.testRows} test. Duplicate inputs stay in the same split. ${s.excludedRows?`${s.excludedRows} validation/test rows excluded to prevent Q8 input overlap. `:''} Training accuracy ${pct(m.trainingAccuracy)} · validation ${pct(m.validationAccuracy)} · held-out float accuracy ${pct(m.floatAccuracy)}. ${m.comparison.beatsSimpleRule?'The neural model beat the single-rule baseline on this test split.':'The neural model did not beat the single-rule baseline on this test split.'}`;
}
function renderSliders(){
  const m=state.model;$('sliders').innerHTML=m.features.map((name,i)=>{const min=m.normalization.minimum[i],max=m.normalization.maximum[i],step=max===min?1:(max-min)/256;return `<div class="feature-control"><label for="feature-${i}">${esc(name)}<output id="feature-value-${i}">${esc(pretty(state.raw[i]))}</output></label><input id="feature-${i}" data-feature="${i}" type="range" min="${min}" max="${max===min?min+1:max}" value="${state.raw[i]}" step="${step}"><div class="feature-bounds"><span>${esc(pretty(min))}</span><span>${esc(pretty(max))}</span></div></div>`}).join('');
  all('[data-feature]').forEach(el=>el.addEventListener('input',()=>{state.raw[Number(el.dataset.feature)]=Number(el.value);$(`feature-value-${el.dataset.feature}`).textContent=pretty(el.value);renderPreview()}));
}
function renderPreview(){if(!state.model)return;state.trace=predictQuantized(state.model,state.raw);state.origin='Browser preview';renderTrace();}
function renderTrace(){
  const t=state.trace;if(!t)return;$('prediction').textContent=state.model.labels[t.classId];$('prediction-origin').textContent=state.origin;
  $('prediction-detail').textContent=`Class ${t.classId} of ${state.model.labels.length} · ${state.model.features.length} numeric inputs → ${state.model.shape.hidden} hidden neurons`;
  const values=t[state.traceStage]||[],labels=state.traceStage==='logits'?state.model.labels:state.traceStage==='normalizedQ8'?state.model.features:values.map((_,i)=>`neuron ${String(i).padStart(2,'0')}`),max=Math.max(...values.map(Math.abs),1);
  $('trace-bars').innerHTML=values.map((v,i)=>`<div class="bar-row ${state.traceStage==='logits'&&i===t.classId?'winner':''}"><span title="${esc(labels[i])}">${esc(labels[i])}</span><span class="bar-track"><i style="--width:${Math.max(0.7,Math.abs(v)/max*100)}%"></i></span><b>${esc(v)}</b></div>`).join('');
}
async function importPackage(pkg,{saved=false}={}){
  const model=pkg.model||pkg;await verifyModel(model);resetModel();state.model=model;state.modelPackage=pkg.model?pkg:{format:'gh0st-forge-package-v1',model};state.result=null;state.dataset=null;state.csv=null;$('dataset-info').classList.add('hidden');$('training-state').textContent='Imported model';$('training-message').textContent='Model package verified.';
  $('model-name').value=String(pkg.name||'Imported Forge model').slice(0,80);setupModel();
  if(pkg.deployment?.chainId===4663&&/^0x[0-9a-fA-F]{40}$/.test(pkg.deployment.address))$('model-address').value=pkg.deployment.address;
  $('creation-hash').value=pkg.deployment?.transactionHash||'';
  notice(`${saved?'Restored the model saved on this device.':'Imported model package verified.'} Scores in an imported report have not been rerun. Load the deployed address to check the on-chain contract.`);
  renderButtons();
}
function replayScript(){
  if(!state.result||!state.dataset)throw new Error('Train in this browser to export a measured held-out replay test.');
  const rows=state.result.splitSummary.testRowIds.map(i=>state.dataset.rows[i]);
  return `// GH0ST Forge independent integer inference replay. Run: node forge-replay.mjs\n// This checks the saved held-out predictions, not a fresh training run.\nimport assert from 'node:assert/strict';\nconst model=${JSON.stringify(state.model)};\nconst rows=${JSON.stringify(rows)};\nfunction predict(raw){const q=raw.map((x,i)=>Math.round(Math.max(-1,Math.min(1,(x-model.normalization.center[i])/model.normalization.scale[i]))*256)||0),w=model.weights,s=model.shape;const hidden=Array.from({length:s.hidden},(_,r)=>Math.max(0,Math.min(32767,Math.trunc(q.reduce((a,x,c)=>a+x*w.hiddenWeights[r*s.input+c],0)/256)+w.hiddenBias[r])));const logits=Array.from({length:s.output},(_,r)=>Math.trunc(hidden.reduce((a,x,c)=>a+x*w.headWeights[r*s.hidden+c],0)/256)+w.headBias[r]);return logits.reduce((best,x,i)=>x>logits[best]?i:best,0)}\nconst matrix=model.labels.map(()=>model.labels.map(()=>0));let correct=0;for(const row of rows){const cls=predict(row.features);matrix[row.label][cls]++;correct+=Number(cls===row.label)}\nassert.deepEqual(matrix,${JSON.stringify(state.result.metrics.confusionMatrix)});assert.equal(correct/rows.length,${state.result.metrics.heldoutAccuracy});\nconsole.log('Integer replay passed:',correct,'/',rows.length,'held-out predictions; accuracy',correct/rows.length);\n`;
}
async function download(kind){
  if(kind==='source')return downloadFile('ForgeModel.sol',state.source,'text/plain');
  if(kind==='artifact')return downloadFile('forge-compiled-contract.json',JSON.stringify(state.artifacts,null,2));
  if(!state.model)throw new Error('Train or import a model first.');
  if(kind==='model')downloadFile('forge-model.json',JSON.stringify(makePackage(),null,2));
  else if(kind==='csv'){if(!state.dataset)throw new Error('The original dataset is unavailable for this imported model.');downloadFile('forge-dataset.csv',datasetToCSV(state.dataset),'text/csv');}
  else if(kind==='test')downloadFile('forge-replay.mjs',replayScript(),'text/javascript');
}
async function loadLive(){
  if(!state.model)throw new Error('Train or import the matching model package first.');
  await verifyModel(state.model);const live=await state.wallet.load($('model-address').value.trim(),state.model,$('creation-hash').value.trim()||null);
  $('live-status').textContent=`Verified ForgeModel at ${live.address}. Runtime, immutable identity, Q8 weights, schema commitments, GH0ST token, fee routing and an exact sample trace match. ${live.creationVerified?'Official creation transaction verified; recorded predictions enabled.':'Add the original deployment transaction to enable recorded predictions. Public read queries are available.'}`;
  saveModel();notice('Deployed model verified. Use the input sliders, then query the public on-chain model. Recording a prediction is optional.');renderButtons();
}
async function received(p,receipt){
  $('receipt').classList.remove('hidden');$('receipt').innerHTML=`<strong>${esc(p.type)} confirmed</strong><br><a href="${EXPLORER}/tx/${receipt.hash}" target="_blank" rel="noopener noreferrer">${receipt.hash} ↗</a><br>Block ${receipt.blockNumber}${p.type==='Record prediction'?` · class ${p.expected.classId} · ${esc(state.wallet.feeText(p.expected.fee))} credited to the model beneficiary`:''}`;
  if(p.type==='Deploy model'){
    state.model=p.expected.modelPackage.model;state.modelPackage=p.expected.modelPackage;state.result=null;setupModel();$('model-address').value=receipt.contractAddress;$('creation-hash').value=receipt.hash;
    $('live-status').textContent=`Your model is deployed and verified at ${receipt.contractAddress}. Its fixed fee is credited to ${p.expected.beneficiary}.`;saveModel();
  }else if(p.type==='Record prediction'&&state.model&&same(state.model.hashes.modelHash,state.wallet.live?.model.hashes.modelHash)){
    state.raw=p.expected.rawFeatures;renderSliders();state.trace={...p.expected.trace,normalizedQ8:p.expected.features};state.origin='Confirmed transaction';renderTrace();
  }
}
async function init(){
  renderNetwork();
  $('load-example').addEventListener('click',()=>action(()=>acceptDataset(generateNpcDataset(),'NPC behavior · generated example')));
  $('csv-upload').addEventListener('change',event=>action(()=>loadCSV(event.target.files[0])));
  const drop=$('dropzone');for(const event of ['dragover','dragenter'])drop.addEventListener(event,e=>{e.preventDefault();if(!locked()&&!state.training)drop.classList.add('dragover')});for(const event of ['dragleave','drop'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.remove('dragover')});drop.addEventListener('drop',e=>{if(!locked()&&!state.training)action(()=>loadCSV(e.dataTransfer.files[0]))});
  $('label-column').addEventListener('change',()=>action(()=>{if(!state.csv)return;const d=parseCSV(state.csv,{labelColumn:$('label-column').value});resetModel();state.dataset=d;drawDataset();notice(`Predicting “${d.labelName}” from ${d.featureNames.length} numeric features.`)}));
  $('hidden-size').addEventListener('change',()=>renderNetwork(state.dataset?.featureNames.length||3,Number($('hidden-size').value),state.dataset?.labels.length||3));
  $('epochs').addEventListener('change',()=>{$('epoch-count').textContent=`0 / ${$('epochs').value} EPOCHS`});
  $('train-button').addEventListener('click',()=>{try{startTraining()}catch(e){notice(readableError(e),true)}});
  $('cancel-training').addEventListener('click',()=>{state.worker?.postMessage({type:'cancel',requestId:state.requestId});$('training-message').textContent='Stopping after the current update…';});
  $('reset-inputs').addEventListener('click',()=>{state.raw=[...state.model.normalization.center];renderSliders();renderPreview()});
  all('[data-trace]').forEach(el=>el.addEventListener('click',()=>{state.traceStage=el.dataset.trace;all('[data-trace]').forEach(b=>b.classList.toggle('active',b===el));renderTrace()}));
  all('[data-download]').forEach(el=>el.addEventListener('click',()=>action(()=>download(el.dataset.download))));
  $('connect').addEventListener('click',()=>action(()=>state.wallet.connect()));
  $('prediction-fee').addEventListener('input',()=>{if(state.wallet)state.wallet.estimate=null;renderButtons()});
  $('model-name').addEventListener('change',()=>{if(state.model)saveModel()});
  $('estimate-deploy').addEventListener('click',()=>action(async()=>{await verifyModel(state.model);await state.wallet.estimateDeploy(state.model,parseFee($('prediction-fee').value));notice('Live deployment estimate ready. The estimate includes a 20% gas limit margin; your wallet shows final network charges. Forge creation fee is 0 GH0ST.')}));
  $('deploy-button').addEventListener('click',()=>action(async()=>{await verifyModel(state.model);await state.wallet.deploy(state.model,parseFee($('prediction-fee').value),makePackage())}));
  $('model-upload').addEventListener('change',event=>action(async()=>{const file=event.target.files[0];if(!file)return;if(file.size>2_000_000)throw new Error('Choose a model package below 2 MB.');await importPackage(JSON.parse(await file.text()));saveModel()}));
  $('verify-model').addEventListener('click',()=>action(loadLive));
  $('chain-preview').addEventListener('click',()=>action(async()=>{const trace=await state.wallet.preview(state.raw);state.trace={...trace,normalizedQ8:predictQuantized(state.model,state.raw).normalizedQ8};state.origin='Verified public read';renderTrace();notice('Public on-chain prediction returned. All integer activations and scores match your local model.');$('playground').scrollIntoView({behavior:'smooth',block:'start'})}));
  $('approve-fee').addEventListener('click',()=>action(()=>state.wallet.approve()));$('paid-infer').addEventListener('click',()=>action(()=>state.wallet.infer([...state.raw])));$('withdraw').addEventListener('click',()=>action(()=>state.wallet.withdraw()));$('refresh-model').addEventListener('click',()=>action(()=>state.wallet.refresh()));$('resolve-pending').addEventListener('click',()=>action(()=>state.wallet.resolve()));$('export-model').addEventListener('click',()=>action(()=>download('model')));
  const [artifacts,source]=await Promise.all([fetch('./artifacts.json').then(r=>{if(!r.ok)throw new Error('Compiled contract could not load.');return r.json()}),fetch('./forgemodel.sol').then(r=>{if(!r.ok)throw new Error('Contract source could not load.');return r.text()})]);
  state.artifacts=artifacts;state.artifact=artifacts.contracts.ForgeModel;state.source=source;state.wallet=new ForgeWallet(state.artifact,{notice,changed:renderButtons,onReceipt:received});
  try{const saved=JSON.parse(localStorage.getItem(STORE));if(saved?.model)await importPackage(saved,{saved:true})}catch(error){notice(`Saved model could not be restored: ${readableError(error)}`,true)}
  if(state.wallet.pending)notice(`A saved ${state.wallet.pending.type.toLowerCase()} transaction is unresolved. Check its receipt before sending another. ${state.wallet.pending.hash}`);
  renderButtons();
}
init().catch(error=>notice(`Forge could not finish loading: ${readableError(error)}`,true));
