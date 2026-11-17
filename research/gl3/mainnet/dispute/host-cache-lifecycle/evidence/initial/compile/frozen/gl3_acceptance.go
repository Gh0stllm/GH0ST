//go:build gl3_acceptance

// SPDX-License-Identifier: GPL-3.0-or-later
// Acceptance-only seams. This file is absent from untagged production builds.
package precompiles

import (
	"crypto/sha256"
	"encoding/hex"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/vm"
	"github.com/ethereum/go-ethereum/params"
	"github.com/offchainlabs/nitro/arbos/burn"
)

// GhostChessDropCachesForAcceptance prevents an in-process lifecycle test from
// accidentally obtaining recovery success from a retained engine VM.
func GhostChessDropCachesForAcceptance() int {
	sliceCaches.Lock()
	defer sliceCaches.Unlock()
	n := len(sliceCaches.Items)
	for key, item := range sliceCaches.Items {
		item.VM.Close()
		delete(sliceCaches.Items, key)
	}
	return n
}

// GhostChessCanonicalForAcceptance reconstructs only from authenticated chain
// bytes, in a separate VM. It never reads or populates the live engine cache.
func GhostChessCanonicalForAcceptance(db vm.StateDB, config *params.ChainConfig, block uint64, owner common.Address, job [32]byte) (string, int, [32]byte, uint32, error) {
	b := burn.NewSystemBurner(nil, false)
	m, e := sliceMetaRead(sliceStore(db, b, sliceNamespace(owner, job)))
	if e != nil {
		return "", 0, [32]byte{}, 0, e
	}
	seed, e := sliceMetaRead(sliceStore(db, b, sliceSeedNamespace))
	if e != nil {
		return "", 0, [32]byte{}, 0, e
	}
	evm := vm.NewEVM(vm.BlockContext{BlockNumber: new(big.Int).SetUint64(block)}, db, config, vm.Config{})
	cache, e := sliceRestoreSeed(evm, m, seed)
	if e != nil {
		return "", 0, [32]byte{}, 0, e
	}
	defer cache.VM.Close()
	canonical, e := cache.VM.Canonical()
	if e != nil {
		return "", 0, [32]byte{}, 0, e
	}
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:]), len(canonical), m.Root, m.Deltas, nil
}
