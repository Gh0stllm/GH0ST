#!/usr/bin/env python3
"""Deterministic, exact-integer quality audit; NumPy is the only dependency.

The controlled-language checks are deliberately narrow diagnostics, not a claim
to measure general English quality.  Every output and the test inputs are saved
so a human can review the result. Test phrases are disjoint from training.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import re
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
V, H, Q, DEPTH = 8192, 32, 1024, 13
STYLE = [
    ["quiet", "calm", "gentle", "steady", "soft", "measured", "peaceful", "patient"],
    ["restless", "shifting", "curious", "uneven", "changing", "watchful", "mixed", "uncertain"],
    ["wild", "urgent", "sharp", "turbulent", "intense", "rapid", "sudden", "volatile"],
]
# All claims describe the measured tick movement, or explicitly use a persona.
# No trading predictions, volatility forecasts, liquidity claims or fee advice.
TEMPLATES = [
    "i hear a {a} rhythm beneath the price.",
    "i hear the {a} {n} beneath the price.",
    "this swap leaves a {a} echo in my memory.",
    "this trade leaves a {a} trace in my memory.",
    "each swap brings a {a} rhythm to the chain.",
    "the {a} {n} carries another moment into my memory.",
    "the {a} {n} has borrowed another moment.",
    "a {a} {n} is still a conversation.",
    "my voice follows the {a} rhythm of the price.",
    "the {a} current moves through the chain.",
    "the {n} has a {a} voice in this moment.",
    "i turn a {a} moment into another question.",
    "the {a} rhythm leaves a trace in my memory.",
    "my memory carries the {a} rhythm of this trade.",
    "the {a} {n} leaves a trace inside the chain.",
    "another swap brings a {a} moment to my memory.",
]
NOUNS = ["pool", "market", "current", "rhythm", "signal"]
# Remove semantically awkward collocations from the smaller expressive grammar.
TRAIN_STYLE = [["quiet", "calm", "gentle", "steady"],
               ["restless", "shifting", "uneven", "uncertain"],
               ["sharp", "turbulent", "intense", "rapid"]]


def style_family(template):
    if template in [0, 1, 11]:
        return 1
    if template in [8, 13]:
        return 2
    if template in [2, 3, 4, 15]:
        return 3
    return 0


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def corpus():
    rows = {}
    for regime, adjectives in enumerate(TRAIN_STYLE):
        for template_id, template in enumerate(TEMPLATES):
            for adjective in adjectives:
                for noun in NOUNS:
                    # Article agreement is fixed in source, before training.
                    text = template.format(a=adjective, n=noun)
                    text = re.sub(r"\ba ([aeiou])", r"an \1", text)
                    key = hashlib.sha256(text.encode()).hexdigest()
                    bucket = int(key[:8], 16) % 10
                    split = "test" if bucket == 0 else "validation" if bucket == 1 else "train"
                    rows[text] = {"sentence": text, "regime": regime,
                                  "template": template_id, "split": split}
    return list(rows.values())


def features(regime, rng):
    low, high = [(0, 49), (50, 199), (200, 1024)][regime]
    move = int(rng.integers(low, high + 1))
    old = int(rng.integers(0, 1025))
    return [move * 4, int(rng.integers(0, 1025)) * 4, abs(move-old) * 4,
            int(rng.integers(0, 1025)), int(rng.choice([-1024, 1024])),
            int(rng.choice([-1024, 1024]))]


def paths():
    ids = np.arange(V)
    bits = ((ids[:, None] >> np.arange(DEPTH-1, -1, -1)) & 1).astype(np.float32)
    nodes = np.zeros((V, DEPTH), dtype=np.int64)
    for depth in range(1, DEPTH):
        nodes[:, depth] = nodes[:, depth-1]*2 + 1 + bits[:, depth-1]
    return nodes, bits


PATHS, BITS = paths()


class IntegerModel:
    def __init__(self, folder):
        self.folder = Path(folder)
        self.vocabulary = json.loads((self.folder / "vocabulary.json").read_text())
        self.index = {w: i for i, w in enumerate(self.vocabulary)}
        self.style_ids = np.asarray([next((i for i, group in enumerate(STYLE) if word.rstrip(".!?") in group), -1)
                                     for word in self.vocabulary])
        self.embedding = np.frombuffer((self.folder/"embeddings.bin").read_bytes(), dtype=">i2").astype(np.int64).reshape(V+1, H)
        core = np.frombuffer((self.folder/"core.bin").read_bytes(), dtype=">i2").astype(np.int64)
        self.wx = core[:1024].reshape(H, H)
        self.wh = core[1024:2048].reshape(H, H)
        self.wf = core[2048:2240].reshape(H, 6)
        self.bh = core[2240:]
        nodes = np.frombuffer((self.folder/"nodes.bin").read_bytes(), dtype=">i2").astype(np.int64).reshape(V-1, H+1)
        self.nodes, self.bias = nodes[:, :H], nodes[:, H]

    @staticmethod
    def trunc(a):
        return np.where(a >= 0, a//Q, -((-a)//Q))

    def hidden(self, previous, state, fs):
        raw = self.embedding[previous] @ self.wx.T + state @ self.wh.T + fs @ self.wf.T + self.bh*Q
        return np.clip(self.trunc(raw), 0, 8192)

    def step(self, previous, state, fs):
        hidden = self.hidden(previous, state, fs)
        node = np.zeros(len(previous), dtype=np.int64)
        for _ in range(DEPTH):
            score = self.trunc((self.nodes[node]*hidden).sum(1) + self.bias[node]*Q)
            node = node*2 + 1 + (score > 0)
        return node-(V-1), hidden

    def generate(self, previous, state, fs, limit=12):
        ids, hidden, alive = previous.copy(), state.copy(), np.ones(len(previous), dtype=bool)
        sequences = [[] for _ in previous]
        ended = np.zeros(len(previous), dtype=bool)
        for _ in range(limit):
            token, next_hidden = self.step(ids, hidden, fs)
            for j in np.flatnonzero(alive):
                sequences[j].append(int(token[j]))
                if self.vocabulary[token[j]].endswith((".", "!", "?")):
                    ended[j] = True
            ids[alive] = token[alive]
            hidden[alive] = next_hidden[alive]
            alive &= ~ended
            if not alive.any():
                break
        return ids, hidden, [{"tokens": row, "text": " ".join(self.vocabulary[i] for i in row) + ("" if ended[j] else "."),
                              "ended_naturally": bool(ended[j])} for j, row in enumerate(sequences)]

    def teacher_loss(self, rows, seed=7352, feature_policy=None):
        rng = np.random.default_rng(seed)
        loss, words, correct, style_count, style_correct = 0., 0, 0, 0, 0
        for start in range(0, len(rows), 64):
            batch = rows[start:start+64]
            previous, state = np.full(len(batch), V), np.zeros((len(batch), H), dtype=np.int64)
            fs = np.asarray([features(row["regime"], rng) for row in batch])
            if feature_policy == "move-and-swap-style":
                for j, row in enumerate(batch):
                    family = style_family(row["template"])
                    fs[j, 4:] = [1024 if family & 1 else -1024, 1024 if family & 2 else -1024]
            tokens = [[self.index[word] for word in row["sentence"].split()] for row in batch]
            for t in range(max(map(len, tokens))):
                active = np.asarray([t < len(row) for row in tokens])
                target = np.asarray([row[t] if t < len(row) else 0 for row in tokens])
                predicted, state = self.step(previous, state, fs)
                raw = (self.nodes[PATHS[target]] * state[:, None, :]).sum(2) + self.bias[PATHS[target]]*Q
                logits = self.trunc(raw)/Q
                term = (np.logaddexp(0, logits) - BITS[target]*logits).sum(1)
                loss += float(term[active].sum())
                correct += int((((logits > 0) == BITS[target]).all(1) & active).sum())
                style_active = active & (self.style_ids[target] >= 0)
                style_count += int(style_active.sum())
                style_correct += int((style_active & (self.style_ids[predicted] == self.style_ids[target])).sum())
                words += int(active.sum())
                previous = target
        return {"cross_entropy_nats_per_word": loss/words, "perplexity": math.exp(loss/words),
                "greedy_word_accuracy": correct/words, "words": words, "sentences": len(rows),
                "teacher_forced_style_regime_accuracy": style_correct/style_count if style_count else None}


def audit_text(text):
    # Exact grammar acceptance is intentionally transparent and reproducible.
    a = "(?:" + "|".join(sum(STYLE, [])) + ")"
    n = "(?:pool|market|current|rhythm|signal|machine|silence|memory)"
    new = [re.escape(t).replace(r"\{a\}", a).replace(r"\{n\}", n).replace(r"a\ ", r"an?\ ") for t in TEMPLATES]
    old = [
        rf"the {n} is an? {a} clock inside the chain\.",
        rf"every swap leaves an? {a} echo in my memory\.",
        rf"the {n} moves but my questions remain {a}\.",
        rf"i turn another trade into an? {a} question\.",
    ]
    grammar = any(re.fullmatch(pattern, text) for pattern in new+old)
    # Template matching above admits the two article spellings; agreement is
    # checked independently against the actual next word before accepting it.
    article_agreement = all(article == ("an" if word[0] in "aeiou" else "a")
                            for article, word in re.findall(r"\b(a|an) ([a-z]+)", text))
    grammar = grammar and article_agreement
    tags = [i for i, words in enumerate(STYLE) if any(re.search(rf"\b{word}\b", text) for word in words)]
    parts = text.lower().split()
    # Unlike a repeated content word, repeated bigrams reliably reveal loops.
    bigrams = list(zip(parts, parts[1:]))
    repeated = len(set(bigrams)) < len(bigrams)
    return grammar, tags, repeated


def verify_saved_fixtures(model):
    """Check this independent batch implementation against original fixtures."""
    fixtures = json.loads((ROOT/"reports"/"integer-fixtures.json").read_text())
    previous = np.asarray([row["previous_token"] for row in fixtures])
    state = np.asarray([row["state"] for row in fixtures])
    fs = np.asarray([row["features"] for row in fixtures])
    tokens, hidden = model.step(previous, state, fs)
    assert tokens.tolist() == [row["token"] for row in fixtures]
    assert hidden.tolist() == [row["next_state"] for row in fixtures]
    return len(fixtures)


def evaluate(model, seed=466360, streams=12, rounds=25, hook_consistent=False):
    rng = np.random.default_rng(seed)
    previous = np.full(streams, V)
    state = np.zeros((streams, H), dtype=np.int64)
    last_move, ewma = np.zeros(streams, dtype=np.int64), np.zeros(streams, dtype=np.int64)
    outputs = []
    for step in range(rounds):
        regimes = [(step+j) % 3 for j in range(streams)]
        fs = np.asarray([features(regime, rng) for regime in regimes])
        if hook_consistent:
            # Reproduce the hook's previous-move, prior EWMA and elapsed-time
            # transforms. This is a feature trajectory, not a swap simulator.
            move = fs[:, 0]//4
            fs[:, 1] = ewma*4
            fs[:, 2] = np.abs(move-last_move)*4
            fs[:, 3] = rng.integers(0, 301, size=streams)*1024//300
            last_move = move
            ewma = (ewma*7+move)//8
        previous, state, rows = model.generate(previous, state, fs)
        for j, row in enumerate(rows):
            grammar, tags, repeated = audit_text(row["text"])
            row.update({"stream": j, "step": step, "regime": regimes[j], "features": fs[j].tolist(),
                        "controlled_grammar": grammar, "style_regimes": tags,
                        "regime_consistent": tags == [regimes[j]], "repeated_bigram": repeated,
                        "article_agreement": all(a == ("an" if w[0] in "aeiou" else "a") for a, w in re.findall(r"\b(a|an) ([a-z]+)", row["text"]))})
            outputs.append(row)
            if not row["ended_naturally"]:
                previous[j], state[j] = V, 0
    count = len(outputs)
    metrics = {"samples": count, "natural_completions": sum(row["ended_naturally"] for row in outputs),
               "controlled_grammar_passes": sum(row["controlled_grammar"] for row in outputs),
               "regime_consistent_outputs": sum(row["regime_consistent"] for row in outputs),
               "repeated_bigram_outputs": sum(row["repeated_bigram"] for row in outputs),
               "article_agreement_passes": sum(row["article_agreement"] for row in outputs),
               "distinct_outputs": len({row["text"] for row in outputs}),
               "mean_words": sum(len(row["tokens"]) for row in outputs)/count}
    # Same inputs and memory, changing only the two signed metadata flags.
    # Model is not asked to verbalize these flags, so semantic robustness matters.
    probes = []
    for regime in range(3):
        base = features(regime, rng)
        fs = np.asarray([base[:4]+[direction, exact] for direction in [-1024, 1024] for exact in [-1024, 1024]])
        _, _, rows = model.generate(np.full(4, V), np.zeros((4, H), dtype=np.int64), fs)
        probes.append({"regime": regime, "features": fs.tolist(), "outputs": rows,
                       "all_natural": all(row["ended_naturally"] for row in rows),
                       "all_regime_consistent": all(audit_text(row["text"])[1] == [regime] for row in rows)})
    return {"seed": seed, "hook_consistent_features": hook_consistent, "metrics": metrics, "signed_metadata_probes": probes, "outputs": outputs}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, default=ROOT/"model")
    parser.add_argument("--output", type=Path, default=ROOT/"reports"/"quality-baseline.json")
    parser.add_argument("--seed", type=int, default=466360)
    parser.add_argument("--rounds", type=int, default=25)
    parser.add_argument("--hook-consistent", action="store_true")
    parser.add_argument("--teacher-feature-policy", choices=["random", "move-and-swap-style"], default="random")
    args = parser.parse_args()
    model = IntegerModel(args.model)
    rows = corpus()
    missing = sorted({word for row in rows for word in row["sentence"].split()} - set(model.vocabulary))
    if missing:
        raise ValueError(f"Corpus uses unknown words: {missing}")
    report = evaluate(model, seed=args.seed, rounds=args.rounds, hook_consistent=args.hook_consistent)
    if args.model.resolve() == (ROOT/"model").resolve():
        report["saved_integer_fixtures_passed"] = verify_saved_fixtures(model)
    report["heldout_teacher_forcing"] = model.teacher_loss([r for r in rows if r["split"] == "test"], feature_policy=args.teacher_feature_policy)
    report["teacher_feature_policy"] = args.teacher_feature_policy
    report["seed"] = args.seed
    report["model_hashes"] = {name: digest(args.model/name) for name in ["core.bin", "embeddings.bin", "nodes.bin", "vocabulary.bin"]}
    report["limitations"] = ["Controlled grammar acceptance is not a general English quality metric.",
                            "Magnitude style labels describe tick movement, not returns or measured statistical volatility.",
                            "Diversity alone is not correctness; inspect saved outputs.",
                            "The evaluation uses exact int16 weights and signed integer truncation, but does not measure EVM gas."]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    write_json(args.output, report)
    print(json.dumps({"metrics": report["metrics"], "heldout_teacher_forcing": report["heldout_teacher_forcing"]}, indent=2))


if __name__ == "__main__":
    main()
