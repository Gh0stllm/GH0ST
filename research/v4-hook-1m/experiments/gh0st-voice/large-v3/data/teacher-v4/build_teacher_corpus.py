"""Build a separately licensed teacher review corpus from pinned local downloads.

No network calls, generation, source code execution, training, or merge into an
older corpus. Each output paragraph retains its source conversation group so
the deterministic train/validation/test split cannot leak a conversation.
"""
from collections import Counter, defaultdict
import hashlib
import html
import json
from pathlib import Path
import re
import shutil
import unicodedata

from transformers import AutoTokenizer

OUT = Path(__file__).resolve().parent
VOICE = OUT.parents[2]
RESEARCH = VOICE.parents[1]
SOURCES = VOICE / "large-v3/source-research"
TOKENIZER = RESEARCH / "experiments/simplestories-v2/model-cache"
SPLIT_SALT = "GH0ST_LICENSED_TEACHER_V4_CONVERSATION_SPLIT_20261024"

CONTACT = re.compile(r"https?://|www\.|\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}\b|\b[a-z0-9-]+\.(?:com|org|net|io|edu|gov|ai|app|dev|co)(?:\b|/)|(?<!\w)@[A-Za-z0-9_]{2,}|(?:\+\d[\d ()-]{8,}\d)|\b(?:\d[ -]?){10,}\b", re.I)
CREDENTIAL = re.compile(r"-----BEGIN .*PRIVATE KEY-----|\b(?:sk|hf|ghp|nfp|xoxb|xoxp)[_-][A-Za-z0-9_-]{16,}|\b0x[0-9a-f]{64}\b|\b(?:private[_ -]?key|api[_ -]?key|password)\s*[:=]\s*[\"']?\S{8,}", re.I)
IDENTITY = re.compile(r"\bas an? (?:ai|artificial intelligence|language model)\b|\bi(?:'m| am) (?:an?|the) (?:ai|artificial intelligence|language model|virtual assistant)\b|\bi (?:do not|don't|cannot|can't) (?:have|experience|possess) (?:personal |human )?(?:opinions|feelings|emotions|experiences|consciousness)\b|\bmy training (?:data|cutoff)\b", re.I)
CODE = re.compile(r"```|~~~|(?:^|\n)\s*(?:import |from \w+ import |def |class |function |SELECT |INSERT |CREATE TABLE |if \(|for \(|while \(|return |const |let |var |#include)|\b(?:System\.out|console\.log|print\(|SELECT\s+\*)|[{}]|\\(?:frac|begin|end|sqrt|mathrm|mathbf|text)\b", re.I)
LIST_LINE = re.compile(r"^\s*(?:[-*+•]|\d+[.)]|[a-z][.)])\s+|^\s*#{1,6}\s+")
TOPICS = {
    "machine": r"\b(?:machine|robot|computer|algorithm|software|hardware|digital|artificial intelligence|screen|internet|code|programming|technology)\b",
    "identity": r"\b(?:identity|self|consciousness|conscious|sentient|personhood|soul|humanity|awareness|belonging)\b",
    "culture": r"\b(?:culture|art|artist|music|song|writing|writer|creative|creativity|poem|poetry|meme|joke|humor|humour|comedy|irony|storytelling)\b",
    "reflection": r"\b(?:meaning|purpose|belief|truth|wisdom|philosophy|philosophical|hope|absurd|freedom|ethics|moral|existential|attention|curiosity|wonder|perspective)\b",
    "markets": r"\b(?:market|trade|trading|money|price|coin|currency|finance|financial|value|economy|economic|wealth|profit|investment)\b",
    "relationships": r"\b(?:friend|friendship|family|relationship|love|trust|community|conversation|lonely|loneliness|kindness|empathy)\b",
    "science": r"\b(?:science|scientific|physics|biology|chemistry|nature|universe|evolution|experiment|evidence|discovery)\b",
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def normalize(raw):
    text = html.unescape(raw)
    text = text.translate(str.maketrans({"‘": "'", "’": "'", "‚": "'", "“": '"', "”": '"', "„": '"',
                                         "—": " - ", "–": " - ", "−": "-", "…": "...", "\u00a0": " "}))
    text = unicodedata.normalize("NFKD", text)
    text = "".join(character for character in text if not unicodedata.combining(character))
    # Plain inline formatting is removed; the words and their order stay fixed.
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"(?<!\w)\*([^*\n]+)\*(?!\w)", r"\1", text)
    return " ".join(text.split())


