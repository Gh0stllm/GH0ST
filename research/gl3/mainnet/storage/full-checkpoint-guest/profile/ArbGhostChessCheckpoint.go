//go:build gl3_checkpoint_integration

// Isolated opt-in A15 profile. Legacy A14/runtime/tree sources stay unchanged.
package precompiles

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"math"
	"sync"

	sliced "github.com/Gh0stllm/GH0ST/gl3/slicedchess"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/arbitrum/multigas"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/offchainlabs/nitro/arbos/burn"
	"github.com/offchainlabs/nitro/arbos/storage"
)

const cpMemoryRange = 7 * 1024 * 1024
const cpPieceMaximum = 8 * 1024 * 1024
const cpMaxPieces = (768*1024*1024 + cpMemoryRange - 1) / cpMemoryRange

type ArbGhostChessCheckpoint struct{ Address addr }

func makeGhostChessCheckpointPrecompile() (addr, *Precompile) {
	return MakePrecompile(&bind.MetaData{ABI: GhostChessCheckpointABI}, &ArbGhostChessCheckpoint{Address: common.HexToAddress("0xa15")})
}
func cpNamespace(owner addr, job bytes32) []byte {
	return crypto.Keccak256([]byte("GL3_CHESS_CHECKPOINT_PROFILE_JOB_V1"), owner[:], job[:])
}
func cpStore(c ctx, evm mech, ns []byte) *storage.Storage {
	return storage.NewGeth(evm.StateDB, c).OpenSubStorage([]byte("GL3_CHESS_CHECKPOINT_BUILDER_V1")).OpenSubStorage(ns)
}

type cpState struct {
	Version     uint32
	Nonce       uint64
	Active      bool
	Owner       addr
	Job         bytes32
	Generation  uint64
	FrozenMeta  [32]byte
	Root        [32]byte
	OldHead     [32]byte
	OldDeltas   uint32
	MemoryBytes uint32
	Cursor      uint32
	Head        [32]byte
	Pieces      [][32]byte
	Verified    uint32
	BodyBytes   uint64
}

func cpRead(s *storage.Storage) (cpState, error) {
	var b cpState
	n, e := s.GetBytesSize()
	if e != nil {
		return b, e
	}
	if n == 0 {
		return cpState{Version: 1}, nil
	}
	if n > 32768 {
		return b, errGhostChess
	}
	data, e := s.GetBytes()
	if e != nil || json.Unmarshal(data, &b) != nil || b.Version != 1 || len(b.Pieces) > cpMaxPieces || b.Verified > uint32(len(b.Pieces)) || b.Cursor > b.MemoryBytes {
		return b, errGhostChess
	}
	return b, nil
}
func cpWrite(s *storage.Storage, b cpState) error {
	data, e := json.Marshal(b)
	if e != nil || len(data) > 32768 {
		return errGhostChess
	}
	return s.SetBytes(data)
}
func cpMetaHash(m sliceMeta) [32]byte { data, _ := json.Marshal(m); return sha256.Sum256(data) }
func cpBacking(m sliceMeta) [32]byte {
	var b [68]byte
	copy(b[:32], m.Root[:])
	copy(b[32:64], m.Head[:])
	binary.LittleEndian.PutUint32(b[64:], m.Deltas)
	return sha256.Sum256(b[:])
}
func cpMutating(c ctx) bool {
	return !c.txProcessor.MsgIsNonMutating() && !c.txProcessor.GhostChessIsObserver()
}

// Native maps are accelerators only. Recording/RPC paths always use the existing
// isolated authenticated restoration, never a host cache as an authority.
type cpNativeBuild struct {
	Nonce    uint64
	Cursor   uint32
	Identity [32]byte
	Codes    map[addr]common.Hash
	Usable   bool
}

// Bind an accelerator to its exact onchain source and immutable piece prefix.
// Verification counters do not change its code set.
func cpBuildIdentity(b cpState) [32]byte {
	b.Verified = 0
	b.Active = true
	data, _ := json.Marshal(b)
	return sha256.Sum256(data)
}

