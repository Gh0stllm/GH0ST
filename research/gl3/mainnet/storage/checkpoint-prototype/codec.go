// Isolated opt-in prototype. This file is not installed in the current STF.
package checkpoint

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math/bits"
)

var ErrCheckpoint = errors.New("invalid standalone checkpoint")
var checkpointMagic = [8]byte{'G', 'L', '3', 'C', 'P', 'B', 'M', 1}

const MaxCheckpointBytes = MaxMemory + MaxMemory/256 + 65536
const MaxGlobals = 256

type Image struct {
	Memory  []byte
	Globals []Global
}

func copyGlobals(g []Global) []Global { return append([]Global(nil), g...) }
func sameGlobals(a, b []Global) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
func validImage(im Image) error {
	if len(im.Memory) == 0 || len(im.Memory) > MaxMemory || len(im.Memory)%65536 != 0 || len(im.Globals) == 0 || len(im.Globals) > MaxGlobals {
		return ErrCheckpoint
	}
	for i, g := range im.Globals {
		if len(g.Name) == 0 || len(g.Name) > 128 || bytes.IndexByte([]byte(g.Name), 0) >= 0 || (i > 0 && im.Globals[i-1].Name >= g.Name) {
			return ErrCheckpoint
		}
	}
	return nil
}
func ImageRoot(im Image) ([32]byte, error) {
	if e := validImage(im); e != nil {
		return [32]byte{}, e
	}
	return NewTree(im.Memory).Root(len(im.Memory), im.Globals), nil
}
func seedWord(seed Image, at int) []byte {
	if at < len(seed.Memory) {
		return seed.Memory[at : at+32]
	}
	return zeroWord[:]
}

var zeroWord [32]byte

// Encode writes a canonical sparse bitmap against the fixed genesis image.
// Every changed value is retained, including changes whose value is now zero.
func Encode(w io.Writer, seed, current Image) error {
	if e := validImage(seed); e != nil {
		return e
	}
	if e := validImage(current); e != nil {
		return e
	}
	if len(current.Memory) < len(seed.Memory) || len(seed.Globals) != len(current.Globals) {
		return ErrCheckpoint
	}
	for i := range seed.Globals {
		if seed.Globals[i].Name != current.Globals[i].Name {
			return ErrCheckpoint
		}
	}
	seedRoot, e := ImageRoot(seed)
	if e != nil {
		return e
	}
	root, e := ImageRoot(current)
	if e != nil {
		return e
	}
	bitmap := make([]byte, len(current.Memory)/256)
	var changed uint32
	for at := 0; at < len(current.Memory); at += 32 {
		if !bytes.Equal(seedWord(seed, at), current.Memory[at:at+32]) {
			word := at / 32
			bitmap[word/8] |= 1 << uint(word%8)
			changed++
		}
	}
	b := bufio.NewWriterSize(w, 65536)
	write := func(x any) error { return binary.Write(b, binary.LittleEndian, x) }
	for _, x := range []any{checkpointMagic, ModuleSHA, seedRoot, root, uint32(len(current.Memory)), uint16(len(current.Globals))} {
		if e = write(x); e != nil {
			return e
		}
	}
	for _, g := range current.Globals {
		if e = write(uint16(len(g.Name))); e != nil {
			return e
		}
		if _, e = b.WriteString(g.Name); e != nil {
			return e
		}
		if e = write(g.Value); e != nil {
			return e
		}
	}
	if e = write(uint32(len(bitmap))); e != nil {
		return e
	}
	if e = write(changed); e != nil {
		return e
	}
	if _, e = b.Write(bitmap); e != nil {
		return e
	}
	for at := 0; at < len(current.Memory); at += 32 {
		word := at / 32
		if bitmap[word/8]&(1<<uint(word%8)) != 0 {
			if _, e = b.Write(current.Memory[at : at+32]); e != nil {
				return e
			}
		}
	}
	return b.Flush()
}

// Decode authenticates all bytes/globals using the unchanged image commitment.
// It rejects redundant changed words, extra bytes and unbounded allocations.
func Decode(r io.Reader, seed Image) (Image, error) {
	fail := func(e error) (Image, error) { return Image{}, fmt.Errorf("%w: %v", ErrCheckpoint, e) }
	if e := validImage(seed); e != nil {
		return fail(e)
	}
	b := bufio.NewReaderSize(io.LimitReader(r, MaxCheckpointBytes+1), 65536)
	read := func(x any) error { return binary.Read(b, binary.LittleEndian, x) }
	var magic [8]byte
	var module, seedRoot, want [32]byte
	var n uint32
	var globals uint16
	for _, x := range []any{&magic, &module, &seedRoot, &want, &n, &globals} {
		if e := read(x); e != nil {
			return fail(e)
		}
	}
	actualSeed, e := ImageRoot(seed)
	if e != nil {
		return fail(e)
	}
	if magic != checkpointMagic || module != ModuleSHA || seedRoot != actualSeed || n < uint32(len(seed.Memory)) || n > MaxMemory || n%65536 != 0 || globals != uint16(len(seed.Globals)) {
		return fail(errors.New("header bounds or identity"))
	}
	im := Image{Memory: make([]byte, n), Globals: make([]Global, globals)}
	copy(im.Memory, seed.Memory)
	for i := range im.Globals {
		var length uint16
		if e = read(&length); e != nil {
			return fail(e)
		}
		if length == 0 || length > 128 {
			return fail(errors.New("global name bound"))
		}
		name := make([]byte, length)
		if _, e = io.ReadFull(b, name); e != nil {
			return fail(e)
		}
		im.Globals[i].Name = string(name)
		if e = read(&im.Globals[i].Value); e != nil {
			return fail(e)
		}
		if im.Globals[i].Name != seed.Globals[i].Name {
			return fail(errors.New("global identity/order"))
		}
	}
	var bitmapBytes, changed uint32
	if e = read(&bitmapBytes); e != nil {
		return fail(e)
	}
	if e = read(&changed); e != nil {
		return fail(e)
	}
	if bitmapBytes != n/256 || changed > n/32 {
		return fail(errors.New("bitmap bounds"))
	}
	bitmap := make([]byte, bitmapBytes)
	if _, e = io.ReadFull(b, bitmap); e != nil {
		return fail(e)
	}
	var count uint32
	for _, v := range bitmap {
		count += uint32(bits.OnesCount8(v))
	}
	if count != changed {
		return fail(errors.New("bitmap count"))
	}
	for word := 0; word < int(n)/32; word++ {
		if bitmap[word/8]&(1<<uint(word%8)) == 0 {
			continue
		}
		at := word * 32
		value := im.Memory[at : at+32]
		if _, e = io.ReadFull(b, value); e != nil {
			return fail(e)
		}
		if bytes.Equal(value, seedWord(seed, at)) {
			return fail(errors.New("redundant noncanonical changed word"))
		}
	}
	if _, e = b.ReadByte(); e != io.EOF {
		return fail(errors.New("trailing checkpoint bytes"))
	}
	root, e := ImageRoot(im)
	if e != nil {
		return fail(e)
	}
	if root != want {
		return fail(errors.New("image root mismatch"))
	}
	return im, nil
}
