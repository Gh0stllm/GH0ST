"""Fit and export the seven-style GH0ST Scene Decoder."""

import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
from time import monotonic

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

import art
from quant import (
    EMBEDDINGS, EXPERT_BYTES, EXPERTS, PACK_BYTES, SHARED_BYTES, FrozenDecoder,
    encode_layer, noise_features, pack_u5, prompt_number,
)


def log(record):
    print(json.dumps(record), flush=True)


def fake_quant(x, scale, lower, upper):
    quantized = (x * scale).round().clamp(lower, upper) / scale
    return x + (quantized - x).detach()


def quant_weight(weight):
    flat = weight.detach().reshape(weight.shape[0], -1)
    scale = (flat.abs().amax(1) * (65536 / 15)).round().clamp(1, 65535)
    scale = (65536 / scale).reshape(-1, *([1] * (weight.ndim - 1)))
    return fake_quant(weight, scale, -16, 15)


class SceneDecoder(nn.Module):
    def __init__(self):
        super().__init__()
        self.embeddings = nn.ModuleDict({name: nn.Embedding(count, width) for name, count, width in EMBEDDINGS})
        for table in self.embeddings.values():
            nn.init.normal_(table.weight, std=0.23)
        self.experts = nn.ModuleList(nn.Linear(96, 1024) for _ in range(EXPERTS))
        self.depth = nn.ModuleList(nn.Conv2d(32, 32, 3, padding=1, groups=32) for _ in range(2))
        self.point = nn.ModuleList(nn.Conv2d(32, 32, 1) for _ in range(2))
        self.gains = nn.Parameter(torch.ones(EXPERTS, 2, 32))
        self.offsets = nn.Parameter(torch.zeros(EXPERTS, 2, 32))
        self.head = nn.Conv2d(32, 128, 1)

    def forward(self, prompt, noise, style, quantized):
        a, b, ta, tb, layout, background, style_ids, palette = prompt.unbind(1)

        def embed(name, values):
            x = self.embeddings[name](values)
            return fake_quant(x, 128, -128, 127)

        subject_a = embed("subject", a) + embed("tint", ta) * (a[:, None] != 0)
        subject_b = embed("subject", b) + embed("tint", tb) * (b[:, None] != 0)
        features = torch.cat((
            subject_a, subject_b, embed("relation", layout), embed("background", background),
            embed("style", style_ids), embed("palette", palette), noise,
        ), dim=1)

        def apply(layer, x):
            if not quantized:
                return layer(x)
            weight = quant_weight(layer.weight)
            bias = fake_quant(layer.bias, 1024, -(1 << 25), (1 << 25) - 1)
            if isinstance(layer, nn.Linear):
                return F.linear(x, weight, bias)
            return F.conv2d(x, weight, bias, padding=layer.padding, groups=layer.groups)

        x = apply(self.experts[style], features).view(-1, 4, 4, 32, 2).amax(-1)
        x = F.interpolate(x.permute(0, 3, 1, 2).clamp(0, 8), scale_factor=2, mode="nearest")
        for ix in range(2):
            x = apply(self.depth[ix], x).clamp(0, 8)
            x = apply(self.point[ix], x)
            gain = fake_quant(self.gains[style, ix], 256, 0, 65535)
            offset = fake_quant(self.offsets[style, ix], 1024, -32768, 32767)
            x = (x * gain[None, :, None, None] + offset[None, :, None, None]).clamp(0, 8)
        return apply(self.head, x)

    def export(self, vocab, dictionaries):
        def array(tensor):
            return tensor.detach().cpu().numpy()

        def encoded(layer):
            return encode_layer(array(layer.weight), array(layer.bias))

        experts = [encoded(expert) for expert in self.experts]
        assert all(len(expert) == EXPERT_BYTES for expert in experts)
        shared = b"".join(encoded(layer) for pair in zip(self.depth, self.point) for layer in pair)
        shared += encoded(self.head) + pack_u5(dictionaries) + art.PALETTES.tobytes()
        for name, _, _ in EMBEDDINGS:
            shared += np.clip(np.rint(array(self.embeddings[name].weight) * 128), -128, 127).astype(np.int8).tobytes()
        for style in range(EXPERTS):
            for index in range(2):
                gain = np.clip(np.rint(array(self.gains[style, index]) * 256), 0, 65535).astype("<u2")
                offset = np.clip(np.rint(array(self.offsets[style, index]) * 1024), -32768, 32767).astype("<i2")
                shared += gain.tobytes() + offset.tobytes()
        assert len(shared) == SHARED_BYTES - 640
        header = b"GH0STSD1\x00" + sha256(json.dumps(vocab, sort_keys=True).encode()).digest()
        shared += header.ljust(640, b"\0")
        pack = b"".join(experts) + shared
        assert len(pack) == PACK_BYTES
        return pack


def holdout_pair(a, b, relation):
    lo, hi = sorted((a, b))
    return (lo * 211 + hi * 37 + relation * 61) % 11 == 0


