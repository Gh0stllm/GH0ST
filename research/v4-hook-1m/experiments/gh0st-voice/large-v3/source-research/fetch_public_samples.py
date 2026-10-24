"""Read public dataset metadata and bounded samples; never execute dataset code.

This is research only. Raw text is not appended to any training corpus.
Only HTTPS GETs to the explicitly named public Hugging Face repositories occur.
"""
from pathlib import Path
import datetime
import hashlib
import json
import re
import urllib.request

OUT = Path(__file__).resolve().parent
RAW = OUT / "raw"
RAW.mkdir(parents=True, exist_ok=True)
MAX_PREFIX = 8 * 1024 * 1024


def get(url, limit):
    assert url.startswith("https://huggingface.co/")
    req = urllib.request.Request(url, headers={"User-Agent": "GH0ST-local-dataset-license-review/1.0"})
    with urllib.request.urlopen(req, timeout=90) as response:
        body = response.read(limit + 1)
        return body[:limit], len(body) > limit, {key: response.headers.get(key) for key in ["Content-Length", "ETag", "Last-Modified"]}


def main():
    manifest = {"scope": "Public dataset research samples only; not ingested into training", "fetched_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(), "sources": []}
    for repo, file, label, prefix in [
        ("NousResearch/Hermes-3-Dataset", "hermes-3-dataset.jsonl", "hermes3", True),
        ("Verdugie/opus-candid-training-data", "v3_train_1558conv.json", "opus-candid-v3", False),
    ]:
        api_url = f"https://huggingface.co/api/datasets/{repo}"
        metadata_bytes, truncated, _ = get(api_url, 2 * 1024 * 1024)
        assert not truncated
        metadata = json.loads(metadata_bytes)
        revision = metadata["sha"]
        assert metadata.get("cardData", {}).get("license") == "apache-2.0", f"Unexpected declared license for {repo}"
        assert any(row["rfilename"] == file for row in metadata["siblings"])
        (RAW / f"{label}-metadata.json").write_bytes(metadata_bytes)
        readme_url = f"https://huggingface.co/datasets/{repo}/resolve/{revision}/README.md"
        readme, cut, _ = get(readme_url, 128 * 1024)
        assert not cut
        (RAW / f"{label}-README.md").write_bytes(readme)
        source_url = f"https://huggingface.co/datasets/{repo}/resolve/{revision}/{file}"
        body, cut, headers = get(source_url, MAX_PREFIX if prefix else 12 * 1024 * 1024)
        if prefix:
            # Keep complete original JSONL rows only; no modified/truncated row.
            body = body[:body.rfind(b"\n") + 1]
        else:
            assert not cut, "Small Opus sample exceeded research download bound"
        raw_path = RAW / f"{label}-{'prefix.jsonl' if prefix else 'complete.json'}"
        raw_path.write_bytes(body)
        records = [json.loads(line) for line in body.splitlines() if line.strip()] if prefix else json.loads(body)
        paragraphs = []
        for index, record in enumerate(records):
            for turn, message in enumerate(record.get("conversations", record.get("messages", []))):
                role = message.get("from", message.get("role"))
                content = message.get("value", message.get("content", ""))
                if role not in {"assistant", "gpt"} or not isinstance(content, str):
                    continue
                for paragraph in content.split("\n\n"):
                    paragraph = paragraph.strip()
                    if len(paragraph.split()) < 20:
                        continue
                    paragraphs.append({"record_index": index, "turn_index": turn, "text": paragraph})
        themes = re.compile(r"\b(consciousness|conscious|philosoph|meaning|identity|culture|meme|attention|machine|belief|freedom|humou?r|irony)\w*\b", re.I)
        themed = [p for p in paragraphs if themes.search(p["text"])]
        selected = themed[:10] if themed else paragraphs[:10]
        (OUT / f"{label}-ten-research-samples.json").write_text(json.dumps(selected, indent=2) + "\n")
        entry = {"repository": repo, "revision": revision, "declared_license": metadata["cardData"]["license"],
                 "metadata_url": api_url, "readme_url": readme_url, "source_url": source_url,
                 "raw_path": str(raw_path.relative_to(OUT)), "raw_bytes": len(body),
                 "raw_sha256": hashlib.sha256(body).hexdigest(), "prefix_only": prefix,
                 "download_truncated_at_bound": cut, "response_headers": headers,
                 "records_in_download": len(records), "assistant_paragraphs_20plus_words": len(paragraphs),
                 "theme_matched_paragraphs": len(themed), "sample_count": len(selected),
                 "sample_selection": "First ten theme-matched assistant paragraphs, otherwise first ten assistant paragraphs; no generative rewrite",
                 "readme_sha256": hashlib.sha256(readme).hexdigest()}
        manifest["sources"].append(entry)
        (OUT / "download-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        print(json.dumps(entry), flush=True)


if __name__ == "__main__":
    main()
