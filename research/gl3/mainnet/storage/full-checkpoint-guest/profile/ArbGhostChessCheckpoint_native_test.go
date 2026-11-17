//go:build gl3_checkpoint_integration

package precompiles

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/ethereum/go-ethereum/core/state"
	"github.com/ethereum/go-ethereum/core/tracing"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/core/vm"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethdb"
	"github.com/ethereum/go-ethereum/ethdb/memorydb"
	"github.com/ethereum/go-ethereum/rlp"
	"github.com/ethereum/go-ethereum/triedb"
	"github.com/holiman/uint256"
	"github.com/offchainlabs/nitro/arbos"
	"github.com/offchainlabs/nitro/arbos/arbosState"
	"github.com/offchainlabs/nitro/arbos/burn"
	"github.com/offchainlabs/nitro/arbos/storage"
	"github.com/offchainlabs/nitro/cmd/chaininfo"
)

// This adapter writes only an ephemeral overlay. The captured preimages and
// accepted completed-image export remain immutable and are never a live chain.
type cpFrozenEntry struct {
	Offset int64
	Size   uint32
}
type cpFrozenDB struct {
	ethdb.KeyValueStore
	file  *os.File
	index map[common.Hash]cpFrozenEntry
}

func (d *cpFrozenDB) Get(key []byte) ([]byte, error) {
	if b, e := d.KeyValueStore.Get(key); e == nil {
		return b, nil
	}
	if bytes.HasPrefix(key, rawdb.CodePrefix) && len(key) == len(rawdb.CodePrefix)+32 {
		key = key[len(rawdb.CodePrefix):]
	}
	if len(key) != 32 {
		return nil, errors.New("not an indexed preimage")
	}
	entry, ok := d.index[common.BytesToHash(key)]
	if !ok {
		return nil, errors.New("missing immutable preimage")
	}
	b := make([]byte, entry.Size)
	_, e := d.file.ReadAt(b, entry.Offset)
	return b, e
}
func (d *cpFrozenDB) Has(key []byte) (bool, error) { _, e := d.Get(key); return e == nil, nil }

type cpCodeSpy struct {
	vm.StateDB
	CodeReads, HashReads, UncachedReads uint64
}

func (s *cpCodeSpy) GetCode(a common.Address) []byte { s.CodeReads++; return s.StateDB.GetCode(a) }
func (s *cpCodeSpy) GetCodeHash(a common.Address) common.Hash {
	s.HashReads++
	return s.StateDB.GetCodeHash(a)
}
func (s *cpCodeSpy) GetCodeUncached(a common.Address) []byte {
	s.UncachedReads++
	if x, ok := s.StateDB.(interface{ GetCodeUncached(common.Address) []byte }); ok {
		return x.GetCodeUncached(a)
	}
	return s.StateDB.GetCode(a)
}

type cpFixture struct {
	evm            *vm.EVM
	db             *state.StateDB
	owner          common.Address
	job            [32]byte
	parsed, legacy abi.ABI
	rows           []map[string]any
	file           *os.File
}

