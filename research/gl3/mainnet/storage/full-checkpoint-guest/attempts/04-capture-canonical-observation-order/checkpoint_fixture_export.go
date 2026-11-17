//go:build gl3_checkpoint_integration && gl3_checkpoint_capture

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
	"github.com/ethereum/go-ethereum/arbitrum/multigas"
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
	"github.com/ethereum/go-ethereum/params"
	"github.com/ethereum/go-ethereum/rlp"
	"github.com/ethereum/go-ethereum/triedb"
	"github.com/holiman/uint256"
	"github.com/offchainlabs/nitro/arbos"
	"github.com/offchainlabs/nitro/arbos/arbosState"
	"github.com/offchainlabs/nitro/arbos/burn"
	"github.com/offchainlabs/nitro/arbos/storage"
	"github.com/offchainlabs/nitro/cmd/chaininfo"
	"github.com/offchainlabs/nitro/statetransfer"
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
	evm.SetPrecompiles(vm.PrecompiledContracts{address: cpCaptureEVMBridge{p}, la: cpCaptureEVMBridge{lp}})
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

// This bridge and importer are build-tagged private test helpers only. They add
// no ABI and are absent from the matching guest/production builds.
type cpCaptureEVMBridge struct{ inner ArbosPrecompile }

func (p cpCaptureEVMBridge) Name() string               { return p.inner.Name() }
func (p cpCaptureEVMBridge) RequiredGas([]byte) uint64  { panic("advanced only") }
func (p cpCaptureEVMBridge) Run([]byte) ([]byte, error) { panic("advanced only") }
func (p cpCaptureEVMBridge) RunAdvanced(input []byte, gas uint64, info *vm.AdvancedPrecompileCall) ([]byte, vm.GasBudget, multigas.MultiGas, error) {
	info.Evm.IncrementDepth()
	defer info.Evm.DecrementDepth()
	out, left, used, e := p.inner.Call(input, info.ActingAsAddress, info.Caller, info.Value, info.ReadOnly, gas, info.Evm)
	return out, vm.NewGasBudget(left, 0), used, e
}

type cpCaptureGenesisRecorder struct {
	vm.StateDB
	accounts map[common.Address]*statetransfer.AccountInitContractInfo
}

func (r *cpCaptureGenesisRecorder) account(a common.Address) *statetransfer.AccountInitContractInfo {
	if r.accounts[a] == nil {
		r.accounts[a] = &statetransfer.AccountInitContractInfo{ContractStorage: map[common.Hash]common.Hash{}}
	}
	return r.accounts[a]
}
func (r *cpCaptureGenesisRecorder) SetState(a common.Address, k, v common.Hash) common.Hash {
	r.account(a).ContractStorage[k] = v
	return r.StateDB.SetState(a, k, v)
}

