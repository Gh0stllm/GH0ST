#!/usr/bin/env python3
"""Fit original subject-conditioned pixel-art heads for the GL3 integer model."""

import hashlib
import itertools
import json
import struct
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from train import B1, LANES, PALETTE, SIZE, STYLE_LAYERS, W1, fit_decoder, lanes, output_capacity, packed, population, render


SUBJECTS = (
    ("Ghost", ("ghost", "spirit", "gh0st", "phantom")),
    ("Cat", ("cat", "kitten", "feline")),
    ("Robot", ("robot", "android", "droid")),
    ("Alien", ("alien", "extraterrestrial", "martian")),
    ("Skull", ("skull", "skeleton")),
    ("Owl", ("owl", "owlet")),
    ("Fox", ("fox", "vixen")),
    ("Rocket", ("rocket", "spaceship", "shuttle")),
    ("Planet", ("planet", "saturn", "world")),
    ("Mountain", ("mountain", "peak", "alpine")),
    ("Castle", ("castle", "fortress", "palace")),
    ("Flower", ("flower", "blossom", "daisy")),
)
STYLES = ("Glow", "Stars", "Sparks", "Frame", "Halo", "Emblem", "Scanlines", "Ivory")
THRESHOLDS = (33, 42, 49, 55, 60, 65, 70, 75, 81, 89, 97)
SEED_LANES = len(THRESHOLDS)
PIXELS = SIZE * SIZE
SAMPLE_COUNT = 2048


