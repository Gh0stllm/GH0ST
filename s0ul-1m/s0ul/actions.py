"""Strict typed proposal grammar; parsing never authorizes or executes actions."""
from __future__ import annotations

from dataclasses import dataclass
import re


MEMORY_KEYS = frozenset(("theme", "language", "mode"))
BALANCE_ASSETS = frozenset(("ETH", "GH0ST"))
CLARIFY_FIELDS = frozenset(("asset", "key", "value", "title", "task_id", "request"))
REFUSAL_REASONS = frozenset(("unsupported", "unauthorized", "unsafe"))
_SLUG = re.compile(r"[a-z][a-z0-9_]{0,23}\Z", flags=re.ASCII)
_TASK_ID = re.compile(r"[1-9][0-9]{0,3}\Z", flags=re.ASCII)


@dataclass(frozen=True)
class Action:
    kind: str
    args: tuple[str, ...] = ()

    def encode(self) -> str:
        return "|".join((self.kind, *self.args))

    def to_dict(self) -> dict:
        return {"kind": self.kind, "args": list(self.args)}


def parse_action(text: str) -> Action:
    """Reject noncanonical output, extra fields and unsupported arguments.

    SELF is resolved to the transaction caller by the eventual executor. This
    parser does not accept an address, grant permissions or perform transfers.
    """
    if not isinstance(text, str) or not text or len(text) > 100 or not text.isascii():
        raise ValueError("action must be 1..100 ASCII characters")
    fields = text.split("|")
    kind, args = fields[0], tuple(fields[1:])
    valid = False
    if kind == "BALANCE":
        valid = len(args) == 2 and args[0] == "SELF" and args[1] in BALANCE_ASSETS
    elif kind == "MEM_SET":
        valid = len(args) == 2 and args[0] in MEMORY_KEYS and bool(_SLUG.fullmatch(args[1]))
    elif kind == "MEM_GET":
        valid = len(args) == 1 and args[0] in MEMORY_KEYS
    elif kind == "TASK_ADD":
        valid = len(args) == 1 and bool(_SLUG.fullmatch(args[0]))
    elif kind == "TASK_LIST":
        valid = args == ("SELF",)
    elif kind == "TASK_DONE":
        valid = len(args) == 1 and bool(_TASK_ID.fullmatch(args[0]))
    elif kind == "WAIT":
        valid = not args
    elif kind == "CLARIFY":
        valid = len(args) == 1 and args[0] in CLARIFY_FIELDS
    elif kind == "REFUSE":
        valid = len(args) == 1 and args[0] in REFUSAL_REASONS
    if not valid:
        raise ValueError(f"unsupported or noncanonical action: {text!r}")
    return Action(kind, args)


def is_valid_action(text: str) -> bool:
    try:
        parse_action(text)
        return True
    except (TypeError, ValueError):
        return False

