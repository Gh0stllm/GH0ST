// SPDX-License-Identifier: GPL-3.0-or-later
// Install the exact initialized A14 image on a live chain after a matched runtime upgrade.
package precompiles

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"math/bits"

	sliced "github.com/Gh0stllm/GH0ST/gl3/slicedchess"
	"github.com/ethereum/go-ethereum/arbitrum/multigas"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/tracing"
)

const (
	sliceMigrationMemoryBytes   = 466157568
	sliceMigrationPagesPerChunk = 16
	sliceMigrationChunks        = sliceMigrationMemoryBytes / (sliceMigrationPagesPerChunk * sliced.PageSize)
	sliceMigrationProofDepth    = 14
	sliceMigrationNextSlot      = 0
	sliceMigrationLastBlockSlot = 1
)

var (
	sliceMigrationNamespace = []byte("GL3_CHESS_SEED_MIGRATION_V1")
	sliceMigrationModule    = bytes32(common.HexToHash("1d650410655d93624801a0fa45d64d72ec5d209115672b5848f010037da5e5bc"))
	sliceMigrationRoot      = bytes32(common.HexToHash("5d89d556e3c7cede4a0e4c80928f84ffa02274053cf0cfa82413dc82c6a2c407"))
	sliceMigrationGlobals   = []sliced.Global{
		{Name: "gl3_global_0", Value: 120685200},
		{Name: "gl3_global_98", Value: 0},
		{Name: "gl3_global_99", Value: 0},
	}
)

func (p ArbGhostChessSlices) SeedMigrationProgress(c ctx, evm mech) (uint32, uint32, error) {
	if !sliceMigrationSupported(evm) {
		return 0, 0, errGhostChess
	}
	seed := sliceStore(evm.StateDB, c, sliceSeedNamespace)
	size, err := seed.GetBytesSize()
	if err != nil {
		return 0, 0, err
	}
	if size != 0 {
		meta, err := sliceMetaRead(seed)
		if err != nil {
			return 0, 0, err
		}
		if meta.Root != sliceMigrationRoot || !validSliceGameSeed(meta) {
			return 0, 0, errGhostChess
		}
		return sliceMigrationChunks, sliceMigrationChunks, nil
	}
	progress := sliceStore(evm.StateDB, c, sliceMigrationNamespace)
	next, err := progress.GetUint64ByUint64(sliceMigrationNextSlot)
	if err != nil {
		return 0, 0, err
	}
	if next >= sliceMigrationChunks {
		return 0, 0, errGhostChess
	}
	return uint32(next), sliceMigrationChunks, nil
}

// InstallSeedChunk accepts sixteen consecutive genesis pages and verifies the whole
// chunk against the exact initialized engine image before storing any page.
func (p ArbGhostChessSlices) InstallSeedChunk(c ctx, evm mech, chunk uint32, nonZeroPages uint16, pages []byte, siblings [sliceMigrationProofDepth]bytes32) (bool, error) {
	if !sliceMigrationSupported(evm) || c.ReadOnly() || chunk >= sliceMigrationChunks ||
		len(pages) != bits.OnesCount16(nonZeroPages)*sliced.PageSize {
		return false, errGhostChess
	}
	owner, err := c.State.ChainOwners().IsMember(c.caller)
	if err != nil {
		return false, err
	}
	if !owner {
		return false, errGhostChess
	}
	next, _, err := p.SeedMigrationProgress(c, evm)
	if err != nil {
		return false, err
	}
	if next != chunk {
		return false, errGhostChess
	}
	active, err := sliceStore(evm.StateDB, c, sliceReservation).GetBytesSize()
	if err != nil {
		return false, err
	}
	if active != 0 || evm.Context.BlockNumber == nil || !evm.Context.BlockNumber.IsUint64() {
		return false, errGhostChess
	}
	progress := sliceStore(evm.StateDB, c, sliceMigrationNamespace)
	lastBlock, err := progress.GetUint64ByUint64(sliceMigrationLastBlockSlot)
	if err != nil {
		return false, err
	}
	block := evm.Context.BlockNumber.Uint64()
	if block <= lastBlock {
		return false, errGhostChess
	}
	if err = c.Burn(multigas.ResourceKindComputation, 20_000); err != nil {
		return false, err
	}
	bodies, root, err := sliceMigrationChunkRoot(chunk, nonZeroPages, pages, siblings)
	if err != nil {
		return false, err
	}
	if root != sliceMigrationRoot {
		return false, errGhostChess
	}
	if err = sliceMigrationWritePages(c, evm, chunk, bodies); err != nil {
		return false, err
	}
	complete := chunk+1 == sliceMigrationChunks
	if complete {
		// Use the same metadata namespace and encoding as SeedGhostChessSlicesGenesis.
		seed := sliceStore(evm.StateDB, c, sliceSeedNamespace)
		err = sliceMetaWrite(seed, sliceMeta{
			Version: 2, Module: sliceMigrationModule, Root: sliceMigrationRoot,
			MemoryBytes: sliceMigrationMemoryBytes, Globals: sliceMigrationGlobals, Generation: 1,
		})
		if err != nil {
			return false, err
		}
	}
	if err = progress.SetUint64ByUint64(sliceMigrationLastBlockSlot, block); err != nil {
		return false, err
	}
	if err = progress.SetUint64ByUint64(sliceMigrationNextSlot, uint64(chunk)+1); err != nil {
		return false, err
	}
	return complete, nil
}

