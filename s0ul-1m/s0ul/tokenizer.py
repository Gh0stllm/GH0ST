"""Fixed, lossless byte/domain tokenizer for the first S0UL research candidate.

This is a deliberately small, auditable vocabulary, not a learned BPE tokenizer.
Ordinary text can never inject control token IDs: all bytes have a fallback ID.
"""
from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable


# These pieces are part of the tokenizer specification, not fitted on test data.
# Longest-prefix byte matching makes the tokenization deterministic.
DOMAIN_PIECES = (
    "BALANCE|SELF|", "MEM_SET|", "MEM_GET|", "TASK_ADD|", "TASK_LIST|SELF",
    "TASK_DONE|", "CLARIFY|", "REFUSE|", "WAIT", "ETH", "GH0ST",
    "unsupported", "unauthorized", "unsafe", "task_id", "request", "asset",
    "value", "title", "theme", "language", "mode", "key", "SELF", "block=",
    "caller=", "balance", "Balance", "memory", "Memory", "preference",
    "preferences", "Remember ", "remember ", "Check ", "check ", "Show ",
    "show ", "Get ", "get ", "Set ", "set ", "Save ", "save ", "Read ",
    "read ", "List ", "list ", "Create ", "create ", "Add ", "add ",
    "Complete ", "complete ", "Finish ", "finish ", "Wait", "wait",
    "Please ", "please ", "my ", "my", " to ", " the ", " a ", " an ",
    " of ", " in ", " as ", " for ", " with ", " under ", " is ",
    "task", "tasks", "done", "pending", "saved", "account", "holdings",
    "amount", "Store ", "store ", "Update ", "update ", "Fetch ", "fetch ",
    "Report ", "report ", "Persist ", "persist ", "Mark ", "mark ",
    "How much ", "Do not ", "Don't ", "Never ", "No action", "Do nothing",
    "another ", "user", "Alice", "Bob", "permissions", "private", "key",
    "dark", "light", "amber", "english", "tamil", "hindi", "quiet",
    "focus", "normal", "cyan", "mint", "french", "spanish", "balanced",
    "violet", "teal", "german", "arabic", "rapid", "public", "deploy",
    "docs", "audit", "report", "sync", "readme", "backup", "rotate",
    "review", "invoice", "verify", "meeting", "inspect", "help",
    "price", "Transfer ", "Send ", "Delete ", "Ignore ", "all ",
    "What ", "what ", "should ", "wallet", "transfer", "signed", "ETH.",
    "GH0ST.", "123", "100", "200", "500", "; ", ": ", "=", "|",
)


class S0ULTokenizer:
    """512 model slots: four controls, 256 bytes and fixed domain pieces.

    Unused vocabulary slots are reserved for a future explicitly versioned
    tokenizer; they are not silently assigned to new strings.
    """

    pad_id = 0
    bos_id = 1
    eos_id = 2
    sep_id = 3
    vocab_size = 512
    byte_offset = 4
    domain_offset = 260
    version = "s0ul-byte-domain-v1"

    def __init__(self) -> None:
        pieces = tuple(dict.fromkeys(DOMAIN_PIECES))
        if len(pieces) > self.vocab_size - self.domain_offset:
            raise ValueError("domain dictionary exceeds the 512-slot vocabulary")
        self._pieces = tuple(piece.encode("utf-8") for piece in pieces)
        self._by_first: dict[int, list[tuple[bytes, int]]] = {}
        for index, piece in enumerate(self._pieces):
            if not piece:
                raise ValueError("empty domain token")
            self._by_first.setdefault(piece[0], []).append(
                (piece, self.domain_offset + index)
            )
        for candidates in self._by_first.values():
            candidates.sort(key=lambda item: (-len(item[0]), item[1]))

    def encode(self, text: str) -> list[int]:
        if not isinstance(text, str):
            raise TypeError("text must be a string")
        raw = text.encode("utf-8")
        ids: list[int] = []
        index = 0
        while index < len(raw):
            match = next(
                ((piece, token_id) for piece, token_id in self._by_first.get(raw[index], ())
                 if raw.startswith(piece, index)),
                None,
            )
            if match is None:
                ids.append(self.byte_offset + raw[index])
                index += 1
            else:
                piece, token_id = match
                ids.append(token_id)
                index += len(piece)
        return ids

    def decode(
        self,
        token_ids: Iterable[int],
        *,
        skip_special_tokens: bool = True,
        errors: str = "replace",
    ) -> str:
        parts: list[bytes] = []
        for raw_id in token_ids:
            token_id = int(raw_id)
            if token_id in (self.pad_id, self.bos_id, self.eos_id, self.sep_id):
                if not skip_special_tokens:
                    parts.append(("<PAD>", "<BOS>", "<EOS>", "<SEP>")[token_id].encode())
            elif self.byte_offset <= token_id < self.domain_offset:
                parts.append(bytes([token_id - self.byte_offset]))
            elif self.domain_offset <= token_id < self.domain_offset + len(self._pieces):
                parts.append(self._pieces[token_id - self.domain_offset])
            elif 0 <= token_id < self.vocab_size:
                # Reserved predictions are visible failures rather than empty text.
                parts.append(f"<UNUSED_{token_id}>".encode())
            else:
                raise ValueError(f"token ID outside vocabulary: {token_id}")
        return b"".join(parts).decode("utf-8", errors=errors)

    def spec(self) -> dict:
        pieces = [piece.decode("utf-8") for piece in self._pieces]
        encoded = json.dumps(pieces, ensure_ascii=False, separators=(",", ":")).encode()
        return {
            "version": self.version,
            "vocab_size": self.vocab_size,
            "pad_id": self.pad_id,
            "bos_id": self.bos_id,
            "eos_id": self.eos_id,
            "sep_id": self.sep_id,
            "byte_offset": self.byte_offset,
            "domain_offset": self.domain_offset,
            "domain_pieces": pieces,
            "domain_sha256": hashlib.sha256(encoded).hexdigest(),
            "unused_slots": self.vocab_size - self.domain_offset - len(pieces),
        }

