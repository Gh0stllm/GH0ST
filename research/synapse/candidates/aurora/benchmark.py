"""Screen the pinned, manually inspected Aurora source; no remote code loading."""
import hashlib
import importlib.util
import json
from pathlib import Path

import torch
from tokenizers import Tokenizer, decoders

ROOT = Path(__file__).resolve().parent
torch.set_num_threads(4)
torch.manual_seed(5102026)
manifest = json.loads((ROOT / "download-manifest.json").read_text())
for name, info in manifest["files"].items():
    assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == info["sha256"]
# Inference.py was read in full: standard torch module definitions, no networking,
# shell calls or executable top-level code other than imports and BASE_DIR.
spec = importlib.util.spec_from_file_location("inspected_aurora", ROOT / "Inference.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
model = module.Aurora80K()
weights = torch.load(ROOT / "Aurora-80K.pt", map_location="cpu", weights_only=True)
model.load_state_dict(weights)
model.eval()
tokenizer = Tokenizer.from_file(str(ROOT / "tokenizer.json"))
original_decoder = tokenizer.decoder
tokenizer.decoder = decoders.ByteLevel()


def generate(prompt, temperature, maximum=48, joint=False):
    ids = tokenizer.encode(prompt).ids
    original_length = len(ids)
    with torch.inference_mode():
        for _ in range(maximum):
            clusters, _, h = model(torch.tensor([ids[-256:]]))
            if joint:
                sub_h = h[0, -1].unsqueeze(0) + model.cluster_emb.weight
                sub_logp = torch.log_softmax(torch.nn.functional.linear(sub_h, model.sub_emb.weight), dim=-1)
                joint_logp = torch.log_softmax(clusters[0, -1], dim=-1).unsqueeze(1) + sub_logp
                tid = module.pick(joint_logp.reshape(-1).clone(), temperature, 40)
            else:
                cid = module.pick(clusters[0, -1].clone(), temperature, 20)
                sub_h = h[0, -1] + model.cluster_emb(torch.tensor(cid))
                subs = torch.nn.functional.linear(sub_h, model.sub_emb.weight)
                sid = module.pick(subs.clone(), temperature, 20)
                tid = cid * 64 + sid
            ids.append(tid)
            if tid == tokenizer.token_to_id("<eos>"):
                break
    return {"prompt": prompt, "temperature": temperature, "sampler": "joint4096" if joint else "nativeClusterFirst", "newTokenIds": ids[original_length:],
            "continuation": tokenizer.decode(ids[original_length:]), "fullText": tokenizer.decode(ids)}


prompts = ["The sun is", "Artificial intelligence", "Robinhood is", "A proof is", "Paris is the capital of"]
results = {"revision": manifest["revision"], "sourceInspectedBeforeExecution": True,
           "checkpointLoad": "torch.load weights_only=True; no pickle object execution",
           "parameterCount": sum(p.numel() for p in model.parameters()),
           "tensorShapes": {key: list(value.shape) for key, value in weights.items()},
           "tokenizerVocabularySize": tokenizer.get_vocab_size(),
           "presentationFix": "Original tokenizer has ByteLevel pre-tokenizer but decoder:null; local ByteLevel decoder restores spaces without altering token IDs/model logits.",
           "samples": [generate(prompt, temperature, joint=joint) for prompt in prompts for temperature in (0.0, 0.6) for joint in (False, True)],
           "macEstimate": {"cachedNextTokenMatrixMACsExcludingAttention": 79616,
                           "attentionMACsPerContextToken": 192, "atContext256": 128768,
                           "excludes": ["RMSNorm", "softmax", "sigmoid", "ALiBi", "KV storage", "gas"]}}
(ROOT / "results.json").write_text(json.dumps(results, indent=2) + "\n")
print(json.dumps(results, indent=2))
