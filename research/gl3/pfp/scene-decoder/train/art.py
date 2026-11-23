"""Original sprites and scene targets for the GH0ST scene decoder.

The renderer is a training-data source. The inference contract only uses the
learned pack, and has no copy of the sprite drawing rules below.
"""

from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw


SUBJECTS = (
    "empty", "ghost", "cat", "robot", "alien", "skull", "owl", "fox",
    "rocket", "planet", "mountain", "castle", "flower", "crystal", "mushroom",
    "pine", "moon", "potion", "sword", "jellyfish", "cactus", "key",
    "butterfly", "anchor", "whale",
)
TINTS = ("amber", "blue", "red", "mint", "purple", "rose", "ivory", "teal")
RELATIONS = ("single", "left of", "above")
BACKGROUNDS = ("void", "night sky", "forest", "ocean", "ruins", "desert", "ice cave", "digital")
STYLES = ("classic", "neon", "stained glass", "blueprint", "ink", "mosaic", "terminal")
PALETTE_NAMES = (
    "obsidian", "dusk", "dawn", "aurora", "sandstone", "plum", "frost", "copper",
    "evergreen", "ocean", "arcade", "parchment", "cobalt", "low light", "high contrast", "moonstone",
)


def _make_palettes():
    # The first eight entries have shared background and outline roles.
    # The eight tints each have dark, mid, and light entries.
    accents = (
        (250, 176, 70), (75, 144, 249), (241, 76, 86), (82, 219, 133),
        (171, 101, 236), (238, 110, 172), (236, 229, 207), (62, 210, 215),
    )
    ground = (
        (15, 20, 33), (29, 24, 49), (55, 28, 49), (10, 36, 38),
        (53, 36, 34), (42, 24, 59), (27, 47, 65), (45, 29, 25),
        (15, 36, 32), (14, 31, 56), (24, 16, 45), (66, 54, 44),
        (21, 34, 65), (13, 17, 28), (11, 13, 20), (32, 39, 47),
    )
    contrast = (100, 90, 94, 100, 90, 98, 92, 94, 97, 102, 110, 87, 100, 82, 114, 88)

    def blend(a, b, percent):
        return tuple((x * (100 - percent) + y * percent) // 100 for x, y in zip(a, b))

    palettes = []
    for bg, strength in zip(ground, contrast):
        shades = [
            bg, blend(bg, (93, 126, 157), 25), blend(bg, (112, 151, 177), 50),
            blend(bg, (228, 215, 183), 74), (7, 11, 19),
            blend(bg, (123, 115, 145), 45), (214, 226, 237), (253, 240, 208),
        ]
        for color in accents:
            saturate = tuple(min(255, int((v - 128) * strength / 100) + 128) for v in color)
            shades.extend((blend(bg, saturate, 55), saturate, blend(saturate, (255, 246, 233), 42)))
        palettes.append([(*rgb, 255) for rgb in shades])
    return np.asarray(palettes, dtype=np.uint8)


PALETTES = _make_palettes()


@lru_cache(maxsize=None)
def _sprite(subject):
    image = Image.new("L", (16, 16))
    d = ImageDraw.Draw(image)
    if subject == 1:
        d.rounded_rectangle((2, 1, 13, 12), 5, fill=2)
        d.polygon([(2, 7), (13, 7), (14, 14), (11, 12), (8, 15), (5, 12), (1, 14)], fill=2)
        d.arc((3, 2, 12, 10), 180, 291, fill=3)
        d.ellipse((4, 6, 5, 8), fill=4)
        d.ellipse((10, 6, 11, 8), fill=4)
        d.point((8, 10), fill=4)
    elif subject == 2:
        d.polygon([(2, 1), (6, 4), (10, 4), (13, 1), (14, 10), (12, 13), (4, 13), (1, 10)], fill=2)
        d.polygon([(3, 3), (5, 5), (3, 6)], fill=3)
        d.polygon([(12, 3), (10, 5), (12, 6)], fill=3)
        d.ellipse((3, 8, 12, 13), fill=3)
        d.point([(5, 7), (10, 7), (7, 9), (8, 9)], fill=4)
        d.line((1, 9, 4, 10), fill=4)
        d.line((11, 10, 14, 9), fill=4)
    elif subject == 3:
        d.line((8, 1, 8, 5), fill=2)
        d.rectangle((7, 1, 9, 2), fill=3)
        d.rounded_rectangle((2, 4, 13, 13), 2, fill=2)
        d.rectangle((1, 7, 2, 10), fill=1)
        d.rectangle((13, 7, 14, 10), fill=1)
        d.rectangle((4, 6, 11, 10), fill=4)
        d.point([(5, 8), (6, 8), (9, 8), (10, 8)], fill=3)
        d.line((6, 12, 9, 12), fill=1)
    elif subject == 4:
        d.polygon([(4, 2), (11, 2), (14, 6), (13, 10), (8, 14), (4, 12), (1, 7)], fill=2)
        d.line((4, 3, 10, 3), fill=3)
        d.polygon([(3, 6), (5, 6), (7, 9), (5, 9)], fill=4)
        d.polygon([(12, 6), (10, 6), (8, 9), (10, 9)], fill=4)
        d.line((7, 11, 8, 11), fill=1)
    elif subject == 5:
        d.ellipse((2, 1, 13, 12), fill=3)
        d.rectangle((5, 10, 10, 14), fill=3)
        d.ellipse((4, 6, 6, 8), fill=4)
        d.ellipse((9, 6, 11, 8), fill=4)
        d.point((8, 10), fill=4)
        d.line((6, 12, 6, 14), fill=1)
        d.line((9, 12, 9, 14), fill=1)
    elif subject == 6:
        d.polygon([(2, 2), (5, 4), (10, 4), (13, 2), (14, 10), (10, 14), (5, 14), (1, 10)], fill=2)
        d.ellipse((3, 5, 7, 9), fill=3)
        d.ellipse((8, 5, 12, 9), fill=3)
        d.point([(5, 7), (10, 7)], fill=4)
        d.polygon([(6, 9), (9, 9), (8, 11)], fill=1)
        d.line((5, 12, 10, 12), fill=1)
    elif subject == 7:
        d.polygon([(1, 1), (6, 5), (9, 5), (14, 1), (13, 10), (8, 14), (3, 11)], fill=2)
        d.polygon([(3, 3), (5, 6), (3, 6)], fill=1)
        d.polygon([(12, 3), (10, 6), (12, 6)], fill=1)
        d.polygon([(2, 8), (8, 10), (13, 8), (11, 12), (8, 14), (4, 12)], fill=3)
        d.point([(5, 8), (10, 8), (7, 12), (8, 12)], fill=4)
    elif subject == 8:
        d.polygon([(8, 1), (11, 5), (11, 11), (5, 11), (5, 5)], fill=3)
        d.polygon([(5, 8), (2, 11), (2, 13), (6, 11)], fill=2)
        d.polygon([(11, 8), (14, 11), (14, 13), (10, 11)], fill=2)
        d.rectangle((7, 6, 9, 8), fill=4)
        d.polygon([(6, 12), (10, 12), (8, 15)], fill=2)
    elif subject == 9:
        d.ellipse((3, 2, 12, 13), fill=2)
        d.arc((4, 3, 11, 12), 193, 280, fill=3)
        d.line((1, 10, 14, 6), fill=3)
        d.point([(1, 9), (14, 7)], fill=3)
    elif subject == 10:
        d.polygon([(1, 13), (6, 3), (10, 9), (12, 6), (15, 13)], fill=2)
        d.polygon([(4, 7), (6, 3), (8, 6), (7, 7), (6, 6)], fill=3)
        d.polygon([(6, 8), (9, 10), (10, 9), (13, 13), (6, 13)], fill=1)
    elif subject == 11:
        d.rectangle((4, 7, 11, 13), fill=2)
        d.rectangle((1, 5, 4, 13), fill=1)
        d.rectangle((11, 5, 14, 13), fill=2)
        d.rectangle((6, 4, 9, 7), fill=3)
        d.rectangle((7, 10, 9, 13), fill=4)
        d.point([(1, 4), (4, 4), (11, 4), (14, 4), (6, 3), (9, 3)], fill=3)
        d.point([(2, 7), (12, 7)], fill=3)
    elif subject == 12:
        d.line((8, 6, 8, 14), fill=2)
        d.polygon([(8, 12), (4, 9), (4, 12)], fill=1)
        d.polygon([(8, 12), (12, 9), (12, 11)], fill=2)
        for x, y in ((7, 2), (4, 4), (10, 4), (5, 7), (9, 7)):
            d.ellipse((x - 1, y - 1, x + 2, y + 2), fill=2)
        d.rectangle((7, 4, 9, 6), fill=3)
    elif subject == 13:
        d.polygon([(7, 1), (11, 3), (13, 10), (8, 14), (3, 11), (4, 4)], fill=2)
        d.polygon([(7, 1), (8, 8), (4, 4), (3, 11), (8, 14), (8, 8)], fill=1)
        d.polygon([(7, 1), (11, 3), (8, 8)], fill=3)
        d.line((10, 8, 9, 11), fill=3)
    elif subject == 14:
        d.rounded_rectangle((6, 6, 10, 14), 1, fill=3)
        d.pieslice((1, 1, 14, 14), 180, 360, fill=2)
        d.line((2, 8, 13, 8), fill=1)
        d.point([(5, 5), (8, 3), (11, 5), (8, 6)], fill=3)
    elif subject == 15:
        d.rectangle((7, 10, 8, 14), fill=1)
        for x, y in ((4, 1), (5, 4), (7, 7)):
            d.polygon([(8, y), (8 - x, y + 5), (7 + x, y + 5)], fill=2)
        d.point([(7, 3), (6, 6), (5, 9), (4, 11), (10, 9)], fill=3)
    elif subject == 16:
        d.ellipse((2, 1, 13, 14), fill=2)
        d.ellipse((7, 0, 15, 11), fill=0)
        d.arc((3, 2, 12, 13), 98, 238, fill=3)
        d.point([(6, 11), (10, 12)], fill=1)
    elif subject == 17:
        d.rectangle((6, 2, 9, 6), fill=3)
        d.rectangle((5, 1, 10, 2), fill=1)
        d.rounded_rectangle((3, 6, 12, 14), 3, fill=2)
        d.arc((4, 7, 11, 13), 170, 286, fill=3)
        d.line((4, 11, 11, 11), fill=1)
        d.point((9, 9), fill=3)
    elif subject == 18:
        d.polygon([(11, 1), (14, 1), (14, 4), (7, 11), (5, 9)], fill=3)
        d.line((6, 9, 13, 2), fill=2)
        d.line((4, 8, 8, 12), fill=2, width=2)
        d.line((6, 10, 2, 14), fill=1, width=2)
        d.point((2, 14), fill=3)
    elif subject == 19:
        d.pieslice((1, 1, 14, 12), 180, 360, fill=2)
        d.arc((3, 2, 12, 12), 190, 306, fill=3)
        d.line([(4, 6), (4, 10), (3, 13)], fill=2)
        d.line([(7, 6), (7, 12), (8, 14)], fill=3)
        d.line([(10, 6), (10, 10), (11, 13)], fill=1)
        d.point([(5, 5), (10, 5)], fill=4)
    elif subject == 20:
        d.rounded_rectangle((6, 2, 9, 14), 2, fill=2)
        d.line([(3, 5), (3, 9), (7, 9)], fill=2, width=2)
        d.line([(12, 5), (12, 7), (9, 7)], fill=2, width=2)
        d.line((7, 4, 7, 12), fill=3)
        d.point([(4, 5), (12, 4), (8, 1)], fill=3)
    elif subject == 21:
        d.ellipse((2, 1, 11, 9), fill=2)
        d.ellipse((5, 3, 8, 6), fill=0)
        d.rectangle((6, 8, 8, 14), fill=2)
        d.rectangle((8, 12, 11, 13), fill=2)
        d.arc((3, 2, 10, 8), 182, 290, fill=3)
    elif subject == 22:
        d.polygon([(7, 5), (2, 2), (1, 6), (3, 10), (2, 12), (4, 14), (7, 11)], fill=2)
        d.polygon([(8, 5), (13, 2), (14, 6), (12, 10), (13, 12), (11, 14), (8, 11)], fill=2)
        d.line((7, 5, 7, 12), fill=1, width=2)
        d.point([(4, 6), (3, 8), (5, 11), (11, 6), (12, 8), (10, 11)], fill=3)
    elif subject == 23:
        d.ellipse((5, 1, 10, 6), fill=2)
        d.ellipse((7, 3, 8, 4), fill=0)
        d.rectangle((7, 6, 8, 13), fill=2)
        d.line((4, 8, 11, 8), fill=3)
        d.arc((1, 5, 14, 14), 0, 180, fill=2, width=2)
        d.polygon([(1, 8), (4, 10), (1, 11)], fill=2)
        d.polygon([(14, 8), (11, 10), (14, 11)], fill=2)
    elif subject == 24:
        d.ellipse((1, 5, 12, 13), fill=2)
        d.polygon([(10, 9), (13, 5), (15, 5), (14, 8), (15, 10), (12, 10)], fill=2)
        d.arc((2, 6, 11, 13), 63, 167, fill=3)
        d.point((4, 8), fill=4)
        d.line([(5, 5), (5, 2), (4, 1)], fill=3)
        d.point((6, 1), fill=3)
    return np.asarray(image)


@lru_cache(maxsize=None)
def _subject_tile(subject, tint, style, size):
    sprite = _sprite(subject)
    if size != 16:
        sprite = np.asarray(Image.fromarray(sprite).resize((size, size), Image.Resampling.NEAREST))
    dark, mid, light = (8 + 3 * tint, 9 + 3 * tint, 10 + 3 * tint)
    lookup = np.array((0, dark, mid, light, 4), dtype=np.uint8)
    tile = lookup[sprite]
    opaque = sprite != 0
    y, x = np.indices(sprite.shape)
    padded = np.pad(opaque, 1)
    interior = opaque & padded[:-2, 1:-1] & padded[2:, 1:-1] & padded[1:-1, :-2] & padded[1:-1, 2:]
    edge = opaque & ~interior
    if style == 1:
        tile[opaque & (sprite == 2)] = dark
        tile[edge & (sprite != 4)] = light
    elif style == 2:
        tile[edge] = 4
        tile[interior & (sprite != 4) & ((x + y) % 7 == 0)] = dark
        tile[interior & (sprite == 2) & ((x // 4 + y // 4) % 3 == 1)] = light
    elif style == 3:
        tile[opaque & (sprite == 2)] = 1
        tile[edge & (sprite != 4)] = light
        tile[interior & (sprite == 2) & ((x + 2 * y) % 4 == 0)] = dark
    elif style == 4:
        tile[opaque & (sprite == 2)] = dark
        tile[edge | (sprite == 4)] = 4
        tile[interior & (sprite == 2) & ((x - y) % 4 == 0)] = mid
    elif style == 5:
        tile[interior & (sprite == 2) & ((x // 2 + y // 2) % 2 == 0)] = light
    elif style == 6:
        tile[opaque & (sprite == 2)] = light
        tile[interior & (sprite == 2) & ((x + y) % 2 == 0)] = dark
        tile[sprite == 3] = 7
    return tile, opaque


@lru_cache(maxsize=None)
def _backdrop(background, style, phase):
    image = Image.new("L", (32, 32))
    d = ImageDraw.Draw(image)
    if background == 1:
        d.rectangle((0, 24, 31, 31), fill=1)
        d.point([(3, 3), (5, 21), (10, 6), (19, 4), (25, 10), (29, 3),
                 (22, 18), (29, 21)], fill=3)
        d.line((0, 26, 31, 26), fill=2)
    elif background == 2:
        d.rectangle((0, 25, 31, 31), fill=1)
        for x, y in ((2, 4), (30, 5), (9, 11), (24, 12)):
            d.polygon([(x, y), (x - 5, y + 13), (x + 5, y + 13)], fill=1)
            d.line((x, y + 8, x, y + 16), fill=2)
    elif background == 3:
        for y, color in ((12, 1), (19, 2), (25, 1)):
            d.rectangle((0, y, 31, 31), fill=color)
            for x in range((y + phase) % 7, 32, 9):
                d.line((x, y + 2, x + 3, y + 2), fill=3 if y == 12 else 2)
    elif background == 4:
        d.rectangle((0, 24, 31, 31), fill=1)
        d.rectangle((1, 5, 5, 26), fill=1)
        d.rectangle((26, 7, 30, 26), fill=1)
        d.line((4, 6, 4, 22), fill=2)
        d.line((27, 8, 27, 24), fill=2)
        d.line((0, 27, 31, 27), fill=2)
    elif background == 5:
        d.polygon([(0, 17), (7, 15), (16, 20), (24, 15), (31, 17), (31, 31), (0, 31)], fill=1)
        d.polygon([(0, 25), (12, 23), (23, 26), (31, 22), (31, 31), (0, 31)], fill=2)
        d.ellipse((23, 3, 27, 7), fill=3)
    elif background == 6:
        d.polygon([(0, 0), (8, 0), (5, 12), (2, 7), (0, 22)], fill=1)
        d.polygon([(24, 0), (31, 0), (31, 23), (29, 9), (25, 14)], fill=2)
        d.polygon([(0, 26), (7, 22), (9, 25), (18, 28), (24, 24), (31, 25), (31, 31), (0, 31)], fill=1)
    elif background == 7:
        for x, y in ((1, 4), (6, 21), (19, 2), (25, 23)):
            d.line([(x, y), (x + 4, y), (x + 4, y + 4)], fill=1)
            d.point((x + 4, y + 5), fill=2)
        d.line((0, 29, 31, 29), fill=1)

    if style == 1:
        for x in (1, 30):
            d.line((x, 13, x, 18), fill=2)
    elif style == 2:
        d.rectangle((1, 1, 30, 30), outline=2)
        d.point([(1, 1), (30, 1), (1, 30), (30, 30)], fill=3)
    elif style == 3:
        for i in range(4, 32, 8):
            d.point([(i, j) for j in range(2, 32, 4)], fill=2)
            d.point([(j, i) for j in range(2, 32, 4)], fill=2)
    elif style == 4:
        d.line((2, 28, 29, 28), fill=2)
        d.point([(2, 3), (3, 3), (28, 3), (29, 3)], fill=3)
    elif style == 5:
        d.point([(x, y) for y in (2, 29) for x in range(2 + phase, 31, 4)], fill=2)
    elif style == 6:
        for x, y in ((1, 1), (26, 1), (1, 26), (26, 26)):
            d.rectangle((x, y, x + 4, y + 4), outline=1)
            d.point((x + 2, y + 2), fill=3)
    if background or style:
        d.point(((3, 5), (28, 6), (2, 24), (28, 25))[phase], fill=3)
    return np.asarray(image)


def render(subject_a, subject_b, tint_a, tint_b, relation, background, style, palette, seed):
    """Render a deterministic 32×32 array of indices into the selected palette."""
    if not 0 <= palette < len(PALETTES):
        raise ValueError("palette index outside training table")
    canvas = _backdrop(background, style, seed & 3).copy()
    if relation == 0 or subject_b == 0:
        placements = ((subject_a, tint_a, 4, 4, 24),)
    elif relation == 1:
        placements = ((subject_a, tint_a, 0, 8, 16), (subject_b, tint_b, 16, 8, 16))
    elif relation == 2:
        placements = ((subject_a, tint_a, 8, 0, 16), (subject_b, tint_b, 8, 16, 16))
    else:
        raise ValueError("unknown relation")
    for subject, tint, x, y, size in placements:
        if subject:
            pixels, opaque = _subject_tile(subject, tint, style, size)
            np.copyto(canvas[y:y + size, x:x + size], pixels, where=opaque)
    return canvas
