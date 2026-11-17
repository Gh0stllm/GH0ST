// SPDX-License-Identifier: GPL-3.0-or-later
// Package hostcacheidentity provides a host-side key for a decoded Nitro
// validation input. It does not change the state transition or proof machine.
package hostcacheidentity

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"hash"
	"reflect"
	"sort"
	"sync"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/offchainlabs/nitro/arbutil"
	"github.com/offchainlabs/nitro/daprovider"
	"github.com/offchainlabs/nitro/validator"
)

const Schema = "GL3_DECODED_VALIDATION_INPUT_V2"

// Key binds the module and wrapper mode separately from the typed input hash.
// It is comparable and can be used directly as a Go map key. No RPC JSON or wire
// hash belongs in this key: the pinned map serializer has unstable key order.
type Key struct {
	ModuleRoot     common.Hash
	UseBoldMachine bool
	InputSHA256    common.Hash
}

var schemaOnce sync.Once
var schemaError error

func requireSchema() error {
	schemaOnce.Do(func() {
		for _, spec := range []struct {
			typ   reflect.Type
			names []string
		}{
			{reflect.TypeFor[validator.ValidationInput](), []string{"Id", "HasDelayedMsg", "DelayedMsgNr", "Preimages", "UserWasms", "BatchInfo", "DelayedMsg", "StartState", "DebugChain"}},
			{reflect.TypeFor[validator.GoGlobalState](), []string{"BlockHash", "SendRoot", "Batch", "PosInBatch"}},
			{reflect.TypeFor[validator.BatchInfo](), []string{"Number", "Data"}},
		} {
			if spec.typ.NumField() != len(spec.names) {
				schemaError = errors.New("unsupported decoded validation schema")
				return
			}
			for _, name := range spec.names {
				if _, ok := spec.typ.FieldByName(name); !ok {
					schemaError = errors.New("unsupported decoded validation schema")
					return
				}
			}
		}
	})
	return schemaError
}

type encoder struct{ h hash.Hash }

func (e encoder) u64(v uint64)  { var b [8]byte; binary.BigEndian.PutUint64(b[:], v); e.h.Write(b[:]) }
func (e encoder) blob(v []byte) { e.u64(uint64(len(v))); e.h.Write(v) }
func (e encoder) tag(v string)  { e.blob([]byte(v)) }
func (e encoder) boolean(v bool) {
	if v {
		e.h.Write([]byte{1})
	} else {
		e.h.Write([]byte{0})
	}
}

// Digest reads every field of the decoded ValidationInput. The caller must
// prevent concurrent mutation during hashing and must keep input immutable for
// as long as any cached execution uses it. This function does not take ownership
// or seal aliases. Use CloneAndKey when the caller cannot transfer exclusive
// ownership of a freshly decoded request.
//
// Nil and empty slices/maps have the same length encoding. A PRESENT empty map
// group remains distinct from an ABSENT group; this conservative separation is
// safe even where the execution would treat both as missing. The encoding has
// field/type tags, collection counts and length-delimited bytes at every level.
func Digest(input *validator.ValidationInput) (common.Hash, error) {
	if input == nil {
		return common.Hash{}, errors.New("nil decoded validation input")
	}
	if err := requireSchema(); err != nil {
		return common.Hash{}, err
	}
	e := encoder{sha256.New()}
	e.tag(Schema)
	e.tag("struct/ValidationInput")
	e.u64(9)
	e.tag("Id/uint64")
	e.u64(input.Id)
	e.tag("HasDelayedMsg/bool")
	e.boolean(input.HasDelayedMsg)
	e.tag("DelayedMsgNr/uint64")
	e.u64(input.DelayedMsgNr)
	e.tag("StartState/struct/GoGlobalState")
	e.u64(4)
	e.tag("BlockHash/hash32")
	e.blob(input.StartState.BlockHash[:])
	e.tag("SendRoot/hash32")
	e.blob(input.StartState.SendRoot[:])
	e.tag("Batch/uint64")
	e.u64(input.StartState.Batch)
	e.tag("PosInBatch/uint64")
	e.u64(input.StartState.PosInBatch)
	e.tag("DebugChain/bool")
	e.boolean(input.DebugChain)
	e.tag("Preimages/map/preimage-type/map/hash32/blob")
	types := make([]int, 0, len(input.Preimages))
	for typ := range input.Preimages {
		types = append(types, int(typ))
	}
	sort.Ints(types)
	e.u64(uint64(len(types)))
	for _, typ := range types {
		e.tag("preimage-group")
		e.u64(uint64(typ))
		group := input.Preimages[arbutil.PreimageType(typ)]
		keys := sortedHashes(group)
		e.u64(uint64(len(keys)))
		for _, key := range keys {
			e.tag("preimage-entry")
			e.blob(key[:])
			e.blob(group[key])
		}
	}
	e.tag("BatchInfo/list/struct/BatchInfo")
	e.u64(uint64(len(input.BatchInfo)))
	for _, batch := range input.BatchInfo {
		e.tag("batch/struct")
		e.u64(2)
		e.tag("Number/uint64")
		e.u64(batch.Number)
		e.tag("Data/blob")
		e.blob(batch.Data)
	}
	e.tag("DelayedMsg/blob")
	e.blob(input.DelayedMsg)
	e.tag("UserWasms/map/target/map/hash32/blob")
	targets := make([]string, 0, len(input.UserWasms))
	for target := range input.UserWasms {
		targets = append(targets, string(target))
	}
	sort.Strings(targets)
	e.u64(uint64(len(targets)))
	for _, target := range targets {
		e.tag("wasm-target-group")
		e.blob([]byte(target))
		group := input.UserWasms[rawdb.WasmTarget(target)]
		keys := sortedHashes(group)
		e.u64(uint64(len(keys)))
		for _, key := range keys {
			e.tag("wasm-module-entry")
			e.blob(key[:])
			e.blob(group[key])
		}
	}
	var result common.Hash
	copy(result[:], e.h.Sum(nil))
	return result, nil
}

