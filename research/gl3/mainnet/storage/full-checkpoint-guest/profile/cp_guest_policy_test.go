//go:build gl3_checkpoint_integration

package precompiles

import (
	"github.com/ethereum/go-ethereum/common"
	"testing"
)

func TestGL3CheckpointNextMoveAdmission(t *testing.T) {
	owner, job := common.HexToAddress("0x1234"), bytes32{7}
	m := sliceMeta{Version: 2, Generation: 2, MemoryBytes: 65536, Root: bytes32{3}, Head: bytes32{4}, Deltas: 2464, History: "e2e4 e7e5", Request: "e2e4"}
	b := cpState{Version: 1, Nonce: 1, Owner: owner, Job: job, Generation: 2, Root: m.Root, OldHead: m.Head, OldDeltas: m.Deltas, MemoryBytes: m.MemoryBytes, Cursor: m.MemoryBytes, Head: bytes32{8}, Pieces: []bytes32{{8}}, Verified: 1}
	b.FrozenMeta = cpMetaHash(m)
	m.Head, m.Deltas = b.Head, 1
	if !cpCheckpointReady(m, b, owner, job) {
		t.Fatal("exact finalized checkpoint rejected")
	}
	cases := map[string]func(*sliceMeta, *cpState){
		"active":                  func(_ *sliceMeta, b *cpState) { b.Active = true },
		"zero-nonce":              func(_ *sliceMeta, b *cpState) { b.Nonce = 0 },
		"version":                 func(_ *sliceMeta, b *cpState) { b.Version++ },
		"wrong-owner":             func(_ *sliceMeta, b *cpState) { b.Owner[0] ^= 1 },
		"wrong-job":               func(_ *sliceMeta, b *cpState) { b.Job[0] ^= 1 },
		"prior-generation":        func(_ *sliceMeta, b *cpState) { b.Generation-- },
		"new-generation":          func(m *sliceMeta, _ *cpState) { m.Generation++ },
		"wrong-root":              func(_ *sliceMeta, b *cpState) { b.Root[0] ^= 1 },
		"partial-range":           func(_ *sliceMeta, b *cpState) { b.Cursor = 32 },
		"wrong-memory":            func(_ *sliceMeta, b *cpState) { b.MemoryBytes++ },
		"unverified":              func(_ *sliceMeta, b *cpState) { b.Verified = 0 },
		"no-pieces":               func(_ *sliceMeta, b *cpState) { b.Pieces = nil },
		"too-many-pieces":         func(_ *sliceMeta, b *cpState) { b.Pieces = []bytes32{{8}, {9}} },
		"wrong-piece-tip":         func(_ *sliceMeta, b *cpState) { b.Pieces = []bytes32{{9}} },
		"wrong-tip":               func(m *sliceMeta, _ *cpState) { m.Head[0] ^= 1 },
		"uncompacted-count":       func(m *sliceMeta, _ *cpState) { m.Deltas = 2464 },
		"history-changed":         func(m *sliceMeta, _ *cpState) { m.History += " g1f3" },
		"request-changed":         func(m *sliceMeta, _ *cpState) { m.Request += " e7e5" },
		"operation-changed":       func(m *sliceMeta, _ *cpState) { m.Operation++ },
		"progress-changed":        func(m *sliceMeta, _ *cpState) { m.Progress.Depth++ },
		"delta-stat-changed":      func(m *sliceMeta, _ *cpState) { m.DeltaBytes++ },
		"frozen-metadata-changed": func(_ *sliceMeta, b *cpState) { b.FrozenMeta[0] ^= 1 },
		"wrong-old-head":          func(_ *sliceMeta, b *cpState) { b.OldHead[0] ^= 1 },
		"wrong-old-deltas":        func(_ *sliceMeta, b *cpState) { b.OldDeltas-- },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			mm, bb := m, b
			bb.Pieces = append([]bytes32(nil), b.Pieces...)
			mutate(&mm, &bb)
			if cpCheckpointReady(mm, bb, owner, job) {
				t.Fatal("non-finalized exact state admitted")
			}
		})
	}
	t.Run("new-game-authenticated-seed", func(t *testing.T) {
		seed := sliceMeta{Generation: 1}
		if !cpCheckpointReady(seed, cpState{}, owner, job) {
			t.Fatal("initial seed denied")
		}
		seed.Deltas = 1
		if cpCheckpointReady(seed, cpState{}, owner, job) {
			t.Fatal("mutable initial history accepted")
		}
		seed.Deltas = 0
		seed.Head = bytes32{1}
		if cpCheckpointReady(seed, cpState{}, owner, job) {
			t.Fatal("initial nonzero history accepted")
		}
	})
}
