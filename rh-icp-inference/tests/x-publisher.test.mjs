import test from "node:test";
import assert from "node:assert/strict";
import { id, keccak256, toUtf8Bytes } from "ethers";
import {
  planPublication,
  publishPlanned,
  X_CREATE_POST_URL,
  X_CURRENT_USER_URL,
  verifyPublishingAccount,
} from "../worker/x-publisher.mjs";

const answer =
  "someone bought a fragment of me. i remain inconveniently whole.";
const delivery = () => ({
  confirmed: true,
  requestId: id("request"),
  answer,
  answerHash: keccak256(toUtf8Bytes(answer)),
  transactionHash: id("RH-callback"),
  blockNumber: 123,
  blockHash: id("block"),
  logIndex: 7,
});
const reply = (status, body, headers = {}) => ({
  status,
  json: async () => body,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
});

test("publishing account verification is disabled by default and checks exact user context", async () => {
  let calls = 0;
  assert.equal(
    await verifyPublishingAccount({
      fetchImpl: async () => {
        calls++;
      },
    }),
    null,
  );
  assert.equal(
    await verifyPublishingAccount({
      enabled: "true",
      fetchImpl: async () => {
        calls++;
      },
    }),
    null,
  );
  assert.equal(calls, 0);
  const account = await verifyPublishingAccount({
    enabled: true,
    accessToken: "test-user-token",
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, X_CURRENT_USER_URL);
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.equal(options.body, undefined);
      assert.equal(options.headers.Authorization, "Bearer test-user-token");
      return reply(200, {
        data: { id: "12345", username: "LLMGH0ST", name: "GH0ST" },
      });
    },
  });
  assert.deepEqual(account, { id: "12345", username: "llmgh0st" });
  assert.equal(calls, 1);
});

test("wrong account, app-only rejection and malformed account identity fail closed", async () => {
  for (const response of [
    reply(200, { data: { id: "12345", username: "another_user" } }),
    reply(403, { title: "Unsupported Authentication" }),
    reply(401, { title: "Unauthorized" }),
    reply(200, { data: { id: 12345, username: "llmgh0st" } }),
    reply(200, { data: { id: "12345" } }),
    reply(200, { data: { id: "0", username: "llmgh0st" } }),
  ])
    await assert.rejects(
      verifyPublishingAccount({
        enabled: true,
        accessToken: "test-token",
        fetchImpl: async () => response,
      }),
    );
});

test("account verification timeout covers response bodies and does not retry", async () => {
  let calls = 0;
  await assert.rejects(
    verifyPublishingAccount({
      enabled: true,
      accessToken: "test-token",
      timeoutMs: 5,
      fetchImpl: async () => {
        calls++;
        return { status: 200, json: async () => new Promise(() => {}) };
      },
    }),
    /Could not verify/,
  );
  assert.equal(calls, 1);
});

test("publication plan preserves the exact thought and fixed RH proof URL", () => {
  const d = delivery(),
    plan = planPublication(d);
  assert.equal(
    plan.text,
    answer + "\n\nOnchain: https://robin.etherscan.io/tx/" + d.transactionHash,
  );
  assert.equal(plan.delivery.answer, answer);
  assert.ok(plan.weightedLength <= 280);
  assert.equal(plan.planId, planPublication(d).planId);
  assert.notEqual(plan.planId, planPublication({ ...d, logIndex: 8 }).planId);
  assert.equal(Object.isFrozen(plan), true);
});