func sortedHashes(group map[common.Hash][]byte) []common.Hash {
	keys := make([]common.Hash, 0, len(group))
	for key := range group {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool { return bytes.Compare(keys[i][:], keys[j][:]) < 0 })
	return keys
}

// KeyOwnedDecoded makes a key WITHOUT copying input. Its name states the
// required ownership contract: the server has freshly decoded this request,
// transfers exclusive ownership to its private retained-run entry, and exposes
// no mutable input aliases thereafter. Do not use it for arbitrary shared Go
// callers. A digest cannot make a mutable object immutable.
func KeyOwnedDecoded(moduleRoot common.Hash, input *validator.ValidationInput, useBoldMachine bool) (Key, error) {
	digest, err := Digest(input)
	if err != nil {
		return Key{}, err
	}
	return Key{ModuleRoot: moduleRoot, UseBoldMachine: useBoldMachine, InputSHA256: digest}, nil
}

// CloneAndKey snapshots every nested map and byte slice, then hashes the owned
// copy. The caller must synchronize the original during copying. Once returned,
// the recipient must keep this owned snapshot private and immutable while its
// cached execution exists; the returned Go pointer itself is not an enforced
// immutable type. This avoids silently treating a generic caller as an owner.
func CloneAndKey(moduleRoot common.Hash, input *validator.ValidationInput, useBoldMachine bool) (*validator.ValidationInput, Key, error) {
	if input == nil {
		return nil, Key{}, errors.New("nil decoded validation input")
	}
	if err := requireSchema(); err != nil {
		return nil, Key{}, err
	}
	out := *input
	out.DelayedMsg = cloneBytes(input.DelayedMsg)
	if input.BatchInfo != nil {
		out.BatchInfo = make([]validator.BatchInfo, len(input.BatchInfo))
		for i, v := range input.BatchInfo {
			out.BatchInfo[i] = validator.BatchInfo{Number: v.Number, Data: cloneBytes(v.Data)}
		}
	}
	if input.Preimages != nil {
		out.Preimages = make(daprovider.PreimagesMap, len(input.Preimages))
		for typ, group := range input.Preimages {
			out.Preimages[typ] = cloneMap(group)
		}
	}
	if input.UserWasms != nil {
		out.UserWasms = make(map[rawdb.WasmTarget]map[common.Hash][]byte, len(input.UserWasms))
		for target, group := range input.UserWasms {
			out.UserWasms[target] = cloneMap(group)
		}
	}
	key, err := KeyOwnedDecoded(moduleRoot, &out, useBoldMachine)
	if err != nil {
		return nil, Key{}, err
	}
	return &out, key, nil
}
func cloneBytes(b []byte) []byte {
	if b == nil {
		return nil
	}
	out := make([]byte, len(b))
	copy(out, b)
	return out
}
func cloneMap(group map[common.Hash][]byte) map[common.Hash][]byte {
	if group == nil {
		return nil
	}
	out := make(map[common.Hash][]byte, len(group))
	for key, data := range group {
		out[key] = cloneBytes(data)
	}
	return out
}