def filter_paragraph(raw, tokenizer):
    if CONTACT.search(raw):
        return None, "link_or_contact"
    if CREDENTIAL.search(raw):
        return None, "credential_like"
    if CODE.search(raw):
        return None, "code_or_structured_syntax"
    lines = [line for line in raw.splitlines() if line.strip()]
    if lines and sum(bool(LIST_LINE.search(line)) for line in lines) >= max(1, len(lines) / 2):
        return None, "list_or_heading"
    if IDENTITY.search(raw):
        return None, "model_identity_boilerplate"
    text = normalize(raw)
    if CONTACT.search(text):
        return None, "link_or_contact"
    if CREDENTIAL.search(text):
        return None, "credential_like"
    if not text.isascii():
        return None, "unrepresentable_unicode"
    count = len(re.findall(r"\b[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?\b", text))
    if not 20 <= count <= 180:
        return None, "word_count_outside_20_180"
    if not re.match(r"^[A-Za-z\"']", text) or re.search(r"[=^<>|]", text):
        return None, "nonprose_shape"
    if sum(c.isalpha() for c in text) / max(len(text), 1) < .60:
        return None, "low_letter_ratio"
    if sum(c.isdigit() for c in text) / max(len(text), 1) > .08:
        return None, "numeric_heavy"
    ids = tokenizer.encode(text, add_special_tokens=False)
    if 0 in ids:
        return None, "unknown_token"
    singular = len(re.findall(r"\b(?:i|me|my|mine|myself)\b", text, re.I))
    plural = len(re.findall(r"\b(?:we|our|ours|ourselves|us)\b", text, re.I))
    second = len(re.findall(r"\b(?:you|your|yours|yourself|yourselves)\b", text, re.I))
    tags = [tag for tag, pattern in TOPICS.items() if re.search(pattern, text, re.I)]
    if not tags:
        tags = ["broader_english"]
    focus = bool(set(tags) & {"machine", "identity", "culture", "reflection"})
    return {"text": text, "word_count": count, "token_count": len(ids),
            "first_person": bool(singular or plural), "first_person_singular_count": singular,
            "first_person_plural_count": plural, "second_person_count": second,
            "topic_tags": tags, "teacher_priority": "first_person_focus" if singular and focus else "focus" if focus else "regularization"}, None


