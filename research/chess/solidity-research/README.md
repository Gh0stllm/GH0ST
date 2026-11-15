# Native Solidity feasibility: exact Stockfish components

This is measured component research for the user's Robinhood-native Solidity
requirement. **There is no complete Stockfish search engine in Solidity here.**
The ICP engine's correctness/strength evidence cannot establish a Solidity engine's
strength or gas. No public deployment, wallet, token allowance or funding is used
by these scripts.

## Actual model, dimensions and bytes

The source is pinned Stockfish19 commit
`edb0d9db6731067ec50ce619ff372b463bc4dd5d`, with full network SHA256
`1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2`.
The official NNUE file is **98,511,183 bytes**, but it uses signed LEB128
compression. Its ordinary decoded fixed-width parameters occupy
**115,114,528 bytes**, excluding any contract/catalog headers.

| Parameter family | Fixed-width bytes |
|---|---:|
| 59,808 threat and 4,560 pawn-pair features ×1024 int8 | 65,912,832 |
| 22,528 piece-square features ×1024 int16 | 46,137,344 |
| 86,896 features ×8 PSQT int32 | 2,780,672 |
| 1024 transformer bias int16 | 2,048 |
| Eight dense layer stacks | 281,632 |

`prepare.py` validates the pinned file hash, every compressed block's decoded
element count, all eight layer stacks and exact EOF. It counts decoded zero/nonzero
bytes without placing the large model in Git. See [network-layout.json](network-layout.json).
PSQ int16 weights range from −1,870 to3,245, so losslessly replacing all of them
with int8 is not valid. The decoded layout has19,556,239 zero bytes and95,558,289
nonzero bytes.

The code-deposit charge alone would be19,702,236,600gas for the compressed file,
or23,022,905,600gas for the decoded parameter bytes, before STOP prefixes, creation,
intrinsic calldata, indexes, engine code or data-availability charges. These are
byte-based components, not deployment quotes. The sibling RH-gas research checks
actual chain limits/rates and shard creation separately.

## Dense component implemented and independently checked

[NnueKernel.sol](NnueKernel.sol) executes the full dense architecture after feature
transformation:1024→32, squared/clipped branches at shift7,64→32,
squared/clipped branches at shift6,128→1, skip term `fc0[30]-fc0[31]`,
and final×9600/16384 truncation. It uses actual pretrained weights for the selected
material bucket. It does not substitute a smaller neural network.

[reference.cpp](reference.cpp) calls the upstream scalar
`NetworkArchitecture::read_parameters` and `propagate` directly. Fifteen synthetic
transformed-input cases across buckets0,3,7 match it exactly for both Solidity
implementations. Zero, sparse, half-sparse, dense and maximum inputs exercise the
activation and sign paths. These are component fixtures, not chess positions.

The scalar stack stores35,204 parameter bytes. The packed representation stores
the same weights in94,820 bytes, suitable for one96KiB-code-limit data shard
with one STOP prefix. Packed words use12 lanes at20-bit spacing. Offset each
signed int8 weight by128 and reverse its polynomial order; the middle coefficient
of an EVM256-bit multiply is the unsigned dot product. Each coefficient is at most
12×255×255=780,300, less than2^20, so lower coefficients cannot carry into the
selected lane. Subtract128×the input sum to recover the signed dot product.
Higher discarded product bits do not affect the selected lower240bits.

The packed 15-case suite reduced dense-vector execution from approximately4.73–4.81M
gas to0.783Mgas per standalone evaluation transaction. For the203-nonzero fixture
it uses approximately0.772Mgas versus1.23–1.28Mscalar. Exact receipts are in
[gas-results.json](gas-results.json), including deployment gas and source/compiler
identity. Ganache's code/init limits are relaxed solely to model Robinhood's larger
limits; opcode charging is Shanghai EVM. No mainnet transaction occurred.

## Accumulator component

The same contract file tests one1024-lane int16 update using actual transformer
biases and four actual PSQ weight rows. It preserves wrapping int16 arithmetic.
The word implementation performs16 independent lanes per256-bit operation, with
separate low15-bit sums and sign-bit corrections so carries cannot cross lanes.

Eight full-row addition/subtraction fixtures match the scalar reference. Sixty-four
additional edge/pattern word cases cover sign flips, wraparound and neighboring
lane canaries. Sample add:202,648→44,356gas; subtract:229,284→45,264gas.
The main suite records **60 actual local transaction receipts**, in addition to
the pure word checks. This is one feature-row update, not a whole accumulator
refresh or position evaluation; threat/PSQT/king-dependent bookkeeping is absent.

## Actual search invocation counts and real transformed vectors

