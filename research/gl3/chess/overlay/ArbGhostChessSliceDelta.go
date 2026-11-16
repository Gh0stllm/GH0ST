// SPDX-License-Identifier: GPL-3.0-or-later
package precompiles

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"errors"

	"github.com/ethereum/go-ethereum/arbitrum/multigas"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/tracing"
	"github.com/ethereum/go-ethereum/core/vm"
	"github.com/ethereum/go-ethereum/crypto"
)

const sliceGroup = 4
const sliceWord = 32
const sliceBlobPage = 16384
const sliceMaxBlob = 32 * 1024 * 1024
const sliceMaxDeltas = 2_000_000 // >512 full decisions at this fixed grouping
var sliceDeltaPrefix = []byte{0, 'G', 'L', '3', 'D', 1}

func sliceDeltaAddress(hash [32]byte, index int) common.Address {
	var n [4]byte
	binary.LittleEndian.PutUint32(n[:], uint32(index))
	return common.BytesToAddress(crypto.Keccak256([]byte("GL3_CHESS_IMMUTABLE_DELTA_V1"), hash[:], n[:])[12:])
}
func sliceWriteDelta(c ctx, db vm.StateDB, body []byte) ([32]byte, error) {
	if len(body) < 44 || len(body) > sliceMaxBlob {
		return [32]byte{}, errGhostChess
	}
	hash := sha256.Sum256(body)
	for at := 0; at < len(body); at += sliceBlobPage {
		end := at + sliceBlobPage
		if end > len(body) {
			end = len(body)
		}
		code := make([]byte, len(sliceDeltaPrefix)+4+end-at)
		copy(code, sliceDeltaPrefix)
		binary.LittleEndian.PutUint32(code[len(sliceDeltaPrefix):], uint32(len(body)))
		copy(code[len(sliceDeltaPrefix)+4:], body[at:end])
		address := sliceDeltaAddress(hash, at/sliceBlobPage)
		if e := c.Burn(multigas.ResourceKindStorageAccessWrite, 200+uint64(len(code))/16); e != nil {
			return [32]byte{}, e
		}
		old := db.GetCode(address)
		if len(old) > 0 && !bytes.Equal(old, code) {
			return [32]byte{}, errGhostChess
		}
		if len(old) == 0 {
			db.SetCode(address, code, tracing.CodeChangeUnspecified)
		}
	}
	return hash, nil
}
func sliceReadDelta(db vm.StateDB, hash [32]byte) ([]byte, error) {
	first := db.GetCode(sliceDeltaAddress(hash, 0))
	header := len(sliceDeltaPrefix) + 4
	if len(first) < header || !bytes.Equal(first[:len(sliceDeltaPrefix)], sliceDeltaPrefix) {
		return nil, errGhostChess
	}
	n := int(binary.LittleEndian.Uint32(first[len(sliceDeltaPrefix):]))
	if n < 44 || n > sliceMaxBlob {
		return nil, errGhostChess
	}
	out := make([]byte, n)
	for at := 0; at < n; at += sliceBlobPage {
		end := at + sliceBlobPage
		if end > n {
			end = n
		}
		code := first
		if at > 0 {
			code = db.GetCode(sliceDeltaAddress(hash, at/sliceBlobPage))
		}
		if len(code) != header+end-at || !bytes.Equal(code[:len(sliceDeltaPrefix)], sliceDeltaPrefix) || int(binary.LittleEndian.Uint32(code[len(sliceDeltaPrefix):])) != n {
			return nil, errGhostChess
		}
		copy(out[at:end], code[header:])
	}
	if sha256.Sum256(out) != hash {
		return nil, errGhostChess
	}
	return out, nil
}
func sliceApplyDeltas(db vm.StateDB, m sliceMeta, memory []byte, codes map[common.Address]common.Hash) error {
	if m.Deltas > sliceMaxDeltas {
		return errGhostChess
	}
	seen := make([]byte, (len(memory)/sliceWord+7)/8)
	head := m.Head
	// Walk newest first, applying only the latest value of each word. Memory use
	// stays bounded even when an old job's complete history must be reconstructed.
	for left := m.Deltas; left > 0; left-- {
		if head == ([32]byte{}) {
			return errGhostChess
		}
		body, e := sliceReadDelta(db, head)
		if e != nil {
			return e
		}
		for i := 0; i < (len(body)+sliceBlobPage-1)/sliceBlobPage; i++ {
			a := sliceDeltaAddress(head, i)
			codes[a] = db.GetCodeHash(a)
		}
		if string(body[:4]) != "GSD1" {
			return errGhostChess
		}
		var prior [32]byte
		copy(prior[:], body[4:36])
		size := int(binary.LittleEndian.Uint32(body[36:40]))
		count := int(binary.LittleEndian.Uint32(body[40:44]))
		if size > len(memory) || size%65536 != 0 || count > (sliceMaxBlob-44)/36 || len(body) != 44+36*count {
			return errGhostChess
		}
		oldOffset := -1
		for at := 44; at < len(body); at += 36 {
			offset := int(binary.LittleEndian.Uint32(body[at:]))
			if offset%sliceWord != 0 || offset <= oldOffset || offset+sliceWord > size {
				return errGhostChess
			}
			oldOffset = offset
			word := offset / sliceWord
			mask := byte(1 << uint(word%8))
			if seen[word/8]&mask == 0 {
				copy(memory[offset:offset+sliceWord], body[at+4:at+36])
				seen[word/8] |= mask
			}
		}
		head = prior
	}
	if head != ([32]byte{}) {
		return errors.New("unbounded GL3 delta history")
	}
	return nil
}
