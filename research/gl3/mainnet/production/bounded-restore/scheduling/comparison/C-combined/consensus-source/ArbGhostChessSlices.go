// SPDX-License-Identifier: GPL-3.0-or-later
// Experimental resumable STF. No synchronous play method exists in this ABI.
package precompiles

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"sync"

	sliced "github.com/Gh0stllm/GH0ST/gl3/slicedchess"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/arbitrum/multigas"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/tracing"
	"github.com/ethereum/go-ethereum/core/vm"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/offchainlabs/nitro/arbos/burn"
	"github.com/offchainlabs/nitro/arbos/storage"
)

const GhostChessSlicesABI = `[
 {"name":"newGame","type":"function","stateMutability":"nonpayable","inputs":[{"name":"job","type":"bytes32"}],"outputs":[{"name":"root","type":"bytes32"}]},
 {"name":"releaseGame","type":"function","stateMutability":"nonpayable","inputs":[{"name":"job","type":"bytes32"}],"outputs":[{"name":"released","type":"bool"}]},
 {"name":"begin","type":"function","stateMutability":"nonpayable","inputs":[{"name":"job","type":"bytes32"},{"name":"generation","type":"uint64"},{"name":"history","type":"string"}],"outputs":[{"name":"step","type":"uint32"},{"name":"pending","type":"bool"},{"name":"root","type":"bytes32"}]},
 {"name":"advance","type":"function","stateMutability":"nonpayable","inputs":[{"name":"job","type":"bytes32"},{"name":"generation","type":"uint64"},{"name":"expectedStep","type":"uint32"}],"outputs":[{"name":"step","type":"uint32"},{"name":"pending","type":"bool"},{"name":"root","type":"bytes32"}]},
 {"name":"inspect","type":"function","stateMutability":"view","inputs":[{"name":"job","type":"bytes32"}],"outputs":[{"name":"generation","type":"uint64"},{"name":"step","type":"uint32"},{"name":"pending","type":"bool"},{"name":"observedNodes","type":"uint64"},{"name":"move","type":"string"},{"name":"actualNodes","type":"uint64"},{"name":"depth","type":"uint32"},{"name":"root","type":"bytes32"}]}
]`

type ArbGhostChessSlices struct{ Address addr }

func makeGhostChessSlicesPrecompile() (addr, *Precompile) {
	return MakePrecompile(&bind.MetaData{ABI: GhostChessSlicesABI}, &ArbGhostChessSlices{Address: common.HexToAddress("0xa14")})
}

var sliceSeedNamespace = crypto.Keccak256([]byte("GL3_CHESS_SLICE_SEED_V1"))
var slicePrefix = []byte{0, 'G', 'L', '3', 'S', 1}

type sliceMeta struct {
	Version          uint32
	Module           [32]byte
	Root             [32]byte
	MemoryBytes      uint32
	Globals          []sliced.Global
	Generation       uint64
	SearchGeneration uint64
	Operation        uint32
	Head             [32]byte
	Deltas           uint32
	DeltaBytes       uint32
	Released         bool
	History          string
	Request          string
	Progress         sliced.Progress
}
type sliceCache struct {
	VM    *sliced.VM
	Image sliced.Image
	Tree  *sliced.Tree
	Root  [32]byte
	Codes map[addr]common.Hash
}

var sliceCaches = struct {
	sync.Mutex
	Items map[string]*sliceCache
}{Items: make(map[string]*sliceCache)}
var sliceSimulationTokens = make(chan struct{}, 1)
var sliceReservation = []byte("GL3_CHESS_RETAINED_GAME_SLOT_V1")

