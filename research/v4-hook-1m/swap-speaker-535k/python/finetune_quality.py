#!/usr/bin/env python3
"""Local NumPy fine-tuning from recovered int16 tensors; baseline is read-only.

The candidate uses exactly the existing 534,751 trainable parameters and the
same onchain inference layout. No lookup table, sentence-template selection,
external model, hosted training, or added decoding work is used at inference.
The curated grammar is training data and an explicitly limited audit only.
"""
from __future__ import annotations
import argparse
import json
import shutil
import time
from pathlib import Path
import numpy as np
from quality_eval import (ROOT, V, H, Q, PATHS, BITS, IntegerModel, corpus,
                          features, digest, write_json, evaluate, style_family, STYLE)


class TrainModel:
    def __init__(self, source, feature_policy="move-and-swap-style", feature_anchors=False, style_weight=4.):
        m = IntegerModel(source)
        self.p = {"embedding": m.embedding.astype(np.float32)/Q,
                  "wx": m.wx.astype(np.float32)/Q, "wh": m.wh.astype(np.float32)/Q,
                  "wf": m.wf.astype(np.float32)/Q, "bh": m.bh.astype(np.float32)/Q,
                  "nodes": m.nodes.astype(np.float32)/Q, "bias": m.bias.astype(np.float32)/Q}
        self.initial = {name: value.copy() for name, value in self.p.items()}
        self.feature_policy = feature_policy
        self.inactive = [1, 2, 3, 4, 5] if feature_policy == "current-move" else [1, 2, 3] if feature_policy == "move-and-swap-style" else []
        # Historical movement and elapsed time do not have corresponding
        # assertions in this narrow voice. The two signed flags may select
        # a trained opening style but never alter the movement category.
        self.p["wf"][:, self.inactive] = 0
        self.feature_anchors = feature_anchors
        if feature_anchors:
            # Reserve three of the 32 existing units as exact feature reads.
            # Current movement cannot be erased by the preceding sentence;
            # direction/exactness remain available to select a learned voice.
            self.p["wx"][:3] = 0
            self.p["wh"][:3] = 0
            self.p["wf"][:3] = 0
            self.p["wf"][0, 0] = 1
            self.p["wf"][1, 4] = 1
            self.p["wf"][2, 5] = 1
            self.p["bh"][:3] = [0, 1, 1]
        self.first = {name: np.zeros_like(value) for name, value in self.p.items()}
        self.second = {name: np.zeros_like(value) for name, value in self.p.items()}
        self.t = 0
        self.vocabulary, self.index = m.vocabulary, m.index
        self.token_weights = np.asarray([style_weight if word.rstrip(".!?") in sum(STYLE, []) else 1.
                                         for word in self.vocabulary], dtype=np.float32)

    def optimize(self, x, y, f, mask, lr):
        p = self.p
        mask = mask*self.token_weights[y]
        batch, steps = x.shape
        states = [np.zeros((batch, H), dtype=np.float32)]
        activations, logits = [], []
        loss, normalizer = 0., mask.sum()
        for t in range(steps):
            z = p["embedding"][x[:, t]] @ p["wx"].T + states[-1] @ p["wh"].T + f[:, t] @ p["wf"].T + p["bh"]
            h = np.clip(z, 0, 8)
            score = (p["nodes"][PATHS[y[:, t]]] * h[:, None]).sum(2) + p["bias"][PATHS[y[:, t]]]
            loss += float(((np.logaddexp(0, score)-BITS[y[:, t]]*score).sum(1)*mask[:, t]).sum())
            activations.append(z)
            states.append(h)
            logits.append(score)
        grads = {name: np.zeros_like(value) for name, value in p.items()}
        carry = np.zeros((batch, H), dtype=np.float32)
        for t in range(steps-1, -1, -1):
            target = y[:, t]
            node = PATHS[target]
            sigmoid = 1/(1+np.exp(-np.clip(logits[t], -50, 50)))
            ds = (sigmoid-BITS[target])*(mask[:, t]/normalizer)[:, None]
            np.add.at(grads["nodes"], node, ds[:, :, None]*states[t+1][:, None])
            np.add.at(grads["bias"], node, ds)
            dh = carry + (ds[:, :, None]*p["nodes"][node]).sum(1)
            dz = dh*((activations[t] > 0) & (activations[t] < 8))
            grads["wx"] += dz.T @ p["embedding"][x[:, t]]
            grads["wh"] += dz.T @ states[t]
            grads["wf"] += dz.T @ f[:, t]
            grads["bh"] += dz.sum(0)
            np.add.at(grads["embedding"], x[:, t], dz @ p["wx"])
            carry = dz @ p["wh"]
        norm = np.sqrt(sum(float((g*g).sum()) for g in grads.values()))
        multiplier = min(1., 5/max(norm, 1e-8))
        self.t += 1
        for name, g in grads.items():
            if name == "wf":
                g[:, self.inactive] = 0
            if self.feature_anchors and name in ["wx", "wh", "wf", "bh"]:
                g[:3] = 0
            g *= multiplier
            self.first[name] = .9*self.first[name]+.1*g
            self.second[name] = .999*self.second[name]+.001*g*g
            corrected = (self.first[name]/(1-.9**self.t))/(np.sqrt(self.second[name]/(1-.999**self.t))+1e-8)
            p[name] -= lr*corrected
        return loss/normalizer

    def export(self, folder, source, metadata):
        folder.mkdir(parents=True, exist_ok=True)
        q = {name: np.rint(value*Q).astype(np.int64) for name, value in self.p.items()}
        if any(np.abs(value).max() > 32767 for value in q.values()):
            raise ValueError("Candidate exceeds int16 range")
        (folder/"embeddings.bin").write_bytes(q["embedding"].astype(">i2").tobytes())
        (folder/"core.bin").write_bytes(b"".join(q[name].astype(">i2").tobytes() for name in ["wx", "wh", "wf", "bh"]))
        (folder/"nodes.bin").write_bytes(np.concatenate([q["nodes"], q["bias"][:, None]], axis=1).astype(">i2").tobytes())
        for name in ["vocabulary.json", "vocabulary.bin"]:
            shutil.copyfile(source/name, folder/name)
        # This file is a newly reconstructed, fine-tuned checkpoint, not the
        # absent original full-precision speaker.safetensors artifact.
        np.savez_compressed(folder/"quality-checkpoint.npz", **self.p)
        baseline = json.loads((source/"manifest.json").read_text())
        baseline["candidate"] = metadata
        baseline["artifacts"] = {name: {"bytes": (folder/name).stat().st_size, "sha256": digest(folder/name)}
                                 for name in ["core.bin", "embeddings.bin", "nodes.bin", "vocabulary.bin", "vocabulary.json", "quality-checkpoint.npz"]}
        baseline.pop("changed_parameter_values_after_training", None)
        baseline.pop("all_embedding_rows_seen_in_training", None)
        baseline["changed_parameter_values_from_recovered_export"] = {name: int((q[name] != np.rint(self.initial[name]*Q)).sum()) for name in q}
        baseline["nonzero_parameter_values"] = {name: int(np.count_nonzero(value)) for name, value in q.items()}
        write_json(folder/"manifest.json", baseline)


