# Transport and trust boundary

The production-facing adapter inherits the official LayerZero V2 `OApp` from the workspace's pinned bridge dependencies. It does not inherit OFT or change any token. The planned directed route is Robinhood embedding → BNB blocks 0–3 → Monad blocks 4–7 → Arc blocks 8–11 and vocabulary head → Robinhood result. Each router and its engine serve one immutable session and model identity. The model embedding table is duplicated on Robinhood and Arc.

The router accepts an ordered array of 2–8 distinct endpoint IDs, with one immutable `routeLength` and stage index. Stage 0 performs embedding only; the final stage performs the output head. Intermediate engines accept contiguous transformer ranges; the first compute stage must start at block 0 and the final stage must end at block 12. Before sealing, deployment tooling must hash the complete ordered network and range manifest into `routeId` and check that adjacent ranges match with no missing or repeated layer. The individual router cannot query or certify the full range coverage across independent chains. The default four-stage manifest is recorded in `config/chains.json`.

An activation packet contains 3,072 bytes: one width-768 residual vector packed as signed int32, big endian. The packet uses `abi.encode(Packet)` with the field order defined in `GPT2InferenceOApp.sol`; the complete activation message is 3,488 bytes and the result message is 416 bytes. KV caches remain on the chain that owns their transformer layers. No KV cache is sent cross-chain.

`lzReceive` inherits the official endpoint and peer authentication. The adapter additionally checks the previous route stage, immutable identities, exact canonical ABI encoding, message kind, exact activation length, input token, expected position and session deadline. A logical position may have only one pending/active activation, and completed positions cannot be replayed even with a fresh GUID. GUIDs are also recorded individually. Peers can be set only to the two neighboring EVM addresses and become immutable after `sealRoute`. The administrator binds an engine once; the adapter checks its controller, model identity, fresh state and exact stage roles.

Receipt records metadata and an activation hash, then emits the complete packet. A permissionless `activate(hidden)` transaction supplies those public bytes and succeeds only when the exact hash matches. It starts the local deterministic engine; it does not accept supplied neural-network outputs. The engine then advances through bounded transactions. Only a boundary/completed engine can expose an outbound packet. `dispatch()` generates the message from engine state, fixes the next route destination and sends it through LayerZero. No caller can replace its payload or reduce the fixed receive option of 500,000 gas. Failed sends revert all local state changes. Destination receipt contains no model math.

This separates transport recovery from model execution: a relayer can retry an authenticated receipt or resume permissionless computation without creating another inference. A session allows at most 1,024 sequential positions. At Robinhood, final delivery must match the active, already dispatched position and input token; it records the final token and emits `ResultFinalized` before the next token can begin. No global LayerZero ordering is requested: the adapter enforces its own sequential session progression.

The endpoint security configuration remains an administrative trust boundary even after application peers are sealed. Two-step ownership acceptance moves the endpoint configuration delegate with ownership; ownership renunciation is disabled. A production operator must review DVNs, confirmation counts, libraries and executors, and verify deployed engine/router bytecode. Model IDs, root hashes and interface getters alone do not certify the deployed weights or implementation: before sealing, verify every assigned weight shard and manifest against the canonical artifacts, as well as complete layer coverage. The adapter has no cancellation/replacement path: expiration ends the session and a new session needs new contracts.

## Local transport is deliberately simulated

`MockEndpoint` is named and documented as a test-only adapter. It emits and stores an inspectable asynchronous packet queue. A local harness copies its exact queued bytes to another independent EVM node using `deliver(srcEid,sender,nonce,guid,receiver,message)`. Anyone can call this function and invent its claimed origin. It only checks duplicate GUIDs per receiver and performs the receiver callback. It provides **no DVN verification, source-chain proof, finality guarantee, production fee quote or live LayerZero delivery**. The default simulated messaging fee is zero; local source and destination transaction gas remains measurable. `MockGPT2Shard` fabricates math only for transport tests and is excluded from the full-model benchmark.

## Production preflight and cost limits

`config/chains.json` records public LayerZero deployment metadata read on 25 October 2026. These addresses are configuration candidates, not evidence of GH0ST deployment or working pathways. Before production use, check current endpoint code, endpoint IDs, both libraries, DVN support and configuration, executor limits, confirmations, callback gas and fee quotes for **each directed application pathway**. Never infer support from an address alone. The existing workspace's separate RH↔Arc research observed DeadDVN defaults and a 10,000-byte message limit; those observations must not be copied as assumptions about the new four-chain route.

Arc is explicitly **mainnet chain ID 5042 / LayerZero EID 30417** here. Arc testnet uses chain ID 5042002 and is not interchangeable. Arc's official chain documentation specifies 18 decimals for native USDC transaction values; the LayerZero metadata's generic USDC decimals field is 6 and must not be used for native fee arithmetic. Current LayerZero metadata marks Arc's former LayerZero Labs DVN `0x282b3386571f7f794450d5789911a9804fa346b4` deprecated; the configuration records its current non-deprecated candidate instead.

Quote the exact `outboundPacket()` bytes with the exact `fixedOptions()`. Every hop adds source execution, verification and destination execution costs. A commitment avoids storing the full activation in the router; it does not make sending those bytes free. Measure weight deployment, duplicated embeddings, all inference transactions, activation imports/exports, all three activation messages and the final-result message before claiming lower per-inference cost. Local mock transport cannot establish production messaging fees or latency.

Official references:

- [LayerZero network metadata](https://metadata.layerzero-api.com/v1/metadata)
- [Robinhood deployments](https://docs.layerzero.network/v2/deployments/chains/robinhood)
- [BNB deployments](https://docs.layerzero.network/v2/deployments/chains/bsc)
- [Monad deployments](https://docs.layerzero.network/v2/deployments/chains/monad)
- [Arc deployments](https://docs.layerzero.network/v2/deployments/chains/arc)
- [Arc mainnet and testnet chain configuration](https://docs.arc.io/arc/references/connect-to-arc)
- [Endpoint and library roles](https://docs.layerzero.network/v2/developers/evm/technical-reference/endpoints)
- [Message execution options](https://docs.layerzero.network/v2/developers/evm/configuration/options)
- [Message design patterns and ordering](https://docs.layerzero.network/v2/developers/evm/oapp/message-design-patterns)