var cpNative = struct {
	sync.Mutex
	Tags   map[string][32]byte
	Builds map[string]*cpNativeBuild
}{Tags: map[string][32]byte{}, Builds: map[string]*cpNativeBuild{}}

func cpPrepare(ns []byte, m sliceMeta) {
	key := string(ns)
	sliceCaches.Lock()
	defer sliceCaches.Unlock()
	cache := sliceCaches.Items[key]
	if cache == nil {
		return
	}
	cpNative.Lock()
	tag, ok := cpNative.Tags[key]
	cpNative.Unlock()
	if !ok || tag != cpBacking(m) || cache.Codes == nil {
		cache.VM.Close()
		delete(sliceCaches.Items, key)
	}
}
func cpSliceRun(c ctx, evm mech, ns []byte, m sliceMeta, begin bool, history string) (uint32, bool, bytes32, error) {
	if cpMutating(c) {
		cpPrepare(ns, m)
	}
	step, pending, root, e := sliceRun(c, evm, ns, m, begin, history)
	if e == nil && cpMutating(c) {
		next, err := sliceMetaRead(sliceStore(evm.StateDB, burn.NewSystemBurner(nil, false), ns))
		if err != nil {
			return 0, false, bytes32{}, err
		}
		cpNative.Lock()
		cpNative.Tags[string(ns)] = cpBacking(next)
		cpNative.Unlock()
	}
	return step, pending, root, e
}
func cpGameUnlocked(c ctx, evm mech, job bytes32) error {
	if evm.ChainConfig().ArbitrumChainParams.AllowDebugPrecompiles {
		return errGhostChess
	}
	b, e := cpRead(cpStore(c, evm, cpNamespace(c.caller, job)))
	if e != nil {
		return e
	}
	if b.Active {
		return errGhostChess
	}
	return nil
}
func cpLocked(c ctx, evm mech, job bytes32, generation, nonce uint64) ([]byte, sliceMeta, cpState, error) {
	ns := cpNamespace(c.caller, job)
	m, e := sliceMetaRead(sliceStore(evm.StateDB, c, ns))
	if e != nil {
		return ns, m, cpState{}, e
	}
	b, e := cpRead(cpStore(c, evm, ns))
	if e != nil {
		return ns, m, b, e
	}
	if evm.ChainConfig().ArbitrumChainParams.AllowDebugPrecompiles || !b.Active || b.Owner != c.caller || b.Job != job || b.Nonce != nonce || b.Generation != generation || m.Generation != generation || m.Released || m.Progress.Pending || b.FrozenMeta != cpMetaHash(m) || b.Root != m.Root || b.OldHead != m.Head || b.OldDeltas != m.Deltas || b.MemoryBytes != m.MemoryBytes {
		return ns, m, b, errGhostChess
	}
	return ns, m, b, nil
}
func cpBudget(c ctx, evm mech) (*storage.Storage, uint64, error) {
	s := sliceStore(evm.StateDB, c, []byte("GL3_CHESS_GLOBAL_SLICE_BUDGET_V1"))
	last, e := s.GetBytes()
	if e != nil || !evm.Context.BlockNumber.IsUint64() {
		return s, 0, errGhostChess
	}
	block := evm.Context.BlockNumber.Uint64()
	if len(last) != 0 && (len(last) != 8 || binary.LittleEndian.Uint64(last) == block) {
		return s, 0, errGhostChess
	}
	return s, block, nil
}
func cpBudgetWrite(s *storage.Storage, block uint64) error {
	var n [8]byte
	binary.LittleEndian.PutUint64(n[:], block)
	return s.SetBytes(n[:])
}
func cpIsolation(rpc bool) (func(), error) {
	if !sliceTakeIsolated(rpc) {
		return nil, errGhostChess
	}
	var once sync.Once
	return func() { once.Do(func() { <-sliceSimulationTokens }) }, nil
}
func cpLoad(c ctx, evm mech, ns []byte, m sliceMeta) (*sliceCache, func(), error) {
	if evm.Cancelled() {
		return nil, nil, errGhostChess
	}
	if e := c.Burn(multigas.ResourceKindComputation, uint64(m.MemoryBytes/4096)*100); e != nil {
		return nil, nil, e
	}
	if !cpMutating(c) {
		release, e := cpIsolation(c.txProcessor.MsgIsNonMutating())
		if e != nil {
			return nil, nil, e
		}
		cache, e := sliceRestore(c, evm, m)
		if e != nil {
			release()
			return nil, nil, e
		}
		if evm.Cancelled() {
			cache.VM.Close()
			release()
			return nil, nil, errGhostChess
		}
		var once sync.Once
		cleanup := func() { once.Do(func() { defer release(); cache.VM.Close() }) }
		return cache, cleanup, nil
	}
	cpPrepare(ns, m)
	sliceCaches.Lock()
	cache, e := sliceLoad(c, evm, ns, m)
	if e != nil {
		sliceCaches.Unlock()
		return nil, nil, e
	}
	stale := false
	for a, want := range cache.Codes {
		if evm.StateDB.GetCodeHash(a) != want {
			stale = true
			break
		}
	}
	if stale {
		cache.VM.Close()
		delete(sliceCaches.Items, string(ns))
		cache, e = sliceLoad(c, evm, ns, m)
		if e != nil {
			sliceCaches.Unlock()
			return nil, nil, e
		}
	}
	if evm.Cancelled() {
		sliceCaches.Unlock()
		return nil, nil, errGhostChess
	}
	cpNative.Lock()
	cpNative.Tags[string(ns)] = cpBacking(m)
	cpNative.Unlock()
	var once sync.Once
	return cache, func() { once.Do(func() { sliceCaches.Unlock() }) }, nil
}

