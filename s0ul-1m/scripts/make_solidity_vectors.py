"""Generate independent IntegerModel golden vectors for local Solidity tests.

Model conversion/export is offline. The JSON retains every expected integer
logit at each greedy decision rather than only the chosen token. Generated
weights and fixtures live in the ignored exports directory.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from s0ul.integer import IntegerModel
from s0ul.model import ModelConfig, S0ULModel
from s0ul.tokenizer import S0ULTokenizer
from s0ul.solidity_export import build_export


def write_case(root, name, model, prompt_ids, max_new_tokens, *, source_kind, prompt_text=None):
    directory = root / name
    manifest = build_export(model, directory)
    prefix = list(prompt_ids)
    decisions = []
    start_saturations = model.saturation_count
    for _ in range(max_new_tokens):
        logits = model.forward(prefix)[-1]
        predicted = int(np.argmax(logits))
        decisions.append({"prefix_ids": list(prefix), "logits": logits.tolist(), "next_id": predicted})
        prefix.append(predicted)
        if predicted == 2:
            break
    full_tokens = model.generate(prompt_ids, max_new_tokens)
    if prefix != full_tokens:
        raise AssertionError("Independent greedy decision loop disagrees with reference generate")
    expected = {
        "fixture": name,
        "source_kind": source_kind,
        "reference": "s0ul.integer.IntegerModel forward and generate, numerical format v1",
        "config": model.config,
        "source_checkpoint_sha256": model.source_checkpoint_sha256,
        "parameter_count": model.config["vocab_size"] * model.config["dim"] + model.config["n_layers"] * (4 * model.config["dim"] ** 2 + 2 * model.config["dim"] * model.config["hidden_dim"] + 2 * model.config["dim"]) + model.config["dim"],
        "prompt_ids": list(prompt_ids),
        "prompt_text": prompt_text,
        "max_new_tokens": max_new_tokens,
        "expected_tokens": prefix,
        "expected_output_ids": prefix[len(prompt_ids):],
        "decisions": decisions,
        "reference_saturations_recomputed_prefixes": model.saturation_count - start_saturations,
        "saturation_note": "The incremental EVM cache avoids recomputing older positions; saturation totals are therefore diagnostics, not a required equality against full-prefix recomputation.",
        "model_manifest_sha256": hashlib.sha256((directory / "model.json").read_bytes()).hexdigest(),
    }
    (directory / "expected.json").write_text(json.dumps(expected, indent=2, sort_keys=True) + "\n")
    return {"name": name, "path": str(directory), "parameter_count": expected["parameter_count"], "decisions": len(decisions), "output_ids": expected["expected_output_ids"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("exports/solidity-tests"))
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--full-bundle", type=Path)
    group.add_argument("--full-checkpoint", type=Path)
    group.add_argument("--full-seeded", action="store_true")
    parser.add_argument("--full-text", default=None, help="Optional trained-model text prompt; default uses raw IDs [1,3]")
    parser.add_argument("--full-new-tokens", type=int, default=1)
    args = parser.parse_args()
    if not 1 <= args.full_new_tokens <= 32:
        parser.error("--full-new-tokens must lie in 1..32")
    torch.set_num_threads(2)
    torch.manual_seed(20261021)
    args.output.mkdir(parents=True, exist_ok=True)
    cfg = ModelConfig(vocab_size=16, dim=8, n_layers=2, n_heads=2, hidden_dim=16, max_seq_len=12)
    floating = S0ULModel(cfg).eval()
    records = [write_case(args.output, "tiny-random", IntegerModel.from_state_dict(floating.state_dict(), cfg.to_dict()), [1, 4, 3], 2, source_kind="seeded random numeric fixture")]
    zero = {name: torch.zeros_like(value) for name, value in floating.state_dict().items()}
    records.append(write_case(args.output, "tiny-zero", IntegerModel.from_state_dict(zero, cfg.to_dict()), [1, 3], 2, source_kind="zero model: lowest-ID argmax ties"))
    eos = {name: value.clone() for name, value in zero.items()}
    for name in eos:
        if name.endswith("norm.weight"):
            eos[name].fill_(1)
    eos["token_embedding.weight"][2].fill_(0.02)
    records.append(write_case(args.output, "tiny-eos", IntegerModel.from_state_dict(eos, cfg.to_dict()), [2], 3, source_kind="constructed EOS-stop fixture"))
    if args.full_bundle or args.full_checkpoint or args.full_seeded:
        if args.full_bundle:
            model = IntegerModel.load(args.full_bundle)
            source = "trained selected integer bundle"
        elif args.full_checkpoint:
            model = IntegerModel.from_checkpoint(args.full_checkpoint)
            source = "trained selected checkpoint converted to integer-v1"
        else:
            torch.manual_seed(271828)
            full = S0ULModel().eval()
            model = IntegerModel.from_state_dict(full.state_dict(), full.config.to_dict())
            source = "seeded full 984192-parameter numeric fixture, not training-quality evidence"
        if model.config != ModelConfig().to_dict():
            raise ValueError("Full-size case must use the exact published 984192-parameter configuration")
        prompt_ids = [1, 3]
        if args.full_text is not None:
            if model.tokenizer_spec != S0ULTokenizer().spec():
                raise ValueError("Text fixture requires a checkpoint-pinned tokenizer")
            prompt_ids = [1] + S0ULTokenizer().encode(args.full_text) + [3]
        records.append(write_case(args.output, "full-model", model, prompt_ids, args.full_new_tokens, source_kind=source, prompt_text=args.full_text))
        if model.tokenizer_spec == S0ULTokenizer().spec() and args.full_text is None:
            text_ids = [1] + S0ULTokenizer().encode("Wait.") + [3]
            records.append(write_case(args.output, "full-text", model, text_ids, 2,
                                      source_kind=source + "; end-to-end text request", prompt_text="Wait."))
    (args.output / "fixtures.json").write_text(json.dumps(records, indent=2) + "\n")
    print(json.dumps({"output": str(args.output), "fixtures": records}, indent=2))


if __name__ == "__main__":
    main()
