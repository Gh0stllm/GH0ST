#!/usr/bin/env python3
"""Reproduce matched-prompt regression evidence for the Q16 M-P1 runtime."""

import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from mp1_fixed import Pack, full_image, rgba_for, image_similarity, sha


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pack", type=Path, required=True)
    parser.add_argument("--browser-captures", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    baseline = json.loads((args.browser_captures / "samples.json").read_text())
    allowed = ("q5", 24680, 16, 1.5)
    if tuple(baseline[name] for name in ("variant", "seed", "steps", "guidance")) != allowed:
        raise ValueError("Baseline differs from fixed-point regression configuration")

    model = Pack(args.pack)
    samples = []
    sheet = Image.new("RGB", (630, 586), "#100e13")
    draw = ImageDraw.Draw(sheet)
    fonts = Path("/System/Library/Fonts/Supplemental")
    def font(name, size):
        path = fonts / (name + ".ttf")
        return ImageFont.truetype(str(path), size) if path.exists() else ImageFont.load_default(size=size)
    draw.text((24, 12), "M-P1 fixed-point replay", fill="#f4ede1", font=font("Arial Bold", 28))
    for x, text in ((395, "Q5 WebGPU"), (498, "Q5 with Q16 math")):
        draw.text((x, 59), text, anchor="mt", fill="#eac18a", font=font("Arial", 12))

    for i, caption in enumerate(baseline["prompts"]):
        prompt, slug = caption["prompt"], caption["slug"]
        before = args.browser_captures / (slug + "-0.png")
        pixels, _, trace, _, _ = full_image(model, prompt, baseline["seed"], False)
        after = rgba_for(pixels, model.palette)
        fixed_png = Image.fromarray(after)
        browser_png = Image.open(before).convert("RGBA")
        metrics = image_similarity(after, before)
        samples.append({
            "prompt": prompt, "pixelSha256": sha(pixels.astype("<u2").tobytes()),
            "finalLatentSha256": trace["15.latent"], **metrics,
        })
        y = 77 + i * 81
        draw.text((24, y + 27), prompt, fill="#f4ede1", font=font("Arial", 15))
        for x, sample in ((360, browser_png), (463, fixed_png)):
            swatch = sample.resize((64, 64), Image.Resampling.NEAREST)
            draw.rectangle((x - 4, y - 4, x + 68, y + 68), fill="#211b27", outline="#463a49")
            sheet.paste(swatch, (x, y), swatch)
    evidence = {
        "seed": baseline["seed"],
        "steps": baseline["steps"],
        "sampleCount": len(samples),
        "meanSilhouetteIoU": round(float(np.mean([s["silhouetteIoU"] for s in samples])), 6),
        "meanPremultipliedRgbMae": round(float(np.mean([s["premultipliedRgbMae"] for s in samples])), 6),
        "exactPixelTotal": sum(s["exactRgbaPixels"] for s in samples),
        "comparedPixelTotal": len(samples) * 256,
        "linearInputMaxAbsQ16": model.linear_input_max_abs,
        "samples": samples,
        "scope": "First sprite in each matched-seed browser batch compared to a local fixed-point replay.",
    }
    (args.output / "six-caption-comparison.json").write_text(json.dumps(evidence, indent=2) + "\n")
    draw.text((23, 564), "Native 16×16 sprites enlarged with nearest-neighbor sampling", fill="#bcb0a6", font=font("Arial", 13))
    sheet.save(args.output / "six-caption-comparison.png")
    print(json.dumps({k: evidence[k] for k in ("sampleCount", "meanSilhouetteIoU", "meanPremultipliedRgbMae", "exactPixelTotal", "comparedPixelTotal")}))
    max_operator = max(model.linear_input_max_abs,key=model.linear_input_max_abs.get)
    print(max_operator, model.linear_input_max_abs[max_operator], model.linear_input_max_abs[max_operator]/65536)


if __name__ == "__main__":
    main()
