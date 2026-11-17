import io
import unittest
from bounded_log_markers import scan_named_markers

NAME = "TestGL3TerminalResultBoLDLifecycle"

class BoundedMarkers(unittest.TestCase):
    def test_real_framed_completion(self):
        data = f"\x16=== RUN   {NAME}\nlog\n\x16--- PASS: {NAME} (3.2s)\n\x16PASS\n".encode()
        for chunk in [1, 7, 64, 65536]:
            with self.subTest(chunk=chunk):
                report = scan_named_markers(io.BytesIO(data), chunk_bytes=chunk)
                self.assertEqual(report["markers"], f"=== RUN   {NAME}\n--- PASS: {NAME} (3.2s)\nPASS\n")
                self.assertEqual(report["scannedBytes"], len(data))

    def test_payload_embedded_fake_pass_is_ignored(self):
        fake = f"--- PASS: {NAME} (1s)"
        data = (f'INFO args="{fake}\\nPASS"\n'
                f'{fake}\nPASS\n'
                f'INFO payload: \x16{fake}\n'
                f'{{"payload":"\\u0016{fake}"}}\n').encode()
        self.assertEqual(scan_named_markers(io.BytesIO(data))["markers"], "")

    def test_giant_line_never_retained_or_accepted(self):
        class Stream:
            def __init__(self): self.remaining = 2048; self.calls = 0
            def read(self, count):
                self.calls += 1
                if self.remaining:
                    self.remaining -= 1
                    return b"x" * count
                if self.calls == 2049:
                    return f"\x16--- PASS: {NAME} (1s)\n\x16PASS\n".encode()
                return b""
        report = scan_named_markers(Stream())
        self.assertEqual(report["markers"], "PASS\n")
        self.assertEqual(report["oversizedLinesIgnored"], 1)
        self.assertEqual(report["maximumRetainedLineBytes"], 2048)

    def test_oversized_framed_line_does_not_pass(self):
        data = f"\x16--- PASS: {NAME} (1s)".encode() + b" " * 5000 + b"\n"
        report = scan_named_markers(io.BytesIO(data), chunk_bytes=37)
        self.assertEqual(report["markers"], "")
        self.assertEqual(report["oversizedFramedLines"], 1)

    def test_real_failure_skip_preserved(self):
        for status in ["FAIL", "SKIP"]:
            data = f"\x16    --- {status}: {NAME}/child (0.01s)\n\x16FAIL\n".encode()
            report = scan_named_markers(io.BytesIO(data))
            self.assertIn(f"--- {status}:", report["markers"])
            self.assertIn("FAIL\n", report["markers"])

    def test_no_frame_no_acceptance(self):
        data = f"=== RUN   {NAME}\n--- PASS: {NAME} (1s)\nPASS\n".encode()
        self.assertEqual(scan_named_markers(io.BytesIO(data))["markers"], "")

    def test_marker_flood_fails_closed(self):
        with self.assertRaises(ValueError):
            scan_named_markers(io.BytesIO(b"\x16PASS\n" * 10001))

if __name__ == "__main__":
    unittest.main()