def subject_image(subject):
    """Make the source artwork for supervised training; excluded from inference."""
    art = Image.new("L", (SIZE, SIZE))
    d = ImageDraw.Draw(art)

    def points(points, value):
        d.point(points, fill=value)

    if subject == 0:
        base = np.maximum.reduce((STYLE_LAYERS[0, 0], STYLE_LAYERS[1, 0], STYLE_LAYERS[3, 0]))
        return base.copy()
    if subject == 1:
        d.polygon([(6, 16), (7, 7), (12, 11), (19, 11), (24, 7), (25, 16)], fill=1, outline=2)
        d.ellipse((6, 10, 25, 24), fill=1)
        d.arc((6, 10, 25, 24), 3, 170, fill=2)
        d.line([(8, 13), (8, 9), (11, 12)], fill=0)
        d.line([(23, 13), (23, 9), (20, 12)], fill=0)
        d.ellipse((10, 14, 12, 16), fill=0)
        d.ellipse((19, 14, 21, 16), fill=0)
        points([(11, 14), (20, 14)], 2)
        d.polygon([(14, 17), (17, 17), (16, 18), (15, 18)], fill=0)
        d.line([(10, 20), (14, 21), (15, 20), (17, 21), (21, 20)], fill=2)
        for y, end in ((18, 12), (20, 11)):
            d.line((4, y, end - 4, y + 1), fill=2)
            d.line((27, y, 35 - end, y + 1), fill=2)
    elif subject == 2:
        d.line((16, 5, 16, 10), fill=1, width=2)
        d.ellipse((14, 5, 18, 8), fill=2)
        d.rounded_rectangle((6, 10, 25, 24), 3, fill=1, outline=2)
        d.rectangle((4, 14, 6, 20), fill=1)
        d.rectangle((25, 14, 27, 20), fill=1)
        d.rounded_rectangle((8, 12, 23, 19), 2, fill=0)
        d.rectangle((11, 14, 13, 16), fill=2)
        d.rectangle((18, 14, 20, 16), fill=2)
        d.rectangle((11, 21, 20, 22), fill=0)
        points([(12, 21), (15, 21), (19, 21)], 2)
    elif subject == 3:
        d.polygon([(13, 7), (18, 7), (23, 9), (26, 13), (25, 17), (22, 22),
                   (18, 25), (13, 25), (9, 22), (6, 17), (5, 13), (8, 9)], fill=1, outline=2)
        d.polygon([(8, 12), (11, 13), (14, 16), (14, 18), (12, 19), (9, 17)], fill=0)
        d.polygon([(23, 12), (20, 13), (17, 16), (17, 18), (19, 19), (22, 17)], fill=0)
        points([(10, 14), (21, 14)], 2)
        d.line((14, 22, 17, 22), fill=0)
        points([(11, 10), (13, 9), (20, 10), (18, 9)], 2)
    elif subject == 4:
        d.ellipse((6, 7, 25, 22), fill=2)
        d.rounded_rectangle((10, 18, 21, 25), 2, fill=2)
        d.arc((6, 7, 25, 22), 12, 155, fill=1)
        d.ellipse((9, 12, 14, 17), fill=0)
        d.ellipse((17, 12, 22, 17), fill=0)
        d.polygon([(15, 17), (13, 20), (17, 20)], fill=0)
        d.line((11, 22, 20, 22), fill=0)
        for x in (12, 15, 18):
            d.line((x, 22, x, 25), fill=0)
        points([(8, 10), (11, 9), (22, 10), (24, 13), (9, 19), (22, 19)], 1)
    elif subject == 5:
        d.polygon([(7, 7), (12, 11), (19, 11), (24, 7), (24, 14), (25, 20),
                   (22, 24), (18, 25), (13, 25), (9, 24), (6, 20), (7, 14)], fill=1, outline=2)
        d.ellipse((8, 11, 15, 18), fill=2)
        d.ellipse((16, 11, 23, 18), fill=2)
        d.ellipse((10, 13, 13, 16), fill=0)
        d.ellipse((18, 13, 21, 16), fill=0)
        points([(11, 13), (19, 13)], 2)
        d.polygon([(14, 17), (17, 17), (16, 20), (15, 20)], fill=1, outline=0)
        d.line((7, 25, 24, 25), fill=1)
        points([(12, 21), (15, 23), (18, 22), (20, 21), (10, 23)], 2)
    elif subject == 6:
        d.polygon([(5, 6), (13, 12), (18, 12), (26, 6), (24, 17), (20, 22),
                   (16, 25), (15, 25), (11, 22), (7, 17)], fill=1, outline=2)
        d.polygon([(7, 9), (11, 12), (8, 14)], fill=0)
        d.polygon([(24, 9), (20, 12), (23, 14)], fill=0)
        d.polygon([(8, 18), (14, 20), (15, 22), (16, 22), (17, 20), (23, 18),
                   (20, 22), (16, 25), (15, 25), (11, 22)], fill=2)
        d.line((11, 16, 13, 17), fill=0, width=2)
        d.line((20, 16, 18, 17), fill=0, width=2)
        d.polygon([(14, 21), (17, 21), (16, 22), (15, 22)], fill=0)
    elif subject == 7:
        d.polygon([(11, 16), (7, 19), (7, 24), (12, 21), (19, 21), (24, 24),
                   (24, 19), (20, 16)], fill=1, outline=2)
        d.polygon([(15, 5), (17, 6), (20, 10), (20, 20), (18, 23), (13, 23),
                   (11, 20), (11, 10)], fill=1, outline=2)
        d.ellipse((13, 10, 18, 15), fill=0, outline=2)
        points([(15, 11), (16, 12), (13, 19), (18, 19)], 2)
        d.polygon([(13, 24), (18, 24), (16, 29), (15, 29)], fill=1)
        d.line((15, 24, 15, 26), fill=2)
    elif subject == 8:
        d.ellipse((3, 11, 28, 22), outline=1)
        d.ellipse((7, 8, 24, 25), fill=1, outline=2)
        d.arc((8, 12, 24, 20), 185, 341, fill=2)
        d.arc((3, 11, 28, 22), 12, 165, fill=2)
        d.arc((3, 12, 28, 24), 28, 152, fill=1)
        points([(20, 18), (17, 21), (21, 22), (13, 23), (11, 19), (9, 17)], 0)
        d.ellipse((24, 6, 27, 9), fill=2)
    elif subject == 9:
        d.polygon([(4, 23), (13, 8), (17, 14), (21, 10), (28, 23)], fill=1, outline=2)
        d.polygon([(11, 12), (13, 8), (17, 14), (15, 13), (14, 15), (12, 14),
                   (9, 16)], fill=2)
        d.polygon([(18, 15), (21, 10), (24, 15), (21, 14), (20, 16)], fill=2)
        d.line([(13, 15), (13, 19), (10, 22)], fill=0)
        d.line([(21, 16), (23, 19), (22, 22)], fill=0)
        d.line((5, 25, 26, 25), fill=1)
        points([(6, 21), (9, 22), (15, 19), (17, 22), (25, 19)], 2)
    elif subject == 10:
        d.rectangle((6, 12, 25, 25), fill=1, outline=2)
        d.rectangle((5, 9, 10, 23), fill=1, outline=2)
        d.rectangle((21, 9, 26, 23), fill=1, outline=2)
        d.rectangle((12, 10, 19, 15), fill=1, outline=2)
        for x in (5, 9, 12, 18, 21, 25):
            d.rectangle((x, 8, x + 1, 10), fill=2)
        d.rounded_rectangle((13, 18, 18, 25), 2, fill=0, outline=2)
        d.rectangle((14, 22, 17, 25), fill=0)
        for x in (7, 23):
            d.line((x, 13, x, 16), fill=0, width=2)
        d.rectangle((15, 12, 16, 14), fill=0)
        d.line((4, 26, 27, 26), fill=2)
    elif subject == 11:
        d.line((16, 14, 16, 25), fill=1, width=2)
        d.polygon([(16, 23), (10, 21), (8, 18), (13, 19)], fill=1, outline=2)
        d.polygon([(17, 24), (21, 20), (24, 19), (23, 22)], fill=1, outline=2)
        for box in ((13, 6, 18, 12), (18, 8, 23, 13), (19, 12, 25, 16),
                    (18, 16, 23, 21), (13, 17, 18, 22), (8, 16, 13, 21),
                    (6, 12, 12, 16), (8, 8, 13, 13)):
            d.ellipse(box, fill=2, outline=1)
        d.ellipse((12, 11, 19, 18), fill=1, outline=2)
        points([(15, 13), (17, 13), (14, 15), (16, 16), (18, 15)], 0)
    else:
        raise ValueError("unknown subject")
    return np.array(art)


