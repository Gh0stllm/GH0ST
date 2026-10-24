"""Offline adapter self-test with artificial WordLevel labels, not a trained model."""
from pathlib import Path
import json
import subprocess
import tempfile

from tokenizers import Tokenizer, AddedToken, Regex, decoders, models, normalizers, pre_tokenizers
import export_recovery as adapter


def main():
    with tempfile.TemporaryDirectory(prefix='gh0st-v5-export-test-')as temp:
        root=Path(temp);old=json.loads((adapter.q12.BASE/'model-cache/tokenizer.json').read_text())['model']['vocab']
        vocab={word:index for word,index in old.items()if index<32}
        vocab.update({('can\'t' if i==32 else 'machine' if i==33 else f'fixtureword{i}'):i for i in range(32,4019)})
        backend=Tokenizer(models.WordLevel(vocab=vocab,unk_token='[UNK]'))
        backend.normalizer=normalizers.Sequence([normalizers.NFKC(),normalizers.Lowercase()])
        backend.pre_tokenizer=pre_tokenizers.Sequence([pre_tokenizers.WhitespaceSplit(),pre_tokenizers.Split(Regex(r"[a-z]+(?:'[a-z]+)*|[0-9]|[^\w\s]"),behavior='isolated',invert=True)])
        backend.decoder=decoders.WordPiece(prefix='##',cleanup=True)
        backend.add_special_tokens([AddedToken('[UNK]',normalized=False,special=True),AddedToken('[EOS]',normalized=False,special=True)])
        tokenizer_file=root/'tokenizer.json';backend.save(str(tokenizer_file))
        tokenizer,loaded,raw,reserved=adapter.load_wordlevel(tokenizer_file)
        assert tokenizer.encode("can't machine.",add_special_tokens=False)==[32,33,15]
        assert tokenizer.decode([32,33,15],skip_special_tokens=True)=="can't machine."
        out=root/'out';out.mkdir()
        tensors,report=adapter.export_weights(adapter.q12.BASE/'model-cache',tokenizer,loaded,raw,out)
        vocabulary=adapter.export_vocabulary(loaded,raw,out)
        words=adapter.decode_vocabulary_blob((out/'vocabulary/vocabulary.bin').read_bytes())
        assert words[32]=="can't" and words[33]=='machine' and len(words)==4019
        bad=bytearray((out/'vocabulary/vocabulary.bin').read_bytes());bad[8:12]=(1).to_bytes(4,'big')
        try:adapter.decode_vocabulary_blob(bad)
        except AssertionError:pass
        else:raise AssertionError('Corrupted vocabulary offset accepted')
        # New labels leave numerical forward arithmetic unchanged for identical IDs.
        draws=adapter.q12.get_draws([42],4)[0]
        row,logits=adapter.q12.generate(tensors,tokenizer,42,draws,4,[3])
        frozen=json.loads((adapter.q12.BASE/'optimization/varied-sentence/continuity/quality/relative64/relative64-policy26-2060turn-reference.json').read_text())
        assert row['generated_tokens']==frozen['generated_tokens'][:4]
        assert adapter.q12.logit_hashes(logits)==frozen['every_step_logit_hash'][:4]
        assert adapter.validate_prompt_token(33)==33
        for bad_prompt in [0,1,2,15,30,4019]:
            try:adapter.validate_prompt_token(bad_prompt)
            except AssertionError:pass
            else:raise AssertionError('Invalid prompt accepted')
        one,_=adapter.q12.generate(tensors,tokenizer,42,draws,1,[33])
        assert one['prompt_ids']==[33]and one['turns'][0]['processed_before']==0 and one['turns'][0]['processed_after']==1
        adapter.q12.evm_artifacts(out,report)
        before=(out/'evm/GH0STVoiceRelative64Model.sol').read_bytes()
        adapter.bind_model_identity(out,vocabulary)
        source=out/'evm/GH0STVoiceRelative64Model.sol';after=source.read_bytes()
        assert before!=after and b'VOCABULARY_RUNTIME_COMMITMENT'in after and b'block.chainid != 31337'in after
        js='''import fs from"node:fs";import solc from"solc";
const file=process.argv[1],content=fs.readFileSync(file,"utf8"),input={language:"Solidity",sources:{"model.sol":{content}},settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:"cancun",outputSelection:{"*":{"*":["evm.bytecode.object","evm.deployedBytecode.object"]}}}};
const out=JSON.parse(solc.compile(JSON.stringify(input))),errors=(out.errors||[]).filter(e=>e.severity==="error");if(errors.length)throw Error(errors.map(e=>e.formattedMessage).join("\\n"));
const c=out.contracts["model.sol"].GH0STVoiceRelative64Model;process.stdout.write(JSON.stringify({runtime_bytes:c.evm.deployedBytecode.object.length/2,creation_bytes:c.evm.bytecode.object.length/2}));'''
        compilation=json.loads(subprocess.check_output([adapter.q12.NODE,'--input-type=module','-e',js,str(source)],cwd=adapter.q12.RESEARCH))
        assert compilation['runtime_bytes']<=24576 and compilation['creation_bytes']<=49152
        broken=json.loads(raw);broken['model']['vocab']['"']=32;broken['model']['vocab']["can't"]=3
        tokenizer_file.write_text(json.dumps(broken))
        try:adapter.load_wordlevel(tokenizer_file)
        except AssertionError:pass
        else:raise AssertionError('Changed quote ID accepted')
        result={'status':'PASS','scope':'Offline artificial-label adapter test, not quality or EVM execution evidence',
                'reserved_ids_checked':len(reserved),'contraction_intact':True,'punctuation_decode_matches':True,
                'all4019_vocabulary_entries_roundtrip':True,'corrupt_offset_rejected':True,'reserved_id_change_rejected':True,
                'same_id_numerical_reference_tokens_and_all_logits_equal':True,'model_identity_binds_vocabulary_and_tokenizer':True,
                'default_quote_prompt_unchanged':True,'nonterminal_single_token_prompt_one_forward_step':True,'invalid_prompt_rejected':True,
                'local_only_guard_retained':True,'compilation':compilation,'evm_execution_performed':False,
                'legacy_exporter_sha256':adapter.sha(adapter.LEGACY.read_bytes())}
        (adapter.HERE/'self-test.json').write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps(result,indent=2))


if __name__=='__main__':main()
