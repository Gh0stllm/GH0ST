// SPDX-License-Identifier: GPL-3.0-or-later
// Package bankprototype is a native allocator experiment, not a registered STF.
package bankprototype

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/state"
	"github.com/ethereum/go-ethereum/core/tracing"
	"github.com/ethereum/go-ethereum/crypto"
)

const PageSize = 4096

var cellMagic = []byte{0, 'G', 'L', '3', 'B', 1}
var descriptorMagic = []byte{0, 'G', 'L', '3', 'M', 1}

const cellHeader = 6 + 4 + 8 + 4 + 32
const domain = "GL3_FIXED_BANK_ALLOCATOR_PROTOTYPE_V1"

type Descriptor struct {
	Version    uint32
	Bank       uint32
	Owner      common.Address
	Epoch      uint64
	Generation uint64
	Pages      uint32
	Present    []byte
	Globals    []byte
	WindowRoot [32]byte
}
type Bank struct {
	ID          uint32
	Owner       common.Address
	seed        [][]byte
	seedGlobals []byte
}

// New receives TRUSTED fixture/engine bytes. There is no public import ABI.
// This prototype covers a small actual-memory window, never a full VM image.
func New(id uint32, owner common.Address, seed [][]byte, globals []byte) (*Bank, error) {
	if len(seed) == 0 || len(seed) > 256 || len(globals) > 16384 {
		return nil, errors.New("prototype window bound")
	}
	b := &Bank{ID: id, Owner: owner, seed: make([][]byte, len(seed)), seedGlobals: bytes.Clone(globals)}
	for i, page := range seed {
		if len(page) != PageSize {
			return nil, errors.New("full pages required")
		}
		b.seed[i] = bytes.Clone(page)
	}
	return b, nil
}
func (b *Bank) Address(index uint32) common.Address {
	var n [8]byte
	binary.BigEndian.PutUint32(n[:4], b.ID)
	binary.BigEndian.PutUint32(n[4:], index)
	return common.BytesToAddress(crypto.Keccak256([]byte(domain), []byte("cell"), n[:])[12:])
}
func (b *Bank) MetaAddress() common.Address {
	var n [4]byte
	binary.BigEndian.PutUint32(n[:], b.ID)
	return common.BytesToAddress(crypto.Keccak256([]byte(domain), []byte("descriptor"), n[:])[12:])
}
func (b *Bank) descriptor(db *state.StateDB) (Descriptor, error) {
	var d Descriptor
	code := db.GetCode(b.MetaAddress())
	if len(code) == 0 {
		return d, nil
	}
	if len(code) > 65536 || !bytes.HasPrefix(code, descriptorMagic) || json.Unmarshal(code[len(descriptorMagic):], &d) != nil {
		return d, errors.New("invalid descriptor")
	}
	if d.Version != 1 || d.Bank != b.ID || d.Owner != b.Owner || d.Pages != uint32(len(b.seed)) || len(d.Present) != (len(b.seed)+7)/8 || d.Epoch == 0 || len(d.Globals) > 16384 {
		return d, errors.New("descriptor identity/shape mismatch")
	}
	if rem := uint(d.Pages % 8); rem != 0 && d.Present[len(d.Present)-1]&^byte((1<<rem)-1) != 0 {
		return d, errors.New("noncanonical presence bitmap")
	}
	return d, nil
}
func (b *Bank) writeDescriptor(db *state.StateDB, d Descriptor) error {
	data, err := json.Marshal(d)
	if err != nil {
		return err
	}
	code := append(bytes.Clone(descriptorMagic), data...)
	db.SetCode(b.MetaAddress(), code, tracing.CodeChangeUnspecified)
	return db.Error()
}
func encodeCell(id uint32, epoch uint64, index uint32, data []byte) []byte {
	code := make([]byte, cellHeader+len(data))
	copy(code, cellMagic)
	binary.BigEndian.PutUint32(code[6:10], id)
	binary.BigEndian.PutUint64(code[10:18], epoch)
	binary.BigEndian.PutUint32(code[18:22], index)
	h := sha256.Sum256(data)
	copy(code[22:54], h[:])
	copy(code[cellHeader:], data)
	return code
}
func (b *Bank) decodeCell(code []byte, index uint32, epoch uint64) ([]byte, error) {
	if len(code) != cellHeader+PageSize || !bytes.HasPrefix(code, cellMagic) || binary.BigEndian.Uint32(code[6:10]) != b.ID || binary.BigEndian.Uint32(code[18:22]) != index || binary.BigEndian.Uint64(code[10:18]) != epoch {
		return nil, errors.New("missing/stale/foreign cell")
	}
	data := code[cellHeader:]
	h := sha256.Sum256(data)
	if !bytes.Equal(h[:], code[22:54]) {
		return nil, errors.New("cell bytes/hash mismatch")
	}
	return bytes.Clone(data), nil
}
func (b *Bank) window(db *state.StateDB, d Descriptor) ([][]byte, [32]byte, error) {
	pages := make([][]byte, len(b.seed))
	h := sha256.New()
	h.Write([]byte(domain))
	var n [8]byte
	binary.BigEndian.PutUint32(n[:4], b.ID)
	binary.BigEndian.PutUint32(n[4:], uint32(len(pages)))
	h.Write(n[:])
	for i := range pages {
		page := bytes.Clone(b.seed[i])
		if d.Present[i/8]&(1<<uint(i%8)) != 0 {
			var err error
			page, err = b.decodeCell(db.GetCode(b.Address(uint32(i))), uint32(i), d.Epoch)
			if err != nil {
				return nil, [32]byte{}, err
			}
		}
		pages[i] = page
		h.Write(page)
	}
	var size [8]byte
	binary.BigEndian.PutUint64(size[:], uint64(len(d.Globals)))
	h.Write(size[:])
	h.Write(d.Globals)
	var root [32]byte
	copy(root[:], h.Sum(nil))
	return pages, root, nil
}
func (b *Bank) Read(db *state.StateDB) (Descriptor, [][]byte, error) {
	d, err := b.descriptor(db)
	if err != nil || d.Epoch == 0 {
		if err == nil {
			err = errors.New("bank uninitialized")
		}
		return d, nil, err
	}
	pages, root, err := b.window(db, d)
	if err == nil && root != d.WindowRoot {
		err = errors.New("window/globals commitment mismatch")
	}
	if err == nil {
		err = db.Error()
	}
	return d, pages, err
}
func (b *Bank) Begin(db *state.StateDB, caller common.Address) (d Descriptor, err error) {
	if caller != b.Owner {
		return d, errors.New("unauthorized prototype writer")
	}
	snapshot := db.Snapshot()
	defer func() {
		if err != nil {
			db.RevertToSnapshot(snapshot)
		}
	}()
	prior, err := b.descriptor(db)
	if err != nil {
		return d, err
	}
	if prior.Epoch == math.MaxUint64 {
		return d, errors.New("epoch overflow")
	}
	d = Descriptor{Version: 1, Bank: b.ID, Owner: b.Owner, Epoch: prior.Epoch + 1, Pages: uint32(len(b.seed)), Present: make([]byte, (len(b.seed)+7)/8), Globals: bytes.Clone(b.seedGlobals)}
	_, d.WindowRoot, err = b.window(db, d)
	if err != nil {
		return d, err
	}
	err = b.writeDescriptor(db, d)
	return d, err
}
func (b *Bank) Update(db *state.StateDB, caller common.Address, epoch, generation uint64, pages map[uint32][]byte, globals []byte) (Descriptor, error) {
	return b.apply(db, caller, epoch, generation, pages, globals, nil)
}