def trait_art(base, subject):
    """Label independent modifier regions and seed-responsive decorative pixels."""
    occupied = base != 0
    layers = np.zeros((8, SIZE, SIZE), np.uint8)

    def mark(bit, coords, color=1):
        for x, y in coords:
            if not occupied[y, x]:
                layers[bit, y, x] = color
                occupied[y, x] = True

    mark(1, ((4, 4), (5, 5), (3, 5), (4, 6), (27, 4), (26, 5), (28, 5), (27, 6),
             (4, 26), (3, 27), (5, 27), (4, 28), (27, 26), (26, 27), (28, 27), (27, 28)))
    mark(1, ((4, 5), (27, 5), (4, 27), (27, 27)), 2)
    mark(2, ((3, 11), (2, 13), (3, 15), (2, 17), (3, 19), (2, 21),
             (28, 10), (29, 12), (28, 14), (29, 16), (28, 18), (29, 20)))
    mark(3, ((1, 1), (2, 1), (3, 1), (1, 2), (1, 3), (30, 1), (29, 1), (28, 1), (30, 2),
             (30, 3), (1, 30), (1, 29), (1, 28), (2, 30), (3, 30), (30, 30), (29, 30),
             (28, 30), (30, 29), (30, 28)))
    mark(4, ((11, 4), (13, 3), (15, 2), (17, 2), (19, 3), (21, 4), (13, 5), (19, 5)), 2)
    mark(5, ((14, 28), (15, 27), (16, 27), (17, 28), (16, 29), (15, 29)), 2)
    mark(6, [(x, y) for y in (1, 30) for x in range(8, 25, 2)])

    around = np.zeros_like(occupied)
    body = base != 0
    around[1:, :] |= body[:-1, :]
    around[:-1, :] |= body[1:, :]
    around[:, 1:] |= body[:, :-1]
    around[:, :-1] |= body[:, 1:]
    yy, xx = np.indices(base.shape)
    glow = np.argwhere(around & ~occupied & ((xx + yy) % 3 == 0))
    mark(0, [(int(x), int(y)) for y, x in glow], 2)
    ivory = (base == 1) & ((xx + 2 * yy) % 7 == 0)
    layers[7, ivory] = 2

    rng = np.random.default_rng(20261123 + subject)
    positions = []
    for row in range(2):
        for col in range(4):
            tile = (xx >= col * 8) & (xx < (col + 1) * 8) & (yy >= row * 16) & (yy < (row + 1) * 16)
            interior = tile & (base > 0) & ~ivory & ((xx + yy) % 2 == 0)
            exterior = tile & ~occupied & (xx > 1) & (xx < 30) & (yy > 1) & (yy < 30) & ((xx + yy) % 2 == 0)
            inside = rng.permutation(np.argwhere(interior))[:4]
            outside = rng.permutation(np.argwhere(exterior))[:SEED_LANES - len(inside)]
            chosen = np.concatenate((inside, outside))
            if len(chosen) != SEED_LANES:
                raise ValueError("seed region needs more pixels")
            positions.append([(int(y), int(x)) for y, x in chosen])
    return layers, positions


