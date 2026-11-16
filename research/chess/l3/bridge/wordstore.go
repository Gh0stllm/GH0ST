package bridge

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
)

type Word = [32]byte
type WordWrite struct{ Key, Value Word }

// WordStore matches ArbOS's word-addressed state model. Apply must have EVM-style
// atomicity/rollback; this adapter does not create a transaction boundary itself.
type WordStore interface {
	Get(Word) (Word, error)
	Apply([]WordWrite) error
}
type WordAdapter struct{ Words WordStore }

func wordKey(key string, index uint32) Word {
	b := append([]byte("GH0ST_LLM_BLOB_V1/"), []byte(key)...)
	var n [4]byte
	binary.BigEndian.PutUint32(n[:], index)
	return sha256.Sum256(append(b, n[:]...))
}
func (a WordAdapter) Read(key string) ([]byte, error) {
	length, e := a.Words.Get(wordKey(key, ^uint32(0)))
	if e != nil {
		return nil, e
	}
	n := binary.BigEndian.Uint64(length[24:])
	if n == 0 {
		return nil, nil
	}
	n--
	if n > MaxModelBytes {
		return nil, ErrIntegrity
	}
	out := make([]byte, n)
	for i := uint64(0); i < n; i += 32 {
		v, e := a.Words.Get(wordKey(key, uint32(i/32)))
		if e != nil {
			return nil, e
		}
		copy(out[i:], v[:])
	}
	return out, nil
}
func (a WordAdapter) Commit(g Guard, writes []Write) error {
	current, e := a.Read(g.Key)
	if e != nil {
		return e
	}
	if !bytes.Equal(current, g.Expected) {
		return ErrConflict
	}
	var words []WordWrite
	for _, write := range writes {
		if len(write.Value) > MaxModelBytes {
			return ErrInvalid
		}
		for i := 0; i < len(write.Value); i += 32 {
			var value Word
			copy(value[:], write.Value[i:])
			words = append(words, WordWrite{wordKey(write.Key, uint32(i/32)), value})
		}
		var length Word
		binary.BigEndian.PutUint64(length[24:], uint64(len(write.Value))+1)
		words = append(words, WordWrite{wordKey(write.Key, ^uint32(0)), length})
	}
	return a.Words.Apply(words)
}
