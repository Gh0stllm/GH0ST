// SPDX-License-Identifier: GPL-3.0-or-later
// Experimental custom STF. Never part of the unchanged standard core profile.
package precompiles

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"strings"

	engine "github.com/Gh0stllm/GH0ST/gl3/chessruntime"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/arbitrum/multigas"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/tracing"
	"github.com/ethereum/go-ethereum/core/vm"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/offchainlabs/nitro/arbos/burn"
	"github.com/offchainlabs/nitro/arbos/storage"
)

const GhostChessABI = `[
 {"name":"newGame","type":"function","stateMutability":"nonpayable","inputs":[{"name":"job","type":"bytes32"}],"outputs":[{"name":"generation","type":"uint64"},{"name":"checkpointSHA","type":"bytes32"}]},
 {"name":"play","type":"function","stateMutability":"nonpayable","inputs":[{"name":"job","type":"bytes32"},{"name":"expectedGeneration","type":"uint64"},{"name":"history","type":"string"}],"outputs":[{"name":"generation","type":"uint64"},{"name":"move","type":"string"},{"name":"nodes","type":"uint64"},{"name":"depth","type":"uint32"},{"name":"checkpointSHA","type":"bytes32"}]},
 {"name":"inspect","type":"function","stateMutability":"view","inputs":[{"name":"job","type":"bytes32"}],"outputs":[{"name":"generation","type":"uint64"},{"name":"move","type":"string"},{"name":"nodes","type":"uint64"},{"name":"depth","type":"uint32"},{"name":"checkpointSHA","type":"bytes32"}]}
]`

var errGhostChess = errors.New("invalid or unauthenticated GL3 chess state")
var ghostChessPrefix = []byte{0, 'G', 'L', '3', 'C', 'P', 1, 0}

const ghostChessPage = 16384 // each STOP-prefixed code cell stays below ordinary code-size limits

type ArbGhostChess struct{ Address addr }

func makeGhostChessPrecompile() (addr, *Precompile) {
	return MakePrecompile(&bind.MetaData{ABI: GhostChessABI}, &ArbGhostChess{Address: common.HexToAddress("0xa13")})
}
func chessNamespace(owner addr, job bytes32) []byte {
	return crypto.Keccak256([]byte("GL3_CHESS_JOB_PAGES_V1"), owner[:], job[:])
}
func chessPageAddress(namespace []byte, index uint64) addr {
	var n [8]byte
	binary.BigEndian.PutUint64(n[:], index)
	return common.BytesToAddress(crypto.Keccak256([]byte("GL3_CHESS_RESERVED_CODECELL_V1"), namespace, n[:])[12:])
}
func chessConfig(db vm.StateDB, burner burn.Burner) *storage.Storage {
	return storage.NewGeth(db, burner).OpenSubStorage([]byte("GL3_CHESS_CONFIG_V1"))
}
func chessJob(c ctx, job bytes32) *storage.Storage {
	return c.State.BackingStorage().OpenSubStorage([]byte("GL3_CHESS_JOBS_V1")).OpenSubStorage(chessNamespace(c.caller, job))
}

type chessMetadata struct {
	Version        uint32
	Policy         string
	Generation     uint64
	StateBytes     uint32
	StateSHA       bytes32
	History        string
	LastRequestSHA bytes32
	Move           string
	Nodes          uint64
	Depth          uint32
}

