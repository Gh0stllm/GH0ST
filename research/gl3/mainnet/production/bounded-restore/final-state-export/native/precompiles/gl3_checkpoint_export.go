//go:build gl3_checkpoint_export && !wasm

// SPDX-License-Identifier: GPL-3.0-or-later
// Native acceptance exporter only. Never compiled into the selected guest.
package precompiles

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/vm"
	"github.com/ethereum/go-ethereum/params"
	"github.com/offchainlabs/nitro/arbos/burn"
)

func GhostChessExportForAcceptance(db vm.StateDB, config *params.ChainConfig, block uint64, owner common.Address, job [32]byte, out string) (string, int, [32]byte, uint32, error) {
	fail := func(e error) (string, int, [32]byte, uint32, error) { return "", 0, [32]byte{}, 0, e }
	b := burn.NewSystemBurner(nil, false)
	jobStore := sliceStore(db, b, sliceNamespace(owner, job))
	m, e := sliceMetaRead(jobStore)
	if e != nil {
		return fail(e)
	}
	seedStore := sliceStore(db, b, sliceSeedNamespace)
	seed, e := sliceMetaRead(seedStore)
	if e != nil {
		return fail(e)
	}
	if m.Progress.Pending || m.Deltas != 2464 || m.Progress.Move != "e7e5" || m.Progress.Nodes != 24000033 || m.Progress.Depth != 38 {
		return fail(fmt.Errorf("unexpected completed metadata: %+v", m.Progress))
	}
	if e = os.MkdirAll(out, 0700); e != nil {
		return fail(e)
	}
	write := func(name string, v []byte) error { return os.WriteFile(filepath.Join(out, name), v, 0600) }
	writeJSON := func(name string, v interface{}) error {
		p, e := json.MarshalIndent(v, "", "  ")
		if e != nil {
			return e
		}
		return write(name, p)
	}
	raw, e := jobStore.GetBytes()
	if e != nil {
		return fail(e)
	}
	if e = write("meta.json", raw); e != nil {
		return fail(e)
	}
	raw, e = seedStore.GetBytes()
	if e != nil {
		return fail(e)
	}
	if e = write("seed-meta.json", raw); e != nil {
		return fail(e)
	}
	if e = writeJSON("seed-globals.json", seed.Globals); e != nil {
		return fail(e)
	}
	body, e := sliceReadDelta(db, m.Head)
	if e != nil {
		return fail(e)
	}
	if e = write("final-delta.bin", body); e != nil {
		return fail(e)
	}
	fragments := []map[string]interface{}{}
	for i := 0; i < (len(body)+sliceBlobPage-1)/sliceBlobPage; i++ {
		address := sliceDeltaAddress(m.Head, i)
		code := sliceReadImmutableChessCode(db, address)
		name := fmt.Sprintf("final-code-%04d.bin", i)
		if e = write(name, code); e != nil {
			return fail(e)
		}
		fragments = append(fragments, map[string]interface{}{"index": i, "address": address.Hex(), "codeHash": db.GetCodeHash(address).Hex(), "file": name, "bytes": len(code)})
	}
	if e = writeJSON("final-fragments.json", fragments); e != nil {
		return fail(e)
	}
	evm := vm.NewEVM(vm.BlockContext{BlockNumber: new(big.Int).SetUint64(block)}, db, config, vm.Config{})
	cache, e := sliceRestoreSeed(evm, m, seed)
	if e != nil {
		return fail(e)
	}
	defer cache.VM.Close()
	// Export committed portable bytes before Canonical may mutate the VM.
	if cache.Tree.Root(len(cache.Image.Memory), cache.Image.Globals) != m.Root {
		return fail(fmt.Errorf("image root mismatch"))
	}
	if e = write("memory.bin", cache.Image.Memory); e != nil {
		return fail(e)
	}
	if e = writeJSON("globals.json", cache.Image.Globals); e != nil {
		return fail(e)
	}
	if e = writeJSON("identity.json", map[string]interface{}{"owner": owner.Hex(), "job": hex.EncodeToString(job[:]), "module": hex.EncodeToString(m.Module[:]), "imageRoot": hex.EncodeToString(m.Root[:]), "head": hex.EncodeToString(m.Head[:]), "generation": m.Generation, "searchGeneration": m.SearchGeneration, "operation": m.Operation, "history": m.History, "request": m.Request, "deltaCount": m.Deltas, "deltaBytes": m.DeltaBytes, "memoryBytes": len(cache.Image.Memory), "progress": m.Progress, "exportBeforeCanonical": true, "exportCallsBeginOrAdvance": false}); e != nil {
		return fail(e)
	}
	canonical, e := cache.VM.Canonical()
	if e != nil {
		return fail(e)
	}
	if e = write("canonical.bin", canonical); e != nil {
		return fail(e)
	}
	sum := sha256.Sum256(canonical)
	if errorDB, ok := db.(interface{ Error() error }); ok {
		if e = errorDB.Error(); e != nil {
			return fail(e)
		}
	}
	return hex.EncodeToString(sum[:]), len(canonical), m.Root, m.Deltas, nil
}
