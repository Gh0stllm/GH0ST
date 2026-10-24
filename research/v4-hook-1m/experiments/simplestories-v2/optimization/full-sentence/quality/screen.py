"""Offline sentence-boundary screen of the unchanged Q12 model.

This imports only numerical definitions from the existing reference. It does
not execute that reference's exporter or modify any previous artifact.
"""
import ast
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import numpy as np
from transformers import AutoTokenizer

BASE = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
Q = 4096
spec = json.loads((BASE / "contracts/protocol.json").read_text())
blob = (BASE / "model/weights.bin").read_bytes()
tables = (BASE / "model/tables.bin").read_bytes()
tensors = {x["name"]: np.frombuffer(blob, dtype=">i2", count=x["elements"], offset=x["byte_offset"]).astype(np.int64).reshape(x["shape"]) for x in spec["weights"]["tensor_layout"]}
cos = np.frombuffer(tables, dtype=">i2", count=256).astype(np.int64).reshape(16, 16)
sin = np.frombuffer(tables, dtype=">i2", count=256, offset=512).astype(np.int64).reshape(16, 16)
sigmoid = np.frombuffer(tables, dtype=">u4", count=257, offset=1024).astype(np.int64)
exp = np.frombuffer(tables, dtype=">u4", count=257, offset=2052).astype(np.int64)
source = BASE / "integer_reference.py"
tree = ast.parse(source.read_text())
main = next(x for x in tree.body if isinstance(x, ast.FunctionDef) and x.name == "main")
functions = [x for x in main.body if isinstance(x, ast.FunctionDef)]
scope = dict(np=np, math=math, os=os, subprocess=subprocess, ROOT=BASE, Q=Q, tensors=tensors, cos=cos, sin=sin, sigmoid=sigmoid, exp=exp)
exec(compile(ast.fix_missing_locations(ast.Module(body=functions, type_ignores=[])), str(source), "exec"), scope)
forward = scope["forward"]
tokenizer = AutoTokenizer.from_pretrained(BASE / "model-cache", local_files_only=True, trust_remote_code=False)

if __name__ == "__main__":
    prompts = ["The", "A", "I", "We", "It", "He", "She", "They", "Once", "One", "Today", "Hello", "Yes", "No", "Go", "Stop", "Tom", "Lily", "Mia", "The cat", "The bird", "The dog", "The sun", "I am", "It was", "He was", "She was", "They were", "We are", "The sky", "In a", "One day", "A little", '"', "Suddenly", "Everyone", "Now", "Thank you", "Goodbye", "Please"]
    cases = [("EOS context", [1])] + [(s, tokenizer.encode(s, add_special_tokens=False)) for s in prompts]
    results = []
    terminals = {tokenizer.convert_tokens_to_ids(x) for x in [".", "!", "?"]}
    for text, prompt in cases:
        context = prompt.copy()
        generated = []
        for _ in range(17-len(prompt)):
            predicted = forward(context)["next_token"]
            generated.append(predicted)
            if predicted == 1 or predicted in terminals:
                break
            context.append(predicted)
        r = dict(prompt=text, prompt_ids=prompt, output_ids=generated, output=tokenizer.decode(generated, skip_special_tokens=True), combined=tokenizer.decode(prompt+generated, skip_special_tokens=True), termination="eos" if generated[-1]==1 else "punctuation" if generated[-1] in terminals else "context_cap", generated_tokens=len(generated), computed_positions=len(prompt)+len(generated)-1)
        results.append(r)
        print(json.dumps(r), flush=True)
        (OUT / "greedy-screen.json").write_text(json.dumps({"scope":"Offline unchanged Q12 model; no chain access", "weights_sha256":hashlib.sha256(blob).hexdigest(), "cases":results}, indent=2)+"\n")