func (p ArbGhostChessCheckpoint) CheckpointBegin(c ctx, evm mech, job bytes32, generation uint64, expectedRoot bytes32) (uint64, error) {
	if evm.ChainConfig().ArbitrumChainParams.AllowDebugPrecompiles {
		return 0, errGhostChess
	}
	ns := cpNamespace(c.caller, job)
	m, e := sliceMetaRead(sliceStore(evm.StateDB, c, ns))
	if e != nil {
		return 0, e
	}
	b, e := cpRead(cpStore(c, evm, ns))
	if e != nil {
		return 0, e
	}
	if b.Active || m.Released || m.Progress.Pending || m.Generation < 2 || m.Generation != generation || m.Root != expectedRoot || b.Nonce == math.MaxUint64 {
		return 0, errGhostChess
	}
	// This freezes authoritative metadata only. No VM/image is allocated here;
	// each Work call later authenticates the locked source under a scoped lease.
	b = cpState{Version: 1, Nonce: b.Nonce + 1, Active: true, Owner: c.caller, Job: job, Generation: generation, FrozenMeta: cpMetaHash(m), Root: m.Root, OldHead: m.Head, OldDeltas: m.Deltas, MemoryBytes: m.MemoryBytes}
	if e = cpWrite(cpStore(c, evm, ns), b); e != nil {
		return 0, e
	}
	if cpMutating(c) {
		cpNative.Lock()
		cpNative.Builds[string(ns)] = &cpNativeBuild{Nonce: b.Nonce, Identity: cpBuildIdentity(b), Codes: map[addr]common.Hash{}, Usable: true}
		cpNative.Unlock()
	}
	return b.Nonce, nil
}
func (p ArbGhostChessCheckpoint) CheckpointWork(c ctx, evm mech, job bytes32, generation, nonce uint64, expectedCursor uint32) (uint32, bytes32, bool, error) {
	ns, m, b, e := cpLocked(c, evm, job, generation, nonce)
	if e != nil {
		return 0, bytes32{}, false, e
	}
	if b.Cursor != expectedCursor || b.Cursor >= b.MemoryBytes || b.Verified != 0 || len(b.Pieces) >= cpMaxPieces {
		return 0, bytes32{}, false, errGhostChess
	}
	budget, block, e := cpBudget(c, evm)
	if e != nil {
		return 0, bytes32{}, false, e
	}
	cache, cleanup, e := cpLoad(c, evm, ns, m)
	if e != nil {
		return 0, bytes32{}, false, e
	}
	defer cleanup()
	seed, e := sliceMetaRead(sliceStore(evm.StateDB, c, sliceSeedNamespace))
	if e != nil {
		return 0, bytes32{}, false, e
	}
	start := int(b.Cursor)
	end := start + cpMemoryRange
	if end > int(m.MemoryBytes) {
		end = int(m.MemoryBytes)
	}
	if e = c.Burn(multigas.ResourceKindComputation, uint64(end-start)/32*8); e != nil {
		return 0, bytes32{}, false, e
	}
	base := make([]byte, end-start)
	newCodes := map[addr]common.Hash{}
	for at := start; at < end && at < int(seed.MemoryBytes); at += 4096 {
		a := slicePageAddress(sliceSeedNamespace, at/4096)
		code := evm.StateDB.GetCode(a)
		newCodes[a] = evm.StateDB.GetCodeHash(a)
		if len(code) > 0 {
			page, err := sliceDecode(code)
			if err != nil {
				return 0, bytes32{}, false, err
			}
			copy(base[at-start:], page)
		}
	}
	mem := cache.VM.Memory()
	if len(mem) != int(m.MemoryBytes) {
		return 0, bytes32{}, false, errGhostChess
	}
	body := make([]byte, 44, cpPieceMaximum)
	copy(body, []byte("GSD1"))
	copy(body[4:36], b.Head[:])
	binary.LittleEndian.PutUint32(body[36:40], m.MemoryBytes)
	var count uint32
	for at := start; at < end; at += 32 {
		if bytes.Equal(mem[at:at+32], base[at-start:at-start+32]) {
			continue
		}
		var offset [4]byte
		binary.LittleEndian.PutUint32(offset[:], uint32(at))
		body = append(body, offset[:]...)
		body = append(body, mem[at:at+32]...)
		count++
	}
	binary.LittleEndian.PutUint32(body[40:44], count)
	if len(body) > cpPieceMaximum {
		return 0, bytes32{}, false, errGhostChess
	}
	head, e := sliceWriteDelta(c, evm.StateDB, body)
	if e != nil {
		return 0, bytes32{}, false, e
	}
	for i := 0; i < (len(body)+sliceBlobPage-1)/sliceBlobPage; i++ {
		a := sliceDeltaAddress(head, i)
		newCodes[a] = evm.StateDB.GetCodeHash(a)
	}
	oldIdentity := cpBuildIdentity(b)
	b.Cursor = uint32(end)
	b.Head = head
	b.Pieces = append(b.Pieces, head)
	b.BodyBytes += uint64(len(body))
	if e = cpWrite(cpStore(c, evm, ns), b); e != nil {
		return 0, bytes32{}, false, e
	}
	if e = cpBudgetWrite(budget, block); e != nil {
		return 0, bytes32{}, false, e
	}
	if cpMutating(c) {
		cpNative.Lock()
		state := cpNative.Builds[string(ns)]
		if state == nil || state.Nonce != nonce || state.Cursor != uint32(start) || state.Identity != oldIdentity || !state.Usable || state.Codes == nil {
			cpNative.Builds[string(ns)] = &cpNativeBuild{Nonce: nonce, Cursor: uint32(end), Identity: cpBuildIdentity(b), Usable: false}
		} else {
			for a, h := range newCodes {
				state.Codes[a] = h
			}
			state.Cursor = uint32(end)
			state.Identity = cpBuildIdentity(b)
		}
		cpNative.Unlock()
	}
	return b.Cursor, head, b.Cursor == b.MemoryBytes, nil
}
func (p ArbGhostChessCheckpoint) CheckpointVerify(c ctx, evm mech, job bytes32, generation, nonce uint64, expectedPiece uint32) (uint32, uint32, bool, error) {
	ns, m, b, e := cpLocked(c, evm, job, generation, nonce)
	if e != nil {
		return 0, 0, false, e
	}
	if b.Cursor != b.MemoryBytes || b.Verified != expectedPiece || b.Verified >= uint32(len(b.Pieces)) {
		return 0, 0, false, errGhostChess
	}
	budget, block, e := cpBudget(c, evm)
	if e != nil {
		return 0, 0, false, e
	}
	body, e := sliceReadDelta(evm.StateDB, b.Pieces[b.Verified])
	if e != nil {
		return 0, 0, false, e
	}
	if len(body) < 44 || len(body) > cpPieceMaximum || string(body[:4]) != "GSD1" || binary.LittleEndian.Uint32(body[36:40]) != m.MemoryBytes {
		return 0, 0, false, errGhostChess
	}
	var prior [32]byte
	copy(prior[:], body[4:36])
	if (b.Verified == 0 && prior != ([32]byte{})) || (b.Verified > 0 && prior != b.Pieces[b.Verified-1]) {
		return 0, 0, false, errGhostChess
	}
	count := binary.LittleEndian.Uint32(body[40:44])
	if uint64(len(body)) != 44+36*uint64(count) {
		return 0, 0, false, errGhostChess
	}
	start := uint64(b.Verified) * cpMemoryRange
	end := start + cpMemoryRange
	if end > uint64(m.MemoryBytes) {
		end = uint64(m.MemoryBytes)
	}
	last := -1
	if e = c.Burn(multigas.ResourceKindComputation, uint64(len(body))/32*8); e != nil {
		return 0, 0, false, e
	}
	for at := 44; at < len(body); at += 36 {
		offset := int(binary.LittleEndian.Uint32(body[at:]))
		if offset%32 != 0 || offset <= last || uint64(offset) < start || uint64(offset+32) > end {
			return 0, 0, false, errGhostChess
		}
		last = offset
	}
	b.Verified++
	if e = cpWrite(cpStore(c, evm, ns), b); e != nil {
		return 0, 0, false, e
	}
	if e = cpBudgetWrite(budget, block); e != nil {
		return 0, 0, false, e
	}
	return b.Verified, uint32(len(b.Pieces)), b.Verified == uint32(len(b.Pieces)), nil
}
func (p ArbGhostChessCheckpoint) CheckpointFinalize(c ctx, evm mech, job bytes32, generation, nonce uint64) (bytes32, bytes32, uint32, error) {
	ns, m, b, e := cpLocked(c, evm, job, generation, nonce)
	if e != nil {
		return bytes32{}, bytes32{}, 0, e
	}
	expected := (uint64(m.MemoryBytes) + cpMemoryRange - 1) / cpMemoryRange
	if b.Cursor != m.MemoryBytes || uint64(len(b.Pieces)) != expected || b.Verified != uint32(len(b.Pieces)) || len(b.Pieces) == 0 || b.Head != b.Pieces[len(b.Pieces)-1] {
		return bytes32{}, bytes32{}, 0, errGhostChess
	}
	// Every bounded piece was derived by Work and separately authenticated by
	// Verify. No API erases/rewrites these STOP cells; debug writers are disabled.
	// Finalize performs only bounded metadata checks/writes, never a source walk,
	// image decode, rehash, VM call or loop over the old delta history.
	buildIdentity := cpBuildIdentity(b)
	m.Head = b.Head
	m.Deltas = uint32(len(b.Pieces))
	b.Active = false
	if e = sliceMetaWrite(sliceStore(evm.StateDB, c, ns), m); e != nil {
		return bytes32{}, bytes32{}, 0, e
	}
	if e = cpWrite(cpStore(c, evm, ns), b); e != nil {
		return bytes32{}, bytes32{}, 0, e
	}
	if cpMutating(c) {
		sliceCaches.Lock()
		cache := sliceCaches.Items[string(ns)]
		cpNative.Lock()
		native := cpNative.Builds[string(ns)]
		if cache != nil && cache.Root == m.Root {
			if native != nil && native.Usable && native.Nonce == nonce && native.Cursor == m.MemoryBytes && native.Identity == buildIdentity {
				cache.Codes = native.Codes
			} else {
				cache.Codes = nil
			}
		}
		cpNative.Tags[string(ns)] = cpBacking(m)
		delete(cpNative.Builds, string(ns))
		cpNative.Unlock()
		sliceCaches.Unlock()
	}
	return m.Root, m.Head, m.Deltas, nil
}
func (p ArbGhostChessCheckpoint) CheckpointCancel(c ctx, evm mech, job bytes32, generation, nonce uint64) (bool, error) {
	ns, _, b, e := cpLocked(c, evm, job, generation, nonce)
	if e != nil {
		return false, e
	}
	b.Active = false
	if e = cpWrite(cpStore(c, evm, ns), b); e != nil {
		return false, e
	}
	if cpMutating(c) {
		cpNative.Lock()
		delete(cpNative.Builds, string(ns))
		cpNative.Unlock()
	}
	return true, nil
}
func (p ArbGhostChessCheckpoint) CheckpointStatus(c ctx, evm mech, job bytes32) (uint64, bool, uint32, uint32, uint32, error) {
	b, e := cpRead(cpStore(c, evm, cpNamespace(c.caller, job)))
	return b.Nonce, b.Active, b.Cursor, b.Verified, uint32(len(b.Pieces)), e
}

