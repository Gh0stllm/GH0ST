// Experimental full-model Nitro precompile. Register only through debugOnly.
// The bounded runtime is pinned, but computation gas is not production priced.
package precompiles

import (
	"crypto/sha256"

	bridge "github.com/Gh0stllm/GH0ST/l3/bridge"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/arbitrum/multigas"
	"github.com/ethereum/go-ethereum/common"
	"github.com/offchainlabs/nitro/arbos/storage"
)

const GhostLLMABI = `[
 {"name":"start","type":"function","stateMutability":"nonpayable","inputs":[{"name":"job","type":"bytes32"},{"name":"token","type":"uint32"}],"outputs":[{"name":"generation","type":"uint64"},{"name":"kernelStep","type":"uint32"},{"name":"phase","type":"uint32"},{"name":"position","type":"uint32"},{"name":"bestToken","type":"uint32"},{"name":"checkpointSHA","type":"bytes32"},{"name":"done","type":"bool"}]},
 {"name":"advance","type":"function","stateMutability":"nonpayable","inputs":[{"name":"job","type":"bytes32"},{"name":"expectedGeneration","type":"uint64"},{"name":"rows","type":"uint32"},{"name":"chunks","type":"uint32"}],"outputs":[{"name":"generation","type":"uint64"},{"name":"kernelStep","type":"uint32"},{"name":"phase","type":"uint32"},{"name":"position","type":"uint32"},{"name":"bestToken","type":"uint32"},{"name":"checkpointSHA","type":"bytes32"},{"name":"done","type":"bool"}]},
 {"name":"append","type":"function","stateMutability":"nonpayable","inputs":[{"name":"job","type":"bytes32"},{"name":"expectedGeneration","type":"uint64"},{"name":"token","type":"uint32"}],"outputs":[{"name":"generation","type":"uint64"},{"name":"kernelStep","type":"uint32"},{"name":"phase","type":"uint32"},{"name":"position","type":"uint32"},{"name":"bestToken","type":"uint32"},{"name":"checkpointSHA","type":"bytes32"},{"name":"done","type":"bool"}]},
 {"name":"inspect","type":"function","stateMutability":"view","inputs":[{"name":"job","type":"bytes32"}],"outputs":[{"name":"generation","type":"uint64"},{"name":"kernelStep","type":"uint32"},{"name":"phase","type":"uint32"},{"name":"position","type":"uint32"},{"name":"bestToken","type":"uint32"},{"name":"checkpointSHA","type":"bytes32"},{"name":"done","type":"bool"}]},
 {"name":"logitsHash","type":"function","stateMutability":"view","inputs":[{"name":"job","type":"bytes32"}],"outputs":[{"name":"sha256I32LE","type":"bytes32"}]}
]`

type ArbGhostLLM struct {
	Address addr
	// Protocol-irrelevant local execution policy. Never persisted or ABI-visible.
	backend bridge.Backend
}

func makeGhostLLMPrecompile() (addr, *Precompile) {
	return makeGhostLLMPrecompileWithBackend(bridge.Interpreter)
}

func makeGhostLLMPrecompileWithBackend(backend bridge.Backend) (addr, *Precompile) {
	return MakePrecompile(&bind.MetaData{ABI: GhostLLMABI}, &ArbGhostLLM{
		Address: common.HexToAddress("0x0000000000000000000000000000000000000a12"), backend: backend,
	})
}

type ghostLLMPrecompileWords struct{ backing *storage.Storage }

func (s ghostLLMPrecompileWords) Get(key bridge.Word) (bridge.Word, error) {
	v, err := s.backing.Get(common.Hash(key))
	return bridge.Word(v), err
}

func (s ghostLLMPrecompileWords) Apply(writes []bridge.WordWrite) error {
	// Enclosing EVM CALL snapshot is the atomic boundary, including failures in
	// return-data metering after a method succeeds. Never swallow Set errors.
	for _, w := range writes {
		if err := s.backing.Set(common.Hash(w.Key), common.Hash(w.Value)); err != nil {
			return err
		}
	}
	return nil
}

func ghostLLMPrecompileStore(backing *storage.Storage) bridge.WordAdapter {
	// A new cache belongs to exactly this call/setup. Discard it before any
	// external state change or snapshot rollback; never retain it globally.
	words := ghostLLMPrecompileWords{backing.OpenSubStorage([]byte("GH0ST_LLM_V1"))}
	return bridge.WordAdapter{Words: bridge.NewDirtyWordStore(words)}
}

func ghostLLMModelConfig(backing *storage.Storage) *storage.Storage {
	return backing.OpenSubStorage([]byte("GH0ST_LLM_CONFIG_V1"))
}

func ghostLLMExpectedModelID() bytes32 {
	payload := append([]byte("GH0ST_LLM_FIXED_V1"), bridge.RuntimeSHA256[:]...)
	payload = append(payload, bridge.WeightsSHA256[:]...)
	return sha256.Sum256(payload)
}

