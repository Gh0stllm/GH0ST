# Local integration review

Reviewed model source: `../kernel/SimpleStoriesV2TwoPrefixCachedModel.sol`, SHA256 `675a50eb0730a8bad06a23a76e3f56d197af64bd74703e997af56d34eb7b8efb`.

Reviewed final experimental hook: `ReadyCachedSampledSentenceHook.sol`, SHA256 `40d00a63c60d37f7ba802047c18ae384b98ef0df599149bbce740ea28f283857`.

This is an implementation review and local verification record, not an independent external audit. The hook deliberately refuses deployment outside local chain31337.

## Readiness issue addressed

The earlier cached hook accepted a model before every possible first-token branch cache existed. A seed selecting an unprepared branch would revert. The new hook verifies the architecture, five-token capability, root-cache runtime/hash, and all64 unique root candidates during construction. Every nonterminal candidate must have its expected20,173-byte cache runtime and matching pinned hash. It records a commitment to those caches. The extended runner tests missing and deliberately corrupted cache rejection before restoring local state.

## Verified design properties

- Weight, table and executable-tile commitments are checked by the model constructor. The root cache is computed by that constructor from the model, then pinned by runtime hash.
- `prepareBranch` computes numerical state using the model. Existing branch mappings cannot be replaced, and repeated preparation verifies the prior runtime hash. There is no output-phrase store or external setter for cache contents.
- Generation checks the root and selected branch runtime hashes again. Cache data contracts have STOP-prefixed runtimes and expose no mutation or withdrawal functions.
- The hook accepts callbacks only from its configured PoolManager and only for a PoolKey referencing itself. It returns zero hook delta and does not custody, redirect or withdraw pool assets.
- Each accepted swap recomputes the sampled output. The caller's exact32-byte seed is used with fixed model, prompt, top-k, temperature and token cap. Pool sequence and block data do not alter inference, allowing view previews to replay exactly. Both preview and execution check the pinned model runtime.
- A result must contain between2 and5 in-range token IDs, nonterminal content, and matching final native EOS/punctuation flags. Earlier terminal tokens are rejected. Incomplete generation and model failure revert the whole swap; no partial sentence event is emitted.
- The model call is bounded. The29.25M experimental budget reserves additional gas for EIP-150 and bookkeeping. Every extended test transaction is capped at32M. Measured passing cases do not constitute a universal gas bound for all seeds.

## Remaining product and deployment constraints

- Native punctuation/EOS proves termination, not grammatical quality. A grammar-screened catalog remains an off-chain evaluation artifact, not an on-chain proof.
- Seeds are public and caller-controlled. Repetition is allowed; neither unpredictable randomness nor a unique sentence on every trade is promised.
- A failed preview must not be treated as a usable quote. The frontend needs the exact selected seed in both the quote and transaction, and must use a gas policy capped by the target chain's actual transaction limit.
- The constructor permits lower inference budgets for local experiments. Any future deployment plan must pin the validated budget and sampler settings explicitly.
- The local tests use an unforked PoolManager and settlement harness. They do not replace a new target-network/router rehearsal of the final hook, nor do they authorize a mainnet deployment or liquidity movement.

The frozen model's cache layout and write-once behavior were also reviewed by the separate model-review worker; no additional blocker was found in that review.