def batch_data(rows, index, rng, feature_policy):
    # Preserve hidden memory across sentence boundaries, including regime
    # changes. This matches the hook's completed-sentence state retention.
    sequences, labels, fs = [], [], []
    for first in rows:
        second = rows[int(rng.integers(len(rows)))]
        ids, targets, vectors = [], [], []
        previous = V
        for row in [first, second]:
            vector = np.asarray(features(row["regime"], rng), dtype=np.float32)/Q
            if feature_policy == "move-and-swap-style":
                family = style_family(row["template"])
                vector[4:] = [1 if family & 1 else -1, 1 if family & 2 else -1]
            for word in row["sentence"].split():
                token = index[word]
                ids.append(previous)
                targets.append(token)
                vectors.append(vector)
                previous = token
        sequences.append(ids)
        labels.append(targets)
        fs.append(vectors)
    width = max(map(len, sequences))
    x, y = np.zeros((len(rows), width), dtype=np.int64), np.zeros((len(rows), width), dtype=np.int64)
    f, mask = np.zeros((len(rows), width, 6), dtype=np.float32), np.zeros((len(rows), width), dtype=np.float32)
    for i, (ids, targets, vectors) in enumerate(zip(sequences, labels, fs)):
        x[i, :len(ids)], y[i, :len(ids)], f[i, :len(ids)], mask[i, :len(ids)] = ids, targets, vectors, 1
    return x, y, f, mask


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=ROOT/"model")
    parser.add_argument("--output", type=Path, default=ROOT/"quality-candidate")
    parser.add_argument("--epochs", type=int, default=160)
    parser.add_argument("--learning-rate", type=float, default=.0008)
    parser.add_argument("--resume", type=Path)
    parser.add_argument("--feature-policy", choices=["current-move", "move-and-swap-style", "all"], default="move-and-swap-style")
    parser.add_argument("--feature-anchors", action="store_true", help="Reserve three existing hidden units for exact current movement and signed style flags")
    parser.add_argument("--style-weight", type=float, default=4.)
    args = parser.parse_args()
    start = time.time()
    rng = np.random.default_rng(846652)
    source_hashes = {name: digest(args.source/name) for name in ["core.bin", "embeddings.bin", "nodes.bin", "vocabulary.bin"]}
    model = TrainModel(args.source, feature_policy=args.feature_policy, feature_anchors=args.feature_anchors, style_weight=args.style_weight)
    if args.resume:
        resumed = np.load(args.resume)
        model.p = {name: resumed[name].copy() for name in model.p}
    rows = corpus()
    missing = sorted({word for row in rows for word in row["sentence"].split()}-set(model.vocabulary))
    if missing:
        raise ValueError(f"Unknown vocabulary: {missing}")
    train = [row for row in rows if row["split"] == "train"]
    valid = [row for row in rows if row["split"] == "validation"]
    test = [row for row in rows if row["split"] == "test"]
    train_set = {row["sentence"] for row in train}
    assert not train_set.intersection(row["sentence"] for row in valid+test)
    args.output.mkdir(parents=True, exist_ok=True)
    write_json(args.output/"quality-corpus.json", {split: [row for row in rows if row["split"] == split] for split in ["train", "validation", "test"]})
    history, best, best_selection = [], None, float("inf")
    baseline = IntegerModel(args.source)
    baseline_audit = evaluate(baseline)
    baseline_audit["heldout_teacher_forcing"] = baseline.teacher_loss(test, feature_policy=args.feature_policy)
    for epoch in range(1, args.epochs+1):
        groups = [[i for i, row in enumerate(train) if row["template"] == template] for template in range(16)]
        target_count = max(map(len, groups))
        # Deduplication makes fixed-noun templates five times rarer. Balance
        # template families explicitly so frequency does not force one opener.
        order = np.concatenate([rng.choice(group, size=target_count, replace=len(group)<target_count) for group in groups])
        rng.shuffle(order)
        losses = []
        for start_index in range(0, len(order), 32):
            selected = [train[i] for i in order[start_index:start_index+32]]
            losses.append(model.optimize(*batch_data(selected, model.index, rng, args.feature_policy), args.learning_rate))
        model.export(args.output, args.source, {"epoch": epoch, "seed": 846652, "source_precision": "reconstructed from verified int16 export"})
        integer = IntegerModel(args.output)
        validation = integer.teacher_loss(valid, feature_policy=args.feature_policy)
        entry = {"epoch": epoch, "training_loss": float(np.mean(losses)), "validation": validation, "elapsed_seconds": time.time()-start}
        # Select on disjoint teacher-forced validation only. Test generation is
        # run after selection; it cannot influence checkpoint selection.
        selection = validation["cross_entropy_nats_per_word"] + 2*(1-validation["teacher_forced_style_regime_accuracy"])
        entry["validation_selection_score"] = selection
        if selection < best_selection:
            best_selection = selection
            best = {name: value.copy() for name, value in model.p.items()}
            best_epoch = epoch
        history.append(entry)
        if epoch == 1 or epoch % 10 == 0 or epoch == args.epochs:
            print(json.dumps(entry), flush=True)
    model.p = best
    metadata = {"selected_epoch": best_epoch, "epochs": args.epochs, "seed": 846652, "learning_rate": args.learning_rate,
                "style_token_loss_weight": args.style_weight,
                "checkpoint_selection": "held-out cross entropy + 2*(1 - teacher-forced style regime accuracy)",
                "source_precision": "reconstructed from verified int16 export; original float checkpoint unavailable",
                "parameter_count": sum(value.size for value in model.p.values()),
                "unconstrained_parameter_values": sum(value.size for value in model.p.values()) - ((3*(H+H+6+1)+(H-3)*len(model.inactive)) if args.feature_anchors else H*len(model.inactive)),
                "deliberately_inactive_feature_weights": H*len(model.inactive),
                "fixed_feature_conditioning_rows": 3 if args.feature_anchors else 0,
                "fixed_feature_conditioning_details": "hidden[0]=current movement/1024; hidden[1]=direction/1024+1; hidden[2]=exactness/1024+1, independent of prior token and recurrent state" if args.feature_anchors else "none",
                "inference_changes": "none: same integer recurrent step and depth-13 greedy decoder",
                "feature_policy": args.feature_policy,
                "feature_policy_details": "current absolute tick movement sets expressive intensity; signed direction and exactness choose four learned opening styles; historical movement, acceleration and elapsed-time columns are zero" if args.feature_policy == "move-and-swap-style" else "only current movement active" if args.feature_policy == "current-move" else "all six active",
                "training_location": "local CPU; NumPy only"}
    model.export(args.output, args.source, metadata)
    candidate = IntegerModel(args.output)
    audit = evaluate(candidate)
    audit["heldout_teacher_forcing"] = candidate.teacher_loss(test, feature_policy=args.feature_policy)
    report = {"schema_version": 1, "metadata": metadata, "history": history, "baseline": baseline_audit, "candidate": audit,
              "independent_hook_trajectory_confirmation": {
                  "baseline": evaluate(baseline, seed=491807, streams=12, rounds=50, hook_consistent=True),
                  "candidate": evaluate(candidate, seed=491807, streams=12, rounds=50, hook_consistent=True)},
              "corpus_counts": {split: sum(row["split"] == split for row in rows) for split in ["train", "validation", "test"]},
              "baseline_payload_sha256": source_hashes,
              "elapsed_seconds": time.time()-start,
              "limitations": ["The curated voice corpus is narrow; its pattern checks are not an independent test of broad English skill.",
                              "Held-out phrases are unique but share compositional templates with training.",
                              "No new WikiText training was possible because the pinned text cache is absent.",
                              "This is a new checkpoint fine-tuned from quantized export, not restoration of the absent original float checkpoint.",
                              "Gas and real PoolManager integration require independent EVM verification."]}
    assert source_hashes == {name: digest(args.source/name) for name in source_hashes}, "Baseline payload changed"
    write_json(ROOT/"reports"/"quality-finetune.json", report)
    print(json.dumps({"baseline": baseline_audit["metrics"], "candidate": audit["metrics"], "selected_epoch": best_epoch, "elapsed_seconds": report["elapsed_seconds"]}, indent=2))


if __name__ == "__main__":
    main()
