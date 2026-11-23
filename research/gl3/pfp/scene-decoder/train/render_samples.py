"""Build an image gallery from exact outputs of the quantized scene model."""

import argparse
from collections import defaultdict
from hashlib import sha256
import json
from math import ceil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from art import STYLES
from quant import unpack_u5


INK = "#0b0a0a"
PANEL = "#121110"
BORDER = "#312820"
AMBER = "#eac18a"
WHITE = "#f1ece4"
MUTED = "#ac9f90"
PIXELS = 128
MARGIN = 34
GAP = 14
PANEL_WIDTH = 2 * PIXELS + 3 * GAP
PANEL_HEIGHT = 250


def font(size, bold=False):
    names = (
        ("DejaVuSansMono-Bold.ttf", "/System/Library/Fonts/Menlo.ttc", 1)
        if bold else ("DejaVuSansMono.ttf", "/System/Library/Fonts/Menlo.ttc", 0)
    )
    for name, index in ((names[0], 0), (names[1], names[2])):
        try:
            return ImageFont.truetype(name, size, index=index)
        except OSError:
            pass
    return ImageFont.load_default(size=size)


def lines(draw, text, face, width):
    words = text.split()
    row = ""
    for word in words:
        candidate = f"{row} {word}".strip()
        if row and draw.textlength(candidate, font=face) > width:
            yield row
            row = word
        else:
            row = candidate
    if row:
        yield row


def read_gallery(evidence):
    fixtures = json.loads((evidence / "vectors.json").read_text())["vectors"]
    frames = np.load(evidence / "sample-frames.npy", allow_pickle=False)
    if not fixtures or frames.shape != (len(fixtures), 2, 32, 32, 4) or frames.dtype != np.uint8:
        raise ValueError("Unexpected sample frame shape or dtype")

    styles = defaultdict(list)
    for fixture, frame in zip(fixtures, frames[:, 0]):
        pixels = bytes.fromhex(fixture["pixelsHex"].removeprefix("0x"))
        palette = bytes.fromhex(fixture["paletteHex"].removeprefix("0x"))
        if len(pixels) != 640 or len(palette) != 128 or sha256(pixels).hexdigest() != fixture["pixelSha256"]:
            raise ValueError(f"Invalid packed output for {fixture['caption']}")
        rgba = np.frombuffer(palette, dtype=np.uint8).reshape(32, 4)[unpack_u5(pixels)].reshape(32, 32, 4)
        if not np.array_equal(frame, rgba):
            raise ValueError(f"Sample frame differs from the quantized output for {fixture['caption']}")
        style = int(fixture["style"])
        if not 0 <= style < len(STYLES):
            raise ValueError(f"Unknown style ID {style}")
        caption, background, _ = fixture["caption"].split(" · ", 2)
        styles[style].append((caption, background, frame, bool(fixture["twoSubjects"])))

    for group in styles.values():
        if len(group) > 2:
            raise ValueError("Expected at most two samples per style")
        group.sort(key=lambda item: item[-1])
    return sorted(styles.items())


def render(evidence, output):
    gallery = read_gallery(evidence)
    columns = min(4, len(gallery))
    rows = ceil(len(gallery) / columns)
    width = 2 * MARGIN + columns * PANEL_WIDTH + (columns - 1) * GAP
    height = 118 + rows * PANEL_HEIGHT + (rows - 1) * GAP + MARGIN
    image = Image.new("RGB", (width, height), INK)
    draw = ImageDraw.Draw(image)
    title, subtitle, heading, caption_font, background_font = (
        font(34, bold=True), font(13), font(14, bold=True), font(12), font(11)
    )
    face = (
        "##.........##",
        "#...........#",
        "#..##...##..#",
        "#...........#",
        "##.........##",
    )
    for y, row in enumerate(face):
        for x, marker in enumerate(row):
            if marker == "#":
                left, top = MARGIN + 5 * x, 30 + 5 * y
                draw.ellipse((left, top, left + 2, top + 2), fill=AMBER)
    left = MARGIN + 80
    draw.text((left, 19), "GH0ST SCENE DECODER", font=title, fill=WHITE)
    draw.text((left, 69), "500 KB  /  32 × 32  /  SELECTED HELD-OUT MODEL OUTPUTS", font=subtitle, fill=AMBER)
    draw.line((MARGIN, 100, width - MARGIN, 100), fill=BORDER)

    for index, (style, samples) in enumerate(gallery):
        row, column = divmod(index, columns)
        count = min(columns, len(gallery) - row * columns)
        span = count * PANEL_WIDTH + (count - 1) * GAP
        x = (width - span) // 2 + column * (PANEL_WIDTH + GAP)
        y = 118 + row * (PANEL_HEIGHT + GAP)
        draw.rectangle((x, y, x + PANEL_WIDTH - 1, y + PANEL_HEIGHT - 1), fill=PANEL, outline=BORDER)
        draw.text((x + GAP, y + 12), STYLES[style].upper(), font=heading, fill=AMBER)

        for card, (caption, background, frame, _) in enumerate(samples):
            dx = x + GAP + card * (PIXELS + GAP)
            dy = y + 38
            picture = Image.fromarray(frame).resize((PIXELS, PIXELS), Image.Resampling.NEAREST)
            image.paste(picture, (dx, dy), picture)
            draw.rectangle((dx - 1, dy - 1, dx + PIXELS, dy + PIXELS), outline=BORDER)
            for line, text in enumerate(lines(draw, caption, caption_font, PIXELS)):
                draw.text((dx, dy + PIXELS + 10 + line * 15), text, font=caption_font, fill=WHITE)
            draw.text((dx, y + 223), background, font=background_font, fill=MUTED)

    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, optimize=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--evidence", type=Path, default=Path(__file__).resolve().parent.parent / "evidence"
    )
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args()
    render(arguments.evidence, arguments.output or arguments.evidence / "model-samples.png")
