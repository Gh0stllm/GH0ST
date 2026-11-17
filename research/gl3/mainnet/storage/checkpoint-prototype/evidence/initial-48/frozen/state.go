package checkpoint

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
)

type Address [20]byte

var ErrOwner = errors.New("checkpoint owner mismatch")
var ErrStale = errors.New("stale checkpoint sequence or build")
var ErrLocked = errors.New("checkpoint build locks the game")
var ErrIncomplete = errors.New("checkpoint image is not quiescent/complete")

type Snapshot struct {
	Image                Image
	Generation, Sequence uint64
	History, Request     string
	Pending              bool
	Head                 Hash
	Deltas               uint32
}
type BackingCache struct {
	Image    *Image
	Identity Hash
	Epoch    uint64
}
type Descriptor struct {
	ID, ImageRoot, GenesisRoot, ManifestHash Hash
	Generation, Sequence                     uint64
	MemoryBytes                              uint32
	Globals                                  []Global
	Chunks                                   []Hash
	EncodedBytes                             uint64
}
type Build struct {
	ID, Root                    Hash
	Nonce, Generation, Sequence uint64
	History, Request            string
	Chunks                      []Hash
	EncodedBytes                uint64
	Sealed                      bool
}
type Game struct {
	Owner      Address
	Job        Hash
	Snapshot   Snapshot
	Root       Hash
	Checkpoint *Descriptor
	Building   *Build
	NextNonce  uint64
	Cache      BackingCache
	Released   bool
	Retired    []*Descriptor
}
type Harness struct {
	Seed  Image
	Store BlobStore
	Game  *Game
}

// This isolated harness receives an authoritative snapshot from its test backend.
// It is not a production ABI for accepting user-supplied VM images or histories.
func NewHarness(seed Image, store BlobStore) (*Harness, error) {
	if e := validImage(seed); e != nil {
		return nil, e
	}
	return &Harness{Seed: seed, Store: store}, nil
}
func (h *Harness) Admit(owner Address, job Hash, s Snapshot) error {
	if h.Game != nil && !h.Game.Released {
		return ErrLocked
	}
	root, e := ImageRoot(s.Image)
	if e != nil {
		return e
	}
	if s.Generation == 0 || len(s.Image.Memory) < len(h.Seed.Memory) {
		return ErrCheckpoint
	}
	im := Image{Memory: bytes.Clone(s.Image.Memory), Globals: copyGlobals(s.Image.Globals)}
	s.Image = im
	h.Game = &Game{Owner: owner, Job: job, Snapshot: s, Root: root}
	h.Game.Cache = BackingCache{Image: &h.Game.Snapshot.Image}
	return nil
}
func (h *Harness) guard(owner Address, sequence uint64) error {
	if h.Game == nil || h.Game.Released {
		return ErrStale
	}
	if owner != h.Game.Owner {
		return ErrOwner
	}
	if sequence != h.Game.Snapshot.Sequence {
		return ErrStale
	}
	return nil
}
func (h *Harness) build(owner Address, sequence uint64, id Hash) (*Build, error) {
	if e := h.guard(owner, sequence); e != nil {
		return nil, e
	}
	g := h.Game
	b := g.Building
	if b == nil || b.ID != id || b.Sequence != sequence || b.Generation != g.Snapshot.Generation || b.History != g.Snapshot.History || b.Request != g.Snapshot.Request || b.Root != g.Root {
		return nil, ErrStale
	}
	return b, nil
}
func (h *Harness) Begin(owner Address, sequence uint64, root Hash) (Hash, error) {
	if e := h.guard(owner, sequence); e != nil {
		return Hash{}, e
	}
	g := h.Game
	if g.Building != nil {
		return Hash{}, ErrLocked
	}
	if g.Snapshot.Pending {
		return Hash{}, ErrIncomplete
	}
	if g.Root != root || g.NextNonce == math.MaxUint64 {
		return Hash{}, ErrStale
	}
	g.NextNonce++
	b := new(bytes.Buffer)
	b.WriteString("GL3_CHECKPOINT_BUILD_V1")
	b.Write(owner[:])
	b.Write(g.Job[:])
	b.Write(root[:])
	binary.Write(b, binary.LittleEndian, sequence)
	binary.Write(b, binary.LittleEndian, g.Snapshot.Generation)
	binary.Write(b, binary.LittleEndian, g.NextNonce)
	id := sha256.Sum256(b.Bytes())
	g.Building = &Build{ID: id, Root: root, Nonce: g.NextNonce, Generation: g.Snapshot.Generation, Sequence: sequence, History: g.Snapshot.History, Request: g.Snapshot.Request}
	return id, nil
}
func (h *Harness) Append(owner Address, sequence uint64, id Hash, index uint32, payload []byte) (Hash, error) {
	b, e := h.build(owner, sequence, id)
	if e != nil {
		return Hash{}, e
	}
	if index != uint32(len(b.Chunks)) || b.Sealed {
		return Hash{}, ErrStale
	}
	if len(payload) == 0 || len(payload) > MaxBuildChunk-BuildEnvelope || b.EncodedBytes+uint64(len(payload)) > MaxCheckpointBytes || len(b.Chunks) >= (MaxCheckpointBytes+MaxBuildChunk-BuildEnvelope-1)/(MaxBuildChunk-BuildEnvelope) {
		return Hash{}, ErrCheckpoint
	}
	mark := h.Store.Snapshot()
	hash, e := h.Store.PutBlob(chunkBody(id, index, payload))
	if e != nil {
		h.Store.Revert(mark)
		return Hash{}, e
	}
	b.Chunks = append(b.Chunks, hash)
	b.EncodedBytes += uint64(len(payload))
	b.Sealed = len(payload) < MaxBuildChunk-BuildEnvelope
	return hash, nil
}

