# GH0ST Watch on ICP

[Open the RH contract scanner](https://ggcey-baaaa-aaaao-bbsgq-cai.icp0.io/). Paste a Robinhood Chain mainnet or testnet address, select the network and choose **Analyze**. The **Try an example** button opens a real contract. Share the resulting URL to scan that address again at a new block.

The browser pins RH RPC reads to one block and checks its hash again before presenting results. ICP disassembles the deployed runtime and returns its fingerprint. Standard implementation slots, beacon proxies and common minimal proxies are resolved when possible. Explorer ABI metadata is used only when its deployed bytecode matches. Token and ownership fields come from getters at the pinned block.

Compatible mint and burn calls run through an ephemeral probe in an RH eth_call. Other compatible recipes run through the ICP fresh-deployment checker when matching verified creation input is available. Reports distinguish these evidence sources and explain untested rules. The frontend uses read-only RH calls. An anonymous ICP summary request sends six outcome codes to the dedicated checker. Qwen can generate a short note under a constrained grammar. The canister validates the complete sentence and caches it by outcome pattern. A scan can always display precomputed Qwen coverage wording alongside the exact observations and grouped reasons for untested checks. The wording source is shown in the interface. Public generation is limited to two attempts per UTC day, one at a time, with a cooldown and a backend balance check above its freezing reserve. The original arbitrary-contract interpret method remains controller-only.

When the explorer indexes the creation, the report links the RH creation receipt, distinguishes the transaction sender from the creating account and displays earlier direct and internal creations from bounded history. Factory history is shown separately from wallet-attributed deployments. For ERC-20 interfaces the scanner reads holder counts, the listed top accounts' share and the sender's token balance. Launch-block Transfer logs show distribution across transactions and recipients. Private bundle membership and common ownership remain unknown. These features use the RH RPC and Blockscout; no GMGN account is required.

GH0ST Watch runs six EVM simulations inside an ICP canister. The hosted release accepts compiled Solidity creation bytecode and executes the selected check against a fresh deployment. All 25 research contracts were queried over ICP. The suite reproduced the expected behavior on 12 examples and found no reproduction on 13 controls. These are authored tests with the target family supplied. [Live query results](suite-results.json).

Select **check_contract** and choose a recipe. Use the constructor-free fixture bytecode for Replay and TokenReturn because those recipes append their own signer or token constructor argument. The other recipes accept creation bytecode including any necessary constructor arguments.

| Recipe | Supported target and observation |
|---|---|
| Mint | Calls mint(address,uint256) from an ordinary account. Choose balanceOf(address) or balance(address). Verifies a deployer control. |
| Authorization | Deploys the treasury with 100 wei. The owner pays directly, then pays through an intermediary. Compares recipient ETH balances. |
| Withdraw | Seeds a second depositor, then reenters either withdraw() or withdraw(uint256) once. Compares the attacker's seven-wei deposit with total receipts. |
| Replay | Redeems the same signed coupon twice. Requires the exact research signing domain, redeem(uint256,uint8,bytes32,bytes32) and points(address). |
| TokenReturn | Supplies a token that can return false. Reads credit(address) or a caller-supplied Solidity address-to-uint mapping slot, then verifies a successful transfer control. |
| Underflow | Burns one unit from an account whose balance(address) getter returns zero. Checks for a wrap to the maximum uint256. |

Results describe the selected call path and test state. Contracts with different ABIs, proxy wiring, role setup or signature domains require adapted recipes. A negative result covers only the executed input.

[Open the dedicated checker on ICP mainnet](https://a4gq6-oaaaa-aaaab-qaa4q-cai.raw.icp0.io/?id=ggcey-baaaa-aaaao-bbsgq-cai). Select **Query** under **demo** for the mint pair or **check_contract** for a selected rule. All 25 cases were rerun against this dedicated canister. [Dedicated checker results](mainnet-suite-results.json).

| ICP demo | Ordinary mint | Ordinary balance | Deployer control |
|---|---|---|---|
| Open mint | Succeeded | 0 to 7 | 0 to 7 |
| Protected mint | Reverted | 0 to 0 | 0 to 7 |

To check compatible code, open **check_mint**, paste hexadecimal EVM creation bytecode into the first field and choose the balance getter with the second field. Use true for `balanceOf(address)` or false for `balance(address)`. The target must expose `mint(address,uint256)`. Constructor arguments, if required, must already be ABI-encoded after the creation bytecode. The simulation uses Shanghai rules, an isolated empty chain, zero deployment value, a 12 KiB input limit and an 800,000 EVM gas limit per simulated transaction. The two [open](open.hex) and [protected](protected.hex) examples use the false setting.

The reported balances come from the contract's getter. Interpret a successful mint against the protocol's intended mint policy. A reverted call describes that account and input. Missing getters, failed deployments and unsuccessful deployer controls produce an error. Public checks return simulation evidence. An optional controller-only update called interpret accepts a rule, creation bytecode and the dedicated Qwen canister principal. It reruns the test on ICP and sends only the resulting observations to the model. The result preserves both the execution evidence and whether the one-token answer agreed, abstained or failed validation. The dedicated Qwen backend returned yes on the open mint and no on the protected mint. See [verified mainnet results and remaining inference headroom](MAINNET.md). See [full deployment budget](FULL-DEPLOYMENT.md).

## Build and verify

The hosted preview runs without any software installation for the caller. To reproduce the canister artifact, use Rust with the wasm32-unknown-unknown target and the committed Cargo.lock. The preview was built with Rust 1.99.1, revm 19.7.0 and dfx 0.32.0. The two hex files are Solidity 0.8.24 Shanghai creation bytecode for the existing mint fixtures in [the research dataset](../audit-improvement-results.json), compiled as Mint.sol with the optimizer disabled.

```sh
sh build.sh
cargo test --locked --lib
dfx deploy watch_checker --playground
dfx canister --network playground call watch_checker demo '()'
```

The playground reservation is temporary. A persistent deployment needs a dedicated funded ICP canister. Operating costs depend on its subnet, memory and workload.
