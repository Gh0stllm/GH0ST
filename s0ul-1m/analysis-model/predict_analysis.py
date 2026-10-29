"""Run the actual adapted transformer; never synthesize a fallback report."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from analysis_codec import decode_words, encode_features, sha256, vocabulary_spec
from integer_cached import CachedInteger


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", required=True, type=Path)
    parser.add_argument("--features", required=True, help="JSON array of fourteen canonical feature values")
    parser.add_argument("--integer-bundle", type=Path, default=Path(__file__).parent / "evaluation-v2/integer")
    parser.add_argument("--checkpoint", type=Path, help="explicitly use floating-point checkpoint instead of integer bundle")
    parser.add_argument("--capture-logits", action="store_true")
    args = parser.parse_args()
    sys.path.insert(0, str(args.source_root.resolve()))
    features = json.loads(args.features)
    prompt = encode_features(features)
    result = {"features": features, "prompt_ids": prompt, "codec": vocabulary_spec(),
              "scope": "finite authored-observation capability pilot; no analyst/security/investment claim"}
    if args.checkpoint:
        import torch
        from s0ul.model import ModelConfig, S0ULModel
        torch.set_num_threads(4)
        saved = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
        if saved.get("format") != "s0ul-analysis-training-v1" or saved.get("codec") != vocabulary_spec():
            raise ValueError("checkpoint/codec mismatch")
        model = S0ULModel(ModelConfig(**saved["config"]))
        model.load_state_dict(saved["model_state_dict"], strict=True)
        model.eval()
        ids = model.generate(torch.tensor([prompt]), 32)[0].tolist()[len(prompt):]
        result.update(runtime="float32 transformer greedy argmax", checkpoint_sha256=sha256(args.checkpoint.read_bytes()))
    else:
        from s0ul.integer import IntegerModel
        codec = json.loads((args.integer_bundle / "analysis-codec.json").read_text())
        if codec != vocabulary_spec():
            raise ValueError("integer bundle/codec mismatch")
        model = IntegerModel.load(args.integer_bundle)
        if args.capture_logits:
            ids, logits = CachedInteger(model).generate(prompt, capture=True)
            result["decision_logits"] = logits
        else:
            ids = CachedInteger(model).generate(prompt)
        result.update(runtime="integer-v1 transformer greedy argmax", saturation_count=model.saturation_count,
                      checkpoint_sha256=model.source_checkpoint_sha256,
                      integer_manifest_sha256=sha256((args.integer_bundle / "integer-manifest.json").read_bytes()))
    result["output_ids"] = ids
    # Invalid output is a visible failure. This module never imports dataset.label.
    result["generated_analysis"] = decode_words(ids)
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
