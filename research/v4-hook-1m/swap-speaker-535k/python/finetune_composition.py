#!/usr/bin/env python3
"""Fast local compositional fine-tuning; existing models remain untouched."""
from __future__ import annotations
import argparse
import collections
import hashlib
import json
import re
import time
from pathlib import Path
import numpy as np
from quality_eval import ROOT, IntegerModel, evaluate, write_json, digest
from finetune_quality import TrainModel, batch_data

STYLE = [["quiet", "gentle", "steady", "soft"], ["restless", "shifting", "uneven", "changing"], ["sharp", "rapid", "turbulent", "wild"]]
OBJECTS = {
    "quiet": ["echo", "rhythm", "signal", "sound", "voice"],
    "gentle": ["rhythm", "current", "sound", "voice", "movement"],
    "steady": ["rhythm", "current", "movement", "signal", "pattern"],
    "soft": ["echo", "sound", "voice", "song"],
    "restless": ["current", "rhythm", "voice", "signal"],
    "shifting": ["current", "pattern", "signal", "movement"],
    "uneven": ["rhythm", "movement", "signal", "sound"],
    "changing": ["pattern", "current", "movement", "signal"],
    "sharp": ["echo", "signal", "sound", "voice", "change"],
    "rapid": ["movement", "current", "rhythm", "change"],
    "turbulent": ["current", "rhythm", "movement"],
    "wild": ["current", "rhythm", "voice", "song"],
}
FAMILIES = [
    (["the pool", "the market", "the current", "the signal", "this trade", "each swap"], ["carries", "leaves", "brings"], 5),
    (["i"], ["hear", "follow", "find"], 0),
    (["my memory", "my voice"], ["carries", "holds", "follows"], 8),
    (["another swap", "another trade", "this swap", "every swap"], ["brings", "carries", "leaves"], 2),
]
TAILS = ["inside the chain.", "in my memory.", "beneath the price.", "through this moment.",
         "after another trade.", "before another change.", "within the market.", "across the chain.",
         "through another moment.", "around the market.", "as the price moves.", "while the current moves.",
         "when the market moves.", "until the next trade."]
ADVERBS = ["", "now", "still"]
DETERMINERS = ["a", "another", "one"]


