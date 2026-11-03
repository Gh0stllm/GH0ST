const ADDRESS = /^0x[0-9a-f]{40}$/i;
const COMMIT = /^[0-9a-f]{40}$/;
const MAX_README = 256 * 1024;

export function repositoryPath(text) {
  let url;
  try { url = new URL(text.trim()); } catch { throw new Error('Enter a public repository URL such as https://github.com/owner/project.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash)
    throw new Error('Use the HTTPS repository homepage on github.com.');
  const match = /^\/([a-z0-9][a-z0-9-]{0,38})\/([a-z0-9_.-]{1,100})\/?$/i.exec(url.pathname);
  if (!match) throw new Error('Paste the repository homepage, without a branch, file or directory path.');
  const name = match[2].replace(/\.git$/i, '');
  if (!name || name==='.' || name==='..') throw new Error('The repository name is invalid.');
  return match[1] + '/' + name;
}

export function addressLine(markdown, address) {
  if (!ADDRESS.test(address)) throw new Error('Scan a valid contract address first.');
  const word = new RegExp('(?:^|[^a-z0-9_])' + address + '(?=$|[^a-z0-9_])', 'i');
  const line = markdown.split('\n').findIndex(text => word.test(text));
  return line < 0 ? null : line + 1;
}

async function githubJson(url, signal, limit, missingMessage) {
  const response = await fetch(url, {
    signal, credentials: 'omit', redirect: 'error', headers: {Accept: 'application/vnd.github+json'}
  });
  if (response.status === 404) throw new Error(missingMessage);
  if (response.status === 403 || response.status === 429) throw new Error('GitHub limited or denied this lookup. Try again later.');
  if (!response.ok) throw new Error('GitHub could not complete this lookup. Try again later.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, text = '';
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > limit) {
        await reader.cancel();
        throw new Error('The GitHub response exceeds the lookup size limit. Open the repository to inspect it.');
      }
      text += decoder.decode(value,{stream:true});
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}

export async function checkReadme(url, address) {
  const repo = repositoryPath(url);
  const endpoint = 'https://api.github.com/repos/' + repo;
  const signal = AbortSignal.timeout(15000);
  const metadata = await githubJson(endpoint,signal,48*1024,'Repository unavailable. Check its name and public visibility.');
  if (typeof metadata.default_branch !== 'string' || !metadata.default_branch)
    throw new Error('GitHub did not report a default branch.');
  const branchPath = metadata.default_branch.split('/').map(encodeURIComponent).join('/');
  const ref = await githubJson(endpoint+'/git/ref/heads/'+branchPath,signal,12*1024,'The default branch could not be resolved.');
  const sha = ref.object?.sha;
  if (ref.object?.type !== 'commit' || !COMMIT.test(sha)) throw new Error('GitHub did not return a commit for the default branch.');
  const readme = await githubJson(endpoint+'/readme?ref='+sha,signal,Math.ceil(MAX_README*1.6)+8192,'No default README was returned for this commit.');
  if (readme.type !== 'file' || readme.encoding !== 'base64' || !Number.isSafeInteger(readme.size) ||
      readme.size < 0 || readme.size > MAX_README || typeof readme.content !== 'string')
    throw new Error('This lookup supports README files up to 256 KiB.');
  if (typeof readme.path !== 'string' || !readme.path || readme.path.split('/').some(s=>!s || s==='.' || s==='..'))
    throw new Error('GitHub returned an invalid README path.');
  const binary = atob(readme.content);
  if (binary.length !== readme.size) throw new Error('GitHub returned an incomplete README.');
  const markdown = new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary, c=>c.charCodeAt(0)));
  const line = addressLine(markdown,address);
  const permalink = 'https://github.com/'+repo+'/blob/'+sha+'/'+readme.path.split('/').map(encodeURIComponent).join('/')+(line ? '#L'+line : '');
  return {repo, sha, line, permalink};
}

function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (className) el.className = className;
  return el;
}

export function mountClaims(container, r) {
  const intro = node('h3','Claim checks');
  const facts = node('dl',null,'facts');
  function fact(label,value){const group=node('div');group.append(node('dt',label),node('dd',value));facts.append(group);}
  fact('Explorer source matches inspected runtime',r.verified?'Confirmed by bytecode match':'Unknown · verified match unavailable');
  const owner = r.overview?.fields?.find(([key])=>key==='Owner getter')?.[1];
  fact('owner() returns the zero address', !ADDRESS.test(owner || '') ? 'Unknown · getter unavailable' :
    /^0x0{40}$/i.test(owner) ? 'Confirmed · other roles require separate checks' : 'Contradicted · '+owner);
  const form=node('form',null,'claim-form'),label=node('label','Public GitHub repository');
  const input=node('input');input.type='url';input.required=true;input.maxLength=250;input.placeholder='https://github.com/owner/project';input.autocomplete='off';input.spellcheck=false;
  label.append(input);const submit=node('button','Check README');submit.type='submit';form.append(label,submit);
  const result=node('div',null,'claim-result');result.setAttribute('aria-live','polite');
  input.addEventListener('input',()=>result.replaceChildren());
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(submit.disabled)return;
    input.readOnly=true;submit.disabled=true;result.textContent='Reading the default branch README…';
    try {
      const check=await checkReadme(input.value,r.address);
      const message=check.line ? 'This README names the scanned address.' : 'The exact address was absent from this README.';
      const link=node('a','Inspect README at '+check.sha.slice(0,8)+' ↗','address break');
      link.href=check.permalink;link.target='_blank';link.rel='noreferrer';
      result.replaceChildren(node('p',message),link);
    } catch(error) {
      result.textContent = error.name==='TimeoutError' ? 'GitHub timed out. Try again.' : error.message;
    } finally {input.readOnly=false;submit.disabled=false;}
  });
  container.replaceChildren(intro,facts,node('h3','Repository address claim'),
    node('p','Check whether a public repository names this exact address in its default README. Project ownership and a reproducible build need separate evidence.'),form,result);
}
