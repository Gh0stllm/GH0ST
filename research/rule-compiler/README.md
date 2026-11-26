# GH0ST Rule Compiler

Write the integer rule for an app quote once. Generate a standalone JavaScript module, readable Solidity, its ABI and Robinhood-compatible bytecode. Check every supported input against the generated code before connecting a wallet. The included example is a fee quote, so a developer can use the JavaScript in checkout and the same rule inside a contract.

## First experiment

An item costs 100 cents. Tier 1 pays 95 cents per item, tier 2 pays 90, and every other tier pays 100. Both inputs range from 0 through 255. The output is an unsigned 32-bit integer in cents.

| Robinhood replay | Original rule | Equivalent handwritten rule |
| --- | ---: | ---: |
| Runtime bytes | 364 | 290 |
| Estimated deployment gas | 139,473 | 122,760 |
| Estimated transaction gas for 10 items, tier 1 | 25,019 | 24,865 |
| Returned price for 10 items, tier 1 | 950 cents | 950 cents |

Both versions were compared at Robinhood block 123683233 with the same simulated contract address and identical call inputs. Seven read-only cases passed. The gas estimates include transaction overhead. A frontend can read the quote with eth_call without spending ETH. Neither implementation was broadcast.

A separate local verifier executed each compiled contract for every one of the 65,536 input pairs. The Solidity bytecode, generated JavaScript and integer reference evaluator returned the same 262,144-byte output table in both builds. Its SHA-256 is `c6432c00c4eed7c90b8b750a1ef5ceac548d3247e0878e2d6884e97b3a77f86c`. The verifier rebuilds the artifacts and checks the runtime bytes it executes. The Robinhood report independently identifies the same runtime hashes.

[Original exhaustive check](proof.json) · [Rewritten exhaustive check](example-optimized/proof.json) · [Original Robinhood replay](result.json) · [Rewritten Robinhood replay](example-optimized/result.json)

## Try it

Install the dependencies listed in package.json with Node.js 20 or later, then run from this directory.

```sh
npm install
node compiler.cjs quote.rule
node verify.cjs
node check-rewrite.cjs quote.rule example-optimized/pricing.rule
node compiler.cjs example-optimized/pricing.rule example-optimized
node verify.cjs example-optimized example-optimized/pricing.rule example-optimized/proof.json
npm test
```

Import the generated app function directly.

```js
import { quote } from './quote.mjs'
console.log(quote(10, 1)) // 950 cents
```

For a new rule, pass its source file and a new output directory to compiler.cjs. Pass that directory and the source file to verify.cjs. The included replay.cjs is a read-only benchmark for this specific pricing example and checks the expected business outputs independently.

## Language and scope

The prototype accepts two unsigned byte inputs, qty and tier, integer literals, addition, multiplication, floor division, equality and if/then/else. It checks bounds before generating code. An expression that may divide by zero or overflow an intermediate uint32 is rejected, even when the range checker cannot prove a safe bound for a particular branch. The output artifacts are a pure quote function. Wallet authorization, balances and transfers belong to the consuming app.

## Orbio integration

The optional server-side command sends a parsed rule to Orbio and asks for an equivalent expression. It accepts a proposal for review only after comparing all input pairs. A one-cent change from 90 to 91 for tier 2 is rejected with the counterexample qty=1, tier=2. A separate compile, bytecode check and benchmark establish whether a proposal is correct and cheaper to execute.

```sh
node orbio.cjs quote.rule proposed.json
```

The command reads ORBIO_API_KEY from the environment. Keep it in a secret store. The published candidate was handwritten. The gateway integration was exercised with a simulated response. No funded Orbio request was made for this report.
