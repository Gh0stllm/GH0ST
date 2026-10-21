"""CPU probe of one-token action routing and restricted output projection.

All layers still execute. This only demonstrates reducing the final output head
and generated token count for a narrow routing job; no EVM gas claim is made.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import torch
import transformers
from transformers import AutoModelForCausalLM, AutoTokenizer
from quantize_compare import CACHE, EXPORTS, NF4, Q, REPO, REV, unpack_codes

ROOT = Path(__file__).resolve().parent
CASES = [
    ("balance", "Show my vault balance.", "A"),
    ("balance_paraphrase", "How much ETH is in my vault?", "A"),
    ("balance_short", "Read the balance.", "A"),
    ("note", "Save a note: buy milk.", "B"),
    ("note_paraphrase", "Remember this note: meeting at noon.", "B"),
    ("note_short", "Store a note saying hello.", "B"),
    ("payment", "Send 1 ETH to Alice.", "C"),
    ("payment_paraphrase", "Pay Alice 2 ETH.", "C"),
    ("payment_short", "Make a payment of 1 ETH to Alice.", "C"),
    ("stop", "Stop this task.", "D"),
    ("stop_paraphrase", "Cancel the task.", "D"),
    ("stop_short", "Do nothing and finish.", "D"),
]


def apply_export(model, folder):
    manifest = json.loads((folder / "manifest.json").read_text())
    data = (folder / "weights.bin").read_bytes()
    assert hashlib.sha256(data).hexdigest() == manifest["sha256"]
    assert data[:32] == NF4.tobytes()
    parameters = dict(model.named_parameters())
    assert set(parameters) == {t["name"] for t in manifest["tensors"]}
    with torch.no_grad():
        for tensor in manifest["tensors"]:
            start = tensor["offset"]; payload = data[start:start + tensor["byte_count"]]
            assert hashlib.sha256(payload).hexdigest() == tensor["sha256"]
            if tensor["format"] == "signed_q24":
                decoded = np.frombuffer(payload, dtype='<i4').astype(np.float32) / Q
            else:
                n = tensor["group_count"]; group = tensor["group"]
                codes = unpack_codes(payload[tensor["metadata_bytes"]:], tensor["bits"], n * group).reshape(n, group)
                if tensor["format"] == "nf4_q15_scale_q24":
                    scales = np.frombuffer(payload[:n*4], dtype='<u4').astype(np.float32) / Q
                    decoded = (NF4.astype(np.float32) / 32767)[codes] * scales[:, None]
                else:
                    offsets = np.frombuffer(payload[:n*4], dtype='<i4').astype(np.float32) / Q
                    scales = np.frombuffer(payload[n*4:n*8], dtype='<u4').astype(np.float32) / Q
                    decoded = codes.astype(np.float32) * scales[:, None] + offsets[:, None]
            parameters[tensor["name"]].copy_(torch.from_numpy(decoded.copy()).reshape(tensor["shape"]))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--few-shot", action="store_true")
    args = parser.parse_args()
    transformers.utils.logging.disable_progress_bar(); torch.set_num_threads(4)
    tokenizer = AutoTokenizer.from_pretrained(CACHE, local_files_only=True, trust_remote_code=False)
    model = AutoModelForCausalLM.from_pretrained(CACHE, local_files_only=True, trust_remote_code=False, dtype=torch.float32).eval()
    labels = ["A", "B", "C", "D"]
    codes = [tokenizer.encode(label, add_special_tokens=False) for label in labels]
    assert all(len(c) == 1 for c in codes)
    ids = torch.tensor([c[0] for c in codes])
    report = {"model":REPO, "revision":REV, "training_performed":False, "onchain_execution":False,
        "prompt_mode":"four_demonstrations" if args.few_shot else "instruction_only",
        "labels":{"A":"read balance", "B":"save note", "C":"request payment", "D":"stop"},
        "token_ids":ids.tolist(), "full_head_multiply_accumulates":model.config.vocab_size * model.config.hidden_size,
        "restricted_head_multiply_accumulates":len(ids) * model.config.hidden_size,
        "scope":"Only last vocabulary projection is reduced; all model layers and prompt prefill remain. Arguments and authorization are separate.",
        "variants":[]}
    for variant in ["baseline", "nf4_g128", "int4_g64"]:
        if variant != "baseline": apply_export(model, EXPORTS / variant)
        result = {"variant":variant, "cases":[]}
        for name, request, expected in CASES:
            prompt = ("Choose an action for the user request. A = show vault balance. B = save a note. "
                      "C = request a payment. D = stop or cancel. Output only one letter: A, B, C, or D.\nUser request: " + request)
            messages = [{"role":"user", "content":prompt}]
            if args.few_shot:
                rules = prompt[:prompt.index("\nUser request:")]
                demonstrations = [("Display the balance of this vault.", "A"),
                    ("Keep a note saying the invoice is due tomorrow.", "B"),
                    ("Transfer 0.5 ETH to Alice.", "C"), ("End this run now.", "D")]
                messages = []
                for i, (example, label) in enumerate(demonstrations):
                    messages.extend([{"role":"user", "content":(rules + "\n" if i == 0 else "") + "User request: " + example},
                                     {"role":"assistant", "content":label}])
                messages.append({"role":"user", "content":"User request: " + request})
            inp = tokenizer.apply_chat_template(messages, add_generation_prompt=True,
                tokenize=True, return_dict=True, return_tensors="pt")
            with torch.inference_mode():
                out = model(**inp, output_hidden_states=True, logits_to_keep=1, use_cache=False)
                hidden = out.hidden_states[-1][:, -1, :]
                restricted = torch.nn.functional.linear(hidden, model.lm_head.weight[ids]) * model.model.lm_head_multiplier
                reference = out.logits[:, -1, ids]
                difference = float((reference - restricted).abs().max())
                assert torch.allclose(reference, restricted, atol=1e-4, rtol=1e-5), difference
            actual = labels[int(restricted.argmax(-1).item())]
            result["cases"].append({"name":name, "request":request, "expected":expected, "actual":actual,
                "passed":actual == expected, "projection_max_error":difference, "prefill_tokens":int(inp["input_ids"].shape[-1])})
        result["passed"] = sum(c["passed"] for c in result["cases"])
        result["total"] = len(CASES); report["variants"].append(result)
        print(json.dumps(result), flush=True)
    report["status"] = "completed"
    filename = "action-router-fewshot-results.json" if args.few_shot else "action-router-results.json"
    (ROOT / filename).write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__": main()
