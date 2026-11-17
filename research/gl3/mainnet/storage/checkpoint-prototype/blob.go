package checkpoint

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"errors"
)

type Hash = [32]byte

const BlobPage = 16384
const MaxBlob = 32 * 1024 * 1024
const MaxBuildChunk = 8 * 1024 * 1024
const BuildEnvelope = 44

var blobPrefix = []byte{0, 'G', 'L', '3', 'D', 1}
var ErrBlob = errors.New("invalid authenticated blob")

// BlobStore is the existing sliceWriteDelta/sliceReadDelta semantic boundary.
// A future Nitro adapter must delegate to the real StateDB transaction journal.
type BlobStore interface {
	PutBlob([]byte) (Hash, error)
	GetBlob(Hash) ([]byte, error)
	Snapshot() int
	Revert(int)
}
type fragmentKey struct {
	Hash  Hash
	Index uint32
}
type undo struct {
	Key      fragmentKey
	Previous []byte
	Existed  bool
}

// MemoryBlobs emulates the existing SHA256 body/16KiB prefixed-code layout.
// It does not create EVM accounts, derive their Keccak addresses, prune or GC.
type MemoryBlobs struct {
	codes     map[fragmentKey][]byte
	journal   []undo
	FailAfter int
	writes    int
}

func NewMemoryBlobs() *MemoryBlobs {
	return &MemoryBlobs{codes: make(map[fragmentKey][]byte), FailAfter: -1}
}
func (s *MemoryBlobs) Snapshot() int { return len(s.journal) }
func (s *MemoryBlobs) Revert(mark int) {
	for i := len(s.journal) - 1; i >= mark; i-- {
		u := s.journal[i]
		if u.Existed {
			s.codes[u.Key] = u.Previous
		} else {
			delete(s.codes, u.Key)
		}
	}
	s.journal = s.journal[:mark]
}
func (s *MemoryBlobs) PutBlob(body []byte) (Hash, error) {
	if len(body) < 44 || len(body) > MaxBlob {
		return Hash{}, ErrBlob
	}
	h := sha256.Sum256(body)
	for at := 0; at < len(body); at += BlobPage {
		end := at + BlobPage
		if end > len(body) {
			end = len(body)
		}
		code := make([]byte, 10+end-at)
		copy(code, blobPrefix)
		binary.LittleEndian.PutUint32(code[6:10], uint32(len(body)))
		copy(code[10:], body[at:end])
		key := fragmentKey{h, uint32(at / BlobPage)}
		old, exists := s.codes[key]
		if exists && !bytes.Equal(old, code) {
			return Hash{}, ErrBlob
		}
		if exists {
			continue
		}
		if s.FailAfter >= 0 && s.writes >= s.FailAfter {
			return Hash{}, errors.New("injected storage write failure")
		}
		s.journal = append(s.journal, undo{key, old, exists})
		s.codes[key] = code
		s.writes++
	}
	return h, nil
}
func (s *MemoryBlobs) GetBlob(h Hash) ([]byte, error) {
	first := s.codes[fragmentKey{h, 0}]
	if len(first) < 10 || !bytes.Equal(first[:6], blobPrefix) {
		return nil, ErrBlob
	}
	n := int(binary.LittleEndian.Uint32(first[6:10]))
	if n < 44 || n > MaxBlob {
		return nil, ErrBlob
	}
	out := make([]byte, n)
	for at := 0; at < n; at += BlobPage {
		end := at + BlobPage
		if end > n {
			end = n
		}
		code := s.codes[fragmentKey{h, uint32(at / BlobPage)}]
		if len(code) != 10+end-at || !bytes.Equal(code[:6], blobPrefix) || int(binary.LittleEndian.Uint32(code[6:10])) != n {
			return nil, ErrBlob
		}
		copy(out[at:end], code[10:])
	}
	if sha256.Sum256(out) != h {
		return nil, ErrBlob
	}
	return out, nil
}
func chunkBody(id Hash, index uint32, payload []byte) []byte {
	out := make([]byte, BuildEnvelope+len(payload))
	copy(out, []byte("CPB1"))
	copy(out[4:36], id[:])
	binary.LittleEndian.PutUint32(out[36:40], index)
	binary.LittleEndian.PutUint32(out[40:44], uint32(len(payload)))
	copy(out[44:], payload)
	return out
}
func chunkPayload(body []byte, id Hash, index uint32) ([]byte, error) {
	if len(body) < BuildEnvelope || len(body) > MaxBuildChunk || string(body[:4]) != "CPB1" || !bytes.Equal(body[4:36], id[:]) || binary.LittleEndian.Uint32(body[36:40]) != index || int(binary.LittleEndian.Uint32(body[40:44])) != len(body)-44 {
		return nil, ErrBlob
	}
	return body[44:], nil
}
