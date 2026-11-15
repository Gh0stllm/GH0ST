# Deterministic Robinhood reads from ICP

Status: required transport correction before a funded public launch. The existing local game/engine/signature tests remain valid for their saved modules, but identical mock RPC replies did not test disagreement among real HTTPS replicas. No mainnet action is performed by this design or the probe.

## Failure being corrected

Ordinary replicated ICP HTTPS outcalls require a subnet supermajority to return the same transformed response. Removing headers and sorting JSON does not make different `eth_blockNumber` values identical. Robinhood advances quickly, so a batch containing a moving head alongside `latest` state can fail consensus even when every response is individually honest.

Do not solve this by selecting one HTTP replica, trusting a browser-provided state or reducing the Stockfish budget. Do not round different heads and call that an identical canonical state.

## Agreed policy

The reviewed deployment uses a 13-node Application subnet. Check `ic_cdk::api::subnet_self_node_count() == 13`; a different subnet requires a separately reviewed replication/budget profile. A failed capability or quorum check fails closed, with no single-node fallback.

### Head discovery

Use the official `flexible_http_request` management method for a small batch containing `eth_chainId` and `eth_blockNumber`:

- `total_requests = 13`, `min_responses = 9`, `max_responses = 13`.
- `transform = None`; parse the individual response bodies after IC agrees which responses to deliver.
- A successful management result can contain only nine replies, even if all thirteen nodes responded. Identical replies are not deduplicated; each comes from a distinct node.
- Require between nine and thirteen HTTP-success responses whose complete JSON-RPC batch parses, has the expected IDs, has no RPC error, reports chain4663, and provides a bounded unsigned hexadecimal head. Wrong-chain, malformed, missing and error responses do not count toward nine valid observations.
- Sort valid head numbers and select the median. Up to four Byzantine observations cannot push this median outside the honest observed range when at least nine observations are valid.
- Derive `N = median_head - confirmations`, with at least12 L2 confirmations. This is not an L1-finality claim.

The median selects a block number, not a game result. Every financially relevant state is fetched separately at that explicit block and checked for consistency/freshness. Do not copy `latest` state from whichever response supplied the median.

### Fixed state

Use ordinary fully replicated `http_request` for `eth_getBlockByNumber(N,false)`, `eth_getCode(...,N)`, `eth_call(...,N)`, `eth_getBalance(...,N)` and confirmed account nonce at `N`. Include no changing head or `latest` value in these batches.

The transform removes headers, canonicalizes object keys and sorts JSON-RPC batch entries by numeric ID. It must preserve semantic result/error content. The existing subnet consensus then requires nine identical transformed replies. Require the exact requested block number, a fresh timestamp, the expected code/token/signer/policy/game/history, and a rechecked block hash. EIP-1898 `{blockHash,requireCanonical:true}` is preferred if the actual official endpoint supports it; otherwise explicit number plus hash recheck remains the disclosed provider-trust policy.

Relay polling becomes two-stage: discover an agreed head, then read active game, ETH balance and watched game at the same explicit `N`. A mutable `latest` batch is not a substitute.

### Fees and gas estimates

Either derive bounded EIP-1559 fees from the agreed block's `baseFeePerGas`, or use flexible13/9/13 for numeric `eth_gasPrice`. Validate the chain and at least nine valid observations, then use a median bounded by immutable gas-price, transaction-cost and remaining-lifetime caps.

Pass an explicit block tag to `eth_estimateGas` when supported. If the provider's estimate is inherently dynamic, use the same validated numeric flexible reducer and existing bounded headroom. An HTTP or numeric quorum failure never authorizes a weaker engine or a larger fee cap.

### Latest/pending nonce observations

A new intent still requires no unresolved signed intent and the exact next nonce from durable confirmed history. Query latest/pending pairs separately from receipt and head reads. With flexible13/9/13, require at least nine fully valid chain-bound pairs; a pair must satisfy `pending >= latest`.

The selected conservative guard uses the maximum observed latest/pending nonce. Any conflict preserves/halts the existing intent; it never constructs a replacement or advances to a new nonce. A Byzantine high outlier can cause a denial of service under this deliberately conservative rule. It cannot authorize spending. Receipt-only recovery must remain available, so an exact subsequently confirmed transaction can resolve a false or transient conflict.

### Transaction and receipt reads

Read only by the already journaled transaction hash. Do not include a changing head in the same replicated payload. Normalize transaction details to the fields actually checked against the immutable intent; normalize receipt details to transaction hash, sender, target, block number/hash, status, gas used and effective price (and required exact event data). Preserve `null` as pending.

