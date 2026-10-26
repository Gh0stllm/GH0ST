import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateJob } from "../worker/protocol.mjs";
import { readJournal, writeJournal, unwrap } from "../worker/journal.mjs";

test("durable journal preserves nonce-bearing raw transaction and checks identity", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh0st-journal-"));
  const file = path.join(dir, "journal.json");
  try {
    const binding = { chainId: 4663, gateway: "0x1234", canisterId: "test" };
    const state = readJournal(file, binding, 100);
    state.requests.push({
      rawTransaction: "0x02abc",
      transactionHash: "0xhash",
    });
    writeJournal(file, state);
    assert.deepEqual(readJournal(file, binding, 0), state);
    assert.throws(() => readJournal(file, { ...binding, chainId: 1 }, 0));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.throws(() => unwrap({ Err: "blocked" }), /blocked/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("client independently verifies the shared Rust/EVM vector", () => {
  const v = JSON.parse(
    fs.readFileSync(new URL("./fixtures/bridge-vector.json", import.meta.url)),
  );
  assert.equal(validateJob(v.config, v.job, v.signer).answer, v.job.answer);
  assert.throws(() =>
    validateJob(v.config, { ...v.job, answer: "tampered" }, v.signer),
  );
  assert.throws(() =>
    validateJob({ ...v.config, chain_id: 1 }, v.job, v.signer),
  );
});