// SeedGhostLLMGenesis is a trusted chain-initialization hook, not an EVM method.
// Inputs must be supplied as authenticated genesis data, never read from files
// by the STF. Register hashes every code/data byte before storing anything. The
// genesis caller must revert its StateDB snapshot if this function returns an
// error, just as an ordinary EVM CALL reverts a failed precompile operation.
func SeedGhostLLMGenesis(backing *storage.Storage, module, weights []byte) (bytes32, error) {
	config := ghostLLMModelConfig(backing)
	old, err := config.Get(common.Hash{})
	if err != nil {
		return bytes32{}, err
	}
	want := ghostLLMExpectedModelID()
	if old != (common.Hash{}) && old != common.Hash(want) {
		return bytes32{}, bridge.ErrIntegrity
	}
	id, err := bridge.Register(ghostLLMPrecompileStore(backing), module, weights)
	if err != nil {
		return bytes32{}, err
	}
	if id != want {
		return bytes32{}, bridge.ErrIntegrity
	}
	if err = config.Set(common.Hash{}, common.Hash(id)); err != nil {
		return bytes32{}, err
	}
	return id, nil
}

func (con ArbGhostLLM) engine(c ctx) (*bridge.Engine, bridge.Store, error) {
	backing := c.State.BackingStorage()
	id, err := ghostLLMModelConfig(backing).Get(common.Hash{})
	if err != nil {
		return nil, nil, err
	}
	if id == (common.Hash{}) {
		return nil, nil, bridge.ErrMissing
	}
	if id != common.Hash(ghostLLMExpectedModelID()) {
		return nil, nil, bridge.ErrIntegrity
	}
	s := ghostLLMPrecompileStore(backing)
	e, err := bridge.NewWithBackend(s, bridge.Hash(id), con.backend)
	return e, s, err
}

func ghostLLMProgress(p bridge.Progress, err error) (uint64, uint32, uint32, uint32, uint32, bytes32, bool, error) {
	return p.Generation, p.KernelStep, p.Phase, p.Position, p.BestToken, p.CheckpointSHA, p.Done, err
}

func (con ArbGhostLLM) Start(c ctx, evm mech, job bytes32, token uint32) (uint64, uint32, uint32, uint32, uint32, bytes32, bool, error) {
	if token >= bridge.Vocabulary {
		return ghostLLMProgress(bridge.Progress{}, bridge.ErrInvalid)
	}
	// Debug-only deterministic floor. ArbOS meters all actual storage too.
	// This does not price interpreter instructions or establish safe mainnet fees.
	if err := c.Burn(multigas.ResourceKindComputation, 100); err != nil {
		return ghostLLMProgress(bridge.Progress{}, err)
	}
	e, s, err := con.engine(c)
	if err != nil {
		return ghostLLMProgress(bridge.Progress{}, err)
	}
	defer e.Close()
	return ghostLLMProgress(e.Begin(s, bridge.Owner(c.caller), job, token))
}

func (con ArbGhostLLM) Advance(c ctx, evm mech, job bytes32, generation uint64, rows, chunks uint32) (uint64, uint32, uint32, uint32, uint32, bytes32, bool, error) {
	if rows == 0 || rows > bridge.MaxRows || chunks == 0 || chunks > bridge.MaxChunksPerCommit {
		return ghostLLMProgress(bridge.Progress{}, bridge.ErrInvalid)
	}
	if err := c.Burn(multigas.ResourceKindComputation, 100+uint64(rows)*uint64(chunks)); err != nil {
		return ghostLLMProgress(bridge.Progress{}, err)
	}
	e, s, err := con.engine(c)
	if err != nil {
		return ghostLLMProgress(bridge.Progress{}, err)
	}
	defer e.Close()
	return ghostLLMProgress(e.Advance(s, bridge.Owner(c.caller), job, generation, rows, chunks))
}

func (con ArbGhostLLM) Append(c ctx, evm mech, job bytes32, generation uint64, token uint32) (uint64, uint32, uint32, uint32, uint32, bytes32, bool, error) {
	if token >= bridge.Vocabulary {
		return ghostLLMProgress(bridge.Progress{}, bridge.ErrInvalid)
	}
	if err := c.Burn(multigas.ResourceKindComputation, 100); err != nil {
		return ghostLLMProgress(bridge.Progress{}, err)
	}
	e, s, err := con.engine(c)
	if err != nil {
		return ghostLLMProgress(bridge.Progress{}, err)
	}
	defer e.Close()
	return ghostLLMProgress(e.Append(s, bridge.Owner(c.caller), job, generation, token))
}

func (con ArbGhostLLM) Inspect(c ctx, evm mech, job bytes32) (uint64, uint32, uint32, uint32, uint32, bytes32, bool, error) {
	e, s, err := con.engine(c)
	if err != nil {
		return ghostLLMProgress(bridge.Progress{}, err)
	}
	defer e.Close()
	return ghostLLMProgress(e.Inspect(s, bridge.Owner(c.caller), job))
}

func (con ArbGhostLLM) LogitsHash(c ctx, evm mech, job bytes32) (bytes32, error) {
	e, s, err := con.engine(c)
	if err != nil {
		return bytes32{}, err
	}
	defer e.Close()
	logits, err := e.Logits(s, bridge.Owner(c.caller), job)
	if err != nil {
		return bytes32{}, err
	}
	return sha256.Sum256(logits), nil
}
