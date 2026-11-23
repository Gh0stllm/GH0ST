"""Train and export the native 64 × 64 layered Scene Decoder."""

import argparse
from hashlib import sha256
import json
from pathlib import Path
import sys

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "train"))
import art
import art64
from quant import pack_u5, prompt_number, unpack_u5


STYLE_BYTES = 69_632
BACKGROUND_OFFSET = 36_864
SHARED_BYTES = 12_576
MODEL_BYTES = 500_000
MAGIC = b"GH0ST64B"
ALTERNATES = (1, 2, 3, 6, 7, 8, 9, 11, 12, 13, 14, 19)
WIDTH = 16


def to_tiles(layers, side):
    cells = side // 4
    return layers.reshape(-1, cells, 4, cells, 4).transpose(0, 1, 3, 2, 4).reshape(-1, 16)


def fake_quant(value, multiplier, lo, hi):
    rounded = (value * multiplier).round().clamp(lo, hi) / multiplier
    return value + (rounded - value).detach()


def fit_layers(tiles, steps, device, rng):
    # Learn a continuous sixteen-value encoding and a shared palette-logit
    # head. Repeated tiles share a training variable to reduce the fit.
    unique, inverse, counts = np.unique(tiles, axis=0, return_inverse=True, return_counts=True)
    targets = torch.as_tensor(unique.astype(np.int64), device=device)
    latents = nn.Parameter(torch.randn(len(unique), WIDTH, device=device) * 0.5)
    head = nn.Linear(WIDTH, 16 * 8).to(device)
    optim = torch.optim.AdamW((latents, *head.parameters()), lr=0.022, weight_decay=0.0001)
    distribution = (counts ** 0.38).astype(np.float64)
    distribution /= distribution.sum()
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optim, steps, eta_min=0.004)
    batch = min(len(unique), 512)
    for step in range(steps):
        ix = torch.as_tensor(rng.choice(len(unique), size=batch, p=distribution), device=device)
        optim.zero_grad(set_to_none=True)
        x = fake_quant(latents[ix], 128, -128, 127)
        w = head.weight
        if step >= steps * 0.55:
            multiplier = 15 / w.detach().abs().amax().clamp_min(1e-6)
            w = fake_quant(w, multiplier, -16, 15)
        prediction = F.linear(x, w, head.bias).view(-1, 8)
        loss = F.cross_entropy(prediction, targets[ix].reshape(-1))
        loss.backward()
        optim.step()
        scheduler.step()
        with torch.no_grad():
            latents.clamp_(-1, 127 / 128)
        if step % 400 == 0 or step == steps - 1:
            print(json.dumps({"step": step + 1, "tiles": len(unique), "loss": float(loss.detach())}), flush=True)

    def array(tensor):
        return tensor.detach().cpu().numpy()

    weights = array(head.weight)
    scale = np.abs(weights).max() / 15
    codes = np.clip(np.rint(weights / scale), -16, 15).astype(np.int32) + 16
    corrected_bias = np.rint(array(head.bias) * 128 / scale).astype(np.int32) - 128 * codes.sum(axis=1)
    # Improve the integer output directly after freezing the Q5 head.
    with torch.no_grad():
        current = (latents * 128).round().clamp(-128, 127) + 128
        matrix = torch.as_tensor(codes.T, dtype=torch.float32, device=device)
        bias = torch.as_tensor(corrected_bias, dtype=torch.float32, device=device)
        best_logits = current @ matrix + bias

        def rank(logits):
            channels = logits.view(-1, 16, 8)
            target = channels.gather(2, targets[:, :, None]).squeeze(2)
            margins = (target - channels.amax(2)).clamp_min(-128)
            return (channels.argmax(2) == targets).sum(1) * 4096 + margins.sum(1)

        quality = rank(best_logits)
        for step_size in (24, 10, 4):
            for dimension in range(WIDTH):
                for direction in (-1, 1):
                    replacement = (current[:, dimension] + direction * step_size).clamp(0, 255)
                    shift = replacement - current[:, dimension]
                    trial = best_logits + shift[:, None] * matrix[dimension]
                    score = rank(trial)
                    accepted = score > quality
                    current[:, dimension] = torch.where(accepted, replacement, current[:, dimension])
                    best_logits = torch.where(accepted[:, None], trial, best_logits)
                    quality = torch.maximum(score, quality)
        encoded_latents = array(current).astype(np.uint8)
    rows = bytearray()
    for row, correction in zip(codes, corrected_bias):
        for start in (0, 8):
            lanes = sum(int(code) << (16 * k) for k, code in enumerate(row[start:start + 8]))
            rows += lanes.to_bytes(16, "big")
        rows += int(correction).to_bytes(4, "big", signed=True)
    integer_predictions = (encoded_latents.astype(np.int32) @ codes.T + corrected_bias).reshape(-1, 16, 8).argmax(2)
    accuracy = (integer_predictions[inverse] == tiles).mean()
    return encoded_latents[inverse], bytes(rows), float(accuracy)