func chessMetaGet(s *storage.Storage) (chessMetadata, error) {
	var m chessMetadata
	size, e := s.GetBytesSize()
	if e != nil {
		return m, e
	}
	if size > 16384 {
		return m, errGhostChess
	}
	b, e := s.GetBytes()
	if e != nil {
		return m, e
	}
	if len(b) == 0 {
		return m, errGhostChess
	}
	if len(b) > 16384 || json.Unmarshal(b, &m) != nil || m.Version != 1 || m.Policy != engine.PolicySHA256 || m.Generation == 0 || m.StateBytes == 0 || m.StateBytes > engine.MaxState || len(m.History) > 8192 {
		return m, errGhostChess
	}
	return m, nil
}
func chessMetaSet(s *storage.Storage, m chessMetadata) error {
	b, e := json.Marshal(m)
	if e != nil {
		return e
	}
	return s.SetBytes(b)
}
func chessReadPages(c ctx, db vm.StateDB, namespace []byte, size uint32, want bytes32) ([]byte, error) {
	if size == 0 || size > engine.MaxState {
		return nil, errGhostChess
	}
	if c != nil {
		if e := c.Burn(multigas.ResourceKindStorageAccessRead, 1000+uint64(size)/128+uint64((size+ghostChessPage-1)/ghostChessPage)*100); e != nil {
			return nil, e
		}
	}
	out := make([]byte, int(size))
	for offset := 0; offset < len(out); offset += ghostChessPage {
		end := offset + ghostChessPage
		if end > len(out) {
			end = len(out)
		}
		code := db.GetCode(chessPageAddress(namespace, uint64(offset/ghostChessPage)))
		if len(code) == 0 {
			continue
		}
		if len(code) != len(ghostChessPrefix)+end-offset || !bytes.Equal(code[:len(ghostChessPrefix)], ghostChessPrefix) {
			return nil, errGhostChess
		}
		copy(out[offset:end], code[len(ghostChessPrefix):])
	}
	if sha256.Sum256(out) != want {
		return nil, errGhostChess
	}
	return out, nil
}
func chessWritePages(c ctx, db vm.StateDB, namespace []byte, data []byte) error {
	if len(data) == 0 || len(data) > engine.MaxState {
		return errGhostChess
	}
	if c != nil {
		if e := c.Burn(multigas.ResourceKindStorageAccessWrite, 1000+uint64(len(data))/64+uint64((len(data)+ghostChessPage-1)/ghostChessPage)*200); e != nil {
			return e
		}
	}
	for offset := 0; offset < len(data); offset += ghostChessPage {
		end := offset + ghostChessPage
		if end > len(data) {
			end = len(data)
		}
		page := data[offset:end]
		nonzero := false
		for _, b := range page {
			if b != 0 {
				nonzero = true
				break
			}
		}
		var code []byte
		if nonzero {
			code = make([]byte, len(ghostChessPrefix)+len(page))
			copy(code, ghostChessPrefix)
			copy(code[len(ghostChessPrefix):], page)
		}
		address := chessPageAddress(namespace, uint64(offset/ghostChessPage))
		if !bytes.Equal(db.GetCode(address), code) {
			db.SetCode(address, code, tracing.CodeChangeUnspecified)
		}
	}
	return nil
}

