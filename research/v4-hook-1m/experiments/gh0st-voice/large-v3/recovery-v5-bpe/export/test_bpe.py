"""Offline original-tokenizer adapter checks; no EVM execution or quality claim."""
from pathlib import Path
import json
import subprocess
import tempfile

import export_bpe as adapter


def main():
    q12 = adapter.q12
    with tempfile.TemporaryDirectory(prefix="gh0st-original-tokenizer-") as directory:
        root = Path(directory)
        tensors, tokenizer, report = q12.export_checkpoint(q12.BASE / "model-cache", root)
        canonical = adapter.checked_tokenizer(tokenizer)
        for invalid in [0, 1, 2, 15, 30, 4019]:
            try:
                adapter.validate_prompt_token(invalid)
            except AssertionError:
                pass
            else:
                raise AssertionError("Invalid prompt accepted")
        assert tokenizer.encode("i", add_special_tokens=False) == [40]
        adapter.bind_metadata(root, report, tokenizer, canonical, 3, 8, 800)
        draws = q12.get_draws([42], 4)[0]
        row, logits = q12.generate(tensors, tokenizer, 42, draws, 4, [3])
        frozen = json.loads((q12.BASE / "optimization/varied-sentence/continuity/quality/relative64/relative64-policy26-2060turn-reference.json").read_text())
        assert row["generated_tokens"] == frozen["generated_tokens"][:4]
        assert q12.logit_hashes(logits) == frozen["every_step_logit_hash"][:4]
        conditioned, _ = q12.generate(tensors, tokenizer, 42, draws, 1, [40])
        assert conditioned["prompt_ids"] == [40]
        assert conditioned["turns"][0]["processed_before"] == 0
        assert conditioned["turns"][0]["processed_after"] == 1
        assert conditioned["generated_count"] == 1
        # Check all vocabulary strings and representative multi-token cleanup.
        cases = [[index] for index in range(4019)]
        cases += [tokenizer.encode(text, add_special_tokens=False) for text in [
            "i can't see it.", '"i am here," said the machine.', "it's not my job!",
            "we're getting there, aren't we?", "memory is a story about yesterday.",
        ]]
        cases += [list(map(int, seq)) for seq in __import__("numpy").random.default_rng(42).integers(0, 4019, size=(128, 15))]
        data = [{"ids": ids, "expected": tokenizer.decode(ids, skip_special_tokens=True)} for ids in cases]
        cases_file = root / "decoder-cases.json"
        cases_file.write_text(json.dumps(data))
        module = (adapter.HERE.parent / "evm/tokenizer.mjs").as_uri()
        script = """import assert from 'node:assert/strict';import fs from 'node:fs';
const {loadTokenizer,decodeIds}=await import(process.argv[1]);
const t=loadTokenizer(process.argv[2],process.argv[3]);const cases=JSON.parse(fs.readFileSync(process.argv[4]));
for(const c of cases)assert.equal(decodeIds(c.ids,t),c.expected,JSON.stringify(c.ids));
process.stdout.write(JSON.stringify({checked:cases.length}));"""
        decoder = json.loads(subprocess.check_output([q12.NODE, "--input-type=module", "-e", script, module, str(root), str(q12.RESEARCH), str(cases_file)], cwd=q12.RESEARCH))
        cosine, sine, sigmoid, exponential = q12.tables()
        (root / "model/tables-relative64.bin").write_bytes(cosine.astype(">i2").tobytes() + sine.astype(">i2").tobytes() + sigmoid.astype(">u4").tobytes() + exponential.astype(">u4").tobytes())
        artifacts = q12.evm_artifacts(root, report)
        assert artifacts["status"] == "EXPORTED_NOT_EVM_TESTED"
        before = (root / "evm/GH0STVoiceRelative64Model.sol").read_bytes()
        adapter.bind_metadata(root, report, tokenizer, canonical, 40, 8, 800)
        manifest = json.loads((root / "evm/model-manifest.json").read_text())
        assert manifest["initial_prompt_token"] == 40 and manifest["initial_prompt_ids"] == [40]
        assert manifest["prompt_text"] == "i" and manifest["prompt_counts_as_generated"] is False
        assert before == (root / "evm/GH0STVoiceRelative64Model.sol").read_bytes()
        assert b"block.chainid != 31337" in before
        assert b'abi.encode("GH0ST_VOICE_Q12_RELATIVE64_LOCAL_V1", a, b, c, promptToken_)' in before
        source = root / "evm/GH0STVoiceRelative64Model.sol"
        script = """import fs from 'node:fs';import solc from 'solc';
const input={language:'Solidity',sources:{'model.sol':{content:fs.readFileSync(process.argv[1],'utf8')}},settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'cancun',outputSelection:{'*':{'*':['evm.bytecode.object','evm.deployedBytecode.object']}}}};
const output=JSON.parse(solc.compile(JSON.stringify(input))),errors=(output.errors||[]).filter(e=>e.severity==='error');if(errors.length)throw Error(errors.map(e=>e.formattedMessage).join('\\n'));
const c=output.contracts['model.sol'].GH0STVoiceRelative64Model;process.stdout.write(JSON.stringify({runtime_bytes:c.evm.deployedBytecode.object.length/2,creation_bytes:c.evm.bytecode.object.length/2}));"""
        compilation = json.loads(subprocess.check_output([q12.NODE, "--input-type=module", "-e", script, str(source)], cwd=q12.RESEARCH))
        assert compilation["runtime_bytes"] <= 24576 and compilation["creation_bytes"] <= 49152
        result = {
            "status": "PASS", "scope": "Offline adapter tests using original pretrained weights; not tuned-model quality or EVM gas evidence",
            "original_tokenizer_type": "WordPiece", "i_prompt_token": 40,
            "default_quote_token_and_full_logit_parity": True,
            "single_token_conditioning_one_forward_step": True,
            "invalid_prompts_rejected": True,
            "prompt_metadata_matches_constructor_argument": True,
            "prompt_does_not_modify_model_kernel_source": True,
            "javascript_python_decoder_cases": decoder["checked"],
            "local_chain_guard_retained": True, "compilation": compilation,
            "evm_execution_performed": False,
            "legacy_exporter_sha256": q12.sha(adapter.LEGACY.read_bytes()),
        }
        q12.write_json(adapter.HERE / "self-test.json", result)
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
