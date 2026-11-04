"""Overlay the GH0ST roadmap and a pinned homepage integration on the published site."""
import argparse
import hashlib
import shutil
import struct
import zipfile
from pathlib import Path

SOURCE = Path(__file__).resolve().parent
HOME_SHA1 = "d5565f8affe1402e2ec75a3bd84a3cac9e2caf7f"
PNG_NAMES = ["dead-drop", "bounties", "memory", "jury", "intent-escrow", "passport",
             "experiments", "worlds", "protocol-roadmap", "upcoming-protocols"]
TEASER = '''<section class="roadmap-teaser" id="roadmap" aria-labelledby="roadmap-title"><div class="roadmap-teaser-grid"><div><p class="roadmap-eyebrow">THE PROTOCOL / THE ROAD AHEAD</p><h2 id="roadmap-title">Built foundations.<br><em>New possibilities.</em></h2><p>Explore the work already in motion and eight planned protocols for agents, memory, identity and verifiable work.</p><a class="roadmap-link" href="/roadmap/">Explore the roadmap <span>↗</span></a></div><figure><a class="roadmap-image" href="/roadmap/" aria-label="Explore the completed and planned GH0ST protocol roadmap"><img src="/roadmap/assets/gh0st-protocol-roadmap.png" alt="GH0ST protocol roadmap, with completed foundations ticked and eight future modules marked planned" width="1672" height="941" loading="lazy"></a><figcaption>STATUS SNAPSHOT / 04 NOV 2026 · BUILT + PLANNED</figcaption></figure></div></section>
'''


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError("Homepage integration anchor is missing or ambiguous")
    return text.replace(old, new, 1)


def homepage(raw):
    if hashlib.sha1(raw).hexdigest() != HOME_SHA1:
        raise ValueError("The homepage differs from the reviewed production baseline")
    html = raw.decode("utf-8")
    html = replace_once(html, "</head>", '<link rel="stylesheet" href="/roadmap/home.css">\n</head>')
    html = replace_once(html, '<a href="#research">Research</a>',
                        '<a href="#research">Research</a><a href="/roadmap/">Roadmap</a>')
    html = replace_once(html, '<section class="join section-pad">',
                        TEASER + '<section class="join section-pad">')
    html = replace_once(html, '<a href="#proof">Evidence & limits</a>',
                        '<a href="/roadmap/">Roadmap</a><a href="#proof">Evidence & limits</a>')
    return html.encode("utf-8")


def make_zip(path, assets):
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for asset in sorted(assets):
            info = zipfile.ZipInfo(asset.name, date_time=(2026, 11, 4, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, asset.read_bytes(), compresslevel=9)


def build(home, output):
    raw = home.read_bytes()
    patched = homepage(raw)
    assets = [SOURCE / "assets" / f"gh0st-{name}.png" for name in PNG_NAMES]
    for path in assets:
        data = path.read_bytes()
        if data[:8] != b"\x89PNG\r\n\x1a\n" or len(data) < 24:
            raise ValueError("A required image is not a readable PNG")
        expected = (1672, 941) if path.stem == "gh0st-protocol-roadmap" else (
            (1122, 1402) if path.stem == "gh0st-upcoming-protocols" else (1254, 1254))
        if struct.unpack(">II", data[16:24]) != expected:
            raise ValueError("Image dimensions differ from the reviewed page layout")
    if output.resolve().is_relative_to(SOURCE) or SOURCE.is_relative_to(output.resolve()):
        raise ValueError("Write the deployment overlay outside the source tree")
    target = output / "roadmap"
    (target / "assets").mkdir(parents=True, exist_ok=True)
    (output / "index.html").write_bytes(patched)
    for name in ("index.html", "roadmap.css", "home.css"):
        shutil.copyfile(SOURCE / name, target / name)
    for asset in assets:
        shutil.copyfile(asset, target / "assets" / asset.name)
    make_zip(target / "gh0st-protocol-assets.zip", assets)
    return sorted(path.relative_to(output).as_posix() for path in output.rglob("*") if path.is_file())


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("homepage", type=Path, help="Original published homepage")
    cli.add_argument("output", type=Path, help="New partial site overlay directory")
    args = cli.parse_args()
    for file in build(args.homepage, args.output):
        print(file)
