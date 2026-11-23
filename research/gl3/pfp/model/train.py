#!/usr/bin/env python3
"""Fit and evaluate the integer GH0ST PFP decoder on original pixel-art examples."""

import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


SIZE = 32
LANES = 16
PALETTE = np.array([(9, 8, 12), (234, 193, 138), (244, 237, 225)], dtype=np.uint8)
STYLES = (
    ("Eyes", "Calm", "Glowing"),
    ("Mouth", "Still", "Grin"),
    ("Headpiece", "Halo", "Horns"),
    ("Frame", "Brackets", "Visor"),
    ("Signal", "Quiet", "Glitch"),
    ("Emblem", "Dot", "Diamond"),
    ("Background", "Clean", "Stars"),
    ("Accent", "Amber", "Ivory"),
)
THRESHOLDS = (27, 35, 42, 48, 53, 57, 61, 66, 70, 74, 79, 85, 92, 100)


def mirror(points):
    return tuple((31 - x, y) for x, y in points)


TOP_LEFT = ((4, 4), (6, 4), (8, 4), (10, 4), (5, 5), (7, 5), (9, 5),
            (4, 6), (6, 6), (8, 6), (10, 6), (5, 7), (7, 7), (9, 7))
SIDE_LEFT = ((2, 9), (2, 11), (2, 13), (2, 15), (2, 17), (2, 19), (2, 21),
             (2, 23), (3, 10), (3, 12), (3, 14), (3, 16), (3, 18), (3, 20))
BOTTOM_LEFT = ((4, 24), (6, 24), (8, 24), (10, 24), (12, 24), (5, 25),
               (7, 25), (9, 25), (11, 25), (4, 26), (6, 26), (8, 26), (10, 26), (12, 26))
SEED_DOTS = (
    TOP_LEFT,
    mirror(TOP_LEFT),
    SIDE_LEFT,
    mirror(SIDE_LEFT),
    ((10, 12), (11, 12), (20, 12), (21, 12), (9, 14), (22, 14), (9, 16),
     (22, 16), (9, 18), (22, 18), (10, 19), (11, 19), (20, 19), (21, 19)),
    BOTTOM_LEFT,
    mirror(BOTTOM_LEFT),
    ((10, 28), (12, 28), (14, 28), (16, 28), (18, 28), (20, 28), (22, 28),
     (9, 30), (11, 30), (13, 30), (15, 30), (17, 30), (19, 30), (21, 30)),
)


def input_projection():
    """Keep style bits separate and blend the 16 seed bytes into eight correlated lanes."""
    weights = np.zeros((LANES, 24), dtype=np.int8)
    bias = np.full(LANES, 8192, dtype=np.int32)
    for bit in range(8):
        weights[bit, 16 + bit] = 64
        bias[bit] = 8128
        weights[8 + bit, 2 * bit:2 * bit + 2] = 45, 19
    return weights, bias


W1, B1 = input_projection()


def lanes(seeds, styles):
    bits = (styles.astype(np.int32)[:, None] >> np.arange(8)) & 1
    values = np.concatenate((seeds.astype(np.int32) - 128, 254 * bits - 127), axis=1)
    return np.clip((values @ W1.astype(np.int32).T + B1) >> 7, 0, 127)