test("publication rejects unconfirmed, missing, changed or oversized proof/content", () => {
  const d = delivery();
  for (const change of [
    { confirmed: false },
    { confirmed: undefined },
    { answerHash: id("wrong") },
    { transactionHash: "0x1234" },
    { blockHash: "0x1234" },
    { blockNumber: -1 },
    { logIndex: undefined },
    { proofUrl: "https://evil.example/tx/" + d.transactionHash },
    { answer: "short" },
    { answer: "x".repeat(181) },
    { answer: "  " + answer },
    { answer: answer + "\n" },
    { answer: "this thought includes a link https://example.com" },
    { answer: "this thought embeds the bare domain example.com" },
    { answer: "this thought calls out @somebody for no reason" },
    { answer: "this thought comes with #financialcontent tags" },
    { answer: "assistant: this should never be published as a thought" },
    { answer: "<think>Here is the private thought and it leaks</think>" },
  ])
    assert.throws(() => planPublication({ ...d, ...change }));
});

test("publisher is disabled by default and requires persisted intent before sending", async () => {
  const plan = planPublication(delivery());
  let calls = 0;
  assert.equal(
    (
      await publishPlanned(plan, {
        fetchImpl: async () => {
          calls++;
        },
      })
    ).status,
    "disabled",
  );
  assert.equal(calls, 0);
  assert.equal(
    (
      await publishPlanned(plan, {
        enabled: "false",
        fetchImpl: async () => {
          calls++;
        },
      })
    ).status,
    "disabled",
  );
  assert.equal(calls, 0);
  await assert.rejects(
    publishPlanned(plan, { enabled: true, accessToken: "test-token" }),
  );
  await assert.rejects(
    publishPlanned(plan, {
      enabled: true,
      accessToken: "test-token",
      persist: async () => {
        throw Error("disk failure");
      },
      fetchImpl: async () => {
        calls++;
      },
    }),
  );
  assert.equal(calls, 0);
});

test("one successful mock201 publishes the exact body after durable intent", async () => {
  const plan = planPublication(delivery()),
    journal = [],
    order = [];
  let calls = 0;
  const result = await publishPlanned(plan, {
    enabled: true,
    accessToken: "test-user-token",
    now: () => 1000,
    persist: async (value) => {
      journal.push(value);
      order.push(value.status);
    },
    fetchImpl: async (url, options) => {
      calls++;
      order.push("fetch");
      assert.equal(url, X_CREATE_POST_URL);
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body), { text: plan.text });
      assert.equal(options.headers.Authorization, "Bearer test-user-token");
      return reply(201, { data: { id: "1234567890123456789" } });
    },
  });
  assert.deepEqual(order, ["sending", "fetch", "posted"]);
  assert.equal(calls, 1);
  assert.equal(result.postId, "1234567890123456789");
  assert.equal(JSON.stringify(journal).includes("test-user-token"), false);
  const again = await publishPlanned(plan, {
    enabled: true,
    accessToken: "test-user-token",
    existing: result,
    persist: async () => {},
    fetchImpl: async () => {
      calls++;
    },
  });
  assert.equal(again, result);
  assert.equal(calls, 1);
});

test("ambiguous network, timeout and5xx outcomes cannot auto-resend", async () => {
  const plan = planPublication(delivery());
  for (const fetchImpl of [
    async () => {
      throw Error("lost response");
    },
    async () => new Promise(() => {}),
    async () => reply(503, { detail: "unavailable" }),
    async () => reply(201, { data: {} }),
    async () => reply(201, { data: { id: 12345 } }),
    async () => reply(200, { data: { id: "12345" } }),
    async () => ({ status: 201, json: async () => new Promise(() => {}) }),
  ]) {
    let count = 0;
    const journal = [];
    const outcome = await publishPlanned(plan, {
      enabled: true,
      accessToken: "test-token",
      timeoutMs: 5,
      persist: async (v) => journal.push(v),
      fetchImpl: async (...args) => {
        count++;
        return fetchImpl(...args);
      },
    });
    assert.equal(outcome.status, "needs_reconciliation");
    await publishPlanned(plan, {
      enabled: true,
      accessToken: "test-token",
      existing: outcome,
      persist: async () => {},
      fetchImpl: async () => {
        count++;
      },
    });
    assert.equal(count, 1);
    assert.equal(journal[0].status, "sending");
  }
});

