// SPDX-License-Identifier: GPL-3.0-or-later
package precompiles

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/ethereum/go-ethereum/core/state"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/core/vm"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethdb/pebble"
	"github.com/ethereum/go-ethereum/triedb"
	"github.com/offchainlabs/nitro/arbos/burn"
)

type capacityDump struct {
	Root                 common.Hash
	Accounts             uint64
	CodeAccounts         uint64
	CodeReferencedBytes  uint64
	CodeUniqueBytes      uint64
	DeltaCodeAccounts    uint64
	DeltaReferencedBytes uint64
	NonzeroNonce         uint64
	NonzeroBalance       uint64
	MissingCodeHashes    uint64
	codeLens             map[common.Hash]uint64
	deltaHashes          map[common.Hash]bool
	unique               map[common.Hash]bool
}

func (d *capacityDump) OnRoot(root common.Hash) { d.Root = root }
func (d *capacityDump) OnAccount(_ *common.Address, a state.DumpAccount) {
	d.Accounts++
	if a.Nonce != 0 {
		d.NonzeroNonce++
	}
	if a.Balance != "0" {
		d.NonzeroBalance++
	}
	h := common.BytesToHash(a.CodeHash)
	if h == types.EmptyCodeHash || len(a.CodeHash) == 0 {
		return
	}
	d.CodeAccounts++
	size, ok := d.codeLens[h]
	if !ok {
		d.MissingCodeHashes++
		return
	}
	d.CodeReferencedBytes += size
	if !d.unique[h] {
		d.unique[h] = true
		d.CodeUniqueBytes += size
	}
	if d.deltaHashes[h] {
		d.DeltaCodeAccounts++
		d.DeltaReferencedBytes += size
	}
}

