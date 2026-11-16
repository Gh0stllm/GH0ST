# Isolated native node RPC check

`node dev-rpc/run.mjs` starts the locally built **darwin/arm64** Nitro binary using upstream `--dev` mode, with parent connectivity, batch posting, staking and external feeds disabled. HTTP binds only to loopback. A fresh random key exists only in memory; only its address is passed for a fake genesis balance. The script never loads an existing wallet or connects to a public chain and always shuts down its child node.

The source helper uses the actual pinned Nitro Brotli encoder and `state.NewStylusPrefix` to prepare the exact normalized e153… Wasm artifact. Four locally signed transactions deploy and activate the Stylus contract, deploy a Solidity caller, and call Stylus from Solidity, storing the signed dot product `-31`. All twelve existing ABI cases are also checked through the running node RPC. A12 is probed without model seeding and must revert. Full-model inference is therefore still proven by the separate EVM/ArbOS fixture, not by this dev-node boot.

Prerequisites: completed native node build, exact local Go toolchain, normalized Stylus artifact from the sibling build (or the real-activation reproduction), and the chess project's pinned ethers/solc dependencies. A Linux server image is not produced here. Native cache/data/logs remain ignored.

[evidence/local-dev-rpc-transactions.json](../evidence/local-dev-rpc-transactions.json) records the four actual local receipts and oracle checks. Their gas includes the development chain's L1 poster accounting; it is not a deployed L3 fee quote, a changed gas limit or proof of an ordinary full-LLM transaction. This development chain has no public parent settlement or fraud-proof challenge.