func (f *cpFixture) call(t *testing.T, legacy bool, gas uint64, name string, args ...any) ([]any, uint64, error) {
	t.Helper()
	parsed, address := f.parsed, common.HexToAddress("0xa15")
	if legacy {
		parsed, address = f.legacy, common.HexToAddress("0xa14")
	}
	input, e := parsed.Pack(name, args...)
	if e != nil {
		t.Fatal(e)
	}
	f.evm.Context.BlockNumber.Add(f.evm.Context.BlockNumber, big.NewInt(1))
	start := time.Now()
	output, left, _, e := f.evm.Call(f.owner, address, input, vm.NewGasBudget(gas, 0), uint256.NewInt(0))
	used := gas - left.RegularGas
	f.rows = append(f.rows, map[string]any{"method": name, "legacy": legacy, "gasUsed": used, "seconds": time.Since(start).Seconds(), "reverted": e != nil})
	if e != nil {
		return nil, used, e
	}
	decoded, e := parsed.Unpack(name, output)
	return decoded, used, e
}
func (f *cpFixture) must(t *testing.T, name string, args ...any) []any {
	t.Helper()
	v, _, e := f.call(t, false, 100_000_000, name, args...)
	if e != nil {
		t.Fatal(name, e)
	}
	return v
}
func (f *cpFixture) reject(t *testing.T, name string, args ...any) {
	t.Helper()
	before := f.meta(t)
	b := f.builder(t)
	if _, _, e := f.call(t, false, 100_000_000, name, args...); e == nil {
		t.Fatal("expected rejection", name)
	}
	if cpMetaHash(before) != cpMetaHash(f.meta(t)) || !cpStatesEqual(b, f.builder(t)) {
		t.Fatal("rejected transaction changed authoritative metadata", name)
	}
}
func cpStatesEqual(a, b cpState) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return bytes.Equal(x, y)
}
func (f *cpFixture) meta(t *testing.T) sliceMeta {
	t.Helper()
	m, e := sliceMetaRead(sliceStore(f.evm.StateDB, burn.NewSystemBurner(nil, false), cpNamespace(f.owner, f.job)))
	if e != nil {
		t.Fatal(e)
	}
	return m
}
func (f *cpFixture) builder(t *testing.T) cpState {
	t.Helper()
	data, e := cpRead(cpStoreForTest(f.evm, cpNamespace(f.owner, f.job)))
	if e != nil {
		t.Fatal(e)
	}
	return data
}
func cpStoreForTest(evm *vm.EVM, ns []byte) *storage.Storage {
	return storage.NewGeth(evm.StateDB, burn.NewSystemBurner(nil, false)).OpenSubStorage([]byte("GL3_CHESS_CHECKPOINT_BUILDER_V1")).OpenSubStorage(ns)
}
func (f *cpFixture) dropCache() {
	key := string(cpNamespace(f.owner, f.job))
	sliceCaches.Lock()
	if c := sliceCaches.Items[key]; c != nil {
		c.VM.Close()
		delete(sliceCaches.Items, key)
	}
	sliceCaches.Unlock()
}