func TestGL3CapacityReadOnlyCompletedDatabase(t *testing.T) {
	path, out, manifestPath := os.Getenv("GL3_CAPACITY_DB"), os.Getenv("GL3_CAPACITY_OUT"), os.Getenv("GL3_CAPACITY_WORKER_MANIFEST")
	if path != "/root/gl3-process-recovery/full/attempt-02/run/persistent-l2/test-stack-name/l2chaindata" || out == "" || manifestPath == "" {
		t.Fatal("explicit closed private completed DB/evidence/manifest required")
	}
	started := time.Now()
	kv, err := pebble.New(path, 16, 16, "gl3-capacity-readonly", true, nil)
	if err != nil {
		t.Fatal(err)
	}
	disk := rawdb.NewDatabase(kv)
	defer disk.Close()
	codeLens := map[common.Hash]uint64{}
	deltaHashes := map[common.Hash]bool{}
	var records, totalKVBytes, totalCodeBytes, deltaCodeBytes, deltaCodeRecords uint64
	type bucket struct {
		Records    uint64
		KeyBytes   uint64
		ValueBytes uint64
	}
	buckets := map[string]*bucket{}
	it := kv.NewIterator(nil, nil)
	for it.Next() {
		key, value := it.Key(), it.Value()
		records++
		totalKVBytes += uint64(len(key) + len(value))
		category := "empty"
		if len(key) > 0 {
			category = fmt.Sprintf("prefix-%02x", key[0])
		}
		if len(key) == 32 {
			category = "32-byte-unprefixed"
		}
		if bytes.HasPrefix(key, rawdb.CodePrefix) && len(key) == len(rawdb.CodePrefix)+32 {
			category = "code"
			h := common.BytesToHash(key[len(rawdb.CodePrefix):])
			if crypto.Keccak256Hash(value) != h {
				t.Fatal("code key/content hash mismatch")
			}
			codeLens[h] = uint64(len(value))
			totalCodeBytes += uint64(len(value))
			if bytes.HasPrefix(value, sliceDeltaPrefix) {
				deltaHashes[h] = true
				deltaCodeBytes += uint64(len(value))
				deltaCodeRecords++
			}
		}
		b := buckets[category]
		if b == nil {
			b = &bucket{}
			buckets[category] = b
		}
		b.Records++
		b.KeyBytes += uint64(len(key))
		b.ValueBytes += uint64(len(value))
	}
	if err = it.Error(); err != nil {
		t.Fatal(err)
	}
	it.Release()
	head := rawdb.ReadHeadHeader(disk)
	if head == nil {
		t.Fatal("missing closed database head")
	}
	genesisHash := rawdb.ReadCanonicalHash(disk, 0)
	genesis := rawdb.ReadHeader(disk, genesisHash, 0)
	if genesis == nil {
		t.Fatal("missing retained genesis header")
	}
	tdb := triedb.NewDatabase(disk, triedb.HashDefaults)
	defer tdb.Close()
	stateDB := state.NewDatabase(tdb, state.NewCodeDB(disk))
	dump := func(root common.Hash) *capacityDump {
		sd, e := state.New(root, stateDB)
		if e != nil {
			t.Fatal(e)
		}
		c := &capacityDump{codeLens: codeLens, deltaHashes: deltaHashes, unique: map[common.Hash]bool{}}
		if _, e = sd.DumpToCollector(c, &state.DumpConfig{SkipCode: true, SkipStorage: true}); e != nil {
			t.Fatal(e)
		}
		if c.MissingCodeHashes != 0 {
			t.Fatal("missing referenced code", c.MissingCodeHashes)
		}
		return c
	}
	genesisState, currentState := dump(genesis.Root), dump(head.Root)
	sd, err := state.New(head.Root, stateDB)
	if err != nil {
		t.Fatal(err)
	}
	var owner struct {
		Owner common.Address
		Job   [32]byte
	}
	b, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(b, &owner); err != nil {
		t.Fatal(err)
	}
	burner := burn.NewSystemBurner(nil, false)
	m, err := sliceMetaRead(sliceStore(sd, burner, sliceNamespace(owner.Owner, owner.Job)))
	if err != nil {
		t.Fatal(err)
	}
	seed, err := sliceMetaRead(sliceStore(sd, burner, sliceSeedNamespace))
	if err != nil {
		t.Fatal(err)
	}
	if m.Progress.Pending || m.Progress.Move != "e7e5" || m.Progress.Nodes != 24000033 || m.Deltas != 2464 {
		t.Fatal("DB is not the recorded completed full-strength first decision", m.Progress, m.Deltas)
	}
	var bodyBytes, chunkReferences, wordRecords uint64
	headDelta := m.Head
	seen := map[[32]byte]bool{}
	for left := m.Deltas; left > 0; left-- {
		if seen[headDelta] {
			t.Fatal("cyclic delta ancestry")
		}
		seen[headDelta] = true
		body, e := sliceReadDelta(sd, headDelta)
		if e != nil {
			t.Fatal(e)
		}
		bodyBytes += uint64(len(body))
		chunkReferences += uint64((len(body) + sliceBlobPage - 1) / sliceBlobPage)
		if string(body[:4]) != "GSD1" {
			t.Fatal("wrong delta format")
		}
		wordRecords += uint64(binary.LittleEndian.Uint32(body[40:44]))
		copy(headDelta[:], body[4:36])
	}
	if headDelta != ([32]byte{}) {
		t.Fatal("delta ancestry did not terminate at seed")
	}
	restoreStarted := time.Now()
	cache, err := sliceRestoreSeed(&vm.EVM{StateDB: sd}, m, seed)
	if err != nil {
		t.Fatal(err)
	}
	defer cache.VM.Close()
	memorySHA := sha256.Sum256(cache.Image.Memory)
	canonical, err := cache.VM.Canonical()
	if err != nil {
		t.Fatal(err)
	}
	canonicalSHA := sha256.Sum256(canonical)
	if hex.EncodeToString(canonicalSHA[:]) != "5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6" {
		t.Fatal("full TT/history/canonical mismatch")
	}
	if err = sd.Error(); err != nil {
		t.Fatal(err)
	}
	result := map[string]any{"passed": true, "allExecutionOnRunpod": true, "databaseReadOnly": true, "database": path, "headBlockNumber": head.Number.Uint64(), "headHash": head.Hash(), "headStateRoot": head.Root, "genesisHash": genesisHash, "genesisStateRoot": genesis.Root, "kvRecords": records, "logicalKVBytes": totalKVBytes, "uniqueCodeRecords": len(codeLens), "uniqueCodeBytes": totalCodeBytes, "deltaUniqueCodeRecords": deltaCodeRecords, "deltaUniqueCodeBytes": deltaCodeBytes, "kvBuckets": buckets, "genesisCurrentState": genesisState, "completedCurrentState": currentState, "unreferencedCodeBytes": totalCodeBytes - currentState.CodeUniqueBytes, "completedMeta": m, "authenticatedDeltaBodyBytes": bodyBytes, "authenticatedDeltaChunkReferences": chunkReferences, "authenticatedWordRecords": wordRecords, "memoryBytes": len(cache.Image.Memory), "memorySHA256": hex.EncodeToString(memorySHA[:]), "canonicalBytes": len(canonical), "canonicalSHA256": hex.EncodeToString(canonicalSHA[:]), "coldRestoreAndCanonicalSeconds": time.Since(restoreStarted).Seconds(), "seconds": time.Since(started).Seconds(), "engineSearchExecuted": false, "stateCommitted": false, "prunerExecuted": false, "twentyGameCapacityAccepted": false}
	b, err = json.MarshalIndent(result, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(out, "completed-database-measurement.json"), append(b, '\n'), 0600); err != nil {
		t.Fatal(err)
	}
}
