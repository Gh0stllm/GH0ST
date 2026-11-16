// GH0ST experimental custom-precompile overlay for Nitro v3.12.2.
// Not registered by stock Nitro. No full-LLM or fraud-proof integration is claimed.
package precompiles

import (
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/arbitrum/multigas"
	"github.com/ethereum/go-ethereum/common"
	tensor "github.com/offchainlabs/nitro/arbos/gh0stllm"
	"github.com/offchainlabs/nitro/arbos/storage"
)

const GhostTensorABI = `[
 {"name":"registerModel","type":"function","stateMutability":"nonpayable","inputs":[{"name":"weights","type":"bytes"}],"outputs":[{"name":"root","type":"bytes32"}]},
 {"name":"begin","type":"function","stateMutability":"nonpayable","inputs":[{"name":"job","type":"bytes32"},{"name":"model","type":"bytes32"},{"name":"input","type":"bytes"}],"outputs":[]},
 {"name":"step","type":"function","stateMutability":"nonpayable","inputs":[{"name":"job","type":"bytes32"},{"name":"maxMacs","type":"uint32"}],"outputs":[{"name":"done","type":"bool"},{"name":"sum","type":"int64"},{"name":"cursor","type":"uint32"}]},
 {"name":"result","type":"function","stateMutability":"view","inputs":[{"name":"job","type":"bytes32"}],"outputs":[{"name":"done","type":"bool"},{"name":"sum","type":"int64"},{"name":"cursor","type":"uint32"}]}
]`

type ArbGhostTensor struct{ Address addr }

// Proposed only; registration/version/genesis/prover changes are deliberately
// absent until a real local replay and wrong-result challenge pass.
func makeGhostTensorPrecompile() (addr, *Precompile) {
	return MakePrecompile(&bind.MetaData{ABI: GhostTensorABI}, &ArbGhostTensor{Address: common.HexToAddress("0x0000000000000000000000000000000000000a11")})
}

type ghostTensorStore struct{ backing *storage.Storage }

func (s ghostTensorStore) Get(k tensor.Word) (tensor.Word, error) {
	v, e := s.backing.Get(common.Hash(k))
	return tensor.Word(v), e
}
func (s ghostTensorStore) Apply(writes []tensor.Write) error {
	// Set meters each storage write and rejects readonly access. If any write
	// fails, the returned error must propagate so the enclosing EVM CALL reverts.
	for _, w := range writes {
		if err := s.backing.Set(common.Hash(w.Key), common.Hash(w.Value)); err != nil {
			return err
		}
	}
	return nil
}
func ghostStore(c ctx) ghostTensorStore {
	return ghostTensorStore{c.State.BackingStorage().OpenSubStorage([]byte("GH0ST_TENSOR_V1"))}
}
func ghostSigned(b []byte) []int8 {
	out := make([]int8, len(b))
	for i, v := range b {
		out[i] = int8(v)
	}
	return out
}
func (con ArbGhostTensor) RegisterModel(c ctx, evm mech, weights []byte) (bytes32, error) {
	if len(weights) == 0 || len(weights) > tensor.MaxElements {
		return bytes32{}, tensor.ErrInvalid
	}
	// Provisional computation charge; this is NOT a measured production gas price.
	if err := c.Burn(multigas.ResourceKindComputation, 100+uint64(len(weights))*50); err != nil {
		return bytes32{}, err
	}
	return tensor.RegisterModel(ghostStore(c), ghostSigned(weights))
}
func (con ArbGhostTensor) Begin(c ctx, evm mech, job, model bytes32, input []byte) error {
	if len(input) == 0 || len(input) > tensor.MaxElements {
		return tensor.ErrInvalid
	}
	if err := c.Burn(multigas.ResourceKindComputation, 100+uint64(len(input))*10); err != nil {
		return err
	}
	return tensor.Begin(ghostStore(c), tensor.Owner(c.caller), job, model, ghostSigned(input))
}
func (con ArbGhostTensor) Step(c ctx, evm mech, job bytes32, maxMacs uint32) (bool, int64, uint32, error) {
	if maxMacs == 0 || maxMacs > tensor.MaxStep {
		return false, 0, 0, tensor.ErrInvalid
	}
	if err := c.Burn(multigas.ResourceKindComputation, 100+uint64(maxMacs)*50); err != nil {
		return false, 0, 0, err
	}
	p, e := tensor.Step(ghostStore(c), tensor.Owner(c.caller), job, maxMacs)
	return p.Done, p.Sum, p.Cursor, e
}
func (con ArbGhostTensor) Result(c ctx, evm mech, job bytes32) (bool, int64, uint32, error) {
	p, e := tensor.Inspect(ghostStore(c), tensor.Owner(c.caller), job)
	return p.Done, p.Sum, p.Cursor, e
}