class Reference:
    """Independent EVM-equivalent integer decoder of the serialized model."""

    def __init__(self, pack):
        assert len(pack) == MODEL_BYTES and pack[7 * STYLE_BYTES + 9952:7 * STYLE_BYTES + 9960] == MAGIC
        self.styles = np.frombuffer(pack[:7 * STYLE_BYTES], dtype=np.uint8).reshape(7, STYLE_BYTES)
        shared = pack[7 * STYLE_BYTES:]
        self.heads = []
        for start in (0, 4608):
            weights, bias = [], []
            for row in range(128):
                offset = start + row * 36
                low = int.from_bytes(shared[offset:offset + 16], "big")
                high = int.from_bytes(shared[offset + 16:offset + 32], "big")
                weights.append([(lanes >> (16 * i)) & 0xffff for lanes in (low, high) for i in range(8)])
                bias.append(int.from_bytes(shared[offset + 32:offset + 36], "big", signed=True))
            self.heads.append((np.array(weights, dtype=np.int32), np.array(bias, dtype=np.int32)))
        self.backdrop = np.frombuffer(shared[9216:9728], dtype=np.uint8).reshape(16, 8, 4)
        self.tints = np.frombuffer(shared[9728:9952], dtype=np.uint8).reshape(8, 7, 4)

    def layer(self, styles, offset, cells, head):
        weight, bias = self.heads[head]
        codes = styles[offset:offset + WIDTH * cells * cells].reshape(-1, WIDTH).astype(np.int32)
        grid = (codes @ weight.T + bias).reshape(-1, 16, 8).argmax(2).astype(np.uint8)
        return grid.reshape(cells, cells, 4, 4).transpose(0, 2, 1, 3).reshape(4 * cells, 4 * cells)

    def generate(self, fields, seed):
        a, b, ta, tb, relation, background, style, palette = fields
        noise = sha256(bytes(fields) + int(seed).to_bytes(8, "big")).digest()
        weights = self.styles[style]
        pixels = self.layer(weights, BACKGROUND_OFFSET + background * 4096, 16, 1)
        placements = (((16, 16),), ((0, 16), (32, 16)), ((16, 0), (16, 32)))[relation]
        for slot, (x, y) in enumerate(placements):
            subject = (a, b)[slot]
            variant_index = 24 + ALTERNATES.index(subject) if subject in ALTERNATES and noise[slot + 1] & 1 else subject - 1
            offset = variant_index * 1024
            sprite = self.layer(weights, offset, 8, 0)
            np.copyto(pixels[y:y + 32, x:x + 32], sprite + 7 + 8 * slot, where=sprite != 0)
        rgba = np.zeros((32, 4), dtype=np.uint8)
        rgba[:8], rgba[8:15], rgba[16:23] = self.backdrop[palette], self.tints[ta], self.tints[tb]
        return pixels, rgba


def build_pack(device, steps, rng):
    subject_layers = np.array([
        art64.subject_layer(subject, style, variant)
        for style in range(7) for subject, variant in (
            [(subject, 0) for subject in range(1, 25)] + [(subject, 1) for subject in ALTERNATES]
        )
    ], dtype=np.uint8).reshape(7, 36, 32, 32)
    backdrop_layers = np.array([
        art64.background_layer(background, style, 0)
        for style in range(7) for background in range(8)
    ], dtype=np.uint8).reshape(7, 8, 64, 64)
    assert subject_layers.max() < 8 and backdrop_layers.max() < 8
    print(json.dumps({"training": "subjects", "layers": 7 * 36}), flush=True)
    subjects, subject_head, subject_accuracy = fit_layers(to_tiles(subject_layers, 32), steps, device, rng)
    print(json.dumps({"training": "backgrounds", "layers": 7 * 8}), flush=True)
    backgrounds, background_head, background_accuracy = fit_layers(to_tiles(backdrop_layers, 64), steps, device, rng)
    styles = np.concatenate((subjects.reshape(7, -1), backgrounds.reshape(7, -1)), axis=1)
    assert styles.shape == (7, STYLE_BYTES)
    assert art64.BACKDROP_RGBA.shape == (16, 8, 4) and art64.TINT_RGBA.shape == (8, 7, 4)
    shared = subject_head + background_head + art64.BACKDROP_RGBA.tobytes() + art64.TINT_RGBA.tobytes()
    assert len(shared) == 9952
    stats = {"subjectTrainingPixelAgreement": subject_accuracy, "backgroundTrainingPixelAgreement": background_accuracy}
    metadata = MAGIC + json.dumps(stats, sort_keys=True).encode()
    pack = styles.tobytes() + (shared + metadata).ljust(SHARED_BYTES, b"\0")
    assert len(pack) == MODEL_BYTES
    return pack, stats


