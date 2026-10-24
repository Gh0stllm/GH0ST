"""Full, independent Q12 reference for natural sentence termination; local only."""
import hashlib
import json
from pathlib import Path
from screen import BASE, OUT, forward, tokenizer

TERMINALS = {tokenizer.convert_tokens_to_ids(x) for x in [".", "!", "?"]}
CASES = [
    ("colon", ":", [27], True),
    ("quote", '"', [3], True),
    ("she", "She", [106], False),
    ("the", "The", [85], False),
    ("eos-start", "[EOS]", [1], True),
]

if __name__ == "__main__":
    cases = []
    for name, prompt, ids, standalone in CASES:
        ctx, output, steps = ids.copy(), [], []
        for i in range(17-len(ids)):
            x = forward(ctx, include_trace=True)
            token = x["next_token"]
            output.append(token)
            steps.append(dict(context_ids=ctx.copy(), next_token=token, last_hidden=x["last_hidden"], logit_hash=x["logit_hash"]))
            if token == 1 or token in TERMINALS:
                break
            ctx.append(token)
        item = dict(name=name, prompt=prompt, prompt_ids=ids, output_ids=output,
                    output=tokenizer.decode(output, skip_special_tokens=True),
                    combined=tokenizer.decode(ids+output, skip_special_tokens=True),
                    generated_text_is_standalone_sentence=standalone,
                    generated_tokens=len(output), maximum_new_tokens=17-len(ids),
                    stop_reason="eos" if output[-1]==1 else "punctuation" if output[-1] in TERMINALS else "context_cap",
                    steps=steps)
        cases.append(item)
        print(json.dumps({k:v for k,v in item.items() if k!='steps'}),flush=True)
    record = dict(schema_version=1,model="SimpleStories/SimpleStories-V2-1.25M",parameters=1235968,
                  arithmetic="Original Q12 reference; no changes to checkpoint, weights or equations",
                  source_sha256={str(p.relative_to(BASE)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [BASE/"integer_reference.py", BASE/"model/weights.bin", BASE/"model/tables.bin"]},
                  execution="Offline CPU; no chain access",cases=cases)
    (OUT / "reference.json").write_text(json.dumps(record,indent=2)+"\n")
