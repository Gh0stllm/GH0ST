# A14 follower on the GL3 pod

The follower has its own Linux build, genesis files, database, cache and
loopback RPC. It reconstructs GL3 from safe Robinhood batches and checks
the genesis assertion against the deployed rollup. It has no wallet,
transaction forwarding, sequencer,
batch poster, validator or staking role. The production node keeps all
of those responsibilities.

The build reuses the pinned Nitro source, Go 1.25.12 and native libraries
already cached on the pod. It verifies the exact Stockfish WASM SHA-256
before compiling. The upgrade candidate extracts the unchanged UCI move
validator from its pinned source, so the retired A13 engine is outside
the link. The same Stockfish search module, weights and 24M-node policy
remain in the candidate.

`follower_config.py` verifies the receipt-derived chain-info and genesis
digests before creating the isolated profile. The public Robinhood
endpoint served launch logs but returned an unavailable historical-state
error for a contract read at the safe parent head. The follower uses
the verified archive endpoint from a private mode-0600 file with the
same safe read mode. `run_follower.py` starts the
compiled follower on two CPU cores at low CPU and I/O priority, with a
disk, memory and log guard that stops only its own child. This staging
uses container scratch so the follower's database writes are separate
from the production network volume. The follower can be rebuilt and
replayed if the container is replaced.

Compare block hashes and state roots at shared block heights. The
follower reads posted batches at Robinhood's safe frontier and can lag
unposted GL3 blocks. The follower does not select a new proof root or
schedule A14. [Production activation constraints](MAINNET.md)

## Same-pod sync confirmed on 2026-11-18

At 17:20:16 UTC, the follower reached GL3 safe block **20,628** with
`eth_syncing` returning `false`. Its block hash and state root matched
production. The production RPC continued serving block **20,629**, one
block ahead of the safe frontier at that observation.
[Build and replay evidence](follower-evidence-20261118.json)
