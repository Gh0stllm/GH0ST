package checkpoint

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"math"
	"testing"
)

func harness(t *testing.T) (*Harness, *MemoryBlobs, Address, Image) {
	t.Helper()
	seed, im := smallImages()
	store := NewMemoryBlobs()
	h, e := NewHarness(seed, store)
	if e != nil {
		t.Fatal(e)
	}
	owner := Address{1}
	snap := Snapshot{Image: im, Generation: 2, Sequence: 17, History: "e2e4 e7e5", Request: "e2e4", Head: Hash{5}, Deltas: 2464}
	if e = h.Admit(owner, Hash{3}, snap); e != nil {
		t.Fatal(e)
	}
	return h, store, owner, im
}
func begin(t *testing.T, h *Harness, o Address) Hash {
	t.Helper()
	id, e := h.Begin(o, 17, h.Game.Root)
	if e != nil {
		t.Fatal(e)
	}
	return id
}
func stage(t *testing.T, h *Harness, o Address, im Image) Hash {
	t.Helper()
	id := begin(t, h, o)
	if e := h.StreamBuild(o, 17, id, im); e != nil {
		t.Fatal(e)
	}
	return id
}
func TestCheckpointSwitchKeepsImageTTMetadataAndColdRestore(t *testing.T) {
	h, _, o, im := harness(t)
	old := h.Game.Snapshot
	cacheImage := h.Game.Cache.Image
	id := stage(t, h, o, im)
	d, e := h.Finalize(o, 17, id)
	if e != nil {
		t.Fatal(e)
	}
	g := h.Game
	if g.Snapshot.Head != (Hash{}) || g.Snapshot.Deltas != 0 {
		t.Fatal("ancestry not reset")
	}
	if g.Snapshot.Generation != old.Generation || g.Snapshot.Sequence != old.Sequence || g.Snapshot.History != old.History || g.Snapshot.Request != old.Request || !bytes.Equal(g.Snapshot.Image.Memory, old.Image.Memory) || !sameGlobals(g.Snapshot.Image.Globals, old.Image.Globals) {
		t.Fatal("search state changed")
	}
	if g.Cache.Image != cacheImage || g.Cache.Epoch != 1 || g.Cache.Identity != d.ManifestHash {
		t.Fatal("cache image cleared or identity stale")
	}
	cold, e := h.ColdRestore(d)
	if e != nil || !bytes.Equal(cold.Memory, im.Memory) || !sameGlobals(cold.Globals, im.Globals) {
		t.Fatal("cold restore", e)
	}
}
func TestOwnerSequenceRootPendingAndSingleAdmission(t *testing.T) {
	h, _, o, im := harness(t)
	bad := Address{2}
	for name, run := range map[string]func() error{"owner": func() error { _, e := h.Begin(bad, 17, h.Game.Root); return e }, "sequence": func() error { _, e := h.Begin(o, 16, h.Game.Root); return e }, "root": func() error { _, e := h.Begin(o, 17, Hash{9}); return e }, "admission": func() error { return h.Admit(o, Hash{4}, Snapshot{Image: im, Generation: 1}) }} {
		t.Run(name, func(t *testing.T) {
			if run() == nil {
				t.Fatal("unauthorized/stale admission")
			}
		})
	}
	h.Game.Snapshot.Pending = true
	if _, e := h.Begin(o, 17, h.Game.Root); !errors.Is(e, ErrIncomplete) {
		t.Fatal("pending image accepted", e)
	}
}
func TestBuildLockBlocksSearchReleaseAndAnotherBuild(t *testing.T) {
	h, _, o, _ := harness(t)
	begin(t, h, o)
	if _, e := h.Begin(o, 17, h.Game.Root); !errors.Is(e, ErrLocked) {
		t.Fatal(e)
	}
	if e := h.StartSearch(o, 17); !errors.Is(e, ErrLocked) {
		t.Fatal(e)
	}
	if e := h.Release(o, 17); !errors.Is(e, ErrLocked) {
		t.Fatal(e)
	}
}
func TestUnstartedGenerationAndBuildNonceOverflowReject(t *testing.T) {
	for _, kind := range []string{"unstarted", "overflow"} {
		t.Run(kind, func(t *testing.T) {
			h, _, o, _ := harness(t)
			if kind == "unstarted" {
				h.Game.Snapshot.Generation = 1
			} else {
				h.Game.NextNonce = math.MaxUint64
			}
			if _, e := h.Begin(o, 17, h.Game.Root); e == nil {
				t.Fatal("invalid begin accepted")
			}
			if h.Game.Building != nil || h.Game.Snapshot.Deltas != 2464 {
				t.Fatal("rejection changed backing")
			}
		})
	}
}
func TestAppendRejectsOwnerStaleOrderAndOversize(t *testing.T) {
	h, _, o, _ := harness(t)
	id := begin(t, h, o)
	cases := map[string]func() error{"owner": func() error { _, e := h.Append(Address{2}, 17, id, 0, []byte{1}); return e }, "sequence": func() error { _, e := h.Append(o, 18, id, 0, []byte{1}); return e }, "build": func() error { _, e := h.Append(o, 17, Hash{9}, 0, []byte{1}); return e }, "order": func() error { _, e := h.Append(o, 17, id, 1, []byte{1}); return e }, "empty": func() error { _, e := h.Append(o, 17, id, 0, nil); return e }, "oversize": func() error { _, e := h.Append(o, 17, id, 0, make([]byte, MaxBuildChunk)); return e }}
	for n, f := range cases {
		t.Run(n, func(t *testing.T) {
			if f() == nil {
				t.Fatal("accepted invalid append")
			}
		})
	}
	if len(h.Game.Building.Chunks) != 0 {
		t.Fatal("failure advanced cursor")
	}
}
func TestPartialStorageFailureRollsBackFragmentsAndCursor(t *testing.T) {
	h, s, o, _ := harness(t)
	id := begin(t, h, o)
	s.FailAfter = 1
	before := len(s.codes)
	if _, e := h.Append(o, 17, id, 0, make([]byte, 65536)); e == nil {
		t.Fatal("missing injection")
	}
	if len(s.codes) != before || len(h.Game.Building.Chunks) != 0 || h.Game.Building.EncodedBytes != 0 {
		t.Fatal("partial write persisted")
	}
	if h.Game.Snapshot.Deltas != 2464 || h.Game.Snapshot.Head != (Hash{5}) {
		t.Fatal("old backing changed")
	}
}
func TestPartialBuildCannotSwitchAndRemainsCancelable(t *testing.T) {
	h, s, o, _ := harness(t)
	id := begin(t, h, o)
	if _, e := h.Append(o, 17, id, 0, []byte("incomplete")); e != nil {
		t.Fatal(e)
	}
	if _, e := h.Finalize(o, 17, id); e == nil {
		t.Fatal("partial switch")
	}
	before := len(s.codes)
	if e := h.Cancel(o, 17, id); e != nil {
		t.Fatal(e)
	}
	if len(s.codes) != before || len(h.Game.Retired) != 1 || h.Game.Snapshot.Deltas != 2464 {
		t.Fatal("cancel silently deleted or reset state")
	}
	newID := begin(t, h, o)
	if newID == id {
		t.Fatal("ABA build id")
	}
	if _, e := h.Append(o, 17, id, 0, []byte{1}); e == nil {
		t.Fatal("stale canceled build accepted")
	}
}
func TestMissingOrCorruptBlobCannotSwitch(t *testing.T) {
	for _, kind := range []string{"missing", "corrupt"} {
		t.Run(kind, func(t *testing.T) {
			h, s, o, im := harness(t)
			id := stage(t, h, o, im)
			key := fragmentKey{h.Game.Building.Chunks[0], 0}
			original := bytes.Clone(s.codes[key])
			if kind == "missing" {
				delete(s.codes, key)
			} else {
				s.codes[key] = bytes.Clone(original)
				s.codes[key][len(original)-1] ^= 1
			}
			if _, e := h.Finalize(o, 17, id); e == nil {
				t.Fatal("invalid backing accepted")
			}
			if h.Game.Checkpoint != nil || h.Game.Building == nil || h.Game.Snapshot.Deltas != 2464 || h.Game.Cache.Epoch != 0 {
				t.Fatal("failed finalize mutated state")
			}
		})
	}
}
func TestWrongImageRootAndStaleMetadataCannotSwitch(t *testing.T) {
	h, _, o, im := harness(t)
	wrong := Image{bytes.Clone(im.Memory), copyGlobals(im.Globals)}
	wrong.Memory[400] = 9
	id := stage(t, h, o, wrong)
	if _, e := h.Finalize(o, 17, id); e == nil {
		t.Fatal("wrong image accepted")
	}
	if h.Game.Snapshot.Deltas != 2464 {
		t.Fatal("old head reset")
	}
	for _, field := range []string{"history", "generation", "request"} {
		t.Run(field, func(t *testing.T) {
			h, _, o, im := harness(t)
			id := stage(t, h, o, im)
			switch field {
			case "history":
				h.Game.Snapshot.History += " x"
			case "request":
				h.Game.Snapshot.Request += " x"
			case "generation":
				h.Game.Snapshot.Generation++
			}
			if _, e := h.Finalize(o, 17, id); !errors.Is(e, ErrStale) {
				t.Fatal("stale snapshot accepted", e)
			}
		})
	}
}
func TestOuterTransactionRollbackRestoresMetadataCacheAndBlobs(t *testing.T) {
	h, s, o, im := harness(t)
	before := h.Snapshot()
	head := h.Game.Snapshot.Head
	id := stage(t, h, o, im)
	if _, e := h.Finalize(o, 17, id); e != nil {
		t.Fatal(e)
	}
	h.Revert(before)
	if len(s.codes) != 0 || h.Game.Checkpoint != nil || h.Game.Building != nil || h.Game.Snapshot.Head != head || h.Game.Snapshot.Deltas != 2464 || h.Game.Cache.Epoch != 0 || !bytes.Equal(h.Game.Cache.Image.Memory, im.Memory) {
		t.Fatal("outer revert leaked backing or lost search state")
	}
}
func TestColdDescriptorAndEnvelopeCorruptionReject(t *testing.T) {
	h, s, o, im := harness(t)
	id := stage(t, h, o, im)
	d, e := h.Finalize(o, 17, id)
	if e != nil {
		t.Fatal(e)
	}
	bad := d
	bad.EncodedBytes++
	if _, e = h.ColdRestore(bad); e == nil {
		t.Fatal("manifest mismatch")
	}
	body, e := s.GetBlob(d.Chunks[0])
	if e != nil {
		t.Fatal(e)
	}
	body[36] ^= 1
	bad = d
	bad.Chunks = append([]Hash(nil), d.Chunks...)
	bad.Chunks[0], e = s.PutBlob(body)
	if e != nil {
		t.Fatal(e)
	}
	bad.ManifestHash = descriptorHash(bad)
	if _, e = h.decodeDescriptor(bad); e == nil {
		t.Fatal("chunk index mismatch")
	}
}
func TestColdRestoreRejectsSelfConsistentWrongAuthorityOrGenesis(t *testing.T) {
	h, _, o, im := harness(t)
	id := stage(t, h, o, im)
	d, e := h.Finalize(o, 17, id)
	if e != nil {
		t.Fatal(e)
	}
	bad := d
	bad.Generation++
	bad.ManifestHash = descriptorHash(bad)
	if _, e = h.ColdRestore(bad); e == nil {
		t.Fatal("untrusted self-consistent manifest accepted")
	}
	bad = d
	bad.GenesisRoot[0] ^= 1
	bad.ManifestHash = descriptorHash(bad)
	if _, e = h.decodeDescriptor(bad); e == nil {
		t.Fatal("descriptor genesis identity mismatch")
	}
}
func TestColdMetadataRetainsHistoryBeforeNextSearchAdmission(t *testing.T) {
	h, _, o, im := harness(t)
	before := h.Game.Snapshot
	id := stage(t, h, o, im)
	d, e := h.Finalize(o, 17, id)
	if e != nil {
		t.Fatal(e)
	}
	cold, e := h.ColdRestoreSnapshot(d)
	if e != nil {
		t.Fatal(e)
	}
	if cold.History != before.History || cold.Request != before.Request || cold.Generation != before.Generation || cold.Sequence != before.Sequence || cold.Pending || cold.Deltas != 0 || cold.Head != (Hash{}) || !bytes.Equal(cold.Image.Memory, im.Memory) {
		t.Fatal("cold metadata/search state lost")
	}
	next, e := NewHarness(h.Seed, h.Store)
	if e != nil {
		t.Fatal(e)
	}
	if e = next.Admit(o, h.Game.Job, cold); e != nil {
		t.Fatal(e)
	}
	if e = next.StartSearch(o, 17); e != nil || !bytes.Equal(next.Game.Snapshot.Image.Memory, im.Memory) {
		t.Fatal("next admission cleared retained state", e)
	}
}
func TestChunkBodyBoundAndMultipleScheduledAppends(t *testing.T) {
	h, s, o, _ := harness(t)
	im := Image{Memory: make([]byte, 16*1024*1024), Globals: copyGlobals(h.Seed.Globals)}
	for i := range im.Memory {
		im.Memory[i] = byte(i%251 + 1)
	}
	h.Game = nil
	if e := h.Admit(o, Hash{4}, Snapshot{Image: im, Generation: 2, Sequence: 17}); e != nil {
		t.Fatal(e)
	}
	id := stage(t, h, o, im)
	if len(h.Game.Building.Chunks) < 2 {
		t.Fatal("fixture did not cross8MiB")
	}
	for _, hash := range h.Game.Building.Chunks {
		body, e := s.GetBlob(hash)
		if e != nil || len(body) > MaxBuildChunk || len(body) > MaxBlob {
			t.Fatal("unbounded blob", e)
		}
	}
	if _, e := h.Finalize(o, 17, id); e != nil {
		t.Fatal(e)
	}
}
func TestSharedBlobNotDeletedAndColdBlobHashChecked(t *testing.T) {
	s := NewMemoryBlobs()
	body := bytes.Repeat([]byte{7}, 65536)
	a, e := s.PutBlob(body)
	if e != nil {
		t.Fatal(e)
	}
	n := len(s.codes)
	b, e := s.PutBlob(body)
	if e != nil || a != b || len(s.codes) != n {
		t.Fatal("sharing changed")
	}
	if sha256.Sum256(body) != a {
		t.Fatal("digest")
	}
	s.codes[fragmentKey{a, 1}][10] ^= 1
	if _, e := s.GetBlob(a); e == nil {
		t.Fatal("corrupt fragment accepted")
	}
}
