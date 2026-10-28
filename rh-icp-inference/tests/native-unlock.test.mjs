import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeMacPasswordPrompt } from "../scripts/native-unlock.mjs";

test("native wallet unlock uses a hidden local field and preserves password spaces", async () => {
  const secret = " test-only password ";
  const password = await nativeMacPasswordPrompt({ platform: "darwin", run(file, args, options, done) {
    assert.equal(file, "/usr/bin/osascript");
    assert.equal(args[0], "-e");
    assert.match(args[1], /with hidden answer/);
    assert.ok(!args[1].includes(secret));
    assert.equal(options.timeout, 180_000);
    done(null, secret + "\n");
  } });
  assert.equal(password, secret);
});

test("native wallet cancellation never exposes child output or error details", async () => {
  const secret = "test-only-do-not-leak";
  await assert.rejects(nativeMacPasswordPrompt({ platform: "darwin", run(_file, _args, _options, done) {
    done(new Error(secret), secret + "\n");
  } }), error => error.message.includes("cancelled") && !error.message.includes(secret));
});

test("native wallet unlock rejects empty or multiline input and unsupported platforms", async () => {
  for (const output of ["\n", "line1\nline2\n", "a".repeat(4097) + "\n"]) {
    await assert.rejects(nativeMacPasswordPrompt({ platform: "darwin", run(_f, _a, _o, done) { done(null, output); } }), /invalid/);
  }
  await assert.rejects(nativeMacPasswordPrompt({ platform: "linux", run() { assert.fail("must not launch"); } }), /macOS/);
});