def style_layers():
    """Original PFP training labels with separate masks for each controllable trait."""
    layers = np.zeros((8, 2, SIZE, SIZE), np.uint8)

    def dots(bit, trait, points, color=1, block=False):
        for x, y in points:
            span = 2 if block else 1
            layers[bit, trait, y:y + span, x:x + span] = color

    # Each face accent sits in the 12-pixel gap between the rails.
    dots(0, 0, ((12, 14), (18, 14)), color=2, block=True)
    dots(0, 1, ((12, 13), (13, 12), (14, 13), (12, 15), (14, 15), (13, 16),
                (17, 13), (18, 12), (19, 13), (17, 15), (19, 15), (18, 16)))
    dots(0, 1, ((12, 14), (13, 13), (13, 14), (13, 15), (14, 14),
                (17, 14), (18, 13), (18, 14), (18, 15), (19, 14)), color=2)
    dots(1, 0, ((14, 19), (16, 19), (18, 19)), color=2)
    dots(1, 1, ((13, 18), (14, 19), (15, 20), (16, 20), (17, 20), (18, 19), (19, 18)), color=2)
    dots(2, 0, ((12, 5), (13, 4), (15, 3), (17, 3), (19, 4), (20, 5), (18, 6), (14, 6)))
    dots(2, 0, ((15, 5), (17, 5)), color=2)
    dots(2, 1, ((11, 4), (12, 5), (13, 6), (14, 7), (20, 4), (19, 5), (18, 6), (17, 7)))
    dots(2, 1, ((11, 3), (20, 3), (12, 4), (19, 4)), color=2)

    bracket_left = ((5, 9), (5, 12), (5, 15), (5, 18), (5, 21),
                    (8, 9), (8, 21), (11, 9), (11, 21))
    dots(3, 0, bracket_left + tuple((30 - x, y) for x, y in bracket_left), block=True)
    dots(3, 0, ((6, 9), (6, 21), (25, 9), (25, 21)), color=2)
    visor_left = ((8, 9), (11, 9), (14, 9), (5, 11), (4, 14), (4, 17), (5, 20),
                  (8, 22), (11, 22), (14, 22))
    dots(3, 1, visor_left + tuple((30 - x, y) for x, y in visor_left), block=True)
    dots(3, 1, ((5, 14), (5, 17), (26, 14), (26, 17), (15, 9), (16, 9)), color=2)

    dots(4, 0, ((1, 14), (1, 17), (30, 14), (30, 17)))
    dots(4, 1, ((1, 10), (1, 12), (1, 16), (1, 20), (30, 10), (30, 12), (30, 16), (30, 20)))
    dots(4, 1, ((1, 13), (1, 19), (30, 13), (30, 19)), color=2)
    dots(5, 0, ((15, 25),), color=2, block=True)
    dots(5, 1, ((15, 24), (16, 24), (14, 25), (17, 25), (14, 26), (17, 26), (15, 27), (16, 27)))
    dots(5, 1, ((15, 25),), color=2, block=True)
    dots(6, 1, ((2, 3), (1, 4), (3, 4), (2, 5), (29, 3), (28, 4), (30, 4), (29, 5),
                (3, 27), (2, 28), (4, 28), (3, 29), (28, 27), (27, 28), (29, 28), (28, 29)))
    dots(6, 1, ((2, 4), (29, 4), (3, 28), (28, 28)), color=2)
    dots(7, 0, ((8, 12), (8, 15), (8, 18), (23, 12), (23, 15), (23, 18)))
    dots(7, 1, ((8, 12), (8, 15), (8, 18), (23, 12), (23, 15), (23, 18)), color=2)
    return layers


STYLE_LAYERS = style_layers()


def examples(hidden):
    """Compose the training illustrations. This function is never used in inference."""
    targets = np.zeros((len(hidden), SIZE, SIZE), dtype=np.uint8)
    for i, alternatives in enumerate(STYLE_LAYERS):
        np.maximum(targets, alternatives[(hidden[:, i] > 0).astype(int)], out=targets)
    for i, positions in enumerate(SEED_DOTS):
        value = hidden[:, 8 + i]
        for j, ((x, y), threshold) in enumerate(zip(positions, THRESHOLDS)):
            visible = value >= threshold if (i + j) % 2 == 0 else value < threshold
            color = (1 if (i + j) % 5 else 2) * visible.astype(np.uint8)
            np.maximum(targets[:, y, x], color, out=targets[:, y, x])
    return targets


