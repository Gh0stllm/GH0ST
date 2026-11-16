//go:build gh0stllmbridge

// Experimental state adapter only. No LLM precompile is registered here.
package precompiles

import (
	bridge "github.com/Gh0stllm/GH0ST/l3/bridge"
	"github.com/ethereum/go-ethereum/common"
	"github.com/offchainlabs/nitro/arbos/storage"
)

type ghostLLMWordStore struct {
	backing       *storage.Storage
	reads, writes uint64
}

func (s *ghostLLMWordStore) Get(key bridge.Word) (bridge.Word, error) {
	s.reads++
	v, e := s.backing.Get(common.Hash(key))
	return bridge.Word(v), e
}
func (s *ghostLLMWordStore) Apply(writes []bridge.WordWrite) error {
	// The enclosing EVM call must revert its StateDB snapshot on any returned error.
	for _, w := range writes {
		if e := s.backing.Set(common.Hash(w.Key), common.Hash(w.Value)); e != nil {
			return e
		}
		s.writes++
	}
	return nil
}

// Production caller binding must come from c.caller, never an ABI owner argument.
func ghostLLMStoreForContext(c ctx) bridge.WordAdapter {
	return bridge.WordAdapter{Words: &ghostLLMWordStore{backing: c.State.BackingStorage().OpenSubStorage([]byte("GH0ST_LLM_V1"))}}
}
