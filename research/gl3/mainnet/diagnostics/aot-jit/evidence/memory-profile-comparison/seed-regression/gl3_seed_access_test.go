package precompiles

import (
	"bytes"
	"math/big"
	"reflect"
	"testing"

	sliced "github.com/Gh0stllm/GH0ST/gl3/slicedchess"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/state"
	"github.com/ethereum/go-ethereum/core/stateless"
	"github.com/ethereum/go-ethereum/core/tracing"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/core/vm"
	"github.com/offchainlabs/nitro/cmd/chaininfo"
)

type gl3SeedNoExtension struct{ vm.StateDB }
type gl3SeedObserve struct {
	vm.StateDB
	reads int
}

func (s *gl3SeedObserve) GetCodeUncached(a common.Address) []byte {
	s.reads++
	return s.StateDB.(interface{ GetCodeUncached(common.Address) []byte }).GetCodeUncached(a)
}

type gl3MissingSeedDB struct {
	state.Database
	missing common.Address
}

func (d *gl3MissingSeedDB) Reader(root common.Hash) (state.Reader, error) {
	r, e := d.Database.Reader(root)
	return &gl3MissingSeedReader{Reader: r, missing: d.missing}, e
}

type gl3MissingSeedReader struct {
	state.Reader
	missing common.Address
}

func (r *gl3MissingSeedReader) Code(a common.Address, h common.Hash) []byte {
	if a == r.missing {
		return nil
	}
	return r.Reader.Code(a, h)
}

func TestGL3ImmutableSeedBadStateAndWitness(t *testing.T) {
	for _, kind := range []string{"bad_prefix", "oversized_page", "missing_account_code", "missing_backing_code"} {
		t.Run(kind, func(t *testing.T) {
			memory := bytes.Repeat([]byte{0x55}, 65536)
			globals := []sliced.Global{{Name: "gl3_global_0"}, {Name: "gl3_global_98"}, {Name: "gl3_global_99"}}
			meta := sliceMeta{Version: 2, Module: sliced.ModuleSHA, Root: sliced.NewTree(memory).Root(len(memory), globals), MemoryBytes: 65536, Globals: globals, Generation: 1}
			db := state.NewDatabaseForTesting()
			s, e := state.New(types.EmptyRootHash, db)
			if e != nil {
				t.Fatal(e)
			}
			first := slicePageAddress(sliceSeedNamespace, 0)
			for i := 0; i < len(memory)/sliced.PageSize; i++ {
				code := sliceEncode(memory[i*sliced.PageSize : (i+1)*sliced.PageSize])
				if i == 0 {
					switch kind {
					case "bad_prefix":
						code[1] ^= 1
					case "oversized_page":
						code = append(code, 1)
					case "missing_account_code":
						code = nil
					}
				}
				s.SetCode(slicePageAddress(sliceSeedNamespace, i), code, tracing.CodeChangeUnspecified)
			}
			root, e := s.Commit(0, false, false)
			if e != nil {
				t.Fatal(e)
			}
			var dbView state.Database = db
			if kind == "missing_backing_code" {
				dbView = &gl3MissingSeedDB{Database: db, missing: first}
			}
			var witnesses [2]map[string]struct{}
			var errors [2]string
			for index, optional := range []bool{false, true} {
				current, e := state.New(root, dbView)
				if e != nil {
					t.Fatal(e)
				}
				witness, e := stateless.NewWitness(&types.Header{Number: big.NewInt(1)}, nil, false)
				if e != nil {
					t.Fatal(e)
				}
				current.StartPrefetcher("gl3-seed-negative", witness)
				var view vm.StateDB = &gl3SeedNoExtension{StateDB: current}
				observer := &gl3SeedObserve{StateDB: current}
				if optional {
					view = observer
				}
				evm := vm.NewEVM(vm.BlockContext{BlockNumber: big.NewInt(1)}, view, chaininfo.ArbitrumDevTestChainConfig(), vm.Config{})
				cache, e := sliceRestoreSeed(evm, meta, meta)
				if cache != nil {
					cache.VM.Close()
				}
				if e == nil {
					t.Fatal("bad seed accepted", kind, optional)
				}
				if optional && observer.reads == 0 {
					t.Fatal("immutable seed bypassed optional authenticated reader")
				}
				if current.Error() != nil {
					errors[index] = current.Error().Error()
				}
				if kind == "missing_backing_code" && current.Error() == nil {
					t.Fatal("missing backing code lost StateDB error")
				}
				current.StopPrefetcher()
				witnesses[index] = witness.Codes
			}
			if !reflect.DeepEqual(witnesses[0], witnesses[1]) || errors[0] != errors[1] {
				t.Fatal("seed reader changed witness/error behavior", errors)
			}
			t.Log("both fallback/uncached reject with identical witness bytes and StateDB error", kind, len(witnesses[1]))
		})
	}
}