def fit_decoder(hidden, images):
    """Learn sparse threshold logits by minimizing supervised pixel mistakes."""
    images = images.reshape((-1, SIZE * SIZE))
    positives = np.stack((images != 0, images == 2), axis=-1).reshape((len(images), -1))
    scored = np.stack((np.ones_like(images, dtype=bool), images != 0), axis=-1).reshape(positives.shape)
    negatives = scored & ~positives
    total_pos = positives.sum(axis=0, dtype=np.int32)
    total_neg = negatives.sum(axis=0, dtype=np.int32)
    best_error = np.minimum(total_pos, total_neg)
    output_count = positives.shape[1]
    weights = np.zeros((output_count, LANES), dtype=np.int8)
    bias = np.where(total_pos > total_neg, 63, -64).astype(np.int32)
    columns = np.arange(output_count)

    for lane in range(LANES):
        bins_pos = np.zeros((129, output_count), dtype=np.int32)
        bins_neg = np.zeros_like(bins_pos)
        for value in np.unique(hidden[:, lane]):
            match = hidden[:, lane] == value
            bins_pos[value + 1] = positives[match].sum(axis=0, dtype=np.int32)
            bins_neg[value + 1] = negatives[match].sum(axis=0, dtype=np.int32)
        lower_pos = bins_pos.cumsum(axis=0, dtype=np.int32)
        lower_neg = bins_neg.cumsum(axis=0, dtype=np.int32)
        for sign, errors in ((1, lower_pos + total_neg - lower_neg), (-1, lower_neg + total_pos - lower_pos)):
            error = errors.min(axis=0)
            equal = errors == error
            low = equal.argmax(axis=0)
            high = 128 - equal[::-1].argmax(axis=0)
            midpoint = (low + high) // 2
            # Choose a measured minimum if separate disjoint intervals tie.
            threshold = np.where(equal[midpoint, columns], midpoint, low)
            take = error < best_error
            weights[take] = 0
            weights[take, lane] = 127 * sign
            bias[take] = np.where(sign > 0, 63 - 127 * threshold[take], 127 * threshold[take] - 63 - 1)
            best_error[take] = error[take]
    return weights, bias


def render(hidden, weights, bias):
    """Run the exact integer GL3 rules and return indexed 32×32 pixels."""
    logits = (hidden @ weights.astype(np.int32).T + bias).reshape((-1, SIZE, SIZE, 2))
    return np.where(logits[..., 0] > 0, 1 + (logits[..., 1] > 0), 0).astype(np.uint8)


def packed(images):
    flat = images.reshape((-1, 256, 4))
    return np.bitwise_or.reduce(flat << np.array([0, 2, 4, 6], dtype=np.uint8), axis=-1)


def output_capacity(weights, bias):
    """Count distinct sprites by exhausting the reachable values of each independent lane."""
    style_values = np.array([0, 127], dtype=np.int32)
    seed_values = np.arange(128, dtype=np.int32)
    counts = []
    product = 1
    # Both logits for any pixel must depend on at most one lane.
    lane_support = (weights.reshape((-1, 2, LANES)) != 0).any(axis=1)
    if not np.all(lane_support.sum(axis=1) <= 1):
        raise ValueError("Cannot multiply output counts across dependent lanes")
    # Equal bytes for each independent seed pair reach all 128 latents.
    equal_bytes = np.repeat(np.arange(256, dtype=np.uint8)[:, None], 16, axis=1)
    reachable = lanes(equal_bytes, np.zeros(256, dtype=np.uint8))
    for lane in range(LANES):
        values = style_values if lane < 8 else seed_values
        if lane >= 8 and not np.array_equal(np.unique(reachable[:, lane]), values):
            raise ValueError("Some seed latents are unreachable")
        hidden = np.zeros((len(values), LANES), dtype=np.int32)
        hidden[:, lane] = values
        sprites = packed(render(hidden, weights, bias))
        count = len(set(bytes(row) for row in sprites))
        counts.append(count)
        product *= count
    return {"distinctPatternsPerLane": counts, "distinctSprites": product,
            "basis": "Exhaustive lane values with independent inputs and disjoint pixel support."}


def population(rng, count):
    seeds = rng.integers(0, 256, (count, 16), dtype=np.uint8)
    styles = np.resize(np.arange(256, dtype=np.uint8), count)
    rng.shuffle(styles)
    return seeds, styles