// The interrupt callback is test-only fault injection after a real cell write.
// A production adapter must derive pages from the authenticated engine state,
// add bounded gas/work metering and use a separately reviewed new STF/root.
func (b *Bank) apply(db *state.StateDB, caller common.Address, epoch, generation uint64, pages map[uint32][]byte, globals []byte, interrupt func(int) error) (d Descriptor, err error) {
	if caller != b.Owner {
		return d, errors.New("unauthorized prototype writer")
	}
	d, err = b.descriptor(db)
	if err != nil {
		return d, err
	}
	if d.Epoch == 0 || d.Epoch != epoch || d.Generation != generation || generation == math.MaxUint64 || len(globals) > 16384 {
		return d, errors.New("stale epoch/generation or invalid globals")
	}
	if _, _, err = b.Read(db); err != nil {
		return d, err
	}
	indices := make([]int, 0, len(pages))
	for i, page := range pages {
		if i >= d.Pages || len(page) != PageSize {
			return d, errors.New("page/index bound")
		}
		indices = append(indices, int(i))
	}
	sort.Ints(indices)
	snapshot := db.Snapshot()
	defer func() {
		if err != nil {
			db.RevertToSnapshot(snapshot)
		}
	}()
	for at, index := range indices {
		i := uint32(index)
		old := db.GetCode(b.Address(i))
		if len(old) > 0 {
			if len(old) != cellHeader+PageSize || !bytes.HasPrefix(old, cellMagic) || binary.BigEndian.Uint32(old[6:10]) != b.ID || binary.BigEndian.Uint32(old[18:22]) != i || binary.BigEndian.Uint64(old[10:18]) > d.Epoch {
				return d, errors.New("unexpected preexisting cell code")
			}
		}
		db.SetCode(b.Address(i), encodeCell(b.ID, d.Epoch, i, pages[i]), tracing.CodeChangeUnspecified)
		d.Present[i/8] |= 1 << uint(i%8)
		if interrupt != nil {
			if err = interrupt(at); err != nil {
				return d, err
			}
		}
	}
	d.Generation++
	d.Globals = bytes.Clone(globals)
	_, d.WindowRoot, err = b.window(db, d)
	if err != nil {
		return d, err
	}
	if err = b.writeDescriptor(db, d); err != nil {
		return d, err
	}
	return d, nil
}
func (d Descriptor) String() string {
	return fmt.Sprintf("bank=%d epoch=%d generation=%d pages=%d", d.Bank, d.Epoch, d.Generation, d.Pages)
}
