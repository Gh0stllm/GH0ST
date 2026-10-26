import { keccak256, toUtf8Bytes } from "ethers";

export const X_CREATE_POST_URL = "https://api.x.com/2/tweets";
export const X_CURRENT_USER_URL = "https://api.x.com/2/users/me";
export const RH_EXPLORER_PREFIX = "https://robin.etherscan.io/tx/";
const SCHEMA = "gh0st-x-publication-v1";
const HASH = /^0x[0-9a-fA-F]{64}$/;
const POST_ID = /^[1-9][0-9]{0,19}$/;

/**
 * Check the user-context token against the intended public account before any
 * production publication. Disabled mode does not contact X and returns null.
 */
export async function verifyPublishingAccount({
  enabled = false,
  accessToken,
  expectedUsername = "llmgh0st",
  fetchImpl = globalThis.fetch,
  timeoutMs = 20_000,
} = {}) {
  if (enabled !== true) return null;
  if (
    typeof accessToken !== "string" ||
    accessToken.length === 0 ||
    /\s/.test(accessToken)
  )
    throw Error("A user-context X access token is required");
  if (
    typeof expectedUsername !== "string" ||
    !/^[A-Za-z0-9_]{1,15}$/.test(expectedUsername)
  )
    throw Error("Invalid expected X publishing username");
  if (typeof fetchImpl !== "function") throw Error("fetch is unavailable");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000)
    throw Error("Invalid X request timeout");
  const controller = new AbortController();
  let timer;
  let result;
  try {
    result = await Promise.race([
      (async () => {
        const response = await fetchImpl(X_CURRENT_USER_URL, {
          method: "GET",
          redirect: "error",
          headers: {
            Authorization: "Bearer " + accessToken,
            Accept: "application/json",
          },
          signal: controller.signal,
        });
        return { status: response.status, body: await response.json() };
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(Error("X account verification timed out"));
        }, timeoutMs);
      }),
    ]);
  } catch {
    throw Error("Could not verify the X publishing account");
  } finally {
    clearTimeout(timer);
  }
  if (result.status !== 200)
    throw Error(
      `X account verification rejected (HTTP ${result.status}); use an authorized user-context token`,
    );
  const { id, username } = result.body?.data ?? {};
  if (
    typeof id !== "string" ||
    !POST_ID.test(id) ||
    typeof username !== "string" ||
    !/^[A-Za-z0-9_]{1,15}$/.test(username)
  )
    throw Error("X account verification returned an invalid identity");
  if (username.toLowerCase() !== expectedUsername.toLowerCase())
    throw Error(
      "X token account does not match the expected publishing account",
    );
  return { id, username: username.toLowerCase() };
}

function requireHash(value, label) {
  if (typeof value !== "string" || !HASH.test(value))
    throw Error(`Invalid ${label}`);
  return value.toLowerCase();
}

function requireIndex(value, label) {
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
      throw Error(`Invalid ${label}`);
    return Number(value);
  }
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value))
    value = Number(value);
  if (!Number.isSafeInteger(value) || value < 0)
    throw Error(`Invalid ${label}`);
  return value;
}

/**
 * The caller must obtain this delivery from canonical RH confirmation checks.
 * `confirmed` is an application boundary, not a substitute for those checks.
 * This function validates the proof metadata and preserves the exact thought.
 */
