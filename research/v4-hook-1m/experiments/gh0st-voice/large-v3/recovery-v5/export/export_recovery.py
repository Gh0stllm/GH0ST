"""Local recovery-v5 exporter for a replacement4019-token WordLevel vocabulary.

Reuses the reviewed fixed-point arithmetic and lossless SWAR exporter without
editing their sources. New token meanings and complete tokenizer bytes are
explicitly committed in the separately generated local-only model identity.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import time

import numpy as np
from safetensors.numpy import load_file
from tokenizers import Tokenizer
from transformers import PreTrainedTokenizerFast, AutoTokenizer

HERE = Path(__file__).resolve().parent
VOICE = HERE.parents[2]
LEGACY = VOICE / "export/quantize_eval.py"
spec = importlib.util.spec_from_file_location("gh0st_reviewed_q12_export", LEGACY)
q12 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(q12)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def validate_prompt_token(value):
    value=int(value)
    assert 0<value<4019 and value not in {1,2,15,30},'Prompt must be one valid nonterminal vocabulary token'
    return value


def decode_vocabulary_blob(blob):
    assert blob[:4] == b'G0V5' and int.from_bytes(blob[4:6],'big') == 1
    count=int.from_bytes(blob[6:8],'big');assert count==4019
    header=8+(count+1)*4;assert len(blob)>=header
    offsets=[int.from_bytes(blob[8+i*4:12+i*4],'big')for i in range(count+1)]
    assert offsets[0]==0 and offsets[-1]==len(blob)-header
    assert all(a<b for a,b in zip(offsets,offsets[1:]))
    return [blob[header+a:header+b].decode('utf-8',errors='strict')for a,b in zip(offsets,offsets[1:])]


def load_wordlevel(path):
    path = path / "tokenizer.json" if path.is_dir() else path
    raw = path.read_bytes()
    description = json.loads(raw)
    assert description["model"]["type"] == "WordLevel", "Recovery-v5 expects complete-word WordLevel vocabulary"
    vocab = description["model"]["vocab"]
    assert len(vocab) == 4019 and sorted(vocab.values()) == list(range(4019)), "Vocabulary must bijectively map4019 tokens to ids0..4018"
    original = json.loads((q12.BASE / "model-cache/tokenizer.json").read_text())["model"]["vocab"]
    reserved = {token: index for token, index in original.items() if index < 32}
    assert len(reserved) == 32
    for token, index in reserved.items():
        assert vocab.get(token) == index, f"Reserved token/id changed: {token!r}"
    for token in vocab:
        assert token and not token.startswith("##"), "WordPiece continuations cannot be decoded as complete words"
        assert not any(character.isspace() for character in token), "WordLevel tokens must contain no whitespace"
        token.encode("utf-8", errors="strict")
    assert description["model"].get("unk_token") == "[UNK]"
    added = {row["content"]: row for row in description.get("added_tokens", [])}
    assert added.get("[UNK]", {}).get("special") and added.get("[EOS]", {}).get("special")
    tokenizer = PreTrainedTokenizerFast(tokenizer_object=Tokenizer.from_file(str(path)), unk_token="[UNK]", eos_token="[EOS]", pad_token="[UNK]", clean_up_tokenization_spaces=True)
    for token in ['!', '"', '.', '?', '[EOS]']:
        assert tokenizer.encode(token, add_special_tokens=False) == [vocab[token]]
    assert tokenizer.encode('"', add_special_tokens=False) == [3]
    return tokenizer, vocab, raw, reserved


def export_weights(checkpoint, tokenizer, vocab, tokenizer_raw, out, prompt_token=3):
    prompt_token=validate_prompt_token(prompt_token)
    checkpoint = checkpoint.resolve()
    raw = load_file(str(checkpoint / "model.safetensors"))
    config = json.loads((checkpoint / "config.json").read_text())
    for name, expected in {"vocab_size":4019,"hidden_size":128,"intermediate_size":341,"num_hidden_layers":4,"num_attention_heads":4,"num_key_value_heads":2,"head_dim":32}.items():
        assert config.get(name, expected) == expected, (name, config.get(name), expected)
    assert config.get("tie_word_embeddings") is True
    protocol = json.loads((q12.BASE / "contracts/protocol.json").read_text())
    tensors, binary, audits = {}, bytearray(), []
    for entry in protocol["weights"]["tensor_layout"]:
        array = raw[entry["name"]].astype(np.float64)
        assert list(array.shape) == entry["shape"] and np.isfinite(array).all()
        values = np.rint(array * 4096).astype(np.int64)
        assert values.min() >= -32768 and values.max() <= 32767, entry["name"]
        assert len(binary) == entry["byte_offset"]
        binary.extend(values.astype(">i2").tobytes())
        tensors[entry["name"]] = values
        matrix = values.ndim == 2
        audits.append({"name":entry["name"],"shape":entry["shape"],"q12_min":int(values.min()),"q12_max":int(values.max()),
                       "matrix":matrix,"swar8_signed12_compatible":not matrix or bool(values.min()>=-2048 and values.max()<=2047),
                       "maximum_absolute_weight_error":float(np.max(np.abs(values/4096-array)))})
    assert len(binary) == 2471936
    (out / "model").mkdir(parents=True,exist_ok=True)
    (out / "model/weights.bin").write_bytes(binary)
    cosine,sine,sigmoid,exponential=q12.tables()
    table=cosine.astype(">i2").tobytes()+sine.astype(">i2").tobytes()+sigmoid.astype(">u4").tobytes()+exponential.astype(">u4").tobytes()
    assert len(table)==6152
    (out / "model/tables-relative64.bin").write_bytes(table)
    old_vocab=json.loads((q12.BASE/'model-cache/tokenizer.json').read_text())['model']['vocab']
    report={"schema_version":2,"scope":"Local recovery-v5 WordLevel Q12 export; no clipping or public-chain activity",
            "checkpoint":str(checkpoint),"checkpoint_sha256":sha((checkpoint/'model.safetensors').read_bytes()),"parameters":1235968,
            "weights_bytes":len(binary),"weights_sha256":sha(binary),"weight_scale":4096,"clipped_parameters":0,
            "rounding":"nearest-even Q12; reject overflow, never clip",
            "tokenizer_type":"WordLevel","tokenizer_vocab_unchanged":vocab==old_vocab,"reserved_ids_0_31_unchanged":True,
            "tokenizer_sha256":sha(tokenizer_raw),"vocabulary_entries":4019,"initial_prompt_ids":[prompt_token],"eos_token_id":1,
            "swar8_signed12_compatible":all(row['swar8_signed12_compatible']for row in audits),"per_tensor":audits,
            "legacy_reference_exporter_sha256":sha(LEGACY.read_bytes())}
    write_json(out/'quantization-report.json',report)
    return tensors,report


def export_vocabulary(vocab, tokenizer_raw, out):
    directory=out/'vocabulary';directory.mkdir(exist_ok=True)
    words=['']*4019
    for token,index in vocab.items():words[index]=token
    offsets=[0];payload=bytearray()
    for token in words:
        payload.extend(token.encode('utf-8'));offsets.append(len(payload))
    blob=b'G0V5'+(1).to_bytes(2,'big')+(4019).to_bytes(2,'big')+b''.join(offset.to_bytes(4,'big')for offset in offsets)+payload
    (directory/'vocabulary.bin').write_bytes(blob)
    (directory/'tokenizer.json').write_bytes(tokenizer_raw)
    write_json(directory/'vocabulary.json',{'schema_version':1,'id_to_token':words,'special_ids':[0,1],'wordlevel':True})
    assert decode_vocabulary_blob(blob)==words
    shards=[]
    for offset in range(0,len(blob),24000):
        runtime=b'\x00'+blob[offset:offset+24000]
        name=f'shard-{len(shards):04d}.runtime.bin'
        (directory/name).write_bytes(runtime)
        shards.append({'index':len(shards),'path':name,'payload_offset':offset,'payload_bytes':len(runtime)-1,'runtime_bytes':len(runtime),'runtime_sha256':sha(runtime)})
    script='''import fs from"node:fs";import path from"node:path";import{keccak256,AbiCoder,ZeroHash}from"ethers";
const dir=process.argv[1],rows=JSON.parse(process.argv[2]);let root=ZeroHash;for(const row of rows){row.runtime_keccak256=keccak256(fs.readFileSync(path.join(dir,row.path)));root=keccak256(AbiCoder.defaultAbiCoder().encode(["bytes32","bytes32"],[root,row.runtime_keccak256]));}process.stdout.write(JSON.stringify({shards:rows,commitment:root}));'''
    result=json.loads(subprocess.check_output([q12.NODE,'--input-type=module','-e',script,str(directory.resolve()),json.dumps(shards)],cwd=q12.RESEARCH))
    manifest={'schema_version':1,'format':'G0V5:magic4,versionuint16BE,countuint16BE,(count+1)relativeuint32BEoffsets,concatenatedUTF8',
              'entries':4019,'bytes':len(blob),'sha256':sha(blob),'tokenizer_sha256':sha(tokenizer_raw),
              'shard_payload_maximum':24000,'shards':result['shards'],'runtime_commitment':result['commitment'],
              'storage':'Each shard is STOP-prefixed EVM runtime; concatenate runtime[1:] in index order to recover vocabulary.bin.',
              'display':'Use the exported tokenizer decoder. These are complete-word tokens; never apply the legacy ##fragment mapping.',
              'deployment_status':'EXPORTED_NOT_DEPLOYED','inference_gas_effect':'Vocabulary data is not read by transformer inference.'}
    write_json(directory/'manifest.json',manifest)
    return manifest


def bind_model_identity(out, vocabulary, prompt_token=3):
    prompt_token=validate_prompt_token(prompt_token)
    source_path=out/'evm/GH0STVoiceRelative64Model.sol'
    source=source_path.read_text()
    marker='    uint256 public constant VOCABULARY = 4019;'
    assert source.count(marker)==1
    source=source.replace(marker,marker+f"\n    bytes32 public constant TOKENIZER_SHA256 = 0x{vocabulary['tokenizer_sha256']};\n    bytes32 public constant VOCABULARY_BLOB_SHA256 = 0x{vocabulary['sha256']};\n    bytes32 public constant VOCABULARY_RUNTIME_COMMITMENT = {vocabulary['runtime_commitment']};")
    old='modelHash = keccak256(abi.encode("GH0ST_VOICE_Q12_RELATIVE64_LOCAL_V1", a, b, c, promptToken_));'
    new='modelHash = keccak256(abi.encode("GH0ST_RECOVERY_V5_WORDLEVEL_Q12_RELATIVE64_LOCAL_V1", a, b, c, promptToken_, TOKENIZER_SHA256, VOCABULARY_BLOB_SHA256, VOCABULARY_RUNTIME_COMMITMENT));'
    assert source.count(old)==1
    source=source.replace(old,new)
    source_path.write_text(source)
    path=out/'evm/model-manifest.json';manifest=json.loads(path.read_text())
    manifest.update(source_sha256=sha(source_path.read_bytes()),tokenizer_sha256=vocabulary['tokenizer_sha256'],vocabulary_blob_sha256=vocabulary['sha256'],
                    vocabulary_runtime_commitment=vocabulary['runtime_commitment'],vocabulary_shards=vocabulary['shards'],
                    model_hash_domain='GH0ST_RECOVERY_V5_WORDLEVEL_Q12_RELATIVE64_LOCAL_V1',initial_prompt_token=prompt_token)
    manifest['limitations'].append('Vocabulary runtime hashes must be verified when vocabulary shards are installed; constructor advertises their commitment but does not receive their addresses.')
    write_json(path,manifest)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--checkpoint',type=Path,required=True)
    parser.add_argument('--tokenizer',type=Path,help='Directory containing tokenizer.json, or tokenizer.json path. Defaults to checkpoint.')
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--seeds',default='42,0,1,2,3,4,5,6,7,8')
    parser.add_argument('--tokens',type=int,default=150)
    parser.add_argument('--prompt-token',type=int,default=3)
    parser.add_argument('--include-legacy-baseline',action='store_true')
    parser.add_argument('--skip-evm-artifacts',action='store_true')
    args=parser.parse_args();assert args.tokens>0
    prompt_token=validate_prompt_token(args.prompt_token)
    if args.include_legacy_baseline:
        assert prompt_token==3,'Legacy semantic comparison supports only shared quotation prompt3'
    started=time.monotonic();args.out.mkdir(parents=True,exist_ok=True)
    tokenizer,vocab,tokenizer_raw,reserved=load_wordlevel(args.tokenizer or args.checkpoint)
    tensors,report=export_weights(args.checkpoint,tokenizer,vocab,tokenizer_raw,args.out,prompt_token)
    vocabulary=export_vocabulary(vocab,tokenizer_raw,args.out)
    seeds=[int(x)for x in args.seeds.split(',')];assert len(set(seeds))==len(seeds)
    draws=q12.get_draws(seeds,args.tokens)
    result={'schema_version':2,'scope':'Local independent Q12 recovery-v5 WordLevel reference; no public-chain activity',
            'checkpoint_sha256':report['checkpoint_sha256'],'weights_sha256':report['weights_sha256'],
            'tokenizer_sha256':report['tokenizer_sha256'],'vocabulary_blob_sha256':vocabulary['sha256'],
            'parameters':1235968,'window':64,'top_k':8,'temperature_milli':800,'initial_prompt_ids':[prompt_token],
            'prompt_text':tokenizer.decode([prompt_token],skip_special_tokens=True),
            'token_policy':'2 iff processed<=26, otherwise1; native terminals end chunk; no context reset','runs':[],
            'limitations':['New vocabulary changes token semantics; legacy/new token IDs cannot be directly compared.',
                           'Baseline is decoded only with its original tokenizer and is not a vocabulary-matched numerical test.',
                           'Offline reference is not EVM gas evidence.']}
    models=[('tuned',tensors,tokenizer)]
    if args.include_legacy_baseline:
        legacy_tokenizer=AutoTokenizer.from_pretrained(q12.BASE/'model-cache',local_files_only=True,trust_remote_code=False)
        models.insert(0,('legacy_baseline',q12.baseline_tensors(),legacy_tokenizer))
    for name,weights,decoder in models:
        for seed,seed_draws in zip(seeds,draws):
            row,logits=q12.generate(weights,decoder,seed,seed_draws,args.tokens,[prompt_token])
            row['model']=name;row['every_step_logit_hash']=q12.logit_hashes(logits)
            row['generated_text']=decoder.decode(row['generated_tokens'],skip_special_tokens=True)
            result['runs'].append(row)
            print(json.dumps({'model':name,'seed':seed,'text':row['full_text'],'q12_safety':row['q12_safety']}),flush=True)
    write_json(args.out/'q12-continuity-comparison.json',result)
    (args.out/'q12-transcripts.txt').write_text('\n\n'.join(f"{r['model']} / seed{r['seed']}\nPROMPT: {r['prompt_text']}\nGENERATED: {r['generated_text']}\nCOMBINED: {r['full_text']}"for r in result['runs'])+'\n')
    if not args.skip_evm_artifacts:
        artifacts=q12.evm_artifacts(args.out,report)
        assert artifacts['status']=='EXPORTED_NOT_EVM_TESTED'
        bind_model_identity(args.out,vocabulary,prompt_token)
        artifacts['vocabulary_bound_in_model_identity']=True
    else:artifacts={'status':'SKIPPED'}
    write_json(args.out/'evm-artifact-report.json',artifacts)
    print(json.dumps({'out':str(args.out),'elapsed_seconds':time.monotonic()-started,'vocabulary_bytes':vocabulary['bytes'],'vocabulary_shards':len(vocabulary['shards']),'reserved_ids':reserved,'artifacts':artifacts}),flush=True)


if __name__=='__main__':main()