func cpOpenCompletedFixture(t *testing.T) *cpFixture {
	t.Helper()
	if os.Getenv("GL3_CHECKPOINT_EVIDENCE") == "" {
		t.Fatal("Runpod evidence directory required")
	}
	path := "/root/bounded-restore/preimages.bin"
	file, e := os.Open(path)
	if e != nil {
		t.Fatal(e)
	}
	disk := &cpFrozenDB{KeyValueStore: memorydb.New(), file: file, index: map[common.Hash]cpFrozenEntry{}}
	var pos int64
	h := sha256.New()
	records := 0
	for {
		var length [8]byte
		_, e = io.ReadFull(file, length[:])
		if e == io.EOF {
			break
		}
		if e != nil {
			t.Fatal(e)
		}
		n := binary.LittleEndian.Uint64(length[:])
		if n == 0 || n > 64*1024*1024 {
			t.Fatal("preimage length")
		}
		b := make([]byte, int(n))
		if _, e = io.ReadFull(file, b); e != nil {
			t.Fatal(e)
		}
		h.Write(length[:])
		h.Write(b)
		disk.index[crypto.Keccak256Hash(b)] = cpFrozenEntry{pos + 8, uint32(n)}
		pos += 8 + int64(n)
		records++
	}
	if pos != 1914805529 || records != 402818 || hex.EncodeToString(h.Sum(nil)) != "8852477df16204a51a337c1f91023fc46fc052304315b96e91e3f1c4a1369157" {
		t.Fatal("frozen preimage input identity")
	}
	headerRaw, e := disk.Get(common.HexToHash("0x4b0cb7e808fd0e32ea667114adf94e67fd7c6617a545e7fb473aab0afb4eb0f0").Bytes())
	if e != nil {
		t.Fatal(e)
	}
	var header types.Header
	if e = rlp.DecodeBytes(headerRaw, &header); e != nil {
		t.Fatal(e)
	}
	db, e := state.NewDeterministic(header.Root, state.NewDatabase(triedb.NewDatabase(rawdb.NewDatabase(disk), nil), nil))
	if e != nil {
		t.Fatal(e)
	}
	owner := common.HexToAddress("0x26E554a8acF9003b83495c7f45F06edCB803d4e3")
	job := [32]byte{0x33}
	config := chaininfo.ArbitrumDevTestChainConfig()
	config.ArbitrumChainParams.AllowDebugPrecompiles = false
	config.ArbitrumChainParams.InitialChainOwner = owner
	// Captured input is a sparse witness, not a complete mutable parent DB. Copy
	// only its fully authenticated seed and exact ancestry into a fresh real
	// StateDB so arbitrary new builder keys cannot create missing-proof lookups.
	captured := db
	syscopy := burn.NewSystemBurner(nil, false)
	seed, e := sliceMetaRead(sliceStore(captured, syscopy, sliceSeedNamespace))
	if e != nil {
		t.Fatal(e)
	}
	capturedMeta, e := sliceMetaRead(sliceStore(captured, syscopy, sliceNamespace(owner, job)))
	if e != nil {
		t.Fatal(e)
	}
	_, db = arbosState.NewArbosMemoryBackedArbOSStateWithConfig(config)
	for i := 0; i < int(seed.MemoryBytes)/4096; i++ {
		a := slicePageAddress(sliceSeedNamespace, i)
		code := captured.GetCodeUncached(a)
		if len(code) > 0 {
			db.SetCode(a, code, tracing.CodeChangeUnspecified)
		}
	}
	if e = sliceMetaWrite(sliceStore(db, syscopy, sliceSeedNamespace), seed); e != nil {
		t.Fatal(e)
	}
	head := capturedMeta.Head
	for remaining := capturedMeta.Deltas; remaining > 0; remaining-- {
		body, e := sliceReadDelta(captured, head)
		if e != nil {
			t.Fatal(e)
		}
		for i := 0; i < (len(body)+sliceBlobPage-1)/sliceBlobPage; i++ {
			a := sliceDeltaAddress(head, i)
			db.SetCode(a, captured.GetCodeUncached(a), tracing.CodeChangeUnspecified)
		}
		copy(head[:], body[4:36])
	}
	if head != ([32]byte{}) {
		t.Fatal("captured ancestry incomplete")
	}
	if e = captured.Error(); e != nil {
		t.Fatal("authenticated source reader", e)
	}
	if e = sliceMetaWrite(sliceStore(db, syscopy, sliceNamespace(owner, job)), capturedMeta); e != nil {
		t.Fatal(e)
	}
	evm := vm.NewEVM(vm.BlockContext{BlockNumber: big.NewInt(10000), GasLimit: ^uint64(0), Transfer: core.Transfer, CanTransfer: core.CanTransfer}, db, config, vm.Config{})
	evm.ProcessingHook = &arbos.TxProcessor{}
	address, p := makeGhostChessCheckpointPrecompile()
	la, lp := makeGhostChessSlicesPrecompile()
	evm.SetPrecompiles(vm.PrecompiledContracts{address: ghostChessEVMBridge{p}, la: ghostChessEVMBridge{lp}})
	parsed, e := abi.JSON(strings.NewReader(GhostChessCheckpointABI))
	if e != nil {
		t.Fatal(e)
	}
	legacy, e := abi.JSON(strings.NewReader(GhostChessSlicesABI))
	if e != nil {
		t.Fatal(e)
	}
	f := &cpFixture{evm: evm, db: db, owner: owner, job: job, parsed: parsed, legacy: legacy, file: file}
	t.Cleanup(func() { f.dropCache(); file.Close() })
	// Test-only import of the native-accepted completed state. No import ABI exists.
	sys := burn.NewSystemBurner(nil, false)
	oldStore := sliceStore(db, sys, sliceNamespace(owner, job))
	old, e := sliceMetaRead(oldStore)
	if e != nil {
		t.Fatal(e)
	}
	old.Released = true
	if e = sliceMetaWrite(oldStore, old); e != nil {
		t.Fatal(e)
	}
	if e = sliceStore(db, sys, sliceReservation).SetBytes(nil); e != nil {
		t.Fatal(e)
	}
	arb, e := arbosState.OpenSystemArbosState(db, nil, false)
	if e != nil {
		t.Fatal(e)
	}
	if e = arb.ChainOwners().Add(owner); e != nil {
		t.Fatal(e)
	}
	f.must(t, "newGame", job)
	export := "/root/bounded-restore/final-state-export/export"
	metaRaw, e := os.ReadFile(filepath.Join(export, "meta.json"))
	if e != nil {
		t.Fatal(e)
	}
	if fmt.Sprintf("%x", sha256.Sum256(metaRaw)) != "f563275e0ac46dbf5688e34ef59d3796a473ffbfe18461bf605e7844dcf46d88" {
		t.Fatal("completed metadata identity")
	}
	var final sliceMeta
	if e = json.Unmarshal(metaRaw, &final); e != nil {
		t.Fatal(e)
	}
	code, e := os.ReadFile(filepath.Join(export, "final-code-0000.bin"))
	if e != nil {
		t.Fatal(e)
	}
	a := sliceDeltaAddress(final.Head, 0)
	if a != common.HexToAddress("0x07D55d3c4fBaE61Ca42EEab10E72417623e1878c") || crypto.Keccak256Hash(code) != common.HexToHash("0x776f2f5bb3ea092de80c3c1c384e43d292c98a6e321477f841a83720c9697ad8") {
		t.Fatal("final immutable fragment identity")
	}
	db.SetCode(a, code, tracing.CodeChangeUnspecified)
	if e = sliceMetaWrite(sliceStore(db, sys, cpNamespace(owner, job)), final); e != nil {
		t.Fatal(e)
	}
	if final.Progress.Pending || final.Generation != 2 || final.Deltas != 2464 || final.History != "e2e4 e7e5" || final.Progress.Nodes != 24000033 {
		t.Fatal("export is not the unchanged full-strength completed decision")
	}
	return f
}