def sample_corpus(seed=710924, counts=(2400, 300, 300)):
    rng = np.random.default_rng(seed)
    data, seen = {}, set()
    for split, count in zip(["train", "validation", "test"], counts):
        rows = []
        while len(rows) < count:
            regime, family = len(rows) % 3, (len(rows)//3) % 4
            subjects, verbs, template = FAMILIES[family]
            subject, verb = str(rng.choice(subjects)), str(rng.choice(verbs))
            adjective = str(rng.choice(STYLE[regime]))
            noun, tail = str(rng.choice(OBJECTS[adjective])), str(rng.choice(TAILS))
            # Entire object/tail combinations are withheld, not just exact strings.
            bucket = int(hashlib.sha256((noun+"|"+tail).encode()).hexdigest()[:8], 16) % 10
            selected = "validation" if bucket == 0 else "test" if bucket == 1 else "train"
            if selected != split:
                continue
            adverb, determiner = str(rng.choice(ADVERBS)), str(rng.choice(DETERMINERS))
            if determiner == "a" and adjective[0] in "aeiou":
                determiner = "an"
            text = " ".join(part for part in [subject, adverb, verb, determiner, adjective, noun, tail] if part)
            if text in seen or len(text.split()) > 12:
                continue
            seen.add(text)
            rows.append({"sentence": text, "regime": regime, "template": template,
                         "family": family, "heldout_pair": noun+"|"+tail})
        data[split] = rows
    train_pairs = {row["heldout_pair"] for row in data["train"]}
    assert all(row["heldout_pair"] not in train_pairs for row in data["validation"]+data["test"])
    return data


def productive_grammar(text):
    for subjects, verbs, _ in FAMILIES:
        for adjective, nouns in OBJECTS.items():
            article = "an" if adjective[0] in "aeiou" else "a"
            pattern = ("(?:"+"|".join(map(re.escape, subjects))+") (?:now |still )?"
                       "(?:"+"|".join(verbs)+") (?:"+article+"|another|one) "+adjective+" "
                       "(?:"+"|".join(nouns)+") (?:"+"|".join(map(re.escape, TAILS))+")")
            if re.fullmatch(pattern, text):
                return True
    return False


def known_texts(data):
    texts = {row["sentence"] for rows in data.values() for row in rows}
    for source in [ROOT/"model/voice-corpus.json", ROOT/"quality-candidate-final/quality-corpus.json"]:
        prior = json.loads(source.read_text())
        texts.update(row["sentence"] for rows in prior.values() for row in rows)
    return texts


def audit(model, data, seed=918247, rounds=25):
    report = evaluate(model, seed=seed, rounds=rounds, hook_consistent=True)
    training = {row["sentence"] for row in data["train"]}
    known = known_texts(data)
    for row in report["outputs"]:
        row["controlled_grammar"] = productive_grammar(row["text"])
        row["exact_new_train_match"] = row["text"] in training
        row["exact_any_known_corpus_match"] = row["text"] in known
        row["valid_novel"] = (row["ended_naturally"] and row["controlled_grammar"] and row["regime_consistent"] and row["article_agreement"]
                              and not row["exact_any_known_corpus_match"])
    out = report["outputs"]
    report["metrics"].update({"controlled_grammar_passes": sum(r["controlled_grammar"] for r in out),
                               "exact_new_train_matches": sum(r["exact_new_train_match"] for r in out),
                               "exact_any_known_corpus_matches": sum(r["exact_any_known_corpus_match"] for r in out),
                               "valid_novel_outputs": sum(r["valid_novel"] for r in out),
                               "distinct_valid_novel_sentences": len({r["text"] for r in out if r["valid_novel"]})})
    report["known_corpus_sentence_count"] = len(known)
    report["limitations"] = ["Productive synthetic grammar; not general English benchmarking.",
                              "Original WikiText pretraining text is unavailable, so novelty is against all known authored corpora only.",
                              "This audit counts novelty jointly with completion, grammar and correct movement intensity."]
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=ROOT/"quality-candidate-final")
    parser.add_argument("--output", type=Path, default=ROOT/"composition-candidate-v1")
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--train-sentences", type=int, default=2400)
    parser.add_argument("--learning-rate", type=float, default=.0007)
    args = parser.parse_args()
    start, rng = time.time(), np.random.default_rng(710925)
    data = sample_corpus(counts=(args.train_sentences, 300, 300))
    args.output.mkdir(parents=True, exist_ok=True)
    write_json(args.output/"composition-corpus.json", data)
    model = TrainModel(args.source, feature_policy="move-and-swap-style", feature_anchors=True, style_weight=4)
    missing = {w for rows in data.values() for row in rows for w in row["sentence"].split()}-set(model.vocabulary)
    assert not missing, missing
    train, valid = data["train"], data["validation"]
    history, best, best_score, best_epoch = [], None, float("inf"), 0
    source_hashes = {name: digest(args.source/name) for name in ["core.bin", "embeddings.bin", "nodes.bin", "vocabulary.bin"]}
    for epoch in range(1, args.epochs+1):
        losses = []
        for chunk in np.array_split(rng.permutation(len(train)), (len(train)+31)//32):
            batch = [train[int(i)] for i in chunk]
            losses.append(model.optimize(*batch_data(batch, model.index, rng, "move-and-swap-style"), args.learning_rate))
        model.export(args.output, args.source, {"epoch": epoch, "status": "training; not selected"})
        integer = IntegerModel(args.output)
        validation = integer.teacher_loss(valid, feature_policy="move-and-swap-style")
        score = validation["cross_entropy_nats_per_word"] + (1-validation["teacher_forced_style_regime_accuracy"])
        entry = {"epoch": epoch, "training_loss": float(np.mean(losses)), "validation": validation,
                 "selection_score": score, "elapsed_seconds": time.time()-start}
        history.append(entry)
        if score < best_score:
            best_score, best_epoch, best = score, epoch, {k:v.copy() for k,v in model.p.items()}
        if epoch == 1 or epoch % 5 == 0:
            # Development seed only; final confirmation uses a reserved seed.
            probe = audit(integer, data, seed=710926, rounds=5)
            entry["development_probe"] = probe["metrics"]
            write_json(args.output/"composition-development-outputs.json", probe)
            print(json.dumps(entry), flush=True)
    model.p = best
    metadata = {"selected_epoch": best_epoch, "epochs": args.epochs, "data_seed":710924,"training_seed":710925,
                "checkpoint_selection":"held-out object/tail pair CE + teacher-forced intensity-class error",
                "parameter_count":534751,"unconstrained_parameter_values":534451,
                "fixed_feature_conditioning_rows":3,"deliberately_inactive_feature_weights":96,
                "feature_policy":"move-and-swap-style","inference_changes":"none; original greedy depth-13 tree",
                "source":"previous candidate; baseline and previous candidate unchanged", "training_location":"local CPU NumPy",
                "train_sentences":len(train),"heldout_pair_split":True,"style_token_loss_weight":4}
    model.export(args.output, args.source, metadata)
    final_model = IntegerModel(args.output)
    result = audit(final_model, data, seed=918247, rounds=50)
    result["heldout_teacher_forcing"] = final_model.teacher_loss(data["test"], feature_policy="move-and-swap-style")
    result["metadata"], result["history"] = metadata, history
    result["source_hashes"] = source_hashes
    assert source_hashes == {name:digest(args.source/name) for name in source_hashes}
    write_json(args.output/"composition-final-audit.json", result)
    print(json.dumps({"final":result["metrics"],"selected_epoch":best_epoch,"elapsed_seconds":time.time()-start}),flush=True)


if __name__ == "__main__":
    main()