def example_vectors(pack):
    decoder = Reference(pack)
    examples = (
        (7, 13, 0, 1, 1, 2, 0, 8),
        (6, 0, 6, 0, 0, 2, 1, 0),
        (13, 14, 4, 5, 2, 6, 2, 6),
        (8, 9, 6, 1, 2, 1, 3, 12),
        (7, 6, 2, 6, 1, 2, 4, 1),
        (14, 13, 3, 1, 1, 2, 5, 8),
        (13, 0, 7, 0, 0, 6, 6, 6),
        (7, 0, 0, 0, 0, 2, 0, 8),
    )
    vectors = []
    for index, fields in enumerate(examples):
        seed = 64312 + 313 * index
        pixels, rgba = decoder.generate(fields, seed)
        a, b, ta, tb, layout, backdrop, style, _ = fields
        caption = f"{art.TINTS[ta]} {art.SUBJECTS[a]}"
        if b:
            caption += f" {art.RELATIONS[layout]} {art.TINTS[tb]} {art.SUBJECTS[b]}"
        vector = {
            "prompt": str(prompt_number(fields)), "seed": str(seed), "style": style,
            "split": "new composition of trained layers", "caption": caption,
            "background": art.BACKGROUNDS[backdrop],
            "pixelsHex": "0x" + pack_u5(pixels).hex(), "paletteHex": "0x" + rgba.tobytes().hex(),
            "pixelSha256": sha256(pack_u5(pixels)).hexdigest(),
        }
        vectors.append(vector)
    return {"modelSha256": sha256(pack).hexdigest(), "vectors": vectors}


def gallery(vectors, path):
    from PIL import Image, ImageDraw, ImageFont

    panels = vectors["vectors"]
    image = Image.new("RGB", (1112, 648), "#0b0a0a")
    draw = ImageDraw.Draw(image)
    try:
        title = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 29)
        text = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 13)
    except OSError:
        title, text = ImageFont.load_default(size=29), ImageFont.load_default(size=13)
    draw.text((28, 22), "GH0ST SCENE DECODER", font=title, fill="#f1ece4")
    draw.text((30, 70), "500 KB  /  NATIVE 64 × 64 MODEL OUTPUTS", font=text, fill="#eac18a")
    for index, vector in enumerate(panels):
        row, col = divmod(index, 4)
        x, y = 30 + 270 * col, 107 + 266 * row
        output = bytes.fromhex(vector["pixelsHex"][2:])
        assert sha256(output).hexdigest() == vector["pixelSha256"]
        pixels = unpack_u5(output).reshape(64, 64)
        palette = np.frombuffer(bytes.fromhex(vector["paletteHex"][2:]), dtype=np.uint8).reshape(32, 4)
        frame = Image.fromarray(palette[pixels]).convert("RGB").resize((192, 192), Image.Resampling.NEAREST)
        image.paste(frame, (x, y))
        caption = [""]
        for word in vector["caption"].split():
            line = (caption[-1] + " " + word).strip()
            if not caption[-1] or draw.textlength(line, font=text) < 244:
                caption[-1] = line
            else:
                caption.append(word)
        for line, label in enumerate(caption):
            draw.text((x, y + 203 + line * 15), label, font=text, fill="#f1ece4")
        extras = f"{vector['background']}  /  {art.STYLES[vector['style']]}"
        draw.text((x, y + 238), extras, font=text, fill="#eac18a")
    image.save(path, optimize=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--steps", type=int, default=3600)
    parser.add_argument("--device", choices=("mps", "cpu"), default="mps")
    args = parser.parse_args()
    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    seed = 64008
    torch.manual_seed(seed)
    torch.set_num_threads(3)
    pack, stats = build_pack(torch.device(args.device), args.steps, np.random.default_rng(seed))
    vectors = example_vectors(pack)
    stats.update({"modelSha256": sha256(pack).hexdigest(), "bytes": len(pack), "stepsPerLayer": args.steps,
                  "trainingSeed": seed, "device": args.device, "subjectLayers": 252, "backgroundLayers": 56,
                  "artSourceSha256": sha256(Path(art64.__file__).read_bytes()).hexdigest()})
    (output / "pack500.bin").write_bytes(pack)
    (output / "vectors.json").write_text(json.dumps(vectors, indent=2) + "\n")
    (output / "training.json").write_text(json.dumps(stats, indent=2) + "\n")
    gallery(vectors, output / "model-samples.png")
    print(json.dumps(stats), flush=True)


if __name__ == "__main__":
    main()