func GhostCheckpointInitForCapture(t *testing.T, owner common.Address) ([32]byte, []statetransfer.AccountInitializationInfo, map[string]any) {
	t.Helper()
	f := cpOpenCompletedFixture(t)
	original := f.meta(t)
	sourceOwner := f.owner
	// Namespace relocation is private genesis preparation, not an exposed transfer.
	// It changes no engine/image/TT/history bytes and is recorded explicitly.
	if owner != f.owner {
		f.owner = owner
		sys := burn.NewSystemBurner(nil, false)
		if e := sliceMetaWrite(sliceStore(f.db, sys, cpNamespace(owner, f.job)), original); e != nil {
			t.Fatal(e)
		}
		if e := sliceStore(f.db, sys, sliceReservation).SetBytes(cpNamespace(owner, f.job)); e != nil {
			t.Fatal(e)
		}
	}
	nonce := f.must(t, "checkpointBegin", f.job, original.Generation, original.Root)[0].(uint64)
	for b := f.builder(t); b.Cursor < b.MemoryBytes; b = f.builder(t) {
		f.must(t, "checkpointWork", f.job, original.Generation, nonce, b.Cursor)
	}
	for b := f.builder(t); b.Verified < uint32(len(b.Pieces)); b = f.builder(t) {
		f.must(t, "checkpointVerify", f.job, original.Generation, nonce, b.Verified)
	}
	f.must(t, "checkpointFinalize", f.job, original.Generation, nonce)
	m, b := f.meta(t), f.builder(t)
	if m.Deltas != 64 || !cpCheckpointReady(m, b, owner, f.job) {
		t.Fatal("checkpoint/admission mismatch")
	}
	f.dropCache()
	canonical, mem, root, e := GhostCheckpointCanonicalForCapture(f.db, f.evm.ChainConfig(), f.evm.Context.BlockNumber.Uint64(), owner, f.job)
	if e != nil || canonical != "5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6" || mem != 466157568 || root != m.Root {
		t.Fatal("exact completed canonical import", e)
	}
	empty, e := state.New(types.EmptyRootHash, state.NewDatabaseForTesting())
	if e != nil {
		t.Fatal(e)
	}
	rec := &cpCaptureGenesisRecorder{StateDB: empty, accounts: map[common.Address]*statetransfer.AccountInitContractInfo{}}
	sys := burn.NewSystemBurner(nil, false)
	seed, e := sliceMetaRead(sliceStore(f.db, sys, sliceSeedNamespace))
	if e != nil {
		t.Fatal(e)
	}
	var codeBytes uint64
	addCode := func(a common.Address) {
		code := f.db.GetCodeUncached(a)
		if len(code) > 0 {
			rec.account(a).Code = append([]byte(nil), code...)
			codeBytes += uint64(len(code))
		}
	}
	for i := 0; i < int(seed.MemoryBytes)/4096; i++ {
		addCode(slicePageAddress(sliceSeedNamespace, i))
	}
	head := m.Head
	for i := uint32(0); i < m.Deltas; i++ {
		body, e := sliceReadDelta(f.db, head)
		if e != nil {
			t.Fatal(e)
		}
		for j := 0; j < (len(body)+sliceBlobPage-1)/sliceBlobPage; j++ {
			addCode(sliceDeltaAddress(head, j))
		}
		copy(head[:], body[4:36])
	}
	if head != ([32]byte{}) {
		t.Fatal("checkpoint predecessor not zero")
	}
	if e := sliceMetaWrite(sliceStore(rec, sys, sliceSeedNamespace), seed); e != nil {
		t.Fatal(e)
	}
	if e := sliceMetaWrite(sliceStore(rec, sys, cpNamespace(owner, f.job)), m); e != nil {
		t.Fatal(e)
	}
	if e := cpWrite(storage.NewGeth(rec, sys).OpenSubStorage([]byte("GL3_CHESS_CHECKPOINT_BUILDER_V1")).OpenSubStorage(cpNamespace(owner, f.job)), b); e != nil {
		t.Fatal(e)
	}
	if e := sliceStore(rec, sys, sliceReservation).SetBytes(cpNamespace(owner, f.job)); e != nil {
		t.Fatal(e)
	}
	accounts := make([]statetransfer.AccountInitializationInfo, 0, len(rec.accounts))
	for a, info := range rec.accounts {
		accounts = append(accounts, statetransfer.AccountInitializationInfo{Addr: a, Nonce: f.db.GetNonce(a), EthBalance: f.db.GetBalance(a).ToBig(), ContractInfo: info})
	}
	if e := f.db.Error(); e != nil {
		t.Fatal(e)
	}
	return f.job, accounts, map[string]any{"sourceOwner": sourceOwner, "privateGenesisOwner": owner, "namespaceRelocated": sourceOwner != owner, "memoryBytes": mem, "canonicalBytes": 163085439, "canonicalSHA256": canonical, "imageRoot": fmt.Sprintf("%x", root), "checkpointHead": fmt.Sprintf("%x", m.Head), "pieces": m.Deltas, "checkpointBodyBytes": b.BodyBytes, "importedCodeBytes": codeBytes, "importedAccounts": len(accounts), "engineSearchExecuted": false, "privateGenesisImportOnly": true, "noPublicImportABI": true}
}

func GhostCheckpointCanonicalForCapture(db *state.StateDB, config *params.ChainConfig, block uint64, owner common.Address, job [32]byte) (string, int, [32]byte, error) {
	sys := burn.NewSystemBurner(nil, false)
	m, e := sliceMetaRead(sliceStore(db, sys, cpNamespace(owner, job)))
	if e != nil {
		return "", 0, [32]byte{}, e
	}
	seed, e := sliceMetaRead(sliceStore(db, sys, sliceSeedNamespace))
	if e != nil {
		return "", 0, [32]byte{}, e
	}
	evm := vm.NewEVM(vm.BlockContext{BlockNumber: new(big.Int).SetUint64(block), GasLimit: ^uint64(0), Transfer: core.Transfer, CanTransfer: core.CanTransfer}, db, config, vm.Config{})
	cold, e := sliceRestoreSeed(evm, m, seed)
	if e != nil {
		return "", 0, [32]byte{}, e
	}
	defer cold.VM.Close()
	if fmt.Sprintf("%x", sha256.Sum256(cold.VM.Memory())) != "26ade604551c291ab4d6e2194dbf45a4cfb8f895d914443d3740ac55422a92f7" {
		return "", 0, [32]byte{}, errors.New("completed memory SHA mismatch")
	}
	canonical, e := cold.VM.Canonical()
	if e != nil {
		return "", 0, [32]byte{}, e
	}
	return fmt.Sprintf("%x", sha256.Sum256(canonical)), len(cold.VM.Memory()), cold.Tree.Root(len(cold.Image.Memory), m.Globals), nil
}