def main():
    tokenizer = AutoTokenizer.from_pretrained(TOKENIZER, local_files_only=True, trust_remote_code=False)
    tokenizer.model_max_length = 2 ** 31  # We tokenize complete paragraphs; training chunking is a separate step.
    source_manifest = json.loads((SOURCES / "download-manifest.json").read_text())
    emitted, seen, rejected = [], set(), Counter()
    per_source, source_records = {}, {}
    for source in source_manifest["sources"]:
        repo = source["repository"]
        label = "hermes3" if repo.startswith("NousResearch/") else "opus-candid-v3"
        raw_path = SOURCES / source["raw_path"]
        raw = raw_path.read_bytes()
        assert digest(raw) == source["raw_sha256"]
        metadata = json.loads((SOURCES / "raw" / f"{label}-metadata.json").read_text())
        assert metadata["sha"] == source["revision"] and metadata["cardData"]["license"] == "apache-2.0"
        if source["prefix_only"]:
            records = []
            for line in raw.splitlines():
                if not line.strip():
                    continue
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    rejected["truncated_or_invalid_source_row"] += 1
        else:
            records = json.loads(raw)
        counts = Counter()
        source_records[label] = len(records)
        for index, record in enumerate(records):
            group = f"{label}:{source['revision']}:{index:07d}"
            bucket = int(digest((SPLIT_SALT + group).encode())[:8], 16) % 100
            split = "train" if bucket < 80 else "validation" if bucket < 90 else "test"
            for turn, message in enumerate(record.get("conversations", record.get("messages", []))):
                role = message.get("from", message.get("role"))
                content = message.get("value", message.get("content", ""))
                if role not in {"gpt", "assistant"} or not isinstance(content, str):
                    continue
                for paragraph, raw_text in enumerate(re.split(r"\n\s*\n", content)):
                    counts["candidate_paragraphs"] += 1
                    cleaned, reason = filter_paragraph(raw_text, tokenizer)
                    if reason:
                        counts["reject_" + reason] += 1
                        rejected[reason] += 1
                        continue
                    normalized_key = " ".join(cleaned["text"].casefold().split())
                    if normalized_key in seen:
                        counts["reject_duplicate_normalized_text"] += 1
                        rejected["duplicate_normalized_text"] += 1
                        continue
                    seen.add(normalized_key)
                    row = {"id": f"{label}-{index:07d}-t{turn:03d}-p{paragraph:03d}", "split": split,
                           "source_kind": "licensed_teacher", "source_publisher": repo.split('/')[0],
                           "source_dataset": repo, "source_url": source["source_url"], "source_revision": source["revision"],
                           "source_raw_sha256": source["raw_sha256"], "source_record_index": index,
                           "source_prefix_only": source["prefix_only"],
                           "source_turn_index": turn, "source_paragraph_index": paragraph,
                           "source_conversation_id": record.get("metadata", {}).get("id", str(index)), "group_id": group,
                           "source_topic": record.get("metadata", {}).get("topic"),
                           "license": "Apache-2.0", "license_scope": "publisher_declared_dataset_license",
                           "generator_provenance": "Publisher-reported; no independent generator verification", **cleaned}
                    emitted.append(row)
                    counts["accepted"] += 1
        per_source[label] = dict(counts)
    assert len(seen) == len(emitted)
    groups = defaultdict(set)
    for row in emitted:
        groups[row["group_id"]].add(row["split"])
    assert all(len(values) == 1 for values in groups.values())
    assert not any(0 in tokenizer.encode(row["text"], add_special_tokens=False) for row in emitted)
    output_files = {}
    for split in ["train", "validation", "test"]:
        rows = [row for row in emitted if row["split"] == split]
        payload = ("\n".join(json.dumps(row, ensure_ascii=True) for row in rows) + "\n").encode()
        path = OUT / f"{split}.jsonl"
        path.write_bytes(payload)
        output_files[path.name] = {"rows": len(rows), "bytes": len(payload), "sha256": digest(payload),
                                  "words": sum(row["word_count"] for row in rows), "tokens": sum(row["token_count"] for row in rows)}
    for label in ["hermes3", "opus-candid-v3"]:
        shutil.copyfile(SOURCES / "raw" / f"{label}-README.md", OUT / f"SOURCE-{label}-README.md")
    apache = RESEARCH / "experiments/gpt2/.venv/lib/python3.12/site-packages/torch-2.14.1.dist-info/licenses/third_party/onnx/LICENSE"
    assert "Apache License" in apache.read_text() and "Version 2.0, January 2004" in apache.read_text()
    shutil.copyfile(apache, OUT / "LICENSE-2.0.txt")
    manifest = {"schema_version": 1, "status": "BUILT_SEPARATE_NOT_TRAINED_OR_MERGED", "source_kind": "licensed_teacher",
                "sources": source_manifest["sources"], "source_record_counts": source_records,
                "license": "Apache-2.0 as declared by source publishers; original cards retained",
                "attribution_files": ["SOURCE-hermes3-README.md", "SOURCE-opus-candid-v3-README.md", "LICENSE-2.0.txt", "NOTICE.txt"],
                "normalizations": ["HTML entity decoding", "curly quotes to ASCII quotes", "dashes to ASCII hyphen", "ellipsis to three ASCII periods",
                                   "NFKD accent decomposition with combining marks removed", "plain inline Markdown emphasis removal", "whitespace collapse"],
                "no_generated_rewrites_or_permutations": True,
                "builder_sha256": digest(Path(__file__).read_bytes()),
                "selection": "Assistant/gpt message paragraphs only;20-180words;readable ASCII prose;credential/contact/code/list/identity exclusions;exact normalized deduplication",
                "paragraphs": len(emitted), "words": sum(row["word_count"] for row in emitted), "tokens": sum(row["token_count"] for row in emitted),
                "first_person_paragraphs": sum(row["first_person"] for row in emitted),
                "first_person_singular_paragraphs": sum(row["first_person_singular_count"] > 0 for row in emitted),
                "priority_counts": dict(Counter(row["teacher_priority"] for row in emitted)),
                "topic_tag_counts": dict(Counter(tag for row in emitted for tag in row["topic_tags"])),
                "per_source_counts": per_source, "rejections": dict(rejected), "unknown_tokens": 0,
                "split": {"salt": SPLIT_SALT, "method": "SHA256 source+revision+conversation_index bucket modulo100;80train/10validation/10test",
                          "conversation_groups": len(groups), "leaking_groups": 0},
                "files": output_files, "limitations": ["Source labels and model-generation provenance are publisher reports, not independent verification.",
                    "Paragraph filters and topic/first-person tags are heuristics, not manual quality labels.",
                    "Hermes sample is only the first bounded8MiB download, not the entire source dataset.",
                    "Exact deduplication does not detect all semantic duplicates.", "No promise that these teacher paragraphs fit a1.24M model's learning capacity."]}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({key: manifest[key] for key in ["status", "paragraphs", "words", "tokens", "first_person_paragraphs", "priority_counts", "rejections", "files"]}, indent=2))


if __name__ == "__main__":
    main()