// Trusted initialization only. The genesis owner must revert the StateDB snapshot
// on any error. This function is not in the public ABI and reads no host files.
func SeedGhostChessGenesis(db vm.StateDB, weights []byte) error {
	if len(weights) != 98511183 || common.Hash(sha256.Sum256(weights)) != common.HexToHash(engine.NNUESHA256) {
		return errGhostChess
	}
	namespace := []byte("GL3_CHESS_FULL_NNUE_V1")
	if e := chessWritePages(nil, db, namespace, weights); e != nil {
		return e
	}
	s := chessConfig(db, burn.NewSystemBurner(nil, false))
	return s.Set(common.Hash{}, common.HexToHash(engine.NNUESHA256))
}
func chessVerifyModel(c ctx, evm mech) error {
	root, e := chessConfig(evm.StateDB, c).Get(common.Hash{})
	if e != nil {
		return e
	}
	if root != common.HexToHash(engine.NNUESHA256) {
		return errGhostChess
	}
	_, e = chessReadPages(c, evm.StateDB, []byte("GL3_CHESS_FULL_NNUE_V1"), 98511183, bytes32(root))
	return e
}
func (p ArbGhostChess) NewGame(c ctx, evm mech, job bytes32) (uint64, bytes32, error) {
	if e := chessVerifyModel(c, evm); e != nil {
		return 0, bytes32{}, e
	}
	store := chessJob(c, job)
	prior, e := store.GetBytes()
	if e != nil {
		return 0, bytes32{}, e
	}
	if len(prior) != 0 {
		return 0, bytes32{}, errGhostChess
	}
	if e = c.Burn(multigas.ResourceKindComputation, 1_000_000); e != nil {
		return 0, bytes32{}, e
	}
	result, e := engine.NewGame()
	if e != nil {
		return 0, bytes32{}, e
	}
	if e = chessWritePages(c, evm.StateDB, chessNamespace(c.caller, job), result.State); e != nil {
		return 0, bytes32{}, e
	}
	meta := chessMetadata{Version: 1, Policy: engine.PolicySHA256, Generation: 1, StateBytes: uint32(len(result.State)), StateSHA: result.StateSHA}
	if e = chessMetaSet(store, meta); e != nil {
		return 0, bytes32{}, e
	}
	return meta.Generation, meta.StateSHA, nil
}
func (p ArbGhostChess) Play(c ctx, evm mech, job bytes32, expectedGeneration uint64, history string) (uint64, string, uint64, uint32, bytes32, error) {
	fail := func(e error) (uint64, string, uint64, uint32, bytes32, error) { return 0, "", 0, 0, bytes32{}, e }
	store := chessJob(c, job)
	meta, e := chessMetaGet(store)
	if e != nil {
		return fail(e)
	}
	if len(history) > 8192 || history != strings.Join(strings.Fields(history), " ") {
		return fail(errGhostChess)
	}
	requestSHA := sha256.Sum256([]byte(history))
	if expectedGeneration+1 == meta.Generation && expectedGeneration != ^uint64(0) && requestSHA == meta.LastRequestSHA {
		if e = chessVerifyModel(c, evm); e != nil {
			return fail(e)
		}
		if _, e = chessReadPages(c, evm.StateDB, chessNamespace(c.caller, job), meta.StateBytes, meta.StateSHA); e != nil {
			return fail(e)
		}
		return meta.Generation, meta.Move, meta.Nodes, meta.Depth, meta.StateSHA, nil
	}
	if meta.Generation != expectedGeneration || meta.Generation == ^uint64(0) {
		return fail(errGhostChess)
	}
	moves := strings.Fields(history)
	old := strings.Fields(meta.History)
	if len(moves) != len(old)+1 || len(moves)%2 != 1 {
		return fail(errGhostChess)
	}
	for i, m := range moves {
		if !engine.ValidMove(m) || (i < len(old) && m != old[i]) {
			return fail(errGhostChess)
		}
	}
	if e = chessVerifyModel(c, evm); e != nil {
		return fail(e)
	}
	state, e := chessReadPages(c, evm.StateDB, chessNamespace(c.caller, job), meta.StateBytes, meta.StateSHA)
	if e != nil {
		return fail(e)
	}
	// Deterministic research tariff. This is NOT a reviewed production gas schedule.
	if e = c.Burn(multigas.ResourceKindComputation, engine.Nodes); e != nil {
		return fail(e)
	}
	result, e := engine.Play(moves, state)
	if e != nil {
		return fail(e)
	}
	if e = chessWritePages(c, evm.StateDB, chessNamespace(c.caller, job), result.State); e != nil {
		return fail(e)
	}
	meta.Generation++
	meta.StateBytes = uint32(len(result.State))
	meta.StateSHA = result.StateSHA
	meta.History = history + " " + result.Move
	meta.LastRequestSHA = requestSHA
	meta.Move = result.Move
	meta.Nodes = result.Nodes
	meta.Depth = result.Depth
	if e = chessMetaSet(store, meta); e != nil {
		return fail(e)
	}
	return meta.Generation, meta.Move, meta.Nodes, meta.Depth, meta.StateSHA, nil
}
func (p ArbGhostChess) Inspect(c ctx, evm mech, job bytes32) (uint64, string, uint64, uint32, bytes32, error) {
	m, e := chessMetaGet(chessJob(c, job))
	if e != nil {
		return 0, "", 0, 0, bytes32{}, e
	}
	return m.Generation, m.Move, m.Nodes, m.Depth, m.StateSHA, nil
}
