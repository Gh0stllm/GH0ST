import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const RESERVED=['[UNK]','[EOS]','!','"','#','$','%','&',"'",'(',')','*','+',',','-','.','/',...Array.from({length:10},(_,i)=>String(i)),':',';','=','?','@'];

export function decodeVocabularyBlob(bytes){
  assert.equal(bytes.subarray(0,4).toString('ascii'),'G0V5');
  assert.equal(bytes.readUInt16BE(4),1);const count=bytes.readUInt16BE(6);assert.equal(count,4019);
  const header=8+(count+1)*4;assert(bytes.length>=header);
  const offsets=Array.from({length:count+1},(_,i)=>bytes.readUInt32BE(8+i*4));
  assert.equal(offsets[0],0);assert.equal(offsets.at(-1),bytes.length-header);
  const decoder=new TextDecoder('utf-8',{fatal:true}),words=[];
  for(let i=0;i<count;i++){assert(offsets[i]<offsets[i+1]);words.push(decoder.decode(bytes.subarray(header+offsets[i],header+offsets[i+1])));}
  assert.equal(new Set(words).size,count);assert.deepEqual(words.slice(0,32),RESERVED);
  assert(words.every(word=>word&&!word.startsWith('##')&&!/\s/u.test(word)));
  return words;
}

export function loadVocabulary(exportDir){
  const directory=path.join(exportDir,'vocabulary');
  const manifest=JSON.parse(readFileSync(path.join(directory,'manifest.json')));
  const blob=readFileSync(path.join(directory,'vocabulary.bin'));
  const tokenizerBytes=readFileSync(path.join(directory,'tokenizer.json'));
  assert.equal(sha(blob),manifest.sha256);assert.equal(blob.length,manifest.bytes);assert.equal(manifest.entries,4019);
  assert.equal(sha(tokenizerBytes),manifest.tokenizer_sha256);
  const tokenizer=JSON.parse(tokenizerBytes);
  assert.equal(tokenizer.model.type,'WordLevel');assert.equal(tokenizer.decoder.type,'WordPiece');
  assert.equal(tokenizer.decoder.prefix,'##');assert.equal(tokenizer.decoder.cleanup,true);
  const words=decodeVocabularyBlob(blob),readable=JSON.parse(readFileSync(path.join(directory,'vocabulary.json')));
  assert.deepEqual(readable.id_to_token,words);assert.deepEqual(readable.special_ids,[0,1]);
  assert.equal(Object.keys(tokenizer.model.vocab).length,words.length);
  for(let i=0;i<words.length;i++)assert.equal(tokenizer.model.vocab[words[i]],i);
  return{directory,manifest,blob,tokenizerBytes,words};
}

// Mirrors the declared tokenizer's punctuation cleanup, never WordPiece merging.
export function decodeIds(ids,words){
  for(const id of ids)assert(Number.isInteger(id)&&id>=0&&id<words.length);
  let text=ids.filter(id=>id!==0&&id!==1).map(id=>words[id]).join(' ');
  for(const[from,to]of[[' .','.'],[' ?','?'],[' !','!'],[' ,',','],[" ' ","'"],[" n't","n't"],[" 'm","'m"],[" 's","'s"],[" 've","'ve"],[" 're","'re"]])text=text.replaceAll(from,to);
  return text;
}