`instrument.py` copies the upstream optimized source/build into its own ignored
directory. The shared match engine and its objects are untouched. It adds counters,
captures every100,000th transformed vector, and joins the worker before reading
counters. `count-search.py` runs fresh one-thread,128MiB-hash, full-skill,
TT/history-cleared searches before/after instrumentation.

Both complete the Black response after `1.e4` as `e7e5`,3,000,212nodes,
depth28. That search calls the full dense stack **1,576,430times**.
Accumulator function counts are also recorded; they count functions, not individual
1024-lane feature rows. They must not be multiplied by one-row kernel gas as if
they were row counts. [Exact profile](search-counters.json).

Sixteen real transformed vectors from that search, in buckets5/6/7, are captured in
[position-vectors.json](position-vectors.json). Their optimized native output matches
the upstream scalar C++ output and Solidity output exactly. The standalone packed
EVM receipts use702,424–742,525gas for those actual vectors; the replay adds22local
receipts. [Actual-vector gas](position-gas-results.json).

Multiplying the measured invocation count by that sampled standalone component
range gives approximately1.107–1.171trilliongas. This is a **conditional component
scenario**, not a measured move cost or a proven lower/upper bound. Sixteen sampled
vectors do not establish the distribution across all1.576million calls. Shared
batching, cached weights, calldata and checkpoints change costs. Board features,
PSQT, legality, alpha-beta search, move ordering, transposition storage and job
continuation remain excluded.

The conversion formula is `scenarioGas × observedGasPriceWei / 1e18` ETH.
At an illustrative20,060,000wei/gas, that component scenario is approximately
22.21–23.48ETH for this one3m-node native reference decision. This does not include
the excluded engine components, nor does it prove that standalone per-evaluation
charging is how a future batched Solidity engine would execute. A40-decision game
must not be advertised as an actually measured bill by multiplying this sample.

## V2 experiment: retained as a negative result

[NnueKernelV2.sol](NnueKernelV2.sol) precomputes input groups, moves the output
accumulator onto the stack, and subtracts the128×total-input offset once per output
row. It preserves all31 prior dense results:15synthetic and16real search vectors.
It uses the same model bytes and full dense architecture.

This candidate reduces the dense synthetic fixture by3.68%, but the16actual search
samples average727,934gas versus the baseline724,382gas, approximately0.49% worse.
The zero fixture is also substantially worse because the output-major loop revisits
zero groups. The baseline remains the preferred measured implementation; V2 is not
presented as a successful optimisation. [V2 comparison](gas-v2-results.json).

The V2 run adds41actual local receipts. Across the main component suite, real-vector
replay and V2 comparison, **123local EVM transaction receipts** were recorded, with
all declared result comparisons passing. No public-chain receipt is claimed.

## Reproduce locally

From `research/chess`, install the pinned parent dependencies with `npm ci` and
prepare the parent engine's pinned Stockfish source/net. Then from this directory:

```sh
python3 prepare.py
/usr/bin/clang++ -std=c++17 -O2 -DNDEBUG -I../engine/.cache/Stockfish/src reference.cpp -o .cache/dense-reference
node benchmark.mjs
python3 instrument.py
python3 count-search.py
node benchmark-positions.mjs
node benchmark-v2.mjs
```

The native instrumentation build currently targets AppleSilicon with the official
`ARCH=apple-silicon COMP=clang` recipe and at most two compiler jobs. Its destination
must be fresh so source patches cannot apply twice. All binaries, raw model rows
and copied objects stay under `.cache/` or `build/`, both ignored.

## Scope and remaining native work

The measurable pieces here do not implement full Stockfish in Solidity. Native
board feature extraction and threat/pawn-pair/PSQT updates, exact legal rules,
search heuristics, search-stack persistence, transposition tables, cancellation,
retry/queue policy and prize integration need separate implementation and validation.
There is consequently **no measured native full-game deployment or playing gas**
to quote from this code. The native full-game strength matches belong to the
existing SF19 reference configuration, not to these component contracts.

Primary source: [pinned architecture](https://github.com/official-stockfish/Stockfish/blob/edb0d9db6731067ec50ce619ff372b463bc4dd5d/src/nnue/nnue_architecture.h),
[transformer](https://github.com/official-stockfish/Stockfish/blob/edb0d9db6731067ec50ce619ff372b463bc4dd5d/src/nnue/nnue_feature_transformer.h),
[network evaluation](https://github.com/official-stockfish/Stockfish/blob/edb0d9db6731067ec50ce619ff372b463bc4dd5d/src/nnue/network.cpp).
License: GPL-3.0-or-later; upstream notices and complete license are retained in
the sibling [engine package](../engine/LICENSE-STOCKFISH-GPL3.txt).