export function planPublication(delivery) {
  if (!delivery || delivery.confirmed !== true)
    throw Error("X publication requires a confirmed RH delivery");
  const answer = delivery.answer;
  if (
    typeof answer !== "string" ||
    answer.length < 30 ||
    answer.length > 180 ||
    answer.trim() !== answer ||
    !/^[\x20-\x7e]+$/.test(answer)
  )
    throw Error("Thought must be 30-180 printable ASCII characters");
  if (
    /https?:|www\.|:\/\/|[@#]|<\|[^>]*\|>|<\/?think\b/i.test(answer) ||
    /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b/i.test(
      answer,
    ) ||
    /^(?:assistant|system|user|response|answer|thought)\s*:/i.test(answer)
  )
    throw Error("Thought contains a link, mention, label or role leakage");
  const answerHash = requireHash(delivery.answerHash, "answer hash");
  if (keccak256(toUtf8Bytes(answer)) !== answerHash)
    throw Error("Thought hash differs from the committed RH answer");
  const transactionHash = requireHash(
    delivery.transactionHash,
    "RH callback transaction hash",
  );
  const blockHash = requireHash(delivery.blockHash, "RH block hash");
  const blockNumber = requireIndex(delivery.blockNumber, "RH block number");
  const logIndex = requireIndex(delivery.logIndex, "RH callback log index");
  const proofUrl = RH_EXPLORER_PREFIX + transactionHash;
  if (delivery.proofUrl !== undefined && delivery.proofUrl !== proofUrl)
    throw Error("Proof URL is not the expected RH explorer transaction");
  const text = answer + "\n\nOnchain: " + proofUrl;
  // The only URL is the controlled proof link. X weights a URL as 23 characters;
  // the 180-character ASCII thought limit leaves ample room below 280.
  const weightedLength = answer.length + "\n\nOnchain: ".length + 23;
  if (weightedLength > 280) throw Error("Publication exceeds X post length");
  const normalized = {
    confirmed: true,
    answer,
    answerHash,
    transactionHash,
    blockNumber,
    blockHash,
    logIndex,
  };
  if (delivery.requestId !== undefined)
    normalized.requestId = requireHash(delivery.requestId, "request ID");
  const textHash = keccak256(toUtf8Bytes(text));
  const planId = keccak256(
    toUtf8Bytes(
      JSON.stringify({ schema: SCHEMA, delivery: normalized, textHash }),
    ),
  );
  return Object.freeze({
    schema: SCHEMA,
    planId,
    textHash,
    text,
    proofUrl,
    weightedLength,
    delivery: Object.freeze(normalized),
  });
}

function validatePlan(plan) {
  if (!plan || plan.schema !== SCHEMA) throw Error("Invalid publication plan");
  const expected = planPublication(plan.delivery);
  for (const field of ["planId", "textHash", "text", "proofUrl"])
    if (expected[field] !== plan[field])
      throw Error("Publication plan was changed after validation");
  return expected;
}

function retryAt(response, timestamp) {
  const header = response.headers?.get?.("retry-after");
  if (header != null) {
    if (/^[0-9]+$/.test(header)) {
      const retry = timestamp + Number(header) * 1000;
      if (Number.isSafeInteger(retry)) return retry;
    }
    const date = Date.parse(header);
    if (Number.isSafeInteger(date) && date > timestamp) return date;
  }
  const reset = response.headers?.get?.("x-rate-limit-reset");
  if (
    reset &&
    /^[0-9]+$/.test(reset) &&
    Number.isSafeInteger(Number(reset) * 1000) &&
    Number(reset) * 1000 > timestamp
  )
    return Number(reset) * 1000;
  return timestamp + 60_000;
}

/**
 * One API attempt at most. No account is contacted unless enabled=true.
 * persist(sendingIntent) MUST finish before fetch is called. A resumed sending
 * intent is uncertain and is never sent again automatically.
 *
 * accessToken must be a GH0ST-account OAuth 2.0 user-context token with the
 * appropriate write scope, not an app-only token. It is never persisted.
 */
export async function publishPlanned(
  candidate,
  {
    enabled = false,
    accessToken,
    existing = null,
    persist,
    fetchImpl = globalThis.fetch,
    timeoutMs = 20_000,
    now = Date.now,
  } = {},
) {
  const plan = validatePlan(candidate);
  if (existing) {
    if (
      existing.planId !== plan.planId ||
      (existing.textHash !== undefined && existing.textHash !== plan.textHash)
    )
      throw Error("Journaled publication belongs to a different plan");
    if (
      ![
        "posted",
        "blocked",
        "needs_reconciliation",
        "sending",
        "retry_after",
        "disabled",
        "ready",
      ].includes(existing.status)
    )
      throw Error("Unrecognized publication journal state");
    // Disabling a publisher must never erase a post ID, uncertain send or rate
    // limit record. Terminal outcomes remain terminal even after re-enabling.
    if (
      enabled !== true ||
      ["posted", "blocked", "needs_reconciliation"].includes(existing.status)
    )
      return existing;
  }
  if (enabled !== true)
    return { schema: SCHEMA, planId: plan.planId, status: "disabled" };
  if (
    typeof accessToken !== "string" ||
    accessToken.length === 0 ||
    /\s/.test(accessToken)
  )
    throw Error("A user-context X access token is required");
  if (typeof persist !== "function")
    throw Error("A durable intent persistence callback is required");
  if (typeof fetchImpl !== "function") throw Error("fetch is unavailable");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000)
    throw Error("Invalid X request timeout");
  const timestamp = requireIndex(now(), "publication timestamp");
  if (existing) {
    if (existing.status === "sending") {
      const uncertain = {
        ...existing,
        status: "needs_reconciliation",
        updatedAt: timestamp,
        reason: "A previous send may have completed; reconcile before retrying",
      };
      await persist(uncertain);
      return uncertain;
    }
    if (
      existing.status === "retry_after" &&
      requireIndex(existing.retryAt, "retry timestamp") > timestamp
    )
      return existing;
    if (!["retry_after", "disabled", "ready"].includes(existing.status))
      throw Error("Unrecognized publication journal state");
  }
  const intent = {
    schema: SCHEMA,
    planId: plan.planId,
    textHash: plan.textHash,
    status: "sending",
    attempt: requireIndex(existing?.attempt ?? 0, "attempt") + 1,
    startedAt: timestamp,
    updatedAt: timestamp,
  };
  await persist(intent);

  let response;
  let body;
  let timer;
  const controller = new AbortController();
  try {
    ({ response, body } = await Promise.race([
      (async () => {
        const received = await fetchImpl(X_CREATE_POST_URL, {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: "Bearer " + accessToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: plan.text }),
          signal: controller.signal,
        });
        let parsed;
        try {
          parsed = await received.json();
        } catch {
          parsed = null;
        }
        return { response: received, body: parsed };
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(Error("X request timed out"));
        }, timeoutMs);
      }),
    ]));
  } catch {
    const uncertain = {
      ...intent,
      status: "needs_reconciliation",
      updatedAt: now(),
      reason: "Network or timeout outcome is unknown; do not resend blindly",
    };
    await persist(uncertain);
    return uncertain;
  } finally {
    clearTimeout(timer);
  }

  let outcome;
  if (
    response.status === 201 &&
    typeof body?.data?.id === "string" &&
    POST_ID.test(body.data.id)
  ) {
    outcome = {
      ...intent,
      status: "posted",
      httpStatus: 201,
      updatedAt: now(),
      postId: body.data.id,
      postUrl: "https://x.com/i/web/status/" + body.data.id,
    };
  } else if (response.status === 429 && !body?.data?.id) {
    outcome = {
      ...intent,
      status: "retry_after",
      httpStatus: 429,
      updatedAt: now(),
      retryAt: retryAt(response, timestamp),
      reason: "X rate limit rejected the request",
    };
  } else if (
    [400, 401, 403, 404, 405, 413, 415, 422].includes(response.status) &&
    !body?.data?.id
  ) {
    outcome = {
      ...intent,
      status: "blocked",
      httpStatus: response.status,
      updatedAt: now(),
      reason: "X rejected the request; review account access or the post",
    };
  } else {
    outcome = {
      ...intent,
      status: "needs_reconciliation",
      httpStatus: Number(response.status),
      updatedAt: now(),
      reason: "X returned an ambiguous result; reconcile before retrying",
    };
    if (typeof body?.data?.id === "string" && POST_ID.test(body.data.id))
      outcome.observedPostId = body.data.id;
  }
  await persist(outcome);
  return outcome;
}
