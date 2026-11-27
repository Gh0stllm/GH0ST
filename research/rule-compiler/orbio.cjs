// Usage: node orbio.cjs path/to/approved.rule [path/to/new-candidate.json]
'use strict';
const { createHash } = require('node:crypto');
const { access, readFile, stat, writeFile } = require('node:fs/promises');
const { parse, evaluate } = require('./compiler.cjs');
const { readBoundedJson } = require('./orbio-response.cjs');

const ENDPOINT = 'https://api.orbio.so/api/v1/chat/completions';
const MODEL = 'anthropic/claude-sonnet-4.5';
const MAX_SOURCE = 2048;
const sha256 = text => createHash('sha256').update(text).digest('hex');
const prompt = [
  'Optimize one small unsigned integer expression for fewer EVM operations.',
  'Input variables qty and tier independently range from 0 through 255.',
  'Expressions use uint32 integer literals, qty, tier, +, *, /, numeric == inside conditions,',
  'parentheses, and if CONDITION then EXPRESSION else EXPRESSION. Division floors.',
  'All intermediate expressions must stay within uint32 and divisors must always be nonzero.',
  'Preserve every output, especially integer rounding. Never assume a tier is limited to a few values.',
  'Return only a JSON object with one field named expression containing your proposed expression.',
  'If no useful rewrite is available, return the original expression. No code, tools, or commentary.'
].join(' ');

function checkedSource(input) {
  if(typeof input !== 'string' || Buffer.byteLength(input) > MAX_SOURCE ||
      !/^[0-9A-Za-z\s()+*/=]+$/.test(input)) {
    throw Error('Rule must be a supported integer expression of at most 2048 bytes.');
  }
  const tree = parse(input);
  return { source:input, tree };
}

function sameExpression(original, candidate) {
  return original.replace(/\s/g, '') === candidate.replace(/\s/g, '');
}

function verifyProposal(original, candidate) {
  const a = checkedSource(original), b = checkedSource(candidate);
  if(sameExpression(a.source, b.source)) throw Error('The proposal repeats the original rule.');
  const digest = createHash('sha256');
  const row = Buffer.alloc(256 * 4);
  for(let qty = 0; qty < 256; qty++) {
    for(let tier = 0; tier < 256; tier++) {
      const before = evaluate(a.tree, qty, tier), after = evaluate(b.tree, qty, tier);
      if(before !== after) throw Error(`Output mismatch at qty=${qty}, tier=${tier}: expected ${before}, got ${after}.`);
      row.writeUInt32BE(before, tier * 4);
    }
    digest.update(row);
  }
  return {
    originalSha256: sha256(a.source), candidate: b.source, candidateSha256: sha256(b.source),
    evidence: { kind: 'finite-domain-interpreter-equivalence', domain: {qty:[0,255],tier:[0,255]},
      checkedInputs: 65536, outputOrder: 'qty then tier ascending, uint32 big endian', outputSha256: digest.digest('hex') },
    gas: 'unmeasured'
  };
}

async function requestProposal(original, send = fetch) {
  const {source} = checkedSource(original);
  const key = process.env.ORBIO_API_KEY;
  if(!key || /\s/.test(key)) throw Error('Set ORBIO_API_KEY in the calling environment.');
  const response = await send(ENDPOINT, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000),
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({model:MODEL, max_tokens:320, messages:[
      {role:'system',content:prompt}, {role:'user',content:JSON.stringify({expression:source})}
    ]})
  });
  const body = await readBoundedJson(response);
  const content = body?.choices?.[0]?.message?.content;
  if(typeof content !== 'string' || Buffer.byteLength(content)>MAX_SOURCE+256) throw Error('Orbio returned an invalid candidate.');
  let proposal;
  try { proposal = JSON.parse(content); } catch { throw Error('Orbio did not return the requested JSON object.'); }
  if(!proposal || Object.keys(proposal).length!==1 || !Object.hasOwn(proposal,'expression')) {
    throw Error('Orbio returned an unexpected candidate format.');
  }
  const usage = {};
  for(const n of ['prompt_tokens','completion_tokens','total_tokens']) {
    if(Number.isSafeInteger(body.usage?.[n]) && body.usage[n]>=0) usage[n]=body.usage[n];
  }
  const metadata = { provider:'Orbio', requestedModel:MODEL, usage };
  if (typeof proposal.expression === 'string' && sameExpression(source, proposal.expression)) {
    checkedSource(proposal.expression);
    return { kind:'unchanged', ...metadata, originalSha256:sha256(source) };
  }
  return { kind:'reviewable-proposal', ...metadata, ...verifyProposal(source, proposal.expression) };
}

async function main() {
  const [file,output,...extra] = process.argv.slice(2);
  if(!file||extra.length) throw Error('Usage: node orbio.cjs approved.rule [new-candidate.json]');
  if(output) {
    try { await access(output); throw Error('Choose a fresh candidate file.'); }
    catch(e) { if(e.code!=='ENOENT') throw e; }
  }
  const info = await stat(file);
  if(!info.isFile() || info.size>MAX_SOURCE) throw Error('Input must be a rule file of at most 2048 bytes.');
  const result = await requestProposal(await readFile(file,'utf8'));
  const json = JSON.stringify(result,null,2)+'\n';
  if(output) await writeFile(output,json,{flag:'wx',mode:0o600}); else process.stdout.write(json);
}
module.exports={verifyProposal,requestProposal};
if(require.main===module) main().catch(e=>{console.error(e.message);process.exitCode=1;});
