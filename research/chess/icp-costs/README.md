# Optional ICP chess cost comparison

This is a cost comparison requested alongside the native Robinhood Solidity
research. It does **not** approve or silently replace that architecture. No public
canister was created, no ICP was converted, and no prize or hosting funds moved.

There are two distinct options:

| Option | Game rules and board | Engine | Assumed result authentication |
|---|---|---|---|
| A | ICP | ICP | One production threshold-ECDSA signature per terminal game authorizes the RH GH0ST escrow payout |
| B | Robinhood Solidity | ICP | One production threshold-ECDSA signature per bot move to authenticate each Solidity update |

Option A matches the earlier protocol direction. Option B keeps the game and
escrow on Robinhood but requires a different production adapter, per-move RH state
verification and per-move RH gas. Another proof/signature scheme would have
different costs. Neither paid implementation is live. The tables separately price
both signature assumptions; they do not cost A while claiming to describe B.

## Actual ICP-to-cycles conversion

An anonymous query to the official CMC canister
`rkp4c-7iaaa-aaaaa-aaaca-cai` returned **1 ICP = 1.6026 XDR = 1.6026 trillion cycles**
for the **2026-11-15 08:24 UTC** rate. The query was verified at 08:28 UTC using
`@icp-sdk/core 6.1.1`: query signatures, the BLS certificate against the SDK-pinned
mainnet root key, the witness root against `certified_data`, and the exact Candid
rate leaf. No network-supplied replacement root key was trusted.

