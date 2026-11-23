"""Native 64×64 moonwood pixel-art source targets.

The background and subject layers are separate, palette-indexed original art.
Zero is transparent for sprite composition. The renderer is for training data.
"""

from functools import lru_cache
from random import Random

import numpy as np
from PIL import Image, ImageDraw


SIZE = 64
SUBJECTS = ("fox", "crystal", "owl", "mushroom")
COLORS = (
    "000000", "0a1326", "111b34", "1b2843", "283754", "3c4e6b", "63718a",
    "8796ad", "adcdd2", "f3e3b5", "263b43", "344a51", "436666", "597b72",
    "83a496", "abc0a1", "131d29", "4b2838", "88433a", "c26640", "e58347",
    "ffb96e", "ffe1ab", "281a30", "402c67", "6554a2", "8e80c7", "b9aced",
    "537988", "70b4ac", "a1debe", "e2f8d1",
)
PALETTE = np.array([
    (*bytes.fromhex(rgb), 0 if i == 0 else 255) for i, rgb in enumerate(COLORS)
], dtype=np.uint8)


def _pine(d, x, y, h, color, light=None):
    half = (h + 3) // 4
    d.rectangle((x, y + h - 5, x + 1, y + h), fill=color)
    d.polygon((
        (x, y), (x + half - 2, y + h // 2), (x + 2, y + h // 2 - 1),
        (x + half, y + h - 3), (x + 1, y + h - 4), (x - half, y + h - 3),
        (x - 2, y + h // 2 - 1), (x - half + 3, y + h // 2),
    ), fill=color)
    if light is not None:
        d.line((x, y + 1, x - half + 1, y + h - 4), fill=light)
        d.line((x, y + h - 5, x + half - 2, y + h - 4), fill=light)


def _moon(d, x, y):
    d.ellipse((x - 7, y - 7, x + 7, y + 7), fill=3)
    d.ellipse((x - 5, y - 5, x + 5, y + 5), fill=8)
    d.ellipse((x - 4, y - 5, x + 4, y + 4), fill=9)
    d.ellipse((x + 1, y - 6, x + 7, y + 1), fill=3)
    d.ellipse((x + 3, y - 6, x + 7, y - 1), fill=2)
    d.point((x - 2, y + 1), fill=8)
    d.point((x, y + 4), fill=8)


@lru_cache(maxsize=96)
def background(seed=0, moon_side=1):
    """Render a native 64×64 moonlit scene with no subject."""
    rng = Random(int(seed))
    image = Image.new("L", (SIZE, SIZE), 1)
    d = ImageDraw.Draw(image)
    d.rectangle((0, 9, 63, 45), fill=2)
    d.rectangle((0, 19, 63, 45), fill=3)
    d.rectangle((0, 27, 63, 45), fill=4)
    d.line((0, 18, 16, 18), fill=3)
    d.line((20, 19, 39, 19), fill=2)
    d.line((42, 26, 63, 26), fill=4)
    for _ in range(24):
        x, y = rng.randrange(SIZE), rng.randrange(3, 23)
        d.point((x, y), fill=rng.choice((4, 5, 6, 7, 8)))
    x_moon = 49 if moon_side else 14
    _moon(d, x_moon, 12)
    bright_x = 16 if moon_side else 46
    d.line((bright_x - 2, 8, bright_x + 2, 8), fill=5)
    d.line((bright_x, 6, bright_x, 10), fill=5)
    d.point((bright_x, 8), fill=8)
    d.polygon((
        (0, 32), (7, 27), (13, 31), (23, 21), (29, 30), (35, 27),
        (42, 33), (51, 25), (63, 31), (63, 45), (0, 45),
    ), fill=3)
    d.polygon(((15, 29), (23, 21), (30, 31), (24, 27), (22, 28), (20, 26)), fill=6)
    d.polygon(((46, 29), (51, 25), (57, 28), (53, 28), (51, 27), (49, 29)), fill=6)
    d.polygon(((23, 28), (30, 33), (30, 41), (17, 39), (22, 33)), fill=4)
    for y in (31, 34, 40):
        x = rng.randrange(13, 32)
        d.line((x, y, min(x + rng.randrange(4, 12), 61), y), fill=5)

    # Distant pines, the creek and a nearer rocky shelf give the scene depth.
    for x in range(-1, 66, 5):
        h = rng.randrange(7, 14)
        y = rng.randrange(27, 34)
        _pine(d, x, y, h, rng.choice((4, 5)))
    d.polygon((
        (0, 45), (8, 39), (17, 40), (25, 45), (35, 46),
        (43, 42), (54, 38), (63, 39), (63, 63), (0, 63),
    ), fill=10)
    d.polygon((
        (15, 46), (24, 44), (35, 45), (46, 41), (53, 43),
        (45, 48), (37, 50), (30, 54), (22, 55), (10, 51),
    ), fill=4)
    for x, y, length in ((24, 44, 10), (41, 45, 7), (22, 48, 15), (14, 50, 8), (29, 51, 7)):
        d.line((x, y, x + length, y), fill=28 if y % 2 else 6)
        d.line((x + 2, y, x + 4, y), fill=8)
    for x, y, h in ((4, 24, 29), (13, 34, 16), (59, 24, 27), (53, 33, 19)):
        _pine(d, x, y, h, 10, 12)
    shelf = (
        (0, 54), (7, 54), (13, 52), (22, 52), (29, 54), (36, 53),
        (42, 52), (54, 52), (59, 49), (63, 51), (63, 63), (0, 63),
    )
    d.polygon(shelf, fill=16)
    d.line(shelf[:-2], fill=12)
    d.line((12, 54, 21, 54), fill=13)
    d.line((43, 54, 54, 54), fill=13)
    for x, y in ((4, 58), (16, 57), (36, 56), (52, 57), (57, 54), (61, 58)):
        d.polygon(((x - 1, y), (x, y - 3), (x + 1, y - 1), (x + 3, y - 2), (x + 2, y)), fill=12)
        d.point((x, y - 2), fill=14)
    for x, y in ((7, 59), (22, 60), (36, 59), (44, 57), (49, 60)):
        d.line((x, y, x + 4, y), fill=10)
        d.point((x + 1, y - 1), fill=11)
    return np.asarray(image)


def _fox(d):
    # Tail rises behind the body, with an ivory tip and a two-color underside.
    d.polygon(((13, 22), (17, 18), (21, 14), (28, 10), (33, 11), (34, 15),
               (30, 21), (25, 24), (19, 26), (12, 25)), fill=23)
    d.polygon(((17, 22), (22, 16), (29, 11), (33, 12), (33, 15), (29, 20),
               (25, 23), (19, 25), (14, 24)), fill=19)
    d.polygon(((25, 14), (29, 11), (33, 12), (33, 15), (29, 18), (29, 16), (26, 17)), fill=22)
    d.line((23, 16, 27, 13), fill=21)
    d.line((18, 24, 25, 22), fill=18)
    d.polygon(((4, 17), (8, 14), (17, 15), (22, 18), (22, 24), (20, 27),
               (19, 29), (14, 29), (13, 26), (10, 25), (9, 29), (5, 29), (4, 23)), fill=23)
    d.polygon(((6, 17), (11, 15), (18, 17), (21, 19), (21, 23),
               (18, 26), (14, 25), (7, 25), (5, 22)), fill=20)
    d.polygon(((8, 22), (15, 22), (18, 20), (21, 20), (21, 24),
               (18, 26), (17, 28), (15, 28), (14, 25), (8, 25), (8, 28), (6, 28)), fill=18)
    d.line((12, 16, 17, 17), fill=21)
    d.polygon(((4, 13), (4, 5), (7, 2), (10, 8), (13, 8), (17, 4), (17, 12),
               (15, 15), (12, 19), (9, 22), (5, 21), (1, 19), (0, 16)), fill=23)
    d.polygon(((5, 13), (5, 6), (7, 4), (9, 10), (13, 9), (16, 6), (16, 12),
               (12, 18), (9, 21), (5, 20), (1, 18), (2, 16)), fill=20)
    d.polygon(((6, 11), (6, 7), (7, 5), (8, 10)), fill=17)
    d.polygon(((13, 10), (16, 7), (16, 12)), fill=18)
    d.polygon(((2, 16), (5, 15), (8, 17), (12, 16), (10, 20), (8, 22), (5, 20), (1, 18)), fill=22)
    d.line((5, 13, 8, 12), fill=21)
    d.line((5, 14, 8, 14), fill=23)
    d.point((6, 14), fill=9)
    d.point(((1, 16), (1, 17), (2, 17)), fill=23)


def _crystal(d):
    d.polygon(((2, 24), (7, 21), (5, 15), (10, 10), (13, 12), (13, 7), (18, 2),
               (24, 6), (25, 14), (28, 10), (33, 15), (32, 25),
               (27, 29), (9, 29)), fill=23)
    d.polygon(((7, 22), (6, 15), (10, 11), (13, 14), (14, 24), (10, 26)), fill=25)
    d.polygon(((8, 16), (10, 11), (11, 16), (9, 24)), fill=26)
    d.line((7, 15, 10, 12), fill=27)
    d.polygon(((19, 27), (15, 21), (14, 7), (18, 3), (23, 6), (25, 23)), fill=25)
    d.polygon(((14, 7), (18, 3), (19, 11), (17, 22), (15, 18)), fill=26)
    d.polygon(((18, 3), (23, 6), (19, 11)), fill=27)
    d.polygon(((19, 11), (23, 6), (25, 23), (22, 25)), fill=24)
    d.line((19, 11, 17, 22), fill=27)
    d.line((14, 8, 15, 16), fill=30)
    d.polygon(((25, 26), (25, 16), (28, 11), (32, 15), (31, 24)), fill=28)
    d.polygon(((26, 17), (28, 11), (30, 15), (29, 23)), fill=29)
    d.line((28, 12, 26, 17), fill=30)
    d.polygon(((3, 25), (11, 24), (16, 26), (24, 25), (32, 25), (27, 29),
               (10, 29)), fill=4)
    d.line((5, 25, 10, 25), fill=7)
    d.line((13, 28, 21, 28), fill=6)
    d.point(((16, 13), (16, 14), (17, 15), (29, 16), (26, 24)), fill=31)
    d.line((5, 9, 9, 9), fill=27)
    d.line((7, 7, 7, 11), fill=27)
    d.point((7, 9), fill=31)
    d.point(((24, 2), (28, 6), (3, 19), (31, 8)), fill=30)


def _owl(d):
    d.polygon(((8, 6), (7, 3), (12, 5), (18, 3), (22, 5), (27, 3), (26, 9),
               (28, 14), (26, 20), (26, 25), (21, 28), (12, 28),
               (8, 25), (7, 19), (5, 15)), fill=23)
    d.polygon(((9, 8), (9, 5), (13, 7), (18, 5), (22, 7), (26, 5),
               (25, 10), (27, 15), (25, 20), (24, 25), (21, 27), (13, 27),
               (9, 24), (8, 17), (6, 14)), fill=18)
    d.ellipse((11, 16, 23, 27), fill=19)
    d.ellipse((13, 18, 22, 25), fill=21)
    d.polygon(((7, 14), (11, 15), (15, 18), (14, 26), (12, 27), (9, 23)), fill=17)
    d.line((9, 17, 13, 22), fill=19)
    d.line((10, 21, 12, 25), fill=18)
    d.polygon(((23, 16), (26, 13), (26, 19), (24, 24), (23, 26), (21, 26)), fill=17)
    d.line((24, 17, 23, 22), fill=19)
    d.ellipse((8, 9, 18, 18), fill=21)
    d.ellipse((17, 9, 26, 18), fill=21)
    d.arc((8, 9, 18, 18), 189, 342, fill=22)
    d.arc((17, 9, 26, 18), 190, 352, fill=22)
    for x in (12, 21):
        d.ellipse((x - 2, 11, x + 2, 16), fill=23)
        d.point((x - 1, 12), fill=31)
    d.polygon(((16, 15), (19, 15), (18, 18)), fill=17)
    d.point((17, 15), fill=22)
    d.line((12, 7, 16, 6), fill=20)
    d.line((21, 7, 24, 6), fill=20)
    for x, y in ((15, 20), (19, 21), (16, 23), (20, 24)):
        d.point(((x, y), (x + 1, y + 1)), fill=19)
    d.line((4, 29, 29, 29), fill=10, width=2)
    d.line((5, 28, 11, 28), fill=13)
    d.line((24, 28, 29, 28), fill=13)
    d.point(((14, 27), (15, 28), (19, 27), (20, 28)), fill=22)


def _mushroom(d):
    d.polygon(((5, 19), (12, 19), (12, 24), (18, 23), (20, 16), (27, 16),
               (27, 22), (29, 27), (28, 29), (9, 29), (4, 26)), fill=23)
    d.polygon(((20, 14), (26, 14), (25, 21), (28, 26), (26, 28), (17, 28),
               (18, 23)), fill=21)
    d.line((22, 17, 21, 25), fill=22)
    d.line((25, 22, 25, 26), fill=18)
    d.polygon(((7, 17), (11, 17), (11, 21), (13, 25), (10, 27), (6, 26)), fill=22)
    d.line((8, 20, 8, 24), fill=21)
    d.polygon(((12, 13), (13, 8), (16, 4), (22, 2), (27, 3), (31, 6),
               (33, 12), (31, 16), (28, 18), (18, 17), (13, 16)), fill=23)
    d.polygon(((13, 12), (14, 8), (17, 5), (22, 3), (27, 4), (30, 6),
               (32, 12), (30, 15), (27, 17), (19, 16), (14, 15)), fill=19)
    d.polygon(((14, 10), (18, 6), (23, 4), (27, 5), (30, 8), (30, 11), (24, 12),
               (20, 11), (17, 12), (14, 11)), fill=20)
    d.line((14, 14, 19, 15), fill=18)
    d.line((20, 15, 28, 16), fill=21)
    d.line((27, 15, 31, 13), fill=21)
    d.point(((16, 8), (18, 7), (21, 5), (22, 5), (23, 5), (26, 6),
             (28, 7), (30, 10), (25, 10), (24, 10), (19, 10), (20, 11)), fill=22)
    d.polygon(((1, 17), (3, 13), (7, 11), (11, 12), (15, 15), (15, 18),
               (12, 20), (5, 20), (2, 19)), fill=23)
    d.polygon(((2, 17), (4, 14), (7, 12), (11, 13), (14, 15), (14, 18),
               (11, 19), (5, 19), (3, 18)), fill=20)
    d.line((4, 18, 12, 18), fill=21)
    d.point(((5, 15), (7, 14), (8, 14), (10, 15), (12, 16)), fill=22)
    d.point(((16, 3), (9, 8), (11, 6), (32, 5), (34, 13), (5, 9)), fill=9)


@lru_cache(maxsize=4)
def sprite(subject):
    """Return an original 35×30 transparent atlas cell."""
    image = Image.new("L", (35, 30))
    draw = ImageDraw.Draw(image)
    drawings = {"fox": _fox, "crystal": _crystal, "owl": _owl, "mushroom": _mushroom}
    drawings[subject](draw)
    return np.asarray(image)


def render(subject, seed=0, x=15, y=24):
    """Combine native layers into one palette-indexed 64×64 training target."""
    layer = sprite(subject)
    height, width = layer.shape
    if not (0 <= x <= SIZE - width and 0 <= y <= SIZE - height):
        raise ValueError("subject would be outside the 64×64 frame")
    scene = background(seed, int(x < 20)).copy()
    region = scene[y:y + height, x:x + width]
    np.copyto(region, layer, where=layer != 0)
    return scene


# V3's layered renderer applies these palettes after generating the
# corresponding shade grids. Foreground zero remains a transparent index.
def _rgba(rows):
    return np.asarray([[(*bytes.fromhex(rgb), 255) for rgb in row.split()] for row in rows], dtype=np.uint8)


BACKDROP_RGBA = _rgba((
    "0a1326 1b2843 283754 344a51 436666 63718a adcdd2 f3e3b5",
    "1c1028 2f1a3b 482846 63435b 956278 b08da9 e3b9bd ffdace",
    "19172d 302443 4b3049 6c4658 99616b c38880 e8bca4 fff0c2",
    "071b25 142e43 234251 2c5b60 3f8079 62a29f 9bd7c2 d7fbcb",
    "23151b 3e2625 56372b 74513c a57955 c89b6e e8cfa2 fff1d1",
    "191326 2e1e41 48335e 615176 867095 b18fb5 d8b9df f5d9f7",
    "0d1e36 1a3350 294e66 456676 5d8c9b 83a9b8 b3d4dc e6f2ec",
    "1b1422 322027 4c2931 643936 8d5650 ab7768 cba492 f2d3b3",
    "0a191e 132923 223a30 315640 4c7255 729878 a2bca2 e0e6c2",
    "051928 0e2941 23405b 325777 42738f 5d98ab 8ebfc6 c2e4e4",
    "150d29 291945 3e2a6d 594f8a 7767a9 9884c1 c0a9e6 e8d9f5",
    "201d24 382f32 51443c 645b4b 877764 ad9779 cfbea0 f2dfb8",
    "091628 18284a 233c68 425287 5f6ea3 8091c7 b2bbdf e6e6f0",
    "090d17 17202f 222d3d 31394b 4b566a 667281 8d9da5 bac5cc",
    "080912 121925 28374a 365463 538085 78a8a4 acdad1 f6e7b3",
    "13151d 282b38 424755 5e6270 7e838e 9aa2a9 c1c8cc f0ede6",
))
TINT_RGBA = _rgba((
    "281a30 4b2838 88433a c26640 e58347 ffb96e ffe1ab",
    "171c3b 222f59 34568a 4d77ab 679ad3 9ac8eb d8eff6",
    "291528 51303d 843844 be5351 e7776d f5a384 ffe2c0",
    "152a2a 263e39 3b6550 518d67 73b188 a4d7a8 dcf1c6",
    "241b3d 3e2b58 584080 7660a6 9780ca b7a4e3 edd8f6",
    "2c172c 4e2a48 73405d a35c7d ce81a5 e6a9c6 f7dae8",
    "25222d 453d47 6e6267 9d8d88 bdb1a4 ded4bb f8f0d5",
    "15262c 234447 366567 4b8d88 6db6a7 a0debf e2f8d1",
))

_SUBJECT_SHADE = np.array((
    0, 1, 1, 2, 3, 4, 5, 6, 7, 7, 2, 3, 4, 5, 6, 7,
    1, 2, 3, 4, 5, 6, 7, 1, 2, 4, 5, 6, 3, 5, 6, 7,
), dtype=np.uint8)
_BACKDROP_SHADE = np.array((
    0, 0, 1, 2, 2, 3, 5, 6, 6, 7, 1, 2, 3, 4, 5, 6,
    0, 0, 1, 3, 4, 5, 6, 0, 1, 3, 4, 5, 4, 5, 6, 7,
), dtype=np.uint8)


def _style_subject(shade, style, variant):
    y, x = np.indices(shade.shape)
    occupied = shade > 0
    padded = np.pad(occupied, 1)
    left, above = padded[1:-1, :-2], padded[:-2, 1:-1]
    right, below = padded[1:-1, 2:], padded[2:, 1:-1]
    rim = occupied & ~(left & above & right & below)
    lit_edge = occupied & ~(left & above)
    surface = shade >= 3
    fine = (x * 3 + y * 5 + variant) % 7

    if style == 1:
        shade[lit_edge & (shade >= 2)] = np.maximum(shade[lit_edge & (shade >= 2)], 5)
        shade[surface & (fine == 0)] += shade[surface & (fine == 0)] < 7
    elif style == 2:
        seams = surface & ((x + 2 * y + variant) % 9 == 0)
        shade[seams] = np.maximum(2, shade[seams] - 2)
        shade[surface & ((x // 5 + y // 5) % 2 == 1) & (shade < 7)] += 1
    elif style == 3:
        hatch = surface & ((x + y) % 3 == 0)
        shade[hatch] = np.maximum(2, shade[hatch] - 1)
        shade[lit_edge & (shade >= 3)] = np.maximum(shade[lit_edge & (shade >= 3)], 6)
    elif style == 4:
        shadow = surface & (fine <= 1)
        shade[shadow] -= 1
        shade[rim & ~lit_edge & (shade >= 2)] -= 1
    elif style == 5:
        tesserae = surface & (shade < 5) & (((x // 2) + (y // 2) + variant) % 4 == 0)
        shade[tesserae] += shade[tesserae] < 7
    elif style == 6:
        screen = surface & (shade < 5) & ((x + y + variant) % 4 == 1)
        shade[screen] = np.maximum(2, shade[screen] - 1)
        shade[lit_edge & (shade >= 3)] = np.minimum(7, shade[lit_edge & (shade >= 3)] + 1)
    if variant == 2:
        glints = (shade >= 5) & ((x + 4 * y) % 13 == 0)
        shade[glints] = 7
    return shade


@lru_cache(maxsize=24 * 7 * 3)
def subject_layer(subject, style, variant):
    """Return a 32×32 layer with zero transparency and seven opaque shades."""
    subject, style, variant = int(subject), int(style), int(variant)
    if not (0 <= subject <= 24 and 0 <= style < 7 and 0 <= variant < 3):
        raise ValueError("subject, style, or variant outside the source art tables")
    names = {7: "fox", 13: "crystal", 6: "owl", 14: "mushroom"}
    layer = np.zeros((32, 32), dtype=np.uint8)
    if subject in names:
        native = sprite(names[subject])
        fitted = Image.fromarray(native).resize((32, 30), Image.Resampling.NEAREST)
        layer[1:31] = _SUBJECT_SHADE[np.asarray(fitted)]
    elif subject:
        # Preserve the original coarse silhouette, then add a textured ramp.
        from art import _sprite
        base = np.asarray(Image.fromarray(_sprite(subject)).resize((29, 29), Image.Resampling.NEAREST))
        layer[1:30, 1:30] = np.array((0, 3, 4, 6, 1), dtype=np.uint8)[base]
        y, x = np.indices(layer.shape)
        material = layer == 4
        layer[material & (x + y <= 20)] = 5
        layer[material & (x + y >= 35)] = 3
        layer[material & ((x + 2 * y) % 11 == 0)] = 5
        up = np.pad(layer > 0, ((1, 0), (0, 0)))[:-1]
        layer[(layer == 4) & ~up] = 6
    if variant == 1:
        layer = layer[:, ::-1].copy()
    _style_subject(layer, style, variant)
    layer.setflags(write=False)
    return layer


def _biome(bg, variant):
    rng = Random(3417 + bg * 127 + variant)
    image = Image.new("L", (64, 64), 0)
    d = ImageDraw.Draw(image)
    for y in (10, 21, 32):
        d.rectangle((0, y, 63, 63), fill=y // 10)

    if bg == 0:
        d.rectangle((0, 0, 63, 63), fill=0)
        focus = 26 + 12 * variant
        for scale, color in ((29, 1), (23, 2), (15, 3)):
            d.ellipse((focus - scale, 26 - scale, focus + scale, 26 + scale), fill=color)
        d.ellipse((9, 49, 55, 62), fill=2)
        d.ellipse((16, 51, 48, 58), fill=3)
    elif bg == 1:
        d.rectangle((0, 20, 63, 63), fill=2)
        d.rectangle((0, 43, 63, 63), fill=3)
        moon_x = 46 - 28 * variant
        d.ellipse((moon_x - 9, 4, moon_x + 9, 22), fill=3)
        d.ellipse((moon_x - 6, 7, moon_x + 6, 19), fill=6)
        d.ellipse((moon_x - 4, 9, moon_x + 5, 18), fill=7)
        d.line((moon_x - 3, 15, moon_x + 2, 15), fill=6)
        for x, y in ((0, 33), (5, 19), (18, 42), (32, 29), (46, 45)):
            cloud = ((x, y), (x + 4, y - 1), (x + 8, y - 4), (x + 13, y - 2),
                     (x + 16, y - 2), (x + 21, y + 1), (x + 7, y + 3))
            d.polygon(cloud, fill=4)
            d.line((x + 3, y + 1, x + 15, y + 1), fill=3)
        for _ in range(36):
            x, y = rng.randrange(64), rng.randrange(3, 43)
            if abs(x - moon_x) > 10 or y > 21:
                d.point((x, y), fill=rng.choice((4, 5, 6)))
        d.polygon(((0, 56), (11, 53), (24, 58), (31, 54), (42, 57), (56, 52),
                   (63, 54), (63, 63), (0, 63)), fill=1)
    elif bg == 3:
        d.rectangle((0, 33, 63, 63), fill=2)
        d.ellipse((45 - 29 * variant, 9, 54 - 29 * variant, 18), fill=7)
        for y in range(35, 64, 3):
            d.rectangle((0, y, 63, y + 1), fill=1 + (y // 3) % 3)
            for x in range(-4, 64, 8):
                start = x + rng.randrange(4)
                d.line((start, y, start + rng.randrange(2, 7), y), fill=rng.choice((2, 3, 4)))
        d.polygon(((0, 50), (12, 47), (25, 52), (31, 57), (43, 53), (58, 51),
                   (63, 48), (63, 63), (0, 63)), fill=1)
        d.line(((0, 49), (12, 46), (25, 51), (31, 56), (43, 52), (58, 50), (63, 47)), fill=5)
    elif bg == 4:
        d.polygon(((0, 31), (12, 23), (22, 28), (31, 18), (42, 25), (52, 20), (63, 26),
                   (63, 63), (0, 63)), fill=2)
        for x, top, width in ((-2, 21, 10), (12, 29, 8), (44, 27, 8), (54, 15, 13)):
            top += variant * 3
            d.rectangle((x, top, x + width, 52), fill=1)
            d.rectangle((x, top, x + 2, 52), fill=4)
            d.rectangle((x + 3, top - 2, x + width, top), fill=3)
            for y in range(top + 3, 52, 5):
                d.line((x + 2, y, x + width, y), fill=2)
        d.pieslice((10, 16, 54, 49), 180, 360, fill=4)
        d.pieslice((18, 23, 46, 41), 180, 360, fill=2)
        d.rectangle((18, 32, 46, 49), fill=2)
        d.rectangle((0, 52, 63, 63), fill=1)
        for start, stop, y in ((5, 17, 55), (32, 45, 54), (20, 40, 58), (50, 62, 59)):
            d.line((start, y, stop, y), fill=3)
    elif bg == 5:
        d.ellipse((38 - 17 * variant, 8, 49 - 17 * variant, 19), fill=7)
        for y, shade in ((27, 4), (35, 3), (43, 2), (53, 1)):
            ridge = tuple((x, y + rng.randrange(-5, 4)) for x in range(0, 64, 7))
            area = (*ridge, (63, ridge[-1][1]), (63, 63), (0, 63))
            d.polygon(area, fill=shade)
            d.line(ridge, fill=shade + 1)
        for _ in range(32):
            x, y = rng.randrange(64), rng.randrange(50, 64)
            d.line((x, y, x + rng.randrange(1, 5), y), fill=rng.choice((2, 3)))
    elif bg == 6:
        d.rectangle((0, 0, 63, 63), fill=2)
        for x, peak, width, shade in ((0, 29, 10, 3), (8, 20, 8, 4), (24, 22, 8, 4),
                                      (39, 15, 6, 4), (50, 28, 10, 5), (58, 34, 12, 4)):
            peak += 2 * variant
            d.polygon(((x, 0), (x + width, 0), (x + width // 2, peak)), fill=shade)
            d.line((x + width // 2, peak, x + width, 0), fill=shade + 1)
        for x, peak, width in ((0, 37, 10), (6, 45, 14), (48, 42, 9), (56, 36, 9)):
            d.polygon(((x, 63), (x + width, 63), (x + width // 2, peak)), fill=4)
            d.line((x + width // 2, peak, x + width, 63), fill=5)
        d.line(((0, 56), (17, 52), (27, 55), (41, 52), (63, 54)), fill=5)
        d.line(((0, 60), (16, 57), (42, 57), (63, 60)), fill=3)
    elif bg == 7:
        d.rectangle((0, 0, 63, 63), fill=0)
        for x in range(4, 64, 7):
            y = rng.randrange(13, 37)
            d.line(((x, 0), (x, y), (x + 4, y + 3), (x + 4, y + 9)), fill=2 + x % 2)
            d.point((x + 4, y + 9), fill=6)
        for x in range(-25, 98, 10):
            d.line((32 + (x - 32) // 5, 38, x, 63), fill=2)
        for y in (38, 41, 45, 50, 56, 62):
            d.line((0, y, 63, y), fill=3 if y % 2 else 2)
        d.rectangle((7 + 32 * variant, 5, 25 + 32 * variant, 8), fill=3)
        d.rectangle((7 + 32 * variant, 11, 20 + 32 * variant, 13), fill=2)
    return np.asarray(image).copy()


@lru_cache(maxsize=8 * 7 * 2)
def background_layer(bg, style, variant):
    """Return an opaque 64×64 background indexed into eight palette tones."""
    bg, style, variant = int(bg), int(style), int(variant)
    if not (0 <= bg < 8 and 0 <= style < 7 and 0 <= variant < 2):
        raise ValueError("background, style, or variant outside the source art tables")
    if bg == 2:
        layer = _BACKDROP_SHADE[background(23 + bg * 13 + variant, variant)]
    else:
        layer = _biome(bg, variant)
    y, x = np.indices(layer.shape)
    if style == 1:
        area = (layer >= 3) & (layer <= 5)
        layer[area] += 1
    elif style == 2:
        leading = (layer >= 2) & ((x + 2 * y) % 17 == 0)
        layer[leading] -= 1
    elif style == 3:
        grid = (x % 8 == 0) & (y % 4 == 0) & (layer <= 3)
        layer[grid] += 1
    elif style == 4:
        layer[(layer >= 2) & (layer <= 4)] -= 1
    elif style == 5:
        tiles = (layer >= 3) & (layer <= 5) & (((x // 2) + (y // 2)) % 4 == 0)
        layer[tiles] += 1
    elif style == 6:
        scanlines = (layer >= 3) & (layer <= 5) & (y % 5 == 0)
        layer[scanlines] -= 1
    layer.setflags(write=False)
    return layer