func sliceNamespace(owner addr, job bytes32) []byte {
	return crypto.Keccak256([]byte("GL3_CHESS_SLICE_JOB_V1"), owner[:], job[:])
}
func slicePageAddress(ns []byte, i int) addr {
	var n [8]byte
	binary.BigEndian.PutUint64(n[:], uint64(i))
	return common.BytesToAddress(crypto.Keccak256([]byte("GL3_CHESS_SLICE_CELL_V1"), ns, n[:])[12:])
}
func sliceStore(db vm.StateDB, b burn.Burner, ns []byte) *storage.Storage {
	return storage.NewGeth(db, b).OpenSubStorage([]byte("GL3_CHESS_SLICE_META_V1")).OpenSubStorage(ns)
}
func sliceMetaRead(s *storage.Storage) (sliceMeta, error) {
	var m sliceMeta
	n, e := s.GetBytesSize()
	if e != nil || n == 0 || n > 16384 {
		return m, errGhostChess
	}
	b, e := s.GetBytes()
	if e != nil || json.Unmarshal(b, &m) != nil || m.Version != 2 || m.Module != sliced.ModuleSHA || m.MemoryBytes == 0 || m.MemoryBytes > sliced.MaxMemory || m.MemoryBytes%65536 != 0 || len(m.History) > 8192 || len(m.Request) > 8192 || m.Generation == 0 || m.Deltas > sliceMaxDeltas {
		return m, errGhostChess
	}
	return m, nil
}
func sliceMetaWrite(s *storage.Storage, m sliceMeta) error {
	b, e := json.Marshal(m)
	if e != nil || len(b) > 16384 {
		return errGhostChess
	}
	return s.SetBytes(b)
}
func sliceZero(page []byte) bool {
	for _, x := range page {
		if x != 0 {
			return false
		}
	}
	return true
}
func sliceEncode(page []byte) []byte {
	if sliceZero(page) {
		return bytes.Clone(slicePrefix)
	}
	out := make([]byte, len(slicePrefix)+len(page))
	copy(out, slicePrefix)
	copy(out[len(slicePrefix):], page)
	return out
}
func sliceDecode(code []byte) ([]byte, error) {
	if !bytes.HasPrefix(code, slicePrefix) || (len(code) != len(slicePrefix) && len(code) != len(slicePrefix)+sliced.PageSize) {
		return nil, errGhostChess
	}
	b := make([]byte, sliced.PageSize)
	copy(b, code[len(slicePrefix):])
	return b, nil
}

