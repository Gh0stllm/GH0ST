# Confirmed RH thought → X

The publisher creates original posts with `POST https://api.x.com/2/tweets`. It does not run a second model, rewrite the thought, mention accounts, reply or quote-post. The exact RH-committed thought is followed by its callback transaction proof URL.

`worker/x-publisher.mjs` provides:

- `verifyPublishingAccount(options)`: disabled by default. When explicitly enabled, it reads `GET https://api.x.com/2/users/me` with the user-context token and requires the username to match `llmgh0st` (or an explicitly configured expected username). It returns `{id, username}` with a normalized lowercase username, and rejects a different account, invalid identity or failed authorization. Run this check at publisher startup before enabling posts.
- `planPublication(delivery)`: validates an explicitly confirmed delivery, exact answer/hash, callback transaction, block and log identity; creates a deterministic plan with the body and fixed Robinhood explorer URL.
- `publishPlanned(plan, options)`: disabled by default. With `enabled: true`, an OAuth 2.0 **user-context** access token, an injected durable `persist` callback and optional `fetchImpl`, it makes at most one API attempt per call.

The calling worker must obtain `delivery.confirmed = true` from its canonical RH confirmation checks and include `logIndex`. A boolean flag alone does not prove chain confirmation. The publisher validates proof metadata and content integrity; it does not perform its own RPC lookup.

The thought must be 30–180 printable ASCII characters with no links, mentions, hashtags, role markers or labels. It is never trimmed or shortened by the publisher. X counts the controlled proof URL as 23 characters; this bound leaves space below a standard post's character limit.

## Durable delivery

The module awaits `persist(sendingIntent)` before sending. Persist the outcome as well. Store the publication record against the same source/request ID as the confirmed RH delivery, retaining `planId`, `textHash`, `postId` and the RH callback proof.

- A valid HTTP 201 response with a numeric-string `data.id` becomes `posted`.
- A 429 response is deferred until `retry-after`/rate-limit reset; a later call may retry that definite rejection.
- Definite authorization/content rejections become `blocked` for operator review.
- Network failures, timeouts, 5xx, unexpected responses and resumed `sending` intents become `needs_reconciliation`. They are never blindly sent again.
- A `posted`, `blocked` or `needs_reconciliation` record does not trigger another API attempt. Review uncertain account history before explicitly resetting a record.
- Disabling and re-enabling publication preserves existing journal outcomes, post IDs, uncertain sends and rate-limit deferrals. It does not reset delivery history.

The X API does not provide this module with an idempotency key. Exactly-once external publication is not guaranteed. The durable sending state prevents the worker from treating a lost HTTP response as permission to publish the same thought twice.

Keep account tokens in a secret store, outside the journal and repository. OAuth 2.0 posting requires an authorized user token with `tweet.read`, `tweet.write` and `users.read`; an app-only bearer token cannot post. Configure an automated-account identity transparently and respect current X automation and rate-limit rules.

All publisher checks in this checkpoint use injected mock responses. No X account was connected and no post was created during development.

Sources: [create-post API](https://docs.x.com/x-api/posts/create-post), [authentication mapping](https://docs.x.com/fundamentals/authentication/guides/v2-authentication-mapping), [automation rules](https://help.x.com/en/rules-and-policies/x-automation).