func sliceMigrationSupported(evm mech) bool {
	return sliced.ModuleSHA == sliceMigrationModule &&
		!evm.ChainConfig().ArbitrumChainParams.AllowDebugPrecompiles
}

func sliceMigrationChunkRoot(chunk uint32, nonZeroPages uint16, pages []byte, siblings [sliceMigrationProofDepth]bytes32) ([sliceMigrationPagesPerChunk][]byte, bytes32, error) {
	var bodies [sliceMigrationPagesPerChunk][]byte
	var nodes [sliceMigrationPagesPerChunk]bytes32
	var zeroPage [sliced.PageSize]byte
	base := uint64(chunk) * sliceMigrationPagesPerChunk
	for i := range nodes {
		page := zeroPage[:]
		if nonZeroPages&(1<<i) != 0 {
			page, pages = pages[:sliced.PageSize], pages[sliced.PageSize:]
			if sliceZero(page) {
				return bodies, bytes32{}, errGhostChess
			}
			bodies[i] = page
		}
		nodes[i] = sliceMigrationLeaf(base+uint64(i), page)
	}
	for width := len(nodes); width > 1; width /= 2 {
		for i := 0; i < width/2; i++ {
			nodes[i] = sliceMigrationParent(nodes[2*i], nodes[2*i+1])
		}
	}
	root, index := nodes[0], chunk
	for _, sibling := range siblings {
		if index&1 == 0 {
			root = sliceMigrationParent(root, sibling)
		} else {
			root = sliceMigrationParent(sibling, root)
		}
		index >>= 1
	}
	return bodies, sliceMigrationImageRoot(root), nil
}

// The hash domains, byte order and tree geometry mirror sliced.Tree, whose
// internal leaf and parent functions are private to the engine package.
func sliceMigrationLeaf(index uint64, page []byte) (root bytes32) {
	h := sha256.New()
	var word [8]byte
	binary.LittleEndian.PutUint64(word[:], index)
	h.Write([]byte("GL3_CHESS_VM_PAGE_V1"))
	h.Write(word[:])
	h.Write(page)
	h.Sum(root[:0])
	return root
}

func sliceMigrationParent(left, right bytes32) bytes32 {
	var payload [65]byte
	payload[0] = 1
	copy(payload[1:33], left[:])
	copy(payload[33:], right[:])
	return sha256.Sum256(payload[:])
}

func sliceMigrationImageRoot(memoryRoot bytes32) (root bytes32) {
	h := sha256.New()
	var word [8]byte
	h.Write([]byte("GL3_CHESS_IMAGE_V1"))
	h.Write(sliceMigrationModule[:])
	h.Write(memoryRoot[:])
	binary.LittleEndian.PutUint64(word[:], sliceMigrationMemoryBytes)
	h.Write(word[:])
	for _, global := range sliceMigrationGlobals {
		h.Write([]byte(global.Name))
		h.Write([]byte{0})
		binary.LittleEndian.PutUint64(word[:], global.Value)
		h.Write(word[:])
	}
	h.Sum(root[:0])
	return root
}

func sliceMigrationWritePages(c ctx, evm mech, chunk uint32, bodies [sliceMigrationPagesPerChunk][]byte) error {
	db := evm.StateDB
	base := int(chunk) * sliceMigrationPagesPerChunk
	for i, body := range bodies {
		address := slicePageAddress(sliceSeedNamespace, base+i)
		if err := c.Burn(multigas.ResourceKindStorageAccessRead, 2600); err != nil {
			return err
		}
		old := db.GetCode(address)
		if body == nil {
			if len(old) != 0 {
				return errGhostChess
			}
			continue
		}
		code := sliceEncode(body)
		if len(old) != 0 && !bytes.Equal(old, code) {
			return errGhostChess
		}
		if len(old) == 0 {
			if db.GetNonce(address) != 0 {
				return errGhostChess
			}
			// Match the EVM code-deposit price per retained byte. A prefunded cell
			// keeps its balance and receives only the expected inert page code.
			if err := c.Burn(multigas.ResourceKindStorageAccessWrite, 200*uint64(len(code))); err != nil {
				return err
			}
			db.SetCode(address, code, tracing.CodeChangeUnspecified)
		}
	}
	return nil
}