Use fully replicated equality for these semantic by-hash results. During the pending-to-included boundary there may be no consensus; wait/retry with the same intent. Alternatively a flexible reducer may require nine identical semantic results. Neither a minority receipt nor a minority `null` permits a new financial intent.

Obtain the confirmation head through the head-discovery method separately. Recheck the recorded receipt block hash at its explicit number before accounting gas. A receipt-only recovery path never signs, broadcasts, replaces, changes a nonce or re-enables an operator-disabled relay.

### Broadcasting

Keep the existing exact-raw-transaction journal. The replicated POST always sends identical pre-journaled raw bytes. Normalize a successful expected hash and narrowly recognized already-known responses only to that precomputed hash. A nonce-too-low response is not success. Ambiguity requires exact-hash/nonce reconciliation before any further intent.

## Official API and pricing

`flexible_http_request` was specified in IC interface version0.68.0 (2026-09-14). Its Candid arguments are the ordinary HTTP fields except that there is no `is_replicated` or `pricing_version`, and there is `replication : opt record {total_requests:nat32;min_responses:nat32;max_responses:nat32}`. Result is `variant {ok:vec http_request_result;err:record{message:text;...}}`; a Candid width projection may decode only the error message.

Installed `ic-cdk 0.20.3` already exposes `subnet_self_node_count()` and `cost_http_request_v2()`. The older pinned management-types crate lacks flexible wrappers, so a small local Candid definition is necessary.

Price flexible calls with `cost_http_request_v2` over exactly this Candid record:

```text
record {
  request_bytes : nat64;
  http_roundtrip_time_ms : nat64;
  raw_response_bytes : nat64;
  transformed_response_bytes : nat64;
  transform_instructions : nat64;
  outcall_type : opt variant {
    flexible : opt record {
      total_requests : nat32;
      min_responses : nat32;
      max_responses : nat32;
    }
  }
}
```

For head discovery, use a small response cap, no transform instructions and a conservative timeout/resource reservation. Existing daily/public/protected cycle limits remain unchanged. Do not use the legacy `cost_http_request` result to price a flexible call.

V2 unused node budgets can refund asynchronously up to a minute after the response. A settled cost measurement must stop timers and allow all calls/refunds to settle before final balance comparison. Saved legacy transport bills remain historical measurements, not the new flexible transport's bill.

## Local support and required tests

The pinned PocketIC16.1 IC commit `e9e42a6dd74acb9049017863e944cd5799be5b2b` contains the flexible argument/result types and method routing. Its default execution configuration explicitly enables `FLEXIBLE_HTTP_REQUESTS_FEATURE`.

Flexible mocks use REST `update/mock_flexible_canister_http`, with `subnet_id`, `request_id` and a `responses` vector containing one entry per committee member. The old replicated mock endpoint and its `additional_responses` do not simulate a flexible call. Fewer than nine successful responses must remain pending until timeout and then fail.

Required actual-Wasm cases: nine varying honest heads; nine valid plus four extreme heads; malformed/wrong-chain/error responses not counted; eight valid responses rejected; fixed-block payloads identical despite varying discovery heads; batch response order normalization; nonce/receipt disagreement preserving intent; and unchanged broadcast bytes/hash across recovery. Re-run coordinator and relay integration against their new module hashes. A mainnet pilot still verifies deployed feature availability, real provider consensus/limits, full24m latency against the native one-hour bot deadline, and settled operating costs before public entry.

## Sources

- [ICP HTTPS outcalls and modes](https://docs.internetcomputer.org/concepts/https-outcalls/)
- [Management method and flexible response semantics](https://docs.internetcomputer.org/references/ic-interface-spec/management-canister/#ic-method-flexible_http_request)
- [System API V2 cost record](https://docs.internetcomputer.org/references/ic-interface-spec/canister-interface/#cycle-cost-calculation)
- [Interface changelog version0.68.0](https://docs.internetcomputer.org/references/ic-interface-spec/changelog/)
- [Pinned PocketIC execution feature default](https://github.com/dfinity/ic/blob/e9e42a6dd74acb9049017863e944cd5799be5b2b/rs/config/src/execution_environment.rs#L14)
- [Pinned management HTTP types](https://github.com/dfinity/ic/blob/e9e42a6dd74acb9049017863e944cd5799be5b2b/rs/types/management_canister_types/src/http.rs)
- [Pinned PocketIC flexible mock endpoint/types](https://github.com/dfinity/ic/blob/e9e42a6dd74acb9049017863e944cd5799be5b2b/packages/pocket-ic/src/common/rest.rs)
