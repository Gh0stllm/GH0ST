#!/usr/bin/env python3
"""Original-domain 22,720-parameter candidate; fixed held-out compositions."""
import hashlib
import copy
import json
import math
from collections import Counter
from pathlib import Path

import numpy as np
import torch
from torch import nn

ROOT = Path(__file__).resolve().parent
SEED, WIDTH, CONTEXT, SCALE = 5102026, 32, 4, 256
torch.set_num_threads(4)
torch.manual_seed(SEED)
torch.use_deterministic_algorithms(True)

CORE = """robinhood is home for ghost
icp runs inference for ghost
ghost uses robinhood as home
ghost uses icp for inference
the model reads tokens and predicts the next token
the expert reads context and returns hidden values
the shared head scores the next token
two experts share the same backbone and head
each expert can be swapped with a compatible expert
a new expert must use the same hidden width
the router combines expert outputs before the head
the chain stores weights and executes integer math
integer division rounds toward zero
the token with the highest score is returned
ties choose the first token
a local test proves local behavior
a live receipt proves a confirmed execution
a source receipt does not prove delivery
check the destination receipt before claiming delivery
a plan is not a deployed model
a queued job is not a completed job
a replay is not a live execution
saved state is not final proof
check the recipient amount and final balance
keep proof links with the exact output
model quality needs held out tests
training accuracy does not measure general quality
the worker waits for a confirmed receipt
the worker stops when state is unclear
read the journal before changing the worker
do not restart a live worker without approval
do not send funds without approval
keep costs and limits clear before execution
the corpus uses original synthetic text""".splitlines()

CLAUSES = ["the model reads tokens", "the expert reads context", "the router combines outputs",
           "the head scores tokens", "the chain stores weights", "the worker reads the journal",
           "the worker waits for proof", "the worker reads the receipt", "the worker stops",
           "the model predicts the next token", "the expert returns hidden values",
           "the head returns the next token"]
HELD_OUT = ["a replay does not prove delivery", "a local test does not prove delivery",
            "a queued job is not final proof", "saved state does not prove delivery",
            "a confirmed receipt does not measure general quality",
            "the worker reads context before execution", "the model reads tokens before the head",
            "check the destination receipt and final balance", "the expert uses the same hidden width",
            "icp runs inference and robinhood is home",
            "the router combines hidden values before the shared head",
            "the chain executes integer math and stores weights"]


def write(name, value):
    path = ROOT / name
    path.write_text(json.dumps(value, indent=2) + "\n")
    return hashlib.sha256(path.read_bytes()).hexdigest()


composed = [f"{a} and {b}" for i, a in enumerate(CLAUSES) for j, b in enumerate(CLAUSES) if i != j]
held_composed = [text for i, text in enumerate(composed) if i % 7 == 0]
train_sentences = CORE + CLAUSES + [text for text in composed if text not in held_composed]
test_sentences = HELD_OUT + held_composed
assert not set(train_sentences) & set(test_sentences)
vocab = ["<bos>", "<eos>", "<unk>"] + sorted(set(" ".join(CORE).split()))
assert len(vocab) == 128, len(vocab)
lookup = {word: index for index, word in enumerate(vocab)}
assert all(word in lookup for sentence in test_sentences for word in sentence.split())
corpus = {"provenance": {"creator": "GH0ST SYNAPSE project; original AI-assisted synthetic text",
                        "license": "CC0-1.0", "created": "2026-11-10", "externalDataset": False,
                        "meaning": "Project-specific mechanics and evidence rules; synthetic text, not a factual knowledge benchmark."},
          "train": train_sentences, "heldOut": test_sentences,
          "split": "Held-out hand-authored recombinations plus every seventh ordered clause pairing; never used for gradients or model selection."}
corpus_hash = write("corpus.json", corpus)


