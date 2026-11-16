// Package gh0stllm is a deterministic bounded integer tensor kernel.
// It is a building block, NOT an LLM or an activated Nitro precompile.
package gh0stllm

import (
	"crypto/sha256"
	"encoding/binary"
	"errors"
)

type Word = [32]byte
type Owner = [20]byte
type Write struct{ Key, Value Word }

// Apply must be atomic; Nitro supplies transaction rollback for failed writes.
type Store interface {
	Get(Word) (Word, error)
	Apply([]Write) error
}

var ErrInvalid = errors.New("invalid tensor input or job")

const MaxElements = 4096
const MaxStep = 1024

func key(domain byte, owner Owner, id Word, index uint32) Word {
	var data [57]byte
	data[0] = domain
	copy(data[1:21], owner[:])
	copy(data[21:53], id[:])
	binary.BigEndian.PutUint32(data[53:], index)
	return sha256.Sum256(data[:])
}
func number(v uint64) (w Word) { binary.BigEndian.PutUint64(w[24:], v); return }
func readNumber(s Store, k Word) (uint64, error) {
	v, e := s.Get(k)
	return binary.BigEndian.Uint64(v[24:]), e
}
func bytesOf(v []int8) []byte {
	b := make([]byte, len(v))
	for i, x := range v {
		b[i] = byte(x)
	}
	return b
}
func pack(v []int8, domain byte, owner Owner, id Word) []Write {
	out := make([]Write, 0, (len(v)+31)/32)
	for i := 0; i < len(v); i += 32 {
		var w Word
		for j := 0; j < 32 && i+j < len(v); j++ {
			w[j] = byte(v[i+j])
		}
		out = append(out, Write{key(domain, owner, id, uint32(i/32)), w})
	}
	return out
}

// RegisterModel writes one immutable small test model. Production needs paged,
// versioned, metered model registration and commitments beyond this 4096-byte demo.
func RegisterModel(s Store, weights []int8) (Word, error) {
	if len(weights) == 0 || len(weights) > MaxElements {
		return Word{}, ErrInvalid
	}
	id := sha256.Sum256(bytesOf(weights))
	n, e := readNumber(s, key(1, Owner{}, id, 0))
	if e != nil {
		return Word{}, e
	}
	if n != 0 {
		if n != uint64(len(weights)) {
			return Word{}, ErrInvalid
		}
		return id, nil
	}
	writes := pack(weights, 2, Owner{}, id)
	writes = append(writes, Write{key(1, Owner{}, id, 0), number(uint64(len(weights)))})
	return id, s.Apply(writes)
}
func Begin(s Store, owner Owner, id, model Word, input []int8) error {
	n, e := readNumber(s, key(1, Owner{}, model, 0))
	if e != nil {
		return e
	}
	if n == 0 || n != uint64(len(input)) {
		return ErrInvalid
	}
	exists, e := readNumber(s, key(3, owner, id, 0))
	if e != nil {
		return e
	}
	if exists != 0 {
		return ErrInvalid
	}
	writes := pack(input, 4, owner, id)
	writes = append(writes, Write{key(3, owner, id, 0), number(n)}, Write{key(5, owner, id, 0), model}, Write{key(6, owner, id, 0), number(0)}, Write{key(7, owner, id, 0), number(0)})
	return s.Apply(writes)
}

type Progress struct {
	Done   bool
	Sum    int64
	Cursor uint32
}

func Inspect(s Store, owner Owner, id Word) (Progress, error) {
	n, e := readNumber(s, key(3, owner, id, 0))
	if e != nil {
		return Progress{}, e
	}
	if n == 0 || n > MaxElements {
		return Progress{}, ErrInvalid
	}
	cursor, e := readNumber(s, key(6, owner, id, 0))
	if e != nil {
		return Progress{}, e
	}
	sum, e := readNumber(s, key(7, owner, id, 0))
	if e != nil {
		return Progress{}, e
	}
	if cursor > n {
		return Progress{}, ErrInvalid
	}
	return Progress{cursor == n, int64(sum), uint32(cursor)}, nil
}
func Step(s Store, owner Owner, id Word, budget uint32) (Progress, error) {
	if budget == 0 || budget > MaxStep {
		return Progress{}, ErrInvalid
	}
	p, e := Inspect(s, owner, id)
	if e != nil {
		return Progress{}, e
	}
	if p.Done {
		return p, nil
	}
	n, e := readNumber(s, key(3, owner, id, 0))
	if e != nil {
		return Progress{}, e
	}
	model, e := s.Get(key(5, owner, id, 0))
	if e != nil {
		return Progress{}, e
	}
	end := uint64(p.Cursor) + uint64(budget)
	if end > n {
		end = n
	}
	var weights, input Word
	loaded := uint32(^uint32(0))
	sum := p.Sum
	for i := p.Cursor; i < uint32(end); i++ {
		block := i / 32
		if block != loaded {
			weights, e = s.Get(key(2, Owner{}, model, block))
			if e != nil {
				return Progress{}, e
			}
			input, e = s.Get(key(4, owner, id, block))
			if e != nil {
				return Progress{}, e
			}
			loaded = block
		}
		sum += int64(int8(weights[i%32])) * int64(int8(input[i%32]))
	}
	// Max4096 signed int8 products fit comfortably in int64; no float/SIMD/IO.
	e = s.Apply([]Write{{key(6, owner, id, 0), number(end)}, {key(7, owner, id, 0), number(uint64(sum))}})
	if e != nil {
		return Progress{}, e
	}
	return Progress{end == n, sum, uint32(end)}, nil
}