// Genesis import is not an ABI method. It commits the complete initialized VM,
// including the full network; no host model or external result is read by STF.
func SeedGhostChessSlicesGenesis(db vm.StateDB, im sliced.Image) error {
	if len(im.Memory) == 0 || len(im.Memory) > sliced.MaxMemory || len(im.Memory)%65536 != 0 {
		return errGhostChess
	}
	tree := sliced.NewTree(im.Memory)
	for i := 0; i < len(im.Memory)/sliced.PageSize; i++ {
		b := im.Memory[i*sliced.PageSize : (i+1)*sliced.PageSize]
		if sliceZero(b) {
			continue
		}
		db.SetCode(slicePageAddress(sliceSeedNamespace, i), sliceEncode(b), tracing.CodeChangeUnspecified)
	}
	return sliceMetaWrite(sliceStore(db, burn.NewSystemBurner(nil, false), sliceSeedNamespace), sliceMeta{Version: 2, Module: sliced.ModuleSHA, Root: tree.Root(len(im.Memory), im.Globals), MemoryBytes: uint32(len(im.Memory)), Globals: im.Globals, Generation: 1})
}
func sliceLoad(c ctx, evm mech, ns []byte, m sliceMeta) (*sliceCache, error) {
	// Charge the exact same seed reads on every invocation. Moving these reads
	// inside only the cache-miss path changes consensus gas and block hashes.
	seed, e := sliceMetaRead(sliceStore(evm.StateDB, c, sliceSeedNamespace))
	if e != nil {
		return nil, e
	}
	if m.MemoryBytes < seed.MemoryBytes {
		return nil, errGhostChess
	}
	key := string(ns)
	if cached := sliceCaches.Items[key]; cached != nil && cached.Root == m.Root {
		// Reorgs/OOG invalidate the root key. Check actual reserved code identities as
		// well, so a stale cached engine cannot hide changed authoritative pages.
		// In the normal profile these STOP cells are sealed: no contract may call
		// them to change code, and only this STF writes them together with Root.
		// ArbDebug can bypass that invariant, so debug-enabled research profiles
		// retain the full identity sweep. Public/fast tests keep ArbDebug DISABLED.
		if evm.ChainConfig().ArbitrumChainParams.AllowDebugPrecompiles {
			for address, want := range cached.Codes {
				if evm.StateDB.GetCodeHash(address) != want {
					return nil, errGhostChess
				}
			}
		}
		return cached, nil
	}
	out, e := sliceRestoreSeed(evm, m, seed)
	if e != nil {
		return nil, e
	}
	if old := sliceCaches.Items[key]; old != nil {
		old.VM.Close()
	}
	if len(sliceCaches.Items) >= 2 {
		for k, old := range sliceCaches.Items {
			old.VM.Close()
			delete(sliceCaches.Items, k)
			break
		}
	}
	sliceCaches.Items[key] = out
	return out, nil
}
func sliceRestore(c ctx, evm mech, m sliceMeta) (*sliceCache, error) {
	seed, e := sliceMetaRead(sliceStore(evm.StateDB, c, sliceSeedNamespace))
	if e != nil {
		return nil, e
	}
	return sliceRestoreSeed(evm, m, seed)
}
func sliceRestoreSeed(evm mech, m sliceMeta, seed sliceMeta) (*sliceCache, error) {
	if m.MemoryBytes < seed.MemoryBytes {
		return nil, errGhostChess
	}
	im := sliced.Image{Memory: make([]byte, m.MemoryBytes), Globals: m.Globals}
	codes := map[addr]common.Hash{}
	var restoreBytes uint64
	for i := 0; i < int(seed.MemoryBytes)/sliced.PageSize; i++ {
		address := slicePageAddress(sliceSeedNamespace, i)
		code := sliceReadImmutableChessCode(evm.StateDB, address)
		sliceRestoreSchedule(&restoreBytes, len(code))
		codes[address] = evm.StateDB.GetCodeHash(address)
		if len(code) > 0 {
			b, e := sliceDecode(code)
			if e != nil {
				return nil, e
			}
			copy(im.Memory[i*sliced.PageSize:], b)
		}
	}
	if e := sliceApplyDeltas(evm.StateDB, m, im.Memory, codes); e != nil {
		return nil, e
	}
	tree := sliced.NewTree(im.Memory)
	if tree.Root(len(im.Memory), im.Globals) != m.Root {
		return nil, errGhostChess
	}
	sliceRestoreBeforeCompanion()
	r, e := sliced.Shared()
	if e != nil {
		return nil, e
	}
	v, e := r.Instantiate()
	if e != nil {
		return nil, e
	}
	if e = v.Restore(im); e != nil {
		v.Close()
		return nil, e
	}
	return &sliceCache{VM: v, Image: im, Tree: tree, Root: m.Root, Codes: codes}, nil
}
func sliceCommit(c ctx, evm mech, ns []byte, m *sliceMeta, cache *sliceCache) error {
	mem := cache.VM.Memory()
	if len(mem) > sliced.MaxMemory {
		return errGhostChess
	}
	old := len(cache.Image.Memory)
	before := cache.Image.Memory
	if len(mem) > old {
		cache.Image.Memory = append(cache.Image.Memory, make([]byte, len(mem)-old)...)
	}
	body := make([]byte, 44, 512*1024)
	copy(body, []byte("GSD1"))
	copy(body[4:36], m.Head[:])
	binary.LittleEndian.PutUint32(body[36:40], uint32(len(mem)))
	var words uint32
	var changed []int
	e := sliced.Diff(before, mem, func(i int, page []byte) error {
		offset := i * sliced.PageSize
		for at := 0; at < len(page); at += sliceWord {
			if offset+at >= old || !bytes.Equal(before[offset+at:offset+at+sliceWord], page[at:at+sliceWord]) {
				var position [4]byte
				binary.LittleEndian.PutUint32(position[:], uint32(offset+at))
				body = append(body, position[:]...)
				body = append(body, page[at:at+sliceWord]...)
				words++
			}
		}
		cache.Tree.SetLeaf(i, page)
		changed = append(changed, i)
		copy(cache.Image.Memory[offset:], page)
		return nil
	})
	if e != nil {
		return e
	}
	binary.LittleEndian.PutUint32(body[40:44], words)
	head, e := sliceWriteDelta(c, evm.StateDB, body)
	if e != nil {
		return e
	}
	m.Head = head
	m.Deltas++
	m.DeltaBytes = uint32(len(body))
	for i := 0; i < (len(body)+sliceBlobPage-1)/sliceBlobPage; i++ {
		address := sliceDeltaAddress(head, i)
		cache.Codes[address] = evm.StateDB.GetCodeHash(address)
	}
	cache.Tree.Flush(changed)
	cache.Image.Globals = cache.VM.Globals()
	m.Globals = cache.Image.Globals
	m.MemoryBytes = uint32(len(mem))
	m.Root = cache.Tree.Root(len(mem), m.Globals)
	cache.Root = m.Root
	return sliceMetaWrite(sliceStore(evm.StateDB, c, ns), *m)
}
func (p ArbGhostChessSlices) NewGame(c ctx, evm mech, job bytes32) (bytes32, error) {
	allowed, e := c.State.ChainOwners().IsMember(c.caller)
	if e != nil || !allowed {
		return bytes32{}, errGhostChess
	}
	reservation := sliceStore(evm.StateDB, c, sliceReservation)
	active, e := reservation.GetBytes()
	if e != nil || len(active) != 0 {
		return bytes32{}, errGhostChess
	}
	ns := sliceNamespace(c.caller, job)
	store := sliceStore(evm.StateDB, c, ns)
	n, e := store.GetBytesSize()
	if e != nil || n != 0 {
		return bytes32{}, errGhostChess
	}
	seed, e := sliceMetaRead(sliceStore(evm.StateDB, c, sliceSeedNamespace))
	if e != nil {
		return bytes32{}, e
	}
	if e = sliceMetaWrite(store, seed); e != nil {
		return bytes32{}, e
	}
	if e = reservation.SetBytes(ns); e != nil {
		return bytes32{}, e
	}
	return seed.Root, nil
}
func (p ArbGhostChessSlices) ReleaseGame(c ctx, evm mech, job bytes32) (bool, error) {
	ns := sliceNamespace(c.caller, job)
	store := sliceStore(evm.StateDB, c, ns)
	m, e := sliceMetaRead(store)
	if e != nil {
		return false, e
	}
	if m.Released {
		return true, nil
	}
	reservation := sliceStore(evm.StateDB, c, sliceReservation)
	active, e := reservation.GetBytes()
	if e != nil || !bytes.Equal(active, ns) {
		return false, errGhostChess
	}
	m.Released = true
	if m.Progress.Pending {
		m.Progress = sliced.Progress{}
	}
	if e = sliceMetaWrite(store, m); e != nil {
		return false, e
	}
	if e = reservation.SetBytes(nil); e != nil {
		return false, e
	}
	if !c.txProcessor.MsgIsNonMutating() && !c.txProcessor.GhostChessIsObserver() {
		sliceCaches.Lock()
		if cached := sliceCaches.Items[string(ns)]; cached != nil {
			cached.VM.Close()
			delete(sliceCaches.Items, string(ns))
		}
		sliceCaches.Unlock()
	}
	return true, nil
}
func (p ArbGhostChessSlices) Begin(c ctx, evm mech, job bytes32, generation uint64, history string) (uint32, bool, bytes32, error) {
	ns := sliceNamespace(c.caller, job)
	store := sliceStore(evm.StateDB, c, ns)
	m, e := sliceMetaRead(store)
	if e != nil {
		return 0, false, bytes32{}, e
	}
	if m.Released || m.Progress.Pending || generation != m.Generation || generation == ^uint64(0) || history == "" || len(history) > 8192 {
		return 0, false, bytes32{}, errGhostChess
	}
	if !validSliceHistory(m.History, history) {
		return 0, false, bytes32{}, errGhostChess
	}
	return sliceRun(c, evm, ns, m, true, history)
}
func (p ArbGhostChessSlices) Advance(c ctx, evm mech, job bytes32, generation uint64, expectedStep uint32) (uint32, bool, bytes32, error) {
	ns := sliceNamespace(c.caller, job)
	m, e := sliceMetaRead(sliceStore(evm.StateDB, c, ns))
	if e != nil {
		return 0, false, bytes32{}, e
	}
	if m.Released || generation != m.SearchGeneration {
		return 0, false, bytes32{}, errGhostChess
	}
	if expectedStep > 0 && expectedStep+1 == m.Operation {
		if evm.ChainConfig().ArbitrumChainParams.AllowDebugPrecompiles {
			if c.txProcessor.MsgIsNonMutating() || c.txProcessor.GhostChessIsObserver() {
				if !sliceTakeIsolated(c.txProcessor.MsgIsNonMutating()) {
					return 0, false, bytes32{}, errGhostChess
				}
				defer func() { <-sliceSimulationTokens }()
				cache, e := sliceRestore(c, evm, m)
				if e != nil {
					return 0, false, bytes32{}, e
				}
				cache.VM.Close()
			} else {
				sliceCaches.Lock()
				defer sliceCaches.Unlock()
				if _, e = sliceLoad(c, evm, ns, m); e != nil {
					return 0, false, bytes32{}, e
				}
			}
		}
		return m.Operation, m.Progress.Pending, m.Root, nil
	}
	if !m.Progress.Pending || expectedStep != m.Operation || expectedStep == 0 || expectedStep == ^uint32(0) {
		return 0, false, bytes32{}, errGhostChess
	}
	return sliceRun(c, evm, ns, m, false, "")
}
func sliceRun(c ctx, evm mech, ns []byte, m sliceMeta, begin bool, history string) (uint32, bool, bytes32, error) {
	fail := func(e error) (uint32, bool, bytes32, error) { return 0, false, bytes32{}, e }
	if m.Deltas >= sliceMaxDeltas {
		return fail(errGhostChess)
	}
	// A single global compute slot per block prevents many short jobs from being
	// packed together into another long blocking block. Ordinary EVM work remains
	// available; retries that do no work do not consume this slot.
	budgetStore := sliceStore(evm.StateDB, c, []byte("GL3_CHESS_GLOBAL_SLICE_BUDGET_V1"))
	last, e := budgetStore.GetBytes()
	if e != nil {
		return fail(e)
	}
	if !evm.Context.BlockNumber.IsUint64() {
		return fail(errGhostChess)
	}
	block := evm.Context.BlockNumber.Uint64()
	if len(last) != 0 && (len(last) != 8 || binary.LittleEndian.Uint64(last) == block) {
		return fail(errGhostChess)
	}
	// A reviewed production tariff remains a separate gate. This research charge
	// includes a fixed bound for authenticated page identities plus actual writes.
	if e := c.Burn(multigas.ResourceKindComputation, uint64(sliced.Quantum*sliceGroup)*20+uint64(m.MemoryBytes/sliced.PageSize)*100); e != nil {
		return fail(e)
	}
	rpc := c.txProcessor.MsgIsNonMutating()
	isolated := rpc || c.txProcessor.GhostChessIsObserver()
	var cache *sliceCache
	if isolated {
		// Recording must read every proof dependency, even if another execution
		// has a matching cached image. RPC/recording/replay/prefetch must also
		// never evict the live cache or hold its lock during reconstruction.
		if !sliceTakeIsolated(rpc) {
			return fail(errGhostChess)
		}
		defer func() { <-sliceSimulationTokens }()
		cache, e = sliceRestore(c, evm, m)
		if e == nil {
			defer cache.VM.Close()
		}
	} else {
		sliceCaches.Lock()
		defer sliceCaches.Unlock()
		cache, e = sliceLoad(c, evm, ns, m)
	}
	if e != nil {
		return fail(e)
	}
	// Invalidate BEFORE execution: a trap, OOG or outer EVM revert must never make
	// an advanced process reachable under the old authoritative root.
	if !isolated {
		delete(sliceCaches.Items, string(ns))
	}
	if begin {
		m.Operation = 0
		m.Request = history
		m.SearchGeneration = m.Generation
		m.Progress, e = cache.VM.Begin(history)
	} else {
		m.Progress, e = cache.VM.Advance()
	}
	if e != nil {
		cache.VM.Close()
		return fail(e)
	}
	for i := 1; i < sliceGroup && m.Progress.Pending; i++ {
		m.Progress, e = cache.VM.Advance()
		if e != nil {
			cache.VM.Close()
			return fail(e)
		}
	}
	m.Operation++
	if !m.Progress.Pending {
		m.Generation++
		m.History = m.Request + " " + m.Progress.Move
	}
	if e = sliceCommit(c, evm, ns, &m, cache); e != nil {
		cache.VM.Close()
		return fail(e)
	}
	var encodedBlock [8]byte
	binary.LittleEndian.PutUint64(encodedBlock[:], block)
	if e = budgetStore.SetBytes(encodedBlock[:]); e != nil {
		cache.VM.Close()
		return fail(e)
	}
	if !isolated {
		sliceCaches.Items[string(ns)] = cache
	}
	return m.Operation, m.Progress.Pending, m.Root, nil
}
func sliceTakeIsolated(rpc bool) bool {
	if !rpc {
		sliceSimulationTokens <- struct{}{}
		return true
	}
	select {
	case sliceSimulationTokens <- struct{}{}:
		return true
	default:
		return false
	}
}
func (p ArbGhostChessSlices) Inspect(c ctx, evm mech, job bytes32) (uint64, uint32, bool, uint64, string, uint64, uint32, bytes32, error) {
	m, e := sliceMetaRead(sliceStore(evm.StateDB, c, sliceNamespace(c.caller, job)))
	if e != nil {
		return 0, 0, false, 0, "", 0, 0, bytes32{}, e
	}
	r := m.Progress
	return m.Generation, m.Operation, r.Pending, r.Observed, r.Move, r.Nodes, r.Depth, m.Root, nil
}
