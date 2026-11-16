package precompiles

import (
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/offchainlabs/nitro/arbos/burn"
	tensor "github.com/offchainlabs/nitro/arbos/gh0stllm"
	"github.com/offchainlabs/nitro/arbos/storage"
	"math/big"
	"strings"
	"testing"
)

func TestGH0STTensorABIMetadata(t *testing.T) {
	address, impl := makeGhostTensorPrecompile()
	if address != common.HexToAddress("0x0000000000000000000000000000000000000a11") || impl.Name() != "ArbGhostTensor" {
		t.Fatal("wrong experiment identity")
	}
	for _, name := range []string{"RegisterModel", "Begin", "Step", "Result"} {
		if impl.methodsByName[name] == nil {
			t.Fatal("missing ABI method", name)
		}
	}
	if impl.methodsByName["Result"].purity != view || impl.methodsByName["Step"].purity != write {
		t.Fatal("wrong ABI mutability")
	}
}

func TestGH0STTensorArbOSStorageAndRollback(t *testing.T) {
	db := storage.NewMemoryBackedStateDB()
	backing := storage.NewGeth(db, burn.NewSystemBurner(nil, false)).OpenSubStorage([]byte("GH0ST_TENSOR_NATIVE_TEST"))
	s := ghostTensorStore{backing}
	model, err := tensor.RegisterModel(s, []int8{127, -128, 3})
	if err != nil {
		t.Fatal(err)
	}
	var owner tensor.Owner
	owner[0] = 9
	var job tensor.Word
	job[0] = 7
	if err = tensor.Begin(s, owner, job, model, []int8{2, 3, 4}); err != nil {
		t.Fatal(err)
	}
	snap := db.Snapshot()
	partial, err := tensor.Step(s, owner, job, 2)
	if err != nil || partial.Done || partial.Cursor != 2 {
		t.Fatal(partial, err)
	}
	db.RevertToSnapshot(snap)
	restored, err := tensor.Inspect(s, owner, job)
	if err != nil || restored.Cursor != 0 || restored.Sum != 0 {
		t.Fatal("Geth rollback did not restore continuation", restored, err)
	}
	// Reopen the ArbOS namespace over the same real in-memory Geth StateDB.
	reopened := ghostTensorStore{storage.NewGeth(db, burn.NewSystemBurner(nil, false)).OpenSubStorage([]byte("GH0ST_TENSOR_NATIVE_TEST"))}
	done, err := tensor.Step(reopened, owner, job, 3)
	if err != nil || !done.Done || done.Sum != -118 {
		t.Fatal(done, err)
	}
}

// This calls Nitro's real ABI dispatcher over its local EVM fixture. It is not
// a submitted transaction or a booted/settled chain.
func TestGH0STTensorNativeABIDispatch(t *testing.T) {
	evm := newMockEVMForTesting()
	address, impl := makeGhostTensorPrecompile()
	parsed, err := abi.JSON(strings.NewReader(GhostTensorABI))
	if err != nil {
		t.Fatal(err)
	}
	caller := common.HexToAddress("0x1234")
	call := func(name string, args ...any) []any {
		t.Helper()
		input, e := parsed.Pack(name, args...)
		if e != nil {
			t.Fatal(e)
		}
		out, left, _, e := impl.Call(input, address, caller, big.NewInt(0), false, 1000000000, evm)
		if e != nil || left == 1000000000 {
			t.Fatal("real ABI dispatch/meter failed", name, e)
		}
		values, e := parsed.Unpack(name, out)
		if e != nil {
			t.Fatal(e)
		}
		return values
	}
	model := call("registerModel", []byte{127, 128, 3})[0].([32]byte)
	job := [32]byte{9}
	call("begin", job, model, []byte{2, 3, 4})
	p := call("step", job, uint32(2))
	if p[0].(bool) || p[1].(int64) != -130 || p[2].(uint32) != 2 {
		t.Fatal(p)
	}
	p = call("step", job, uint32(1))
	if !p[0].(bool) || p[1].(int64) != -118 || p[2].(uint32) != 3 {
		t.Fatal(p)
	}
	p = call("result", job)
	if !p[0].(bool) || p[1].(int64) != -118 {
		t.Fatal(p)
	}
	input, _ := parsed.Pack("step", job, uint32(1))
	_, _, _, e := impl.Call(input, address, common.HexToAddress("0x5678"), big.NewInt(0), false, 1000000000, evm)
	if e == nil {
		t.Fatal("ABI caller ownership was not enforced")
	}
	_, _, _, e = impl.Call(input, address, caller, big.NewInt(0), true, 1000000000, evm)
	if e == nil {
		t.Fatal("staticcall allowed a mutable method")
	}
}