def generate_prompts(rng, style, count, split):
    rows = []
    while len(rows) < count:
        a = int(rng.integers(1, len(art.SUBJECTS)))
        b = int(rng.integers(1, len(art.SUBJECTS)))
        if a == b:
            continue
        relation = int(rng.choice([0, 1, 2], p=[0.36, 0.42, 0.22]))
        if relation and holdout_pair(a, b, relation) != (split == "held-out"):
            continue
        if relation == 0:
            b = 0
        # Keep background and colors varied within all seven styles.
        tint_a, tint_b = map(int, rng.integers(len(art.TINTS), size=2))
        background = int(rng.integers(len(art.BACKGROUNDS)))
        palette = int(rng.integers(len(art.PALETTE_NAMES)))
        seed = int(rng.integers(0, 1 << 63, dtype=np.uint64))
        rows.append(((a, b, tint_a, tint_b, relation, background, style, palette), seed))
    return rows


def extract_patches(pixels):
    return pixels.reshape(-1, 8, 4, 8, 4).transpose(0, 1, 3, 2, 4).reshape(-1, 64, 16)


def dictionary(train_patches):
    # Learn a discrete vocabulary from original patch frequencies. Downweight
    # uniform backdrop tiles, preserving enough entries for foreground shapes.
    choices, counts = np.unique(train_patches.reshape(-1, 16), axis=0, return_counts=True)
    uniform = np.all(choices == choices[:, :1], axis=1)
    priority = counts * np.where(uniform, 0.10, 1.0)
    assert len(choices) >= 128
    return choices[np.argsort(-priority, kind="stable")[:128]]


def labels(patches, codebook):
    flat = patches.reshape(-1, 16)
    unique, inverse = np.unique(flat, axis=0, return_inverse=True)
    chosen = np.empty(len(unique), dtype=np.uint8)
    for start in range(0, len(unique), 1024):
        tiles = unique[start:start + 1024]
        distance = (tiles[:, None, :] != codebook[None, :, :]).sum(2)
        chosen[start:start + len(tiles)] = distance.argmin(1)
    return chosen[inverse].reshape(-1, 8, 8)


def build_data(count, heldout, seed, cache_path):
    if cache_path.exists():
        with np.load(cache_path) as saved:
            return {key: saved[key] for key in saved.files}
    rng = np.random.default_rng(seed)
    merged = {name: [] for name in ("prompts", "seeds", "noise", "images", "labels", "codebooks")}
    for style in range(EXPERTS):
        start = monotonic()
        rows = generate_prompts(rng, style, count, "train") + generate_prompts(rng, style, heldout, "held-out")
        images = np.stack([art.render(*prompt, item_seed) for prompt, item_seed in rows])
        assert images.dtype == np.uint8 and images.shape == (count + heldout, 32, 32) and images.max() < 32
        patches = extract_patches(images)
        codebook = dictionary(patches[:count])
        records = {
            "prompts": np.array([fields for fields, _ in rows], dtype=np.uint8),
            "seeds": np.array([item_seed for _, item_seed in rows], dtype=np.uint64),
            "noise": np.stack([noise_features(fields, item_seed) for fields, item_seed in rows]).astype(np.int8),
            "images": images, "labels": labels(patches, codebook), "codebooks": codebook,
        }
        for name, value in records.items():
            merged[name].append(value)
        log({"stage": "dataset", "style": style, "train": count, "heldOut": heldout, "seconds": round(monotonic() - start, 2)})
    data = {name: np.stack(values) for name, values in merged.items()}
    np.savez(cache_path, **data)
    return data


def description(fields):
    a, b, tint_a, tint_b, relation, background, style, palette = fields
    first = f"{art.TINTS[tint_a]} {art.SUBJECTS[a]}"
    objects = f"{first} {art.RELATIONS[relation]} {art.TINTS[tint_b]} {art.SUBJECTS[b]}" if b else first
    return f"{objects} · {art.BACKGROUNDS[background]} · {art.STYLES[style]}"