const GhostChessCheckpointABI = `[{"name":"newGame","type":"function","stateMutability":"nonpayable","inputs":[{"name":"job","type":"bytes32"}],"outputs":[{"name":"root","type":"bytes32"}]},{"name":"releaseGame","type":"function","stateMutability":"nonpayable","inputs":[{"name":"job","type":"bytes32"}],"outputs":[{"name":"released","type":"bool"}]},{"name":"begin","type":"function","stateMutability":"nonpayable","inputs":[{"name":"job","type":"bytes32"},{"name":"generation","type":"uint64"},{"name":"history","type":"string"}],"outputs":[{"name":"step","type":"uint32"},{"name":"pending","type":"bool"},{"name":"root","type":"bytes32"}]},{"name":"advance","type":"function","stateMutability":"nonpayable","inputs":[{"name":"job","type":"bytes32"},{"name":"generation","type":"uint64"},{"name":"expectedStep","type":"uint32"}],"outputs":[{"name":"step","type":"uint32"},{"name":"pending","type":"bool"},{"name":"root","type":"bytes32"}]},{"name":"inspect","type":"function","stateMutability":"view","inputs":[{"name":"job","type":"bytes32"}],"outputs":[{"name":"generation","type":"uint64"},{"name":"step","type":"uint32"},{"name":"pending","type":"bool"},{"name":"observedNodes","type":"uint64"},{"name":"move","type":"string"},{"name":"actualNodes","type":"uint64"},{"name":"depth","type":"uint32"},{"name":"root","type":"bytes32"}]},{"name":"checkpointBegin","type":"function","stateMutability":"nonpayable","inputs":[{"name":"job","type":"bytes32"},{"name":"generation","type":"uint64"},{"name":"expectedRoot","type":"bytes32"}],"outputs":[{"name":"nonce","type":"uint64"}]},{"name":"checkpointWork","type":"function","stateMutability":"nonpayable","inputs":[{"name":"job","type":"bytes32"},{"name":"generation","type":"uint64"},{"name":"nonce","type":"uint64"},{"name":"expectedCursor","type":"uint32"}],"outputs":[{"name":"cursor","type":"uint32"},{"name":"piece","type":"bytes32"},{"name":"complete","type":"bool"}]},{"name":"checkpointVerify","type":"function","stateMutability":"nonpayable","inputs":[{"name":"job","type":"bytes32"},{"name":"generation","type":"uint64"},{"name":"nonce","type":"uint64"},{"name":"expectedPiece","type":"uint32"}],"outputs":[{"name":"verified","type":"uint32"},{"name":"pieces","type":"uint32"},{"name":"complete","type":"bool"}]},{"name":"checkpointFinalize","type":"function","stateMutability":"nonpayable","inputs":[{"name":"job","type":"bytes32"},{"name":"generation","type":"uint64"},{"name":"nonce","type":"uint64"}],"outputs":[{"name":"root","type":"bytes32"},{"name":"head","type":"bytes32"},{"name":"deltas","type":"uint32"}]},{"name":"checkpointCancel","type":"function","stateMutability":"nonpayable","inputs":[{"name":"job","type":"bytes32"},{"name":"generation","type":"uint64"},{"name":"nonce","type":"uint64"}],"outputs":[{"name":"cancelled","type":"bool"}]},{"name":"checkpointStatus","type":"function","stateMutability":"view","inputs":[{"name":"job","type":"bytes32"}],"outputs":[{"name":"nonce","type":"uint64"},{"name":"active","type":"bool"},{"name":"cursor","type":"uint32"},{"name":"verified","type":"uint32"},{"name":"pieces","type":"uint32"}]}]`

