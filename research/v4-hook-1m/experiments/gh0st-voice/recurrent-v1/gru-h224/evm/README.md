# GRU H224 local arithmetic and gas fixture

The frozen two-update training checkpoint passed **4/4 actual local v4 swaps**,
each emitting one nonempty word. Maximum whole-swap gas was **22,283,959**;
mean22,076,883; minimum22,000,980. The model constructor used5,585,371gas and
the runtime is5200bytes. These results establish implementation feasibility,
not language quality. Its output was `can the have first`.

The independent Q10 reference matched every generated token, all224 signed
hidden values and all13 visited decoder scores. It recomputes the original
input-matrix/embedding dot product rather than reading the fused input table.
Every fixture step additionally compared input and recurrent dot products with
explicit scalar Python sums. The trajectory exercised391 negative hidden
values. A separate export check recovered all5,505,696 derived input values
exactly. There were no public-chain transactions.

The test also passed rollback after inference, low-gas rejection, malformed and
stale requests, changed model runtime rejection, unauthorized callback rejection
and pool isolation. Each successful swap emitted a word; failures reverted.
The four-word fixture selected no natural terminator, so it does not separately
demonstrate a GRU transition across one. The hook keeps state at punctuation by
the same unconditional persistence logic used in the earlier recurrent hook.

## Fixed-point convention

All source weights are signed-int16 Q10, rounded nearest-even on export with
overflow rejection. Gate order is `(r,z,n)`. There is one input bias and no
recurrent bias. Hidden values are signed Q10 in[-1024,1024].

With `Q=1024`, signed division always truncates toward zero:

```text
folded[token] = Wx @ embedding[token] + bh * Q  (exact signed Q20)
X = trunc((folded[token] + Wf @ features) / Q)
R = trunc((Wh @ hidden) / Q)
r = S(Xr + Rr)
z = S(Xz + Rz)
n = 2*S(2*(Xn + trunc(r*Rn/Q))) - Q
hidden' = trunc((z*hidden + (Q-z)*n) / Q)
```

`S` uses the existing257-entry positive sigmoid-delta table. The absolute Q10
input is rounded to the nearest1/16, clamped to table index256. The Q16
probability is converted to Q10 with `(probability+32)//64`. The output word
uses the learned13-level tree and the same configurable Q10-temperature
Bernoulli sampler as the recurrent prototype.

## Resident image

The source model has3,983,967 learned parameters. It retains its original
embedding, input matrix and input bias as **off-chain reference files only**.
On-chain data consists of309120bytes of recurrent/feature weights,
3685950bytes of decoder weights,262144bytes of vocabulary and27528480bytes of
derived signed40 input rows. Derived values are not independent learned
parameters.

The1326 data shards are located through four STOP-prefixed packed-address
catalogs. Constructor validation reads every target's code length and code
hash, avoiding thousands of storage writes for address arrays. Catalog and data
runtime installation was simulated with `hardhat_setCode`; their deployment
cost is excluded. Only the model, hook, PoolManager, router and test-token
deployment transactions are measured. The model and hook constructors enforce
local chain31337.

Evidence is in `gru-smoke-local.json`, `gru-smoke-reference.json` and
`gru-smoke-summary.json`. These preserve the two-step checkpoint's SHA256 and
the complete runtime commitments. A trained checkpoint still requires its own
quality evaluation, export checks and local gas/parity test.
