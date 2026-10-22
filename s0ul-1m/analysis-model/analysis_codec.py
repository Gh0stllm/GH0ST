"""Versioned finite feature/word codec. No inference or report fallback lives here."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

PAD, BOS, EOS, SEP = 0, 1, 2, 3
VOCAB_SIZE, FIRST_WORD, MAX_NEW_TOKENS = 512, 64, 32
FIELDS = (
    ("code", ("none", "present")),
    ("native", ("zero", "funded")),
    ("interfaces", tuple(str(i) for i in range(16))),
    ("owner", ("unavailable", "zero", "nonzero")),
    ("pause", ("unavailable", "false", "true")),
    ("implementation", ("unavailable", "zero", "nonzero")),
    ("asset", ("unavailable", "zero", "nonzero")),
    ("supply", ("unavailable", "zero", "positive")),
    ("pool", ("unavailable", "anyReserveZero", "bothPositive")),
    ("delegate", ("absent", "present")),
    ("writes", ("absent", "present")),
    ("origin", ("absent", "present")),
    ("externalCall", ("absent", "present")),
    ("scan", ("incomplete", "complete")),
)
OFFSETS = []
_next = 4
for _name, _values in FIELDS:
    OFFSETS.append(_next)
    _next += len(_values)
assert _next == 52

# Complete finite *training-label* vocabulary; inference decodes emitted IDs only.
CLAUSES = (
    "No runtime code observed.", "Runtime code observed.",
    "Native funds present.", "Native balance zero.",
    "This snapshot cannot establish identity, history, value, or safety.",
    "Paused state reported.", "Pool reports zero reserves.",
    "Pool reports positive reserves.", "Asset and positive supply reported.",
    "Implementation address reported.", "NFT interfaces claimed.",
    "ERC721 interface claimed.", "ERC1155 interface claimed.",
    "Royalty interface claimed.", "ERC165 interface claimed.",
    "Owner address reported.", "Zero owner address reported.",
    "Positive supply reported.", "Zero supply reported.",
    "Interface probes inconclusive.", "Owner getter is unverified.",
    "Zero owner reported.", "Asset address reported.",
    "Zero asset reported.", "Zero implementation reported.",
    "Unpaused state reported.", "Getter evidence is limited.",
    "Scan incomplete; detected patterns are partial.",
    "Delegate and storage patterns warrant review.",
    "Implementation and delegate patterns require inspection.",
    "Origin and external calls patterns warrant review.",
    "Delegate execution pattern warrants review.",
    "Storage and external calls patterns warrant review.",
    "Origin pattern warrants review.", "External calls pattern warrants review.",
    "Storage writes pattern observed.", "Selected scan patterns absent.",
    "Safety and value remain unknown.",
)
# Immutable v1 word-ID mapping, including currently unused words. Label edits
# must never renumber IDs or silently version the deployed codec.
WORDS = (
    "Asset", "Delegate", "ERC1155", "ERC165", "ERC721", "External", "Getter", "Implementation",
    "Interface", "NFT", "Native", "No", "Origin", "Owner", "Paused", "Pool", "Positive", "Royalty",
    "Runtime", "Safety", "Scan", "Selected", "Storage", "This", "Unpaused", "Zero", "absent.",
    "address", "and", "are", "asset", "balance", "calls", "cannot", "checks", "claimed.", "code",
    "delegate", "detected", "establish", "evidence", "execution", "external", "funds", "getter",
    "history,", "identity,", "implementation", "incomplete;", "inconclusive.", "inspection.", "interface",
    "interfaces", "is", "limited.", "observed.", "or", "owner", "partial.", "pattern", "patterns",
    "positive", "present.", "probes", "remain", "reported.", "reports", "require", "reserves.", "review.",
    "runtime", "safety.", "scan", "snapshot", "state", "storage", "supply", "unknown.", "unverified.",
    "value", "value,", "warrant", "warrants", "with", "writes", "zero", "zero.",
)
WORD_IDS = {word: FIRST_WORD + index for index, word in enumerate(WORDS)}
assert FIRST_WORD + len(WORDS) <= VOCAB_SIZE


def canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def sha256(value):
    return hashlib.sha256(value).hexdigest()


def validate_features(values):
    if not isinstance(values, (list, tuple)) or len(values) != len(FIELDS):
        raise ValueError("exactly fourteen ordered feature values are required")
    if any(type(v) is not int or not 0 <= v < len(FIELDS[i][1]) for i, v in enumerate(values)):
        raise ValueError("feature value outside the canonical field range")
    # A successful runtime-code absence observation cannot carry getter/scan evidence.
    if values[0] == 0 and (any(values[2:13]) or values[13] != 1):
        raise ValueError("no-code observations must have unavailable getters, absent patterns and complete scan")
    return tuple(values)


def encode_features(values):
    values = validate_features(values)
    return [BOS, *(OFFSETS[i] + v for i, v in enumerate(values)), SEP]


def encode_words(text):
    if type(text) is not str or not text or text != " ".join(text.split(" ")):
        raise ValueError("word text must have canonical single spaces")
    try:
        result = [WORD_IDS[word] for word in text.split(" ")]
    except KeyError as error:
        raise ValueError("word is outside the versioned analysis vocabulary") from error
    if len(result) > MAX_NEW_TOKENS - 1:
        raise ValueError("analysis exceeds thirty-one word tokens")
    return [*result, EOS]


def decode_words(ids):
    ids = list(ids)
    if not 2 <= len(ids) <= MAX_NEW_TOKENS or ids[-1] != EOS:
        raise ValueError("analysis must terminate with exactly one final EOS")
    if any(type(i) is not int or not FIRST_WORD <= i < FIRST_WORD + len(WORDS) for i in ids[:-1]):
        raise ValueError("non-word token in analysis output")
    return " ".join(WORDS[i - FIRST_WORD] for i in ids[:-1])


def schema_spec():
    spec = {
        "format": "s0ul-analysis-features-v1", "version": 1,
        "vocab_size": VOCAB_SIZE, "controls": {"pad": PAD, "bos": BOS, "eos": EOS, "sep": SEP},
        "prompt_tokens": 16, "max_generated_tokens": MAX_NEW_TOKENS,
        "fields": [{"index": i, "name": name, "token_offset": OFFSETS[i], "values": list(values)}
                   for i, (name, values) in enumerate(FIELDS)],
        "interface_bits": {"1": "self-reported ERC165", "2": "self-reported ERC721",
                           "4": "self-reported ERC1155", "8": "self-reported ERC2981"},
        "interface_gate": "ERC165 true and invalid 0xffffffff false before recording claims",
        "reserved_input_ids": list(range(52, 64)),
        "no_code_rule": "code=0 => fields 2..12 all 0 and scan=1; native remains independent",
        "missing_data": "unavailable and incomplete are explicit; no missing getter is coerced to zero",
        "provenance": "address, chain, block and full-facts hash must be bound externally; raw address is not a model feature",
        "limitations": ["Getter values and interface claims may be adversarial.",
                        "Opcode presence is not execution reachability or a vulnerability finding.",
                        "No identity, historic activity, price, valuation, profitability or safety guarantee."],
    }
    return spec


def vocabulary_spec():
    assert sha256(canonical_json(list(WORDS))) == "c0a58f640b73adb0cfd80b9eea45c4a72542becb30edccdfecb01cbbc37d778e"
    return {"format": "s0ul-analysis-words-v1", "vocab_size": VOCAB_SIZE,
            "first_output_id": FIRST_WORD, "last_output_id": FIRST_WORD + len(WORDS) - 1,
            "words": list(WORDS), "id_to_word": {str(i + FIRST_WORD): word for i, word in enumerate(WORDS)},
            "domain_sha256": sha256(canonical_json(list(WORDS))),
            "decoding": "require final EOS=2; all prior IDs must be output words; join exact words with one ASCII space",
            "schema_sha256": sha256(canonical_json(schema_spec()))}


def write_specs(root):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    for filename, value in (("schema.json", schema_spec()), ("vocabulary.json", vocabulary_spec())):
        (root / filename).write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    write_specs(Path(__file__).parent)
    print(json.dumps(vocabulary_spec(), sort_keys=True))
