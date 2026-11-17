// Existing incremental Tree implementation copied unchanged from the pinned runtime.
package checkpoint

import (
	"crypto/sha256"
	"encoding/binary"
)

const PageSize = 4096
const MaxMemory = 768 * 1024 * 1024

type Global struct {
	Name  string
	Value uint64
}

type Tree struct {
	Leaves int
	Hashes [][32]byte
}

func leaf(i int, b []byte) [32]byte {
	h := sha256.New()
	h.Write([]byte("GL3_CHESS_VM_PAGE_V1"))
	var n [8]byte
	binary.LittleEndian.PutUint64(n[:], uint64(i))
	h.Write(n[:])
	h.Write(b)
	var out [32]byte
	copy(out[:], h.Sum(nil))
	return out
}
func parent(a, b [32]byte) [32]byte {
	var x [65]byte
	x[0] = 1
	copy(x[1:33], a[:])
	copy(x[33:], b[:])
	return sha256.Sum256(x[:])
}
func NewTree(memory []byte) *Tree {
	n := 1
	for n < (MaxMemory+PageSize-1)/PageSize {
		n *= 2
	}
	t := &Tree{n, make([][32]byte, n*2)}
	for i := 0; i < len(memory)/PageSize; i++ {
		t.Hashes[n+i] = leaf(i, memory[i*PageSize:(i+1)*PageSize])
	}
	for i := n - 1; i > 0; i-- {
		t.Hashes[i] = parent(t.Hashes[i*2], t.Hashes[i*2+1])
	}
	return t
}
func (t *Tree) Set(i int, b []byte) {
	at := t.Leaves + i
	t.Hashes[at] = leaf(i, b)
	for at /= 2; at > 0; at /= 2 {
		t.Hashes[at] = parent(t.Hashes[at*2], t.Hashes[at*2+1])
	}
}
func (t *Tree) SetLeaf(i int, b []byte) { t.Hashes[t.Leaves+i] = leaf(i, b) }

// Changed page indices arrive in ascending order. Merge shared ancestors once.
func (t *Tree) Flush(pages []int) {
	current := make([]int, len(pages))
	for i, p := range pages {
		current[i] = t.Leaves + p
	}
	for len(current) > 0 && current[0] > 1 {
		next := make([]int, 0, (len(current)+1)/2)
		last := -1
		for _, i := range current {
			p := i / 2
			if p == last {
				continue
			}
			last = p
			t.Hashes[p] = parent(t.Hashes[2*p], t.Hashes[2*p+1])
			next = append(next, p)
		}
		current = next
	}
}
func (t *Tree) Root(memoryBytes int, globals []Global) [32]byte {
	h := sha256.New()
	h.Write([]byte("GL3_CHESS_IMAGE_V1"))
	h.Write(ModuleSHA[:])
	h.Write(t.Hashes[1][:])
	var n [8]byte
	binary.LittleEndian.PutUint64(n[:], uint64(memoryBytes))
	h.Write(n[:])
	for _, g := range globals {
		h.Write([]byte(g.Name))
		h.Write([]byte{0})
		binary.LittleEndian.PutUint64(n[:], g.Value)
		h.Write(n[:])
	}
	var r [32]byte
	copy(r[:], h.Sum(nil))
	return r
}