See [rate](cmc-rate.json), [archived certificate/witness](cmc-witness.json), and
[the reproducible read-only verifier](cmc-rate.mjs). The ID and rate semantics come
from the [official system-canister reference](https://docs.internetcomputer.org/references/system-canisters/)
and [CMC Candid source](https://github.com/dfinity/ic/blob/master/rs/nns/cmc/cmc.did).
Requery before an actual funding decision; this saved certificate proves a
historical rate, not a permanent conversion price.

USD illustrations use the supplied **$2.17/ICP** market quote around 08:24 UTC.
The JSON also retains the documentation's illustrative $1.36643/XDR conversion,
which gives slightly different USD numbers. Cycles and the certified ICP
conversion are the primary calculations.

## Measured search costs

The same existing full-network Stockfish 19 continuation artifact was installed
and executed in an isolated local PocketIC 16.1.0 application subnet. Each case was
a fresh Black search after full history `1.e4`, with 128 MiB TT and no strength
limit. Results matched native Stockfish exactly. The 10m result is measured;
it is not a linear extrapolation from 3m.

| Search budget | Actual nodes / completed depth | ICP updates | Sampled instructions | Actual local cycles debited | ICP / approximate USD |
|---|---|---:|---:|---:|---|
| 3m | 3,000,212 / 28 | 30 | 147,201,702,476 | 147,402,396,353 | 0.091977 / $0.19959 |
| 10m | 10,000,460 / 35 | 100 | 488,411,278,349 | 489,080,110,816 | 0.305179 / $0.66224 |

The largest sampled update in either run used **10,361,296,288 instructions**,
below the 40B update ceiling. The cycle debit includes ingress and encoding tails
missed by the in-method instruction sample. The first 3m case differed from the
simple `instructions + 5M × updates` estimate by about 0.034 percent.

[Full local before/after balances and memory evidence](pocketic-costs.json) and
[harness](pocketic-costs.py). Local cycles are fabricated test balances, not ICP
tokens or a public bill. The production queue, retry/upgrade controls, authority
adapter, ledger/RPC work and terminal signing were not executed by this harness.
Other positions, histories and retained-cache policies can cost differently.

Current [official cycle pricing](https://docs.internetcomputer.org/references/cycle-costs/)
lists 1 cycle/instruction plus 5M per update on a 13-node application subnet.
Compute and storage scale by `node_count / 13`. Production `key_1` signing is
**26,153,846,153 cycles** per signature, determined by the key's signing subnet.
That signing fee is about **0.016320 ICP / $0.03541** here and is not multiplied
again when modeling a 34-node game subnet.

## Game-length scenarios, 13-node computation

These repeat the measured opening-search cost per bot decision. They are **not
whole games measured on ICP**, include the stated signature assumption, and
exclude the additional work listed below. Bot decisions are not plies or both
sides' combined moves.

| Bot decisions | A: 3m engine | A: 10m engine | B: 3m engine | B: 10m engine |
|---:|---:|---:|---:|---:|
| 40 | 3.6954 ICP / $8.02 | 12.2235 ICP / $26.52 | $9.40 | $27.91 |
| 60 | 5.5349 ICP / $12.01 | 18.3271 ICP / $39.77 | $14.10 | $41.86 |
| 80 | 7.3745 ICP / $16.00 | 24.4307 ICP / $53.01 | $18.80 | $55.81 |

The six completed native 3m benchmark games available at this cost snapshot had
**17, 37, 46, 94, 97 and 100 bot decisions**, averaging **65.17**. Repeating the
opening cost across those lengths gives:

| Scenario using the observed native turn counts | A: 3m | A: 10m | B: 3m | B: 10m |
|---|---:|---:|---:|---:|
| Per-game mean | $13.04 | $43.19 | $15.31 | $45.46 |
| 100 games at that mean | $1,304 | $4,319 | $1,531 | $4,546 |
| 1,000 games at that mean | $13,042 | $43,191 | $15,314 | $45,464 |

This is a selected native-game length snapshot, not a population forecast. Applying
the 10m search cost to 3m game lengths does not establish what 10m games will cost
or how long they will last. The full [cost report](cost-report.json) records source
game IDs, per-length results, 60-decision volume scenarios and both subnet sizes.

On a **34-node** compute subnet, the analogous 40-decision figures are about
**$20.92 / $69.32** for A at 3m/10m, and **$22.30 / $70.70** for B. At the 65.17
decision length scenario, they become **$34.05 / $112.90** for A and
**$36.33 / $115.18** for B. These are scaled arithmetic, not a run on that subnet.

## Upfront creation and resident memory

Two application canisters cost **1T cycles = 0.623986 ICP / about $1.35** to create
at the listed 13-node rate. This is creation burn only. One engine canister alone
would be half that; the actual number depends on the final game/orchestrator
design. Installation, model chunk upload, freezing/storage reservations and an
operating balance and ledger/top-up transfer fees remain additional. Funding a balance is not the same as burning
all of it immediately.

The local engine install charged 17.593B cycles on the first installation and
0.314B when the same module was already compiled in that local process. Those
figures exclude model upload and are local observations, not a public deployment
quote. The deployment staging store used by the harness is artificial and is
destroyed with the instance; it is not a required third paid canister.

The module is **98.214 MiB**, but its measured warm resident footprint is larger:

| `canister_status` component | Warm bytes |
|---|---:|
| Wasm binary | 102,984,786 |
| Wasm linear memory, including loaded model, TT and work buffers | 467,533,824 |
| Stable memory | 67,174,400 |
| Total `memory_size`, including other overhead | **637,706,660** |

That total is about **608.16 MiB**. A 512 MiB allocation would not fit this warm
prototype. At the listed 13-node storage rate, the measured footprint is about
**0.1220 ICP / $0.265 per 30-day month**; a **1 GiB** storage scenario costs about
**0.2054 ICP / $0.446 per month**. The 34-node 1 GiB scenario is about $1.17/month.
Additional game records and concurrent job state need their own headroom.

These estimates assume **0 percent reserved compute**, using best-effort scheduling
with no latency guarantee. Reserving even 1 percent continuously would separately
cost about **25.92T cycles / 16.17 ICP / $35.10 per 30-day month** on 13 nodes.

## Additional costs and trust boundary

The tables omit production game-authority execution, job scheduling/retries,
ledger/RPC verification, failed or aborted searches, freezing/storage reservation,
deployment upload and future rate changes. Option B additionally needs per-bot-move
RH state verification and Ethereum transactions. Do not treat those omissions as
zero charges or call the totals a complete game bill.

For the current A-style RH escrow, [the separate gas evidence](../gas/README.md)
has a read-only deployment estimate of 1,573,283 gas and canonical 25k GH0ST
approval of 46,355 gas. Local mock-token entry/reservation used 212,615 gas and
checkmate settlement 86,356 gas. These remain payment-overhead references; they
do not price option B's full native board or neural search.

The RH vault authenticates the pinned ICP threshold-ECDSA signer. Solidity does
not independently recompute Stockfish or prove its canister code. Reviewed module
hashes, controllers/upgrades, input/chain bindings, game IDs and exactly-once
receipts remain material trust boundaries before either funded architecture.

## Reproduce without spending

From `research/chess` using the existing pinned dependencies:

```sh
node icp-costs/cmc-rate.mjs
engine/.cache/venv/bin/python icp-costs/pocketic-costs.py
node icp-costs/calculate.mjs
```

The CMC command is anonymous and query-only; the harness starts and stops its own
local server with fake cycles and never reads a deployment identity. The calculator
uses the saved certified conversion, explicit [pricing inputs](pricing.json),
existing search evidence and the current completed native-game snapshots. Regenerate
JSON for updated inputs; the explanatory figures above describe this saved run.
