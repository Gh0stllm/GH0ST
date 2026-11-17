"""Bounded Go test marker extraction for future -test.v=test2json runs.

Ordinary log/payload text is not a framework completion marker. Only whole short
lines beginning with Go's pinned 0x16 test2json framing byte are considered.
This framing is a trusted-process convention, not an authentication boundary
against a process intentionally forging the same control bytes.
"""
import re

_MARKER = re.compile(rb"(?:=== RUN   [A-Za-z0-9_]+(?:/[^\r\n]+)?|(?:\s*)--- (?:PASS|FAIL|SKIP): [A-Za-z0-9_]+(?:/[^\r\n]+)? \([0-9.]+s\)|PASS|FAIL(?:\s.*)?|\?\s+.*\[no test files\])")

def scan_named_markers(stream, *, chunk_bytes=65536, retained_line_bytes=2048):
    if not 1 <= chunk_bytes <= 1024 * 1024 or not 64 <= retained_line_bytes <= 16384:
        raise ValueError("invalid bounded scanner configuration")
    prefix = bytearray()
    line_bytes = 0
    lines = oversized = scanned = 0
    markers = []
    oversized_framed = 0

    def finish():
        nonlocal lines, oversized, oversized_framed, line_bytes
        lines += 1
        if line_bytes > retained_line_bytes:
            oversized += 1
            if prefix.startswith(b"\x16"):
                oversized_framed += 1
        elif prefix.startswith(b"\x16"):
            payload = bytes(prefix[1:])
            if _MARKER.fullmatch(payload):
                markers.append(payload.decode("ascii", "strict") + "\n")
        prefix.clear()
        line_bytes = 0

    while True:
        chunk = stream.read(chunk_bytes)
        if not chunk:
            break
        scanned += len(chunk)
        offset = 0
        while offset < len(chunk):
            end = chunk.find(b"\n", offset)
            stop = len(chunk) if end < 0 else end
            fragment = chunk[offset:stop]
            line_bytes += len(fragment)
            room = retained_line_bytes - len(prefix)
            if room > 0:
                prefix.extend(fragment[:room])
            if end < 0:
                break
            finish()
            offset = end + 1
    if line_bytes:
        finish()
    return {
        "markers": "".join(markers),
        "scannedBytes": scanned,
        "lines": lines,
        "oversizedLinesIgnored": oversized,
        "oversizedFramedLines": oversized_framed,
        "chunkBytes": chunk_bytes,
        "maximumRetainedLineBytes": retained_line_bytes,
        "requiresTest2JSONFraming": True,
    }