func TestGL3CheckpointCompletedNativeStateDB(t *testing.T) {
	f := cpOpenCompletedFixture(t)
	original := f.meta(t)
	ns := cpNamespace(f.owner, f.job)
	gen := original.Generation
	t.Run("requires-completed-checkpoint-before-next-begin", func(t *testing.T) {
		f.reject(t, "begin", f.job, gen, "e2e4 e7e5 g1f3")
	})
	nonce := f.must(t, "checkpointBegin", f.job, gen, original.Root)[0].(uint64)
	t.Run("metadata-only-begin", func(t *testing.T) {
		if nonce != 1 {
			t.Fatal("initial nonce")
		}
		sliceCaches.Lock()
		n := len(sliceCaches.Items)
		sliceCaches.Unlock()
		if n != 0 {
			t.Fatal("Begin allocated VM")
		}
	})
	t.Run("owner-generation-root-lock", func(t *testing.T) {
		f.reject(t, "checkpointBegin", f.job, gen, original.Root)
		f.reject(t, "checkpointWork", f.job, gen+1, nonce, uint32(0))
		f.reject(t, "checkpointWork", f.job, gen, nonce+1, uint32(0))
		f.reject(t, "checkpointWork", f.job, gen, nonce, uint32(32))
		f.reject(t, "begin", f.job, gen, "e2e4 e7e5 g1f3")
		f.reject(t, "advance", f.job, gen, uint32(9853))
		f.reject(t, "releaseGame", f.job)
	})
	t.Run("legacy-domain-and-shared-admission", func(t *testing.T) {
		var internal [32]byte
		copy(internal[:], ns)
		salted := sha256.Sum256(append([]byte("internal"), f.job[:]...))
		for _, candidate := range [][32]byte{f.job, internal, salted} {
			for _, name := range []string{"newGame", "begin", "releaseGame"} {
				before := f.meta(t)
				b := f.builder(t)
				args := []any{candidate}
				if name == "begin" {
					args = []any{candidate, gen, "e2e4 e7e5 g1f3"}
				}
				_, _, e := f.call(t, true, 100000000, name, args...)
				if name != "releaseGame" && e == nil {
					t.Fatal("legacy bypass", name)
				}
				if cpMetaHash(before) != cpMetaHash(f.meta(t)) || !cpStatesEqual(b, f.builder(t)) {
					t.Fatal("legacy alias mutated checkpoint")
				}
				reservation, e := sliceStore(f.db, burn.NewSystemBurner(nil, false), sliceReservation).GetBytes()
				if e != nil || !bytes.Equal(reservation, ns) {
					t.Fatal("legacy altered global reservation")
				}
			}
		}
	})
	t.Run("actual-handler-isolated-admission-error-and-cancel", func(t *testing.T) {
		oldHook := f.evm.ProcessingHook
		f.evm.ProcessingHook = arbos.NewTxProcessor(f.evm, &core.Message{From: f.owner, TxRunContext: core.NewMessageEthcallContext()})
		defer func() { f.evm.ProcessingHook = oldHook }()
		release, e := cpIsolation(true)
		if e != nil {
			t.Fatal(e)
		}
		f.reject(t, "checkpointWork", f.job, gen, nonce, uint32(0))
		release()
		if len(sliceSimulationTokens) != 0 {
			t.Fatal("denial leaked token")
		}
		snap := f.db.Snapshot()
		if e = sliceStore(f.db, burn.NewSystemBurner(nil, false), sliceSeedNamespace).SetBytes(nil); e != nil {
			t.Fatal(e)
		}
		f.reject(t, "checkpointWork", f.job, gen, nonce, uint32(0))
		f.db.RevertToSnapshot(snap)
		if len(sliceSimulationTokens) != 0 {
			t.Fatal("restore error leaked token")
		}
		f.evm.Cancel()
		f.reject(t, "checkpointWork", f.job, gen, nonce, uint32(0))
		if len(sliceSimulationTokens) != 0 {
			t.Fatal("canceled handler leaked token")
		}
		// A canceled EVM is one-shot. Replace it without changing authoritative state.
		old := f.evm
		f.evm = vm.NewEVM(old.Context, f.db, old.ChainConfig(), vm.Config{})
		a, p := makeGhostChessCheckpointPrecompile()
		la, lp := makeGhostChessSlicesPrecompile()
		f.evm.SetPrecompiles(vm.PrecompiledContracts{a: ghostChessEVMBridge{p}, la: ghostChessEVMBridge{lp}})
		f.evm.ProcessingHook = oldHook
	})
	// Rejected/OOG/outer-reverted calls must not advance authoritative work. Native
	// accelerators may survive a reverted frame and must never become authorities.
	t.Run("oog-and-outer-rollback", func(t *testing.T) {
		before := f.builder(t)
		if _, _, e := f.call(t, false, 1000, "checkpointWork", f.job, gen, nonce, uint32(0)); e == nil {
			t.Fatal("OOG accepted")
		}
		if !cpStatesEqual(before, f.builder(t)) {
			t.Fatal("OOG changed builder")
		}
		snap := f.db.Snapshot()
		f.must(t, "checkpointWork", f.job, gen, nonce, uint32(0))
		f.db.RevertToSnapshot(snap)
		if !cpStatesEqual(before, f.builder(t)) {
			t.Fatal("outer rollback failed")
		}
	})
	t.Run("missing-original-backing-fails-closed", func(t *testing.T) {
		f.dropCache()
		snap := f.db.Snapshot()
		f.db.SetCode(sliceDeltaAddress(original.Head, 0), nil, tracing.CodeChangeUnspecified)
		f.reject(t, "checkpointWork", f.job, gen, nonce, uint32(0))
		f.db.RevertToSnapshot(snap)
	})
	f.must(t, "checkpointWork", f.job, gen, nonce, uint32(0))
	t.Run("stale-native-code-index-reconstructs", func(t *testing.T) {
		sliceCaches.Lock()
		old := sliceCaches.Items[string(ns)].VM
		sliceCaches.Items[string(ns)].Codes[common.HexToAddress("0xdead")] = common.HexToHash("0x01")
		sliceCaches.Unlock()
		b := f.builder(t)
		f.must(t, "checkpointWork", f.job, gen, nonce, b.Cursor)
		sliceCaches.Lock()
		now := sliceCaches.Items[string(ns)]
		if now.VM == old {
			t.Fatal("stale VM retained")
		}
		if _, ok := now.Codes[common.HexToAddress("0xdead")]; ok {
			t.Fatal("stale native index survived authoritative restore")
		}
		sliceCaches.Unlock()
	})
	var firstVM any
	for f.builder(t).Cursor < original.MemoryBytes {
		b := f.builder(t)
		f.must(t, "checkpointWork", f.job, gen, nonce, b.Cursor)
		sliceCaches.Lock()
		cache := sliceCaches.Items[string(ns)]
		if cache == nil {
			t.Fatal("live cache missing")
		}
		if firstVM == nil {
			firstVM = cache.VM
		} else if firstVM != cache.VM {
			t.Fatal("checkpoint changed live VM")
		}
		sliceCaches.Unlock()
	}
	built := f.builder(t)
	if len(built.Pieces) != 64 || built.Cursor != original.MemoryBytes {
		t.Fatal("coverage", len(built.Pieces), built.Cursor)
	}
	t.Run("complete-coverage-before-finalize", func(t *testing.T) {
		f.reject(t, "checkpointFinalize", f.job, gen, nonce)
		f.reject(t, "checkpointWork", f.job, gen, nonce, built.Cursor)
		f.reject(t, "checkpointVerify", f.job, gen, nonce, uint32(1))
	})
	t.Run("missing-and-corrupt-piece-rollback", func(t *testing.T) {
		a := sliceDeltaAddress(built.Pieces[0], 0)
		code := bytes.Clone(f.db.GetCode(a))
		snap := f.db.Snapshot()
		f.db.SetCode(a, nil, tracing.CodeChangeUnspecified)
		f.reject(t, "checkpointVerify", f.job, gen, nonce, uint32(0))
		f.db.RevertToSnapshot(snap)
		snap = f.db.Snapshot()
		bad := bytes.Clone(code)
		bad[len(bad)-1] ^= 1
		f.db.SetCode(a, bad, tracing.CodeChangeUnspecified)
		f.reject(t, "checkpointVerify", f.job, gen, nonce, uint32(0))
		f.db.RevertToSnapshot(snap)
	})
	for f.builder(t).Verified < uint32(len(built.Pieces)) {
		b := f.builder(t)
		f.must(t, "checkpointVerify", f.job, gen, nonce, b.Verified)
	}
	t.Run("outer-finalize-rollback", func(t *testing.T) {
		before := f.meta(t)
		builder := f.builder(t)
		snapshot := f.db.Snapshot()
		f.must(t, "checkpointFinalize", f.job, gen, nonce)
		f.db.RevertToSnapshot(snapshot)
		if cpMetaHash(before) != cpMetaHash(f.meta(t)) || !cpStatesEqual(builder, f.builder(t)) {
			t.Fatal("outer Finalize rollback changed authoritative root/head/lock")
		}
	})
	t.Run("finalize-bounded-and-state-identical", func(t *testing.T) {
		spy := &cpCodeSpy{StateDB: f.evm.StateDB}
		f.evm.StateDB = spy
		f.must(t, "checkpointFinalize", f.job, gen, nonce)
		f.evm.StateDB = spy.StateDB
		if spy.CodeReads+spy.HashReads+spy.UncachedReads != 0 {
			t.Fatal("Finalize read code/image/history", spy.CodeReads, spy.HashReads, spy.UncachedReads)
		}
		m := f.meta(t)
		if m.Head != built.Head || m.Deltas != 64 {
			t.Fatal("head/count switch")
		}
		same := m
		same.Head = original.Head
		same.Deltas = original.Deltas
		if cpMetaHash(same) != cpMetaHash(original) {
			t.Fatal("Finalize changed globals/TT/history/root/other fields")
		}
		sliceCaches.Lock()
		cache := sliceCaches.Items[string(ns)]
		if cache.VM != firstVM {
			t.Fatal("Finalize replaced search VM")
		}
		sliceCaches.Unlock()
		if f.builder(t).Active {
			t.Fatal("build lock not released")
		}
	})
	t.Run("completed-checkpoint-admission-is-metadata-only", func(t *testing.T) {
		if !cpCheckpointReady(f.meta(t), f.builder(t), f.owner, f.job) {
			t.Fatal("exact finalized checkpoint denied")
		}
	})
	t.Run("cold-root-all-bytes-and-canonical", func(t *testing.T) {
		f.dropCache()
		m := f.meta(t)
		seed, e := sliceMetaRead(sliceStore(f.db, burn.NewSystemBurner(nil, false), sliceSeedNamespace))
		if e != nil {
			t.Fatal(e)
		}
		cold, e := sliceRestoreSeed(f.evm, m, seed)
		if e != nil {
			t.Fatal(e)
		}
		defer cold.VM.Close()
		if fmt.Sprintf("%x", sha256.Sum256(cold.VM.Memory())) != "26ade604551c291ab4d6e2194dbf45a4cfb8f895d914443d3740ac55422a92f7" || cold.Tree.Root(len(cold.Image.Memory), m.Globals) != original.Root {
			t.Fatal("cold all-byte/root mismatch")
		}
		canonical, e := cold.VM.Canonical()
		if e != nil {
			t.Fatal(e)
		}
		if len(canonical) != 163085439 || fmt.Sprintf("%x", sha256.Sum256(canonical)) != "5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6" {
			t.Fatal("TT/history canonical changed")
		}
	})
	t.Run("cancel-nonce-ABA-and-partial", func(t *testing.T) {
		m := f.meta(t)
		n2 := f.must(t, "checkpointBegin", f.job, gen, m.Root)[0].(uint64)
		f.reject(t, "checkpointWork", f.job, gen, nonce, uint32(0))
		// Re-encoding the same image shares immutable hashes. Even funded,
		// nonzero-nonce code cells must not be reset by a repeated writer.
		a := sliceDeltaAddress(built.Pieces[0], 0)
		codeHash := f.db.GetCodeHash(a)
		f.db.SetNonce(a, 7, tracing.NonceChangeUnspecified)
		f.db.SetBalance(a, uint256.NewInt(17), tracing.BalanceChangeUnspecified)
		output := f.must(t, "checkpointWork", f.job, gen, n2, uint32(0))
		if output[1].([32]byte) != built.Pieces[0] || f.db.GetCodeHash(a) != codeHash || f.db.GetNonce(a) != 7 || f.db.GetBalance(a).Uint64() != 17 {
			t.Fatal("shared immutable code/nonce/balance mutated")
		}
		f.reject(t, "checkpointFinalize", f.job, gen, n2)
		f.must(t, "checkpointCancel", f.job, gen, n2)
		n3 := f.must(t, "checkpointBegin", f.job, gen, m.Root)[0].(uint64)
		if n3 != n2+1 {
			t.Fatal("nonce reused")
		}
		f.reject(t, "checkpointCancel", f.job, gen, n2)
		f.must(t, "checkpointCancel", f.job, gen, n3)
	})
	if os.Getenv("GL3_CHECKPOINT_NEXT_DECISION") == "1" {
		t.Run("checkpoint-cold-next-full24m-golden", func(t *testing.T) {
			started := time.Now()
			sliceCaches.Lock()
			for k, cache := range sliceCaches.Items {
				cache.VM.Close()
				delete(sliceCaches.Items, k)
			}
			sliceCaches.Unlock()
			cpNative.Lock()
			cpNative.Tags = map[string][32]byte{}
			cpNative.Builds = map[string]*cpNativeBuild{}
			cpNative.Unlock()
			committed := f.meta(t)
			seed, e := sliceMetaRead(sliceStore(f.db, burn.NewSystemBurner(nil, false), sliceSeedNamespace))
			if e != nil {
				t.Fatal(e)
			}
			cold, e := sliceRestoreSeed(f.evm, committed, seed)
			if e != nil {
				t.Fatal(e)
			}
			if cold.Tree.Root(len(cold.Image.Memory), committed.Globals) != original.Root || fmt.Sprintf("%x", sha256.Sum256(cold.VM.Memory())) != "26ade604551c291ab4d6e2194dbf45a4cfb8f895d914443d3740ac55422a92f7" {
				cold.VM.Close()
				t.Fatal("pre-search authenticated cold checkpoint mismatch")
			}
			cold.VM.Close()
			// No canonical call is made on the VM that is continued by Begin/Advance.
			history := "e2e4 e7e5 g1f3"
			f.must(t, "begin", f.job, committed.Generation, history)
			calls := 1
			for {
				m := f.meta(t)
				if !m.Progress.Pending {
					break
				}
				if calls > 10000 {
					t.Fatal("unchanged decision failed to finish")
				}
				f.must(t, "advance", f.job, m.SearchGeneration, m.Operation)
				calls++
				if calls%128 == 0 {
					data, _ := json.Marshal(map[string]any{"operation": m.Operation, "nodes": m.Progress.Nodes, "seconds": time.Since(started).Seconds(), "status": "RUNNING_NOT_ACCEPTED"})
					if e = os.WriteFile(filepath.Join(os.Getenv("GL3_CHECKPOINT_EVIDENCE"), "continuation-progress.json"), append(data, '\n'), 0600); e != nil {
						t.Fatal(e)
					}
				}
			}
			final := f.meta(t)
			if final.Progress.Move != "b8c6" || final.Progress.Nodes != 24000311 || final.Progress.Depth != 39 || final.History != "e2e4 e7e5 g1f3 b8c6" {
				t.Fatal("full-strength frozen result mismatch", final.Progress, final.History)
			}
			f.dropCache()
			isolated, e := sliceRestoreSeed(f.evm, final, seed)
			if e != nil {
				t.Fatal(e)
			}
			canonical, e := isolated.VM.Canonical()
			isolated.VM.Close()
			if e != nil {
				t.Fatal(e)
			}
			digest := fmt.Sprintf("%x", sha256.Sum256(canonical))
			if digest != "b06a3f26b0b276c0109fb1888fa32727714ada8abb00cbec8f857bec8308068b" {
				t.Fatal("full canonical/TT/history mismatch", digest)
			}
			data, _ := json.MarshalIndent(map[string]any{"passed": true, "allExecutionOnRunpod": true, "scope": "actual native A15 checkpoint to authenticated cold restore to unchanged full24m second decision; no guest proof or deployment", "inputHistory": history, "finalHistory": final.History, "move": final.Progress.Move, "actualNodes": final.Progress.Nodes, "depth": final.Progress.Depth, "operations": calls, "progressStep": final.Progress.Step, "canonicalBytes": len(canonical), "canonicalSHA256": digest, "canonicalMatchesFrozenUncheckpointedGolden": true, "firstCheckpointImageRoot": fmt.Sprintf("%x", original.Root), "finalImageRoot": fmt.Sprintf("%x", final.Root), "portableModuleSHA256": fmt.Sprintf("%x", final.Module), "allVMSearchCachesDestroyedBeforeBegin": true, "allPortableMemoryGlobalsTTHistoryRetained": true, "qualityOrSearchPolicyChanged": false, "guestProofAccepted": false, "productionAccepted": false, "seconds": time.Since(started).Seconds()}, "", "  ")
			if e = os.WriteFile(filepath.Join(os.Getenv("GL3_CHECKPOINT_EVIDENCE"), "continuation-result.json"), append(data, '\n'), 0600); e != nil {
				t.Fatal(e)
			}
		})
	}
	if e := f.db.Error(); e != nil {
		t.Fatal(e)
	}
	report := map[string]any{"passed": !t.Failed(), "allExecutionOnRunpod": true, "sourceKind": "real StateDB/EVM/Keccak/ABI with exact native-export completed first decision, test-only private fixture import", "engineSearchExecuted": os.Getenv("GL3_CHECKPOINT_NEXT_DECISION") == "1", "history": original.History, "nodes": original.Progress.Nodes, "depth": original.Progress.Depth, "memoryBytes": original.MemoryBytes, "oldDeltaCount": original.Deltas, "checkpointPieces": len(built.Pieces), "checkpointBodyBytes": built.BodyBytes, "checkpointImageRoot": fmt.Sprintf("%x", original.Root), "allPortableBytesGlobalsCanonicalUnchanged": !t.Failed(), "finalizeCodeReads": 0, "pieceScanMemoryBytesMaximum": cpMemoryRange, "pieceEncodedBytesMaximum": cpPieceMaximum, "coldSourceRestoreStillUnboundedByPiece": true, "accountsDeleted": false, "prunerExecuted": false, "guestProofAccepted": false, "productionAccepted": false, "twentyGameCapacityAccepted": false, "calls": f.rows}
	data, _ := json.MarshalIndent(report, "", "  ")
	if e := os.WriteFile(filepath.Join(os.Getenv("GL3_CHECKPOINT_EVIDENCE"), "completed-native.json"), append(data, '\n'), 0600); e != nil {
		t.Fatal(e)
	}
}