def examples(sentences):
    contexts, labels = [], []
    for sentence in sentences:
        ids = [0] * CONTEXT + [lookup[word] for word in sentence.split()] + [1]
        for index in range(CONTEXT, len(ids)):
            contexts.append(ids[index-CONTEXT:index]); labels.append(ids[index])
    return torch.tensor(contexts), torch.tensor(labels)


class Network(nn.Module):
    def __init__(self):
        super().__init__()
        self.embeddings = nn.ModuleList([nn.Embedding(len(vocab), WIDTH) for _ in range(CONTEXT)])
        self.experts = nn.ModuleList([nn.Linear(WIDTH, WIDTH) for _ in range(2)])
        self.head = nn.Linear(WIDTH, len(vocab))
        for embedding in self.embeddings:
            nn.init.normal_(embedding.weight, std=0.25)

    def forward(self, tokens):
        hidden = torch.relu(sum(self.embeddings[i](tokens[:, i]) for i in range(CONTEXT)))
        merged = sum(torch.relu(expert(hidden)) for expert in self.experts) / 2
        return self.head(merged)


def quantize(tensor):
    return np.rint(tensor.detach().cpu().numpy() * SCALE).astype(np.int64).reshape(-1).tolist()


def tdiv(value, denominator):
    return (1 if value >= 0 else -1) * (abs(value) // denominator)


def integer_forward(model, ids, override=None):
    assert len(ids) == CONTEXT
    hidden = [max(0, min(32767, sum(model["embeddings"][(p * len(vocab) + ids[p]) * WIDTH + j] for p in range(CONTEXT))))
              for j in range(WIDTH)]
    activations = []
    for index, original in enumerate(model["experts"]):
        expert = override if index == 1 and override is not None else original
        activations.append([max(0, min(32767, tdiv(sum(expert["weights"][o * WIDTH + j] * hidden[j]
                                                    for j in range(WIDTH)), SCALE) + expert["bias"][o]))
                            for o in range(WIDTH)])
    merged = [tdiv(activations[0][j] + activations[1][j], 2) for j in range(WIDTH)]
    logits = [tdiv(sum(model["headWeights"][o * WIDTH + j] * merged[j] for j in range(WIDTH)), SCALE)
              + model["headBias"][o] for o in range(len(vocab))]
    return {"hidden": hidden, "expertActivations": activations, "merged": merged,
            "logits": logits, "token": max(range(len(vocab)), key=logits.__getitem__)}


def export(network):
    return {"schema": "gh0st-synapse-model-v2", "id": "synapse-domain-128x4x32-v2",
            "scale": SCALE, "contextSize": CONTEXT, "hiddenSize": WIDTH, "activationMax": 32767,
            "vocab": vocab, "embeddings": sum([quantize(e.weight) for e in network.embeddings], []),
            "experts": [{"id": f"domain-expert-{i}", "weights": quantize(e.weight), "bias": quantize(e.bias)}
                        for i, e in enumerate(network.experts)],
            "headWeights": quantize(network.head.weight), "headBias": quantize(network.head.bias),
            "training": {"method": "PyTorch AdamW CPU, full batch", "steps": 2500, "seed": SEED,
                         "learningRate": 0.018, "weightDecay": 0.0001, "corpusSha256": corpus_hash,
                         "coreFactExtraExposureRepeats": 5,
                         "torchVersion": torch.__version__, "floatType": "float32"},
            "provenance": corpus["provenance"]}


train_x, train_y = examples(train_sentences)
core_x, core_y = examples(CORE)
fit_x = torch.cat([train_x] + [core_x] * 5)
fit_y = torch.cat([train_y] + [core_y] * 5)
test_x, test_y = examples(test_sentences)
network = Network()
optimizer = torch.optim.AdamW(network.parameters(), lr=0.018, weight_decay=0.0001)
for step in range(2500):
    optimizer.zero_grad()
    logits = network(fit_x)
    loss = nn.functional.cross_entropy(logits, fit_y)
    loss.backward()
    optimizer.step()
    if step in (0, 999, 2499):
        print(json.dumps({"step": step + 1, "loss": loss.item(),
                          "weightedTrainAccuracy": (logits.argmax(-1) == fit_y).float().mean().item()}), flush=True)
model = export(network)
train_contexts = {tuple(row) for row in train_x.tolist()}


def evaluate(x, y):
    with torch.inference_mode():
        logits = network(x)
        float_predictions = logits.argmax(-1).numpy()
        cross_entropy = nn.functional.cross_entropy(logits, y).item()
    traces = [integer_forward(model, row) for row in x.tolist()]
    integer_predictions = np.array([trace["token"] for trace in traces])
    unseen = np.array([tuple(row) not in train_contexts for row in x.tolist()])
    return {"examples": len(y), "integerTop1Accuracy": float((integer_predictions == y.numpy()).mean()),
            "floatTop1Accuracy": float((float_predictions == y.numpy()).mean()),
            "floatCrossEntropyNats": cross_entropy, "floatPerplexity": math.exp(cross_entropy),
            "integerFloatAgreement": float((integer_predictions == float_predictions).mean()),
            "unseenContextExamples": int(unseen.sum()),
            "unseenContextIntegerAccuracy": float((integer_predictions[unseen] == y.numpy()[unseen]).mean()) if unseen.any() else None,
            "maximumHiddenActivation": max(max(trace["hidden"]) for trace in traces),
            "maximumExpertActivation": max(max(row) for trace in traces for row in trace["expertActivations"])}


metrics = {"parameterCount": sum(p.numel() for p in network.parameters()), "vocabularySize": len(vocab),
           "contextSize": CONTEXT, "hiddenSize": WIDTH, "matrixMACsPerToken": 2 * WIDTH * WIDTH + len(vocab) * WIDTH,
           "trainingSentences": len(train_sentences), "heldOutSentences": len(test_sentences),
           "train": evaluate(train_x, train_y), "heldOut": evaluate(test_x, test_y),
           "limitation": "Held-out sentences use the same authored grammar and vocabulary; this is narrow-domain recombination, not general reasoning."}
model["metrics"] = metrics
model_hash = write("model.json", model)


def complete(prompt, maximum=20):
    words = prompt.split()
    ids = [0] * CONTEXT + [lookup.get(word, 2) for word in words]
    new = []
    for _ in range(maximum):
        token = integer_forward(model, ids[-CONTEXT:])["token"]
        ids.append(token)
        if token == 1:
            break
        new.append(vocab[token])
    return {"prompt": prompt, "continuation": " ".join(new), "newTokenIds": ids[len(words)+CONTEXT:]}


prompts = ["a source receipt does", "a local test", "a queued job is", "the model reads",
           "the expert reads", "integer division", "icp runs inference and", "the chain stores weights and the expert reads",
           "check the destination receipt", "robinhood is"]
samples = [complete(prompt) for prompt in prompts]

# Restore every component from the exported integers before training only expert 1.
alternate_network = copy.deepcopy(network)
with torch.no_grad():
    for index, embedding in enumerate(alternate_network.embeddings):
        values = model["embeddings"][index * len(vocab) * WIDTH:(index+1) * len(vocab) * WIDTH]
        embedding.weight.copy_(torch.tensor(values).reshape(len(vocab), WIDTH) / SCALE)
    for index, expert in enumerate(alternate_network.experts):
        expert.weight.copy_(torch.tensor(model["experts"][index]["weights"]).reshape(WIDTH, WIDTH) / SCALE)
        expert.bias.copy_(torch.tensor(model["experts"][index]["bias"]) / SCALE)
    alternate_network.head.weight.copy_(torch.tensor(model["headWeights"]).reshape(len(vocab), WIDTH) / SCALE)
    alternate_network.head.bias.copy_(torch.tensor(model["headBias"]) / SCALE)
for parameter in alternate_network.parameters():
    parameter.requires_grad_(False)
for parameter in alternate_network.experts[1].parameters():
    parameter.requires_grad_(True)
alt_targets = fit_y.clone()
selection = (fit_x[:, -3:] == torch.tensor([lookup["the"], lookup["expert"], lookup["reads"]])).all(dim=1)
alt_targets[selection] = lookup["tokens"]
alt_fit_x = torch.cat([fit_x, fit_x[selection].repeat(8, 1)])
alt_fit_y = torch.cat([alt_targets, alt_targets[selection].repeat(8)])
alt_optimizer = torch.optim.AdamW(alternate_network.experts[1].parameters(), lr=0.008, weight_decay=0.0001)
for step in range(1600):
    alt_optimizer.zero_grad()
    alt_loss = nn.functional.cross_entropy(alternate_network(alt_fit_x), alt_fit_y)
    alt_loss.backward()
    alt_optimizer.step()
alternate = {"schema": "gh0st-synapse-expert-v2", "id": "domain-expert-reads-tokens-v2",
             "replaceExpertIndex": 1, "compatibleModelSha256": model_hash, "scale": SCALE,
             "hiddenSize": WIDTH, "activationMax": 32767,
             "weights": quantize(alternate_network.experts[1].weight),
             "bias": quantize(alternate_network.experts[1].bias),
             "training": {"method": "AdamW CPU; only expert1 weights/bias trained", "steps": 1600,
                          "learningRate": 0.008, "sameProjectAuthorship": True,
                          "frozenComponents": ["embeddings", "expert0", "headWeights", "headBias"],
                          "changedTarget": "Contexts ending the expert reads target tokens instead of context"}}
demonstration_context = [0, lookup["the"], lookup["expert"], lookup["reads"]]
base_token = integer_forward(model, demonstration_context)["token"]
alternate_token = integer_forward(model, demonstration_context, alternate)["token"]
assert base_token == lookup["context"], "base must learn demonstration context"
assert alternate_token == lookup["tokens"], "alternate expert must alter demonstration output"
alternate["demonstration"] = {"tokens": demonstration_context, "words": [vocab[i] for i in demonstration_context],
                              "baseToken": base_token, "baseWord": vocab[base_token],
                              "alternateToken": alternate_token, "alternateWord": vocab[alternate_token]}
alternate_hash = write("alternate-expert.json", alternate)
write("results.json", {"modelSha256": model_hash, "metrics": metrics, "samples": samples,
                       "alternateDemonstration": alternate["demonstration"]})
fixture_rows = list(dict.fromkeys(tuple(row) for row in train_x.tolist()))
chosen = [tuple(demonstration_context)] + fixture_rows[::max(1, len(fixture_rows)//30)] + test_x[:15].tolist()
chosen = list(dict.fromkeys(tuple(row) for row in chosen))
fixtures = [{"id": f"base-{index:03d}", "variant": "base", "tokens": row,
             "words": [vocab[i] for i in row], "expected": integer_forward(model, row)}
            for index, row in enumerate(chosen)]
fixtures += [{"id": f"alternate-{index:03d}", "variant": "alternate", "tokens": row,
              "words": [vocab[i] for i in row], "expected": integer_forward(model, row, alternate)}
             for index, row in enumerate(chosen[:8])]
fixtures_hash = write("fixtures.json", {"schema": "gh0st-synapse-fixtures-v2", "modelSha256": model_hash,
                                       "alternateExpertSha256": alternate_hash, "fixtures": fixtures})
write("manifest.json", {"corpus.json": corpus_hash, "model.json": model_hash,
                        "alternate-expert.json": alternate_hash, "fixtures.json": fixtures_hash})
print(json.dumps({"metrics": metrics, "samples": samples, "modelSha256": model_hash,
                  "alternateDemonstration": alternate["demonstration"]}, indent=2), flush=True)
