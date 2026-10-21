"""Generate an inspected action proposal; never submit or execute a transaction."""
import argparse
import json
import time

import torch

from .actions import parse_action
from .evaluate import load_checkpoint
from .tokenizer import S0ULTokenizer


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--max-new-tokens", type=int, default=32)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    if args.threads < 1 or args.max_new_tokens < 1:
        raise ValueError("threads and generation budget must be positive")
    torch.set_num_threads(args.threads)
    torch.use_deterministic_algorithms(True)
    model, checkpoint = load_checkpoint(args.checkpoint)
    tokenizer = S0ULTokenizer()
    prefix = [tokenizer.bos_id] + tokenizer.encode(args.prompt) + [tokenizer.sep_id]
    budget = min(args.max_new_tokens, model.config.max_seq_len - len(prefix))
    if budget <= 0:
        raise ValueError("prompt leaves no output context")
    started = time.monotonic()
    ids = model.generate(torch.tensor([prefix]), budget)[0, len(prefix):].tolist()
    terminated = tokenizer.eos_id in ids
    if terminated:
        ids = ids[:ids.index(tokenizer.eos_id)]
    output = tokenizer.decode(ids)
    forbidden = any(token in (tokenizer.pad_id, tokenizer.bos_id, tokenizer.sep_id) for token in ids)
    error, action = None, None
    try:
        if forbidden or not terminated:
            raise ValueError("invalid control token or missing EOS")
        action = parse_action(output).to_dict()
    except ValueError as exc:
        error = str(exc)
    print(json.dumps({"model": "GH0ST S0UL-1M", "mode": "float32_local_reference",
                      "prompt": args.prompt, "prediction": output, "valid_action": action,
                      "validation_error": error, "terminated_with_eos": terminated,
                      "elapsed_seconds": time.monotonic() - started,
                      "executed": False, "selected_training_step": checkpoint["training"]["step"]}, indent=2))


if __name__ == "__main__":
    main()
