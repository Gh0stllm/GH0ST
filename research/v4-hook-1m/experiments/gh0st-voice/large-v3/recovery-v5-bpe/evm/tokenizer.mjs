import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';

export const sha=value=>createHash('sha256').update(value).digest('hex');

export function loadTokenizer(exportDir,base){
  const file=path.join(exportDir,'tokenizer/tokenizer.json'),bytes=readFileSync(file);
  assert(bytes.equals(readFileSync(path.join(base,'experiments/simplestories-v2/model-cache/tokenizer.json'))),'Original tokenizer bytes differ');
  const description=JSON.parse(bytes),words=[];
  assert.equal(description.model.type,'WordPiece');
  for(const [text,id] of Object.entries(description.model.vocab)){
    assert(Number.isInteger(id)&&id>=0&&id<4019&&!words[id]);words[id]=text;
  }
  assert.equal(words.length,4019);assert(words.every(Boolean));
  assert.equal(words[3],'"');assert.equal(words[40],'i');
  return {file,bytes,sha256:sha(bytes),description,words,special:new Set(description.added_tokens.filter(t=>t.special).map(t=>t.id))};
}

export function decodeIds(ids,tokenizer){
  for(const id of ids)assert(Number.isInteger(id)&&id>=0&&id<4019);
  return ids.filter(i=>!tokenizer.special.has(i)).map(i=>tokenizer.words[i]).join(' ')
    .replace(/ ##/g,'').replace(/ \./g,'.').replace(/ \?/g,'?').replace(/ !/g,'!').replace(/ ,/g,',');
}