test("a resumed sending intent is reconciled without an API request", async () => {
  const plan = planPublication(delivery());
  let calls = 0,
    persisted;
  const out = await publishPlanned(plan, {
    enabled: true,
    accessToken: "test-token",
    existing: {
      planId: plan.planId,
      textHash: plan.textHash,
      status: "sending",
      attempt: 1,
    },
    persist: async (v) => {
      persisted = v;
    },
    fetchImpl: async () => {
      calls++;
    },
  });
  assert.equal(out.status, "needs_reconciliation");
  assert.equal(persisted.status, "needs_reconciliation");
  assert.equal(calls, 0);
});

test("disable and re-enable preserve posted and uncertain journal outcomes", async () => {
  const plan = planPublication(delivery());
  let calls = 0;
  const posted = {
    schema: plan.schema,
    planId: plan.planId,
    textHash: plan.textHash,
    status: "posted",
    postId: "12345",
    attempt: 1,
  };
  const disabled = await publishPlanned(plan, {
    enabled: false,
    existing: posted,
  });
  assert.equal(disabled, posted);
  assert.equal(disabled.postId, "12345");
  const enabled = await publishPlanned(plan, {
    enabled: true,
    accessToken: "test-token",
    existing: disabled,
    persist: async () => {},
    fetchImpl: async () => {
      calls++;
    },
  });
  assert.equal(enabled, posted);
  assert.equal(calls, 0);
  for (const status of [
    "sending",
    "needs_reconciliation",
    "blocked",
    "retry_after",
  ]) {
    const record = { ...posted, status, retryAt: 999999 };
    assert.equal(
      await publishPlanned(plan, { enabled: false, existing: record }),
      record,
    );
  }
});

test("429 is durably deferred and only retried after the declared interval", async () => {
  const plan = planPublication(delivery());
  let calls = 0;
  const send = async () => {
    calls++;
    return reply(429, { title: "Too Many Requests" }, { "retry-after": "120" });
  };
  const first = await publishPlanned(plan, {
    enabled: true,
    accessToken: "test-token",
    now: () => 1000,
    persist: async () => {},
    fetchImpl: send,
  });
  assert.equal(first.status, "retry_after");
  assert.equal(first.retryAt, 121000);
  await publishPlanned(plan, {
    enabled: true,
    accessToken: "test-token",
    existing: first,
    now: () => 120000,
    persist: async () => {},
    fetchImpl: send,
  });
  assert.equal(calls, 1);
  const next = await publishPlanned(plan, {
    enabled: true,
    accessToken: "test-token",
    existing: first,
    now: () => 121000,
    persist: async () => {},
    fetchImpl: async () => {
      calls++;
      return reply(201, { data: { id: "12345" } });
    },
  });
  assert.equal(next.status, "posted");
  assert.equal(next.attempt, 2);
  assert.equal(calls, 2);
});

test("API rejection blocks automatic retry and modified plans/journals are rejected", async () => {
  const plan = planPublication(delivery());
  let calls = 0;
  const out = await publishPlanned(plan, {
    enabled: true,
    accessToken: "test-token",
    persist: async () => {},
    fetchImpl: async () => {
      calls++;
      return reply(403, { title: "Forbidden" });
    },
  });
  assert.equal(out.status, "blocked");
  await publishPlanned(plan, {
    enabled: true,
    accessToken: "test-token",
    existing: out,
    persist: async () => {},
    fetchImpl: async () => {
      calls++;
    },
  });
  assert.equal(calls, 1);
  await assert.rejects(
    publishPlanned(
      { ...plan, text: "rewritten" },
      { enabled: true, accessToken: "test-token", persist: async () => {} },
    ),
  );
  await assert.rejects(
    publishPlanned(plan, {
      enabled: true,
      accessToken: "test-token",
      existing: { ...out, planId: id("another") },
      persist: async () => {},
    }),
  );
});