type chunkReader struct {
	Store   BlobStore
	Build   Build
	index   int
	payload []byte
	total   uint64
}

func (r *chunkReader) Read(out []byte) (int, error) {
	if len(out) == 0 {
		return 0, nil
	}
	for len(r.payload) == 0 {
		if r.index == len(r.Build.Chunks) {
			if r.total != r.Build.EncodedBytes {
				return 0, ErrBlob
			}
			return 0, io.EOF
		}
		body, e := r.Store.GetBlob(r.Build.Chunks[r.index])
		if e != nil {
			return 0, e
		}
		payload, e := chunkPayload(body, r.Build.ID, uint32(r.index))
		if e != nil {
			return 0, e
		}
		r.payload = payload
		r.total += uint64(len(payload))
		r.index++
	}
	n := copy(out, r.payload)
	r.payload = r.payload[n:]
	return n, nil
}
func descriptorHash(d Descriptor) Hash {
	b := new(bytes.Buffer)
	b.WriteString("GL3_CHECKPOINT_MANIFEST_V1")
	b.Write(d.ID[:])
	b.Write(d.ImageRoot[:])
	b.Write(d.GenesisRoot[:])
	binary.Write(b, binary.LittleEndian, d.Generation)
	binary.Write(b, binary.LittleEndian, d.Sequence)
	binary.Write(b, binary.LittleEndian, d.MemoryBytes)
	binary.Write(b, binary.LittleEndian, d.EncodedBytes)
	binary.Write(b, binary.LittleEndian, uint32(len(d.Chunks)))
	for _, hash := range d.Chunks {
		b.Write(hash[:])
	}
	for _, g := range d.Globals {
		binary.Write(b, binary.LittleEndian, uint16(len(g.Name)))
		b.WriteString(g.Name)
		binary.Write(b, binary.LittleEndian, g.Value)
	}
	return sha256.Sum256(b.Bytes())
}
func (h *Harness) Finalize(owner Address, sequence uint64, id Hash) (Descriptor, error) {
	b, e := h.build(owner, sequence, id)
	if e != nil {
		return Descriptor{}, e
	}
	g := h.Game
	if g.Snapshot.Pending || g.Root != b.Root {
		return Descriptor{}, ErrStale
	}
	decoded, e := Decode(&chunkReader{Store: h.Store, Build: *b}, h.Seed)
	if e != nil {
		return Descriptor{}, e
	}
	root, e := ImageRoot(decoded)
	if e != nil {
		return Descriptor{}, e
	}
	if root != g.Root || !sameGlobals(decoded.Globals, g.Snapshot.Image.Globals) {
		return Descriptor{}, ErrCheckpoint
	}
	seedRoot, e := ImageRoot(h.Seed)
	if e != nil {
		return Descriptor{}, e
	}
	d := Descriptor{ID: id, ImageRoot: root, GenesisRoot: seedRoot, Generation: g.Snapshot.Generation, Sequence: sequence, MemoryBytes: uint32(len(decoded.Memory)), Globals: copyGlobals(decoded.Globals), Chunks: append([]Hash(nil), b.Chunks...), EncodedBytes: b.EncodedBytes}
	d.ManifestHash = descriptorHash(d)
	// All validation precedes the single metadata/backing-identity switch. The
	// authoritative image, TT/history and cache Image pointer remain untouched.
	if g.Checkpoint != nil {
		g.Retired = append(g.Retired, g.Checkpoint)
	}
	g.Checkpoint = &d
	g.Snapshot.Head = Hash{}
	g.Snapshot.Deltas = 0
	g.Building = nil
	g.Cache.Identity = d.ManifestHash
	g.Cache.Epoch++
	return d, nil
}
func (h *Harness) ColdRestore(d Descriptor) (Image, error) {
	if descriptorHash(d) != d.ManifestHash {
		return Image{}, ErrCheckpoint
	}
	im, e := Decode(&chunkReader{Store: h.Store, Build: Build{ID: d.ID, Chunks: d.Chunks, EncodedBytes: d.EncodedBytes}}, h.Seed)
	if e != nil {
		return Image{}, e
	}
	root, e := ImageRoot(im)
	if e != nil || root != d.ImageRoot || len(im.Memory) != int(d.MemoryBytes) || !sameGlobals(im.Globals, d.Globals) {
		return Image{}, ErrCheckpoint
	}
	return im, nil
}
func (h *Harness) Cancel(owner Address, sequence uint64, id Hash) error {
	b, e := h.build(owner, sequence, id)
	if e != nil {
		return e
	}
	h.Game.Retired = append(h.Game.Retired, &Descriptor{ID: id, Chunks: append([]Hash(nil), b.Chunks...), EncodedBytes: b.EncodedBytes})
	h.Game.Building = nil
	return nil
}
func (h *Harness) StartSearch(owner Address, sequence uint64) error {
	if e := h.guard(owner, sequence); e != nil {
		return e
	}
	if h.Game.Building != nil {
		return ErrLocked
	}
	h.Game.Snapshot.Pending = true
	return nil
}
func (h *Harness) Release(owner Address, sequence uint64) error {
	if e := h.guard(owner, sequence); e != nil {
		return e
	}
	if h.Game.Building != nil {
		return ErrLocked
	}
	h.Game.Released = true
	return nil
}