func (p ArbGhostChessCheckpoint) NewGame(c ctx, evm mech, job bytes32) (bytes32, error) {
	if evm.ChainConfig().ArbitrumChainParams.AllowDebugPrecompiles {
		return bytes32{}, errGhostChess
	}

	allowed, e := c.State.ChainOwners().IsMember(c.caller)
	if e != nil || !allowed {
		return bytes32{}, errGhostChess
	}
	reservation := sliceStore(evm.StateDB, c, sliceReservation)
	active, e := reservation.GetBytes()
	if e != nil || len(active) != 0 {
		return bytes32{}, errGhostChess
	}
	ns := cpNamespace(c.caller, job)
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

func (p ArbGhostChessCheckpoint) ReleaseGame(c ctx, evm mech, job bytes32) (bool, error) {
	if e := cpGameUnlocked(c, evm, job); e != nil {
		return false, e
	}

	ns := cpNamespace(c.caller, job)
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

func (p ArbGhostChessCheckpoint) Begin(c ctx, evm mech, job bytes32, generation uint64, history string) (uint32, bool, bytes32, error) {
	if e := cpGameUnlocked(c, evm, job); e != nil {
		return 0, false, bytes32{}, e
	}

	ns := cpNamespace(c.caller, job)
	store := sliceStore(evm.StateDB, c, ns)
	m, e := sliceMetaRead(store)
	if e != nil {
		return 0, false, bytes32{}, e
	}
	if m.Released || m.Progress.Pending || generation != m.Generation || generation == ^uint64(0) || history == "" || len(history) > 8192 {
		return 0, false, bytes32{}, errGhostChess
	}
	// Versioned guest profile: each completed decision must be compacted before
	// another search starts. The authenticated image and engine are unchanged.
	b, e := cpRead(cpStore(c, evm, ns))
	if e != nil || !cpCheckpointReady(m, b, c.caller, job) {
		return 0, false, bytes32{}, errGhostChess
	}
	if !validSliceHistory(m.History, history) {
		return 0, false, bytes32{}, errGhostChess
	}
	return cpSliceRun(c, evm, ns, m, true, history)
}

func (p ArbGhostChessCheckpoint) Advance(c ctx, evm mech, job bytes32, generation uint64, expectedStep uint32) (uint32, bool, bytes32, error) {
	if e := cpGameUnlocked(c, evm, job); e != nil {
		return 0, false, bytes32{}, e
	}

	ns := cpNamespace(c.caller, job)
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
	return cpSliceRun(c, evm, ns, m, false, "")
}

func (p ArbGhostChessCheckpoint) Inspect(c ctx, evm mech, job bytes32) (uint64, uint32, bool, uint64, string, uint64, uint32, bytes32, error) {
	m, e := sliceMetaRead(sliceStore(evm.StateDB, c, cpNamespace(c.caller, job)))
	if e != nil {
		return 0, 0, false, 0, "", 0, 0, bytes32{}, e
	}
	r := m.Progress
	return m.Generation, m.Operation, r.Pending, r.Observed, r.Move, r.Nodes, r.Depth, m.Root, nil
}