def assess(pack, data, count):
    decoder = FrozenDecoder(pack)
    vectors, assessment, sample_images = [], [], []
    for style in range(EXPERTS):
        stats = Counter()
        samples = []
        for i in range(count, len(data["seeds"][style])):
            fields = data["prompts"][style, i].tolist()
            seed = int(data["seeds"][style, i])
            original = data["images"][style, i]
            pixels, palette, ids = decoder.generate(fields, seed)
            target = data["labels"][style, i]
            ideal = decoder.codebook[style, target].transpose(0, 2, 1, 3).reshape(32, 32)
            exact = int(np.count_nonzero(pixels == original))
            foreground = original >= 8
            matched_foreground = int(np.count_nonzero((pixels == original) & foreground))
            stats.update({
                "images": 1, "exactPixels": exact,
                "codebookCeilingPixels": int(np.count_nonzero(ideal == original)),
                "exactPatchIds": int(np.count_nonzero(ids == target)),
                "foregroundPixels": int(np.count_nonzero(foreground)),
                "exactForegroundPixels": matched_foreground,
            })
            caption = description(fields)
            entry = {
                "prompt": str(prompt_number(fields)), "seed": str(seed),
                "pixelsHex": "0x" + pack_u5(pixels).hex(), "paletteHex": "0x" + palette.tobytes().hex(),
                "caption": caption, "style": style, "split": "held-out",
                "exactPixels": exact, "foregroundPixels": int(foreground.sum()),
                "exactForegroundPixels": matched_foreground, "twoSubjects": bool(fields[1]),
                "pixelSha256": sha256(pack_u5(pixels)).hexdigest(),
            }
            samples.append((entry, palette[pixels], palette[original]))
        # Pick the strongest single- and two-subject held-out examples per
        # style. The aggregate metrics above include the whole held-out set.
        for dual in (False, True):
            matches = [sample for sample in samples if sample[0]["twoSubjects"] == dual]
            if matches:
                best = max(matches, key=lambda s: (
                    s[0]["exactForegroundPixels"] / max(1, s[0]["foregroundPixels"]),
                    s[0]["exactPixels"],
                ))
                vectors.append(best[0])
                sample_images.append((best[1], best[2]))
        assessment.append({"style": art.STYLES[style], **stats})
    return vectors, assessment, np.array(sample_images)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--examples-per-style", type=int, default=3072)
    parser.add_argument("--held-out-per-style", type=int, default=128)
    parser.add_argument("--steps-per-style", type=int, default=480)
    parser.add_argument("--batch", type=int, default=48)
    parser.add_argument("--seed", type=int, default=500031)
    parser.add_argument("--device", choices=("mps", "cpu"), default="mps")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    torch.manual_seed(args.seed)
    torch.set_num_threads(3)
    rng = np.random.default_rng(args.seed + 1)
    device = torch.device(args.device)
    start = monotonic()
    data = build_data(args.examples_per_style, args.held_out_per_style, args.seed, args.dataset)
    count = args.examples_per_style
    assert data["labels"].shape == (EXPERTS, count + args.held_out_per_style, 8, 8)
    prompts = torch.as_tensor(data["prompts"][:, :count], dtype=torch.long, device=device)
    noise = torch.as_tensor(data["noise"][:, :count], dtype=torch.float32, device=device) / 128
    target = torch.as_tensor(data["labels"][:, :count], dtype=torch.long, device=device)
    frequencies = np.stack([np.bincount(t.reshape(-1), minlength=128) for t in data["labels"][:, :count]])
    weights = np.power(np.maximum(frequencies, 64), -0.26)
    class_weights = torch.as_tensor(weights / weights.mean(1, keepdims=True), dtype=torch.float32, device=device)
    model = SceneDecoder().to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.003, weight_decay=0.0005)
    steps = args.steps_per_style
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=steps * EXPERTS, eta_min=0.0005)
    log({"stage": "training", "device": args.device, "examples": EXPERTS * count, "steps": steps * EXPERTS})
    for step in range(steps):
        losses = []
        for style in rng.permutation(EXPERTS).tolist():
            indices = torch.as_tensor(rng.integers(count, size=args.batch), device=device)
            optimizer.zero_grad(set_to_none=True)
            logits = model(prompts[style, indices], noise[style, indices], style, step >= steps * 0.72)
            loss = F.cross_entropy(logits, target[style, indices], weight=class_weights[style])
            loss.backward()
            optimizer.step()
            scheduler.step()
            if step % 40 == 0 or step == steps - 1:
                losses.append(float(loss.detach()))
        if losses:
            log({"stage": "progress", "stepPerStyle": step + 1, "loss": round(sum(losses) / len(losses), 4),
                 "seconds": round(monotonic() - start, 1)})
    vocab = {
        "subjects": art.SUBJECTS, "tints": art.TINTS, "relations": art.RELATIONS,
        "backgrounds": art.BACKGROUNDS, "styles": art.STYLES, "palettes": art.PALETTE_NAMES,
    }
    pack = model.export(vocab, data["codebooks"])
    vectors, assessment, sample_images = assess(pack, data, count)
    digest = sha256(pack).hexdigest()
    (args.output / "pack500.bin").write_bytes(pack)
    (args.output / "vocabulary.json").write_text(json.dumps(vocab, indent=2) + "\n")
    (args.output / "vectors.json").write_text(json.dumps({"modelSha256": digest, "vectors": vectors}, indent=2) + "\n")
    np.save(args.output / "sample-frames.npy", sample_images)
    report = {
        "modelSha256": digest, "bytes": len(pack), "trainExamples": count * EXPERTS,
        "heldOutExamples": args.held_out_per_style * EXPERTS, "stepsPerStyle": steps,
        "batchSize": args.batch, "trainingSeed": args.seed, "trainingDevice": args.device,
        "torch": torch.__version__, "perStyle": assessment, "seconds": round(monotonic() - start, 2),
        "data": "original programmatic pixel art; two-subject layout combinations held out",
        "sampleSelection": "best exact foreground pixel recall among held-out single and two-subject samples per style",
    }
    (args.output / "training.json").write_text(json.dumps(report, indent=2) + "\n")
    log({"stage": "exported", **report})


if __name__ == "__main__":
    main()