// StreamBuild is a harness convenience, not a synchronous production method.
// Each Append call remains bounded to one authenticated <=8MiB blob. A real STF
// adapter needs separately scheduled, metered build work and StateDB journaling.
func (h *Harness) StreamBuild(owner Address, sequence uint64, id Hash, current Image) error {
	w := &buildWriter{h: h, owner: owner, sequence: sequence, id: id, buffer: make([]byte, 0, MaxBuildChunk-BuildEnvelope)}
	if e := Encode(w, h.Seed, current); e != nil {
		return e
	}
	return w.flush()
}

type buildWriter struct {
	h        *Harness
	owner    Address
	sequence uint64
	id       Hash
	index    uint32
	buffer   []byte
}

func (w *buildWriter) flush() error {
	if len(w.buffer) == 0 {
		return nil
	}
	_, e := w.h.Append(w.owner, w.sequence, w.id, w.index, w.buffer)
	if e != nil {
		return e
	}
	w.index++
	w.buffer = w.buffer[:0]
	return nil
}
func (w *buildWriter) Write(p []byte) (int, error) {
	total := 0
	for len(p) > 0 {
		n := cap(w.buffer) - len(w.buffer)
		if n > len(p) {
			n = len(p)
		}
		w.buffer = append(w.buffer, p[:n]...)
		p = p[n:]
		total += n
		if len(w.buffer) == cap(w.buffer) {
			if e := w.flush(); e != nil {
				return total, e
			}
		}
	}
	return total, nil
}
func (d Descriptor) String() string {
	return fmt.Sprintf("checkpoint %x: %d bytes in %d chunks", d.ManifestHash, d.EncodedBytes, len(d.Chunks))
}

// TransactionSnapshot models the outer EVM journal boundary for the prototype.
// Image bytes are immutable throughout checkpoint operations; no full VM copy or
// reset is needed to roll metadata/backing identity back after an outer revert.
type TransactionSnapshot struct {
	game      *Game
	storeMark int
}

func cloneDescriptor(d *Descriptor) *Descriptor {
	if d == nil {
		return nil
	}
	out := *d
	out.Globals = copyGlobals(d.Globals)
	out.Chunks = append([]Hash(nil), d.Chunks...)
	return &out
}
func cloneGame(g *Game) *Game {
	if g == nil {
		return nil
	}
	out := *g
	out.Snapshot.Image.Globals = copyGlobals(g.Snapshot.Image.Globals)
	out.Checkpoint = cloneDescriptor(g.Checkpoint)
	if g.Building != nil {
		b := *g.Building
		b.Chunks = append([]Hash(nil), b.Chunks...)
		out.Building = &b
	}
	out.Retired = make([]*Descriptor, len(g.Retired))
	for i, d := range g.Retired {
		out.Retired[i] = cloneDescriptor(d)
	}
	out.Cache.Image = &out.Snapshot.Image
	return &out
}
func (h *Harness) Snapshot() TransactionSnapshot {
	return TransactionSnapshot{cloneGame(h.Game), h.Store.Snapshot()}
}
func (h *Harness) Revert(mark TransactionSnapshot) {
	h.Store.Revert(mark.storeMark)
	h.Game = cloneGame(mark.game)
}