def examples(subject, hidden):
    base = subject_image(subject)
    traits, seed_pixels = trait_art(base, subject)
    images = np.repeat(base[None, :, :], len(hidden), axis=0)
    for bit, trait in enumerate(traits):
        active = hidden[:, bit, None, None] > 0
        np.copyto(images, trait, where=active & (trait > 0))
    for lane, positions in enumerate(seed_pixels):
        for idx, (y, x) in enumerate(positions):
            values = hidden[:, 8 + lane]
            enabled = values >= THRESHOLDS[idx] if (lane + idx) % 2 else values < THRESHOLDS[idx]
            current = base[y, x]
            alternate = 1 if current == 2 or (current == 0 and (lane + idx) % 7) else 2
            images[:, y, x] = np.where(enabled, alternate, current)
    return images


def threshold_record(row, bias):
    active = np.flatnonzero(row)
    if active.size == 0:
        return bytes((255, int(bias > 0)))
    if active.size != 1:
        raise ValueError("expected one learned lane per logit")
    lane = int(active[0])
    w = int(row[lane])
    enabled = np.arange(128) * w + int(bias) > 0
    shifts = np.flatnonzero(enabled[1:] != enabled[:-1])
    if shifts.size != 1:
        raise ValueError("learned threshold cannot use threshold record format")
    return bytes((lane, int(shifts[0] + 1) | (0x80 if enabled[0] else 0)))


def head_data(weights, bias):
    base = bytearray(packed(render(np.zeros((1, LANES), dtype=np.int32), weights, bias))[0])
    records = bytearray()
    for pixel in range(PIXELS):
        index = pixel * 2
        if not weights[index:index + 2].any():
            continue
        records.extend(struct.pack("<H", pixel))
        records.extend(threshold_record(weights[index], bias[index]))
        records.extend(threshold_record(weights[index + 1], bias[index + 1]))
    return bytes(base + records), len(records) // 6