def sheet(out, images, styles):
    width, height = 172, 185
    cols = 6
    rows = (len(styles) + cols - 1) // cols
    page = Image.new("RGB", (28 + width * cols, 84 + rows * height), (14, 12, 17))
    draw = ImageDraw.Draw(page)
    draw.text((24, 19), "GH0ST / ON-CHAIN PFP DECODER", fill=(244, 237, 225))
    draw.text((24, 37), "32 x 32 integer model output  /  24 held-out seeds and style masks", fill=(176, 152, 125))
    for i, style in enumerate(styles):
        x = 24 + (i % cols) * width
        y = 64 + (i // cols) * height
        draw.rectangle((x - 3, y - 3, x + 130, y + 150), outline=(54, 44, 40))
        avatar = Image.fromarray(PALETTE[images[i]]).resize((128, 128), resample=Image.Resampling.NEAREST)
        page.paste(avatar, (x, y))
        draw.text((x + 4, y + 132), f"STYLE {int(style):02X}", fill=(234, 193, 138))
    page.save(out)


def main():
    out = Path(__file__).resolve().parent
    train_seed, train_style = population(np.random.default_rng(4663001), 4096)
    train_hidden = lanes(train_seed, train_style)
    w2, b2 = fit_decoder(train_hidden, examples(train_hidden))
    blob = W1.tobytes() + B1.astype("<i4").tobytes() + w2.tobytes() + b2.astype("<i4").tobytes()
    digest = hashlib.sha256(blob).hexdigest()
    (out / "weights.bin").write_bytes(blob)

    eval_seed, eval_style = population(np.random.default_rng(20261123), 4096)
    test_hidden = lanes(eval_seed, eval_style)
    test_images = render(test_hidden, w2, b2)
    expected = examples(test_hidden)
    output = packed(test_images)
    foreground = expected != 0
    controls_seed = eval_seed[:256]
    controls_style = eval_style[:256]
    control_images = test_images[:256]
    style_changes = {}
    for i, (name, off, on) in enumerate(STYLES):
        altered = render(lanes(controls_seed, controls_style ^ (1 << i)), w2, b2)
        changes = (control_images != altered).reshape((len(controls_seed), -1)).sum(axis=1)
        style_changes[name] = {"labels": [off, on], "observations": len(changes),
                               "minChangedPixels": int(changes.min()), "meanChangedPixels": float(changes.mean())}
    fixed = render(lanes(eval_seed, np.full(len(eval_seed), 0x29, dtype=np.uint8)), w2, b2)
    bounds = np.array(([0] * 16, [255] * 16), dtype=np.uint8)
    golden_seed = np.concatenate((bounds, eval_seed[:22]))
    golden_style = np.concatenate((np.array([0, 255], dtype=np.uint8), eval_style[:22]))
    golden_pixels = packed(render(lanes(golden_seed, golden_style), w2, b2))
    vectors = [{"seed": "0x" + seed.tobytes().hex(), "style": int(style), "pixels": "0x" + image.tobytes().hex()}
               for seed, style, image in zip(golden_seed, golden_style, golden_pixels)]
    (out / "vectors.json").write_text(json.dumps({"schema": "gh0st.gl3.pfp.v1", "modelSHA256": digest,
                                                  "vectors": vectors}, indent=2) + "\n")
    metrics = {
        "trainingExamples": len(train_seed), "heldOutExamples": len(eval_seed), "modelSHA256": digest,
        "weightAndBiasBytes": len(blob), "outputBytes": int(output.shape[1]),
        "decoderNonzeroWeights": int(np.count_nonzero(w2)),
        "heldOutPixelAccuracy": float((test_images == expected).mean()),
        "heldOutForegroundColorAccuracy": float((test_images[foreground] == expected[foreground]).mean()),
        "heldOutExactImages": int(np.all(test_images == expected, axis=(1, 2)).sum()),
        "heldOutDistinctImages": len(set(row.tobytes() for row in output)),
        "fixedStyle": 41, "fixedStyleDistinctImages": len(set(row.tobytes() for row in packed(fixed))),
        "styleBitAblations": style_changes,
        "outputCapacity": output_capacity(w2, b2),
        "scope": "Quality metrics compare the integer model to its original synthetic art labels, not human aesthetic ratings.",
    }
    (out / "quality.json").write_text(json.dumps(metrics, indent=2) + "\n")
    sheet(out / "gallery.png", test_images[:24], eval_style[:24])
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