def decode_head(head, hidden):
    """Use the actual model pack representation for byte-for-byte fixture validation."""
    image = bytearray(head[:256])

    def value(lane, threshold):
        if lane == 255:
            return bool(threshold)
        at_least_threshold = hidden[lane] >= (threshold & 127)
        return not at_least_threshold if threshold & 128 else bool(at_least_threshold)

    for pixel, fg_lane, fg_threshold, ivory_lane, ivory_threshold in struct.iter_unpack("<HBBBB", head[256:]):
        foreground = value(fg_lane, fg_threshold)
        color = (1 + int(value(ivory_lane, ivory_threshold))) if foreground else 0
        shift = 2 * (pixel % 4)
        image[pixel // 4] = (image[pixel // 4] & ~(3 << shift)) | (color << shift)
    return bytes(image)


def gallery(images, out):
    tile_width, tile_height = 167, 173
    page = Image.new("RGB", (36 + tile_width * 6, 86 + tile_height * 4), (14, 12, 17))
    d = ImageDraw.Draw(page)
    d.text((24, 18), "GH0ST / ON-DEMAND PIXEL ART", fill=(244, 237, 225))
    d.text((24, 37), "32 x 32 learned decoder  /  12 subjects  /  2 variations each", fill=(176, 152, 125))
    for idx, (subject, style, image) in enumerate(images):
        x = 24 + (idx % 6) * tile_width
        y = 63 + (idx // 6) * tile_height
        d.rectangle((x - 3, y - 3, x + 130, y + 150), outline=(54, 44, 40))
        avatar = Image.fromarray(PALETTE[image]).resize((128, 128), resample=Image.Resampling.NEAREST)
        page.paste(avatar, (x, y))
        d.text((x + 4, y + 132), f"{SUBJECTS[subject][0].upper()}   {style:02X}", fill=(234, 193, 138))
    page.save(out)


def invariant_separation(heads):
    """Find the minimum invariant pixel differences between any pair of subjects."""
    palette = []
    constant = []
    for head in heads:
        baseline = np.frombuffer(head[:256], dtype=np.uint8)
        palette.append(((baseline[:, None] >> np.arange(0, 8, 2)) & 3).reshape(-1))
        fixed_pixels = np.ones(PIXELS, dtype=bool)
        for pixel, *_ in struct.iter_unpack("<HBBBB", head[256:]):
            fixed_pixels[pixel] = False
        constant.append(fixed_pixels)
    return min(int(np.count_nonzero(constant[a] & constant[b] & (palette[a] != palette[b])))
               for a, b in itertools.combinations(range(len(heads)), 2))


def main():
    out = Path(__file__).resolve().parent
    train = lanes(*population(np.random.default_rng(4663001), SAMPLE_COUNT))
    eval_seed, eval_style = population(np.random.default_rng(19841211), SAMPLE_COUNT)
    evaluation = lanes(eval_seed, eval_style)
    heads, renders, results, vectors = [], [], [], []
    offsets = [0]
    for subject, (name, _) in enumerate(SUBJECTS):
        weights, bias = fit_decoder(train, examples(subject, train))
        head, records = head_data(weights, bias)
        offsets.append(offsets[-1] + len(head))
        heads.append(head)
        test = render(evaluation, weights, bias)
        goal = examples(subject, evaluation)
        fg = goal > 0
        fixed = render(lanes(eval_seed, np.zeros(len(eval_seed), dtype=np.uint8)), weights, bias)
        ref = packed(test)
        assert all(decode_head(head, h) == p.tobytes() for h, p in zip(evaluation[:64], ref[:64]))
        changes = []
        for bit in range(8):
            alt = lanes(eval_seed[:256], eval_style[:256] ^ np.uint8(1 << bit))
            diff = (render(alt, weights, bias) != test[:256]).sum(axis=(1, 2))
            changes.append({"style": STYLES[bit], "minPixels": int(diff.min()), "meanPixels": float(diff.mean())})
        results.append({
            "subject": subject, "name": name, "headBytes": len(head), "variablePixelRecords": records,
            "heldOutPixelAccuracy": float((test == goal).mean()), "foregroundAccuracy": float((test[fg] == goal[fg]).mean()),
            "exactImages": int(np.all(test == goal, axis=(1, 2)).sum()),
            "fixedStyleUnique": len({p.tobytes() for p in packed(fixed)}), "styleAblations": changes,
            "outputCapacity": output_capacity(weights, bias),
        })
        seed_examples = np.array([np.zeros(16, dtype=np.uint8), eval_seed[subject], np.full(16, 255, dtype=np.uint8)])
        style_examples = np.array([0, eval_style[subject], 255], dtype=np.uint8)
        hidden = lanes(seed_examples, style_examples)
        images = render(hidden, weights, bias)
        for seed, style, pixels in zip(seed_examples, style_examples, packed(images)):
            vectors.append({"subject": subject, "seed": "0x" + seed.tobytes().hex(), "style": int(style),
                            "pixels": "0x" + pixels.tobytes().hex()})
        renders.extend(((subject, 0, images[0]), (subject, int(style_examples[1]), images[1])))
        print(f"{name}: {records} variable pixels, {results[-1]['exactImages']}/{len(test)} matching holdouts")
    blob = W1.tobytes() + B1.astype("<i4").tobytes() + struct.pack("<13H", *offsets) + b"".join(heads)
    if len(blob) > 24_575:
        raise ValueError("Pack exceeds single code-data contract size")
    digest = hashlib.sha256(blob).hexdigest()
    (out / "image-model.bin").write_bytes(blob)
    (out / "image-vectors.json").write_text(json.dumps({"schema": "gh0st.gl3.image.v2", "modelSHA256": digest,
                                                        "vectors": vectors}, indent=2) + "\n")
    separation = invariant_separation(heads)
    unique = sum(row["outputCapacity"]["distinctSprites"] for row in results) if separation > 0 else None
    summary = {
        "schema": "gh0st.gl3.image.quality.v2", "modelSHA256": digest, "modelPackBytes": len(blob), "outputBytes": 256,
        "subjects": results, "trainingExamplesPerSubject": SAMPLE_COUNT, "heldOutExamplesPerSubject": SAMPLE_COUNT,
        "minInvariantPixelDifferencesBetweenSubjects": separation, "totalDistinctSprites": unique,
        "scope": "Pixel fidelity compares independently held-out inputs to synthetic supervised labels, not human aesthetic ratings.",
    }
    (out / "image-quality.json").write_text(json.dumps(summary, indent=2) + "\n")
    manifest = {
        "schema": "gh0st.gl3.image.subjects.v2", "subjects": [{"id": i, "name": n, "aliases": a}
            for i, (n, a) in enumerate(SUBJECTS)], "styles": [{"bit": i, "name": n} for i, n in enumerate(STYLES)],
        "palette": ["#09080c", "#eac18a", "#f4ede1"],
    }
    (out / "subjects.json").write_text(json.dumps(manifest, indent=2) + "\n")
    gallery(renders, out / "image-gallery.png")
    print(f"{len(blob)} bytes, sha256 {digest}")


if __name__ == "__main__":
    main()
