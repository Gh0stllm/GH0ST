// SPDX-License-Identifier: GPL-3.0-or-later
package bankprototype

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"os"
	"path/filepath"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/ethereum/go-ethereum/core/state"
	"github.com/ethereum/go-ethereum/core/tracing"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/core/vm"
	"github.com/ethereum/go-ethereum/params"
	"github.com/ethereum/go-ethereum/triedb"
	"github.com/holiman/uint256"
)

var owner = common.HexToAddress("0x1234")

type fixture struct {
	before, after [][]byte
	globals       []byte
}

func readFixture(t *testing.T) fixture {
	t.Helper()
	dir := os.Getenv("GL3_BANK_FIXTURE")
	if dir == "" {
		t.Fatal("actual image-window fixture required")
	}
	var manifest struct {
		SamplePages int
		Files       map[string]struct {
			Bytes  int
			SHA256 string
		}
	}
	b, e := os.ReadFile(filepath.Join(dir, "fixture.json"))
	if e != nil {
		t.Fatal(e)
	}
	if e = json.Unmarshal(b, &manifest); e != nil {
		t.Fatal(e)
	}
	read := func(name string) []byte {
		data, e := os.ReadFile(filepath.Join(dir, name))
		if e != nil {
			t.Fatal(e)
		}
		h := sha256.Sum256(data)
		if len(data) != manifest.Files[name].Bytes || hex.EncodeToString(h[:]) != manifest.Files[name].SHA256 {
			t.Fatal("fixture page hash mismatch")
		}
		return data
	}
	f := fixture{}
	for i := 0; i < manifest.SamplePages; i++ {
		f.before = append(f.before, read(name("preterminal", i)))
		f.after = append(f.after, read(name("completed", i)))
	}
	f.globals = read("globals.json")
	return f
}
func name(tag string, i int) string { return tag + "-" + string(rune('0'+i)) + ".bin" }
func stateDB(t *testing.T) (*state.StateDB, *triedb.Database, state.Database) {
	t.Helper()
	disk := rawdb.NewMemoryDatabase()
	tdb := triedb.NewDatabase(disk, triedb.HashDefaults)
	db := state.NewDatabase(tdb, state.NewCodeDB(disk))
	s, e := state.New(types.EmptyRootHash, db)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { tdb.Close(); disk.Close() })
	return s, tdb, db
}
func newBank(t *testing.T, f fixture) *Bank {
	t.Helper()
	b, e := New(7, owner, f.before, f.globals)
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func updates(pages [][]byte) map[uint32][]byte {
	m := map[uint32][]byte{}
	for i, p := range pages {
		m[uint32(i)] = bytes.Clone(p)
	}
	return m
}
func exact(t *testing.T, b *Bank, s *state.StateDB, pages [][]byte, globals []byte) Descriptor {
	t.Helper()
	d, p, e := b.Read(s)
	if e != nil {
		t.Fatal(e)
	}
	if len(p) != len(pages) || !bytes.Equal(d.Globals, globals) {
		t.Fatal("window/globals shape mismatch")
	}
	for i := range p {
		if !bytes.Equal(p[i], pages[i]) {
			t.Fatal("actual source bytes changed", i)
		}
	}
	return d
}
func codeIdentities(b *Bank, s *state.StateDB) []common.Hash {
	r := []common.Hash{s.GetCodeHash(b.MetaAddress())}
	for i := range b.seed {
		r = append(r, s.GetCodeHash(b.Address(uint32(i))))
	}
	return r
}
func sameHashes(a, b []common.Hash) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestFixedBankActualBytesRepeatedGenerationsAndEpochReset(t *testing.T) {
	f := readFixture(t)
	b := newBank(t, f)
	s, _, _ := stateDB(t)
	d, e := b.Begin(s, owner)
	if e != nil {
		t.Fatal(e)
	}
	for generation := 0; generation < 20; generation++ {
		pages := f.after
		if generation%2 == 1 {
			pages = f.before
		}
		d, e = b.Update(s, owner, d.Epoch, d.Generation, updates(pages), f.globals)
		if e != nil {
			t.Fatal(e)
		}
		exact(t, b, s, pages, f.globals)
	}
	if d.Epoch != 1 || d.Generation != 20 {
		t.Fatal("generation/epoch drift")
	}
	priorAddresses := []common.Address{}
	for i := range f.before {
		priorAddresses = append(priorAddresses, b.Address(uint32(i)))
	}
	d, e = b.Begin(s, owner)
	if e != nil {
		t.Fatal(e)
	}
	exact(t, b, s, f.before, f.globals)
	if d.Epoch != 2 || d.Generation != 0 {
		t.Fatal("new epoch did not reset bounded descriptor")
	}
	for i, a := range priorAddresses {
		if a != b.Address(uint32(i)) || len(s.GetCode(a)) != cellHeader+PageSize {
			t.Fatal("epoch allocated new cells or erased backing")
		}
	}
}

func TestFixedBankBalancesNoncesAndUnknownCode(t *testing.T) {
	f := readFixture(t)
	b := newBank(t, f)
	s, _, _ := stateDB(t)
	slot := common.HexToHash("0xaa")
	value := common.HexToHash("0xbb")
	addresses := []common.Address{b.MetaAddress()}
	for i := range f.before {
		addresses = append(addresses, b.Address(uint32(i)))
	}
	for i, a := range addresses {
		s.SetBalance(a, uint256.NewInt(uint64(100+i)), tracing.BalanceChangeUnspecified)
		s.SetNonce(a, uint64(7+i), tracing.NonceChangeUnspecified)
		s.SetState(a, slot, value)
	}
	d, e := b.Begin(s, owner)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = b.Update(s, owner, d.Epoch, d.Generation, updates(f.after), f.globals); e != nil {
		t.Fatal(e)
	}
	for i, a := range addresses {
		if s.GetBalance(a).Uint64() != uint64(100+i) || s.GetNonce(a) != uint64(7+i) || s.GetState(a, slot) != value {
			t.Fatal("donation/nonce/storage destroyed")
		}
	}
	snapshot := s.Snapshot()
	s.SetCode(b.Address(0), []byte{0x60, 0x01}, tracing.CodeChangeUnspecified)
	d, e = b.Begin(s, owner)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = b.Update(s, owner, d.Epoch, d.Generation, updates(f.after), f.globals); e == nil {
		t.Fatal("foreign code was overwritten")
	}
	s.RevertToSnapshot(snapshot)
}

func TestFixedBankAuthorityBoundsAndAtomicFailure(t *testing.T) {
	f := readFixture(t)
	b := newBank(t, f)
	s, _, _ := stateDB(t)
	d, e := b.Begin(s, owner)
	if e != nil {
		t.Fatal(e)
	}
	before := codeIdentities(b, s)
	if _, e = b.Update(s, common.HexToAddress("0x9999"), d.Epoch, 0, updates(f.after), f.globals); e == nil {
		t.Fatal("unauthorized writer")
	}
	if _, e = b.Update(s, owner, d.Epoch+1, 0, updates(f.after), f.globals); e == nil {
		t.Fatal("stale epoch accepted")
	}
	if _, e = b.Update(s, owner, d.Epoch, 1, updates(f.after), f.globals); e == nil {
		t.Fatal("stale generation accepted")
	}
	if _, e = b.Update(s, owner, d.Epoch, 0, map[uint32][]byte{99: make([]byte, PageSize)}, f.globals); e == nil {
		t.Fatal("out of bank range")
	}
	want := errors.New("injected after real writes")
	if _, e = b.apply(s, owner, d.Epoch, 0, updates(f.after), f.globals, func(i int) error {
		if i == 1 {
			return want
		}
		return nil
	}); !errors.Is(e, want) {
		t.Fatal(e)
	}
	if !sameHashes(before, codeIdentities(b, s)) {
		t.Fatal("partial write survived failure")
	}
	exact(t, b, s, f.before, f.globals)
}

func TestFixedBankCorruptionCopyAndOuterRollback(t *testing.T) {
	f := readFixture(t)
	b := newBank(t, f)
	s, _, _ := stateDB(t)
	d, e := b.Begin(s, owner)
	if e != nil {
		t.Fatal(e)
	}
	d, e = b.Update(s, owner, d.Epoch, 0, updates(f.after), f.globals)
	if e != nil {
		t.Fatal(e)
	}
	for _, kind := range []string{"missing", "corrupt", "stale"} {
		t.Run(kind, func(t *testing.T) {
			snapshot := s.Snapshot()
			code := bytes.Clone(s.GetCode(b.Address(0)))
			switch kind {
			case "missing":
				code = nil
			case "corrupt":
				code[len(code)-1] ^= 1
			case "stale":
				code[17] ^= 1
			}
			s.SetCode(b.Address(0), code, tracing.CodeChangeUnspecified)
			if _, _, e = b.Read(s); e == nil {
				t.Fatal("bad backing accepted")
			}
			s.RevertToSnapshot(snapshot)
			exact(t, b, s, f.after, f.globals)
		})
	}
	copyDB := s.Copy()
	if _, e = b.Update(copyDB, owner, d.Epoch, d.Generation, updates(f.before), f.globals); e != nil {
		t.Fatal(e)
	}
	exact(t, b, copyDB, f.before, f.globals)
	exact(t, b, s, f.after, f.globals)
	snapshot := s.Snapshot()
	if _, e = b.Update(s, owner, d.Epoch, d.Generation, updates(f.before), f.globals); e != nil {
		t.Fatal(e)
	}
	s.RevertToSnapshot(snapshot)
	exact(t, b, s, f.after, f.globals)
}

type updateHook struct {
	bank    *Bank
	db      *state.StateDB
	pages   [][]byte
	globals []byte
	calls   int
}

func (h *updateHook) RequiredGas([]byte) uint64 { return 10000 }
func (h *updateHook) Run([]byte) ([]byte, error) {
	h.calls++
	d, e := h.bank.descriptor(h.db)
	if e != nil {
		return nil, e
	}
	_, e = h.bank.Update(h.db, owner, d.Epoch, d.Generation, updates(h.pages), h.globals)
	return nil, e
}

func TestFixedBankRealEVMOuterRevertAndOOG(t *testing.T) {
	f := readFixture(t)
	b := newBank(t, f)
	s, _, _ := stateDB(t)
	if _, e := b.Begin(s, owner); e != nil {
		t.Fatal(e)
	}
	address := common.HexToAddress("0xea16")
	contract := common.HexToAddress("0xf00d")
	hook := &updateHook{bank: b, db: s, pages: f.after, globals: f.globals}
	zero := big.NewInt(0)
	cfg := &params.ChainConfig{ChainID: big.NewInt(412346), HomesteadBlock: zero, EIP150Block: zero, EIP155Block: zero, EIP158Block: zero, ByzantiumBlock: zero, ConstantinopleBlock: zero, PetersburgBlock: zero, IstanbulBlock: zero}
	canTransfer := func(db vm.StateDB, a common.Address, n *uint256.Int) bool { return db.GetBalance(a).Cmp(n) >= 0 }
	transfer := func(db vm.StateDB, from, to common.Address, n *uint256.Int) {
		db.SubBalance(from, n, tracing.BalanceChangeUnspecified)
		db.AddBalance(to, n, tracing.BalanceChangeUnspecified)
	}
	evm := vm.NewEVM(vm.BlockContext{CanTransfer: canTransfer, Transfer: transfer, GetHash: func(uint64) common.Hash { return common.Hash{} }, BlockNumber: big.NewInt(1), Time: 1, GasLimit: 10_000_000}, s, cfg, vm.Config{NoBaseFee: true})
	evm.SetPrecompiles(vm.PrecompiledContracts{address: hook})
	// Call the native test hook, then REVERT in an ordinary EVM outer contract.
	code := []byte{0x60, 0, 0x60, 0, 0x60, 0, 0x60, 0, 0x60, 0, 0x73}
	code = append(code, address[:]...)
	code = append(code, 0x5a, 0xf1, 0x50, 0x60, 0, 0x60, 0, 0xfd)
	s.SetCode(contract, code, tracing.CodeChangeUnspecified)
	before := codeIdentities(b, s)
	if _, _, _, e := evm.Call(owner, contract, nil, vm.NewGasBudget(1_000_000, 0), uint256.NewInt(0)); e == nil {
		t.Fatal("outer contract did not revert")
	}
	if hook.calls != 1 || !sameHashes(before, codeIdentities(b, s)) {
		t.Fatal("real EVM outer revert leaked allocator state", hook.calls)
	}
	exact(t, b, s, f.before, f.globals)
	if _, _, _, e := evm.Call(owner, address, nil, vm.NewGasBudget(9999, 0), uint256.NewInt(0)); e == nil {
		t.Fatal("precompile OOG accepted")
	}
	if hook.calls != 1 || !sameHashes(before, codeIdentities(b, s)) {
		t.Fatal("OOG entered writer or changed state")
	}
}

type countDump struct {
	Accounts, CodeAccounts, CodeBytes uint64
	codeDB                            *state.StateDB
}

func (c *countDump) OnRoot(common.Hash) {}
func (c *countDump) OnAccount(a *common.Address, v state.DumpAccount) {
	c.Accounts++
	if common.BytesToHash(v.CodeHash) != types.EmptyCodeHash && len(v.CodeHash) > 0 {
		c.CodeAccounts++
		if a != nil {
			c.CodeBytes += uint64(len(c.codeDB.GetCode(*a)))
		}
	}
}

func TestFixedBankTwentyEpochCurrentBoundAndHistoricalAvailability(t *testing.T) {
	f := readFixture(t)
	b := newBank(t, f)
	s, tdb, db := stateDB(t)
	roots := []common.Hash{}
	deltas := []map[string]any{}
	for epoch := 0; epoch < 20; epoch++ {
		d, e := b.Begin(s, owner)
		if e != nil {
			t.Fatal(e)
		}
		pages := f.after
		if epoch%2 == 1 {
			pages = f.before
		}
		if _, e = b.Update(s, owner, d.Epoch, 0, updates(pages), f.globals); e != nil {
			t.Fatal(e)
		}
		root, e := s.Commit(uint64(epoch+1), false, false)
		if e != nil {
			t.Fatal(e)
		}
		if e = tdb.Commit(root, false); e != nil {
			t.Fatal(e)
		}
		roots = append(roots, root)
		s, e = state.New(root, db)
		if e != nil {
			t.Fatal(e)
		}
		exact(t, b, s, pages, f.globals)
		for i := range f.before {
			if len(s.GetCode(b.Address(uint32(i)))) != PageSize+cellHeader {
				t.Fatal("current cell payload grew")
			}
		}
		dump := &countDump{codeDB: s}
		if _, e = s.DumpToCollector(dump, &state.DumpConfig{SkipCode: true, SkipStorage: true}); e != nil {
			t.Fatal(e)
		}
		if dump.Accounts != uint64(len(f.before)+1) || dump.CodeAccounts != uint64(len(f.before)+1) {
			t.Fatal("current account set grew", dump)
		}
		deltas = append(deltas, map[string]any{"epoch": epoch + 1, "stateRoot": root, "currentAccounts": dump.Accounts, "currentCodeAccounts": dump.CodeAccounts, "fixedCellPayloadBytes": len(f.before) * (PageSize + cellHeader), "descriptorBytes": len(s.GetCode(b.MetaAddress()))})
	}
	for i, root := range roots {
		old, e := state.New(root, db)
		if e != nil {
			t.Fatal(e)
		}
		pages := f.after
		if i%2 == 1 {
			pages = f.before
		}
		exact(t, b, old, pages, f.globals)
	}
	// Code versions are historical rawdb objects, not erased by current-cell reuse.
	disk := tdb.Disk()
	it := disk.NewIterator(rawdb.CodePrefix, nil)
	records, total := uint64(0), uint64(0)
	for it.Next() {
		if len(it.Key()) == len(rawdb.CodePrefix)+32 {
			records++
			total += uint64(len(it.Value()))
		}
	}
	if e := it.Error(); e != nil {
		t.Fatal(e)
	}
	it.Release()
	if records <= uint64(len(f.before)+1) {
		t.Fatal("history was silently deleted")
	}
	if out := os.Getenv("GL3_BANK_OUT"); out != "" {
		report := map[string]any{"passed": true, "scope": "20 small allocator epochs over four exact real-image pages, not20games or1600decisions", "epochs": 20, "fixedCurrentAccounts": len(f.before) + 1, "currentCellCount": len(f.before), "currentCellPayloadBytes": len(f.before) * (PageSize + cellHeader), "historicalCodeRecords": records, "historicalCodeBytes": total, "all20HistoricalRootsStillRestore": true, "oldCodePruned": false, "sourcePagesExact": true, "wholeVMOrEngineTested": false, "selectedMachineChanged": false, "twentyGameCapacityAccepted": false, "rows": deltas}
		data, _ := json.MarshalIndent(report, "", "  ")
		if e := os.WriteFile(filepath.Join(out, "native-bank-result.json"), append(data, '\n'), 0600); e != nil {
			t.Fatal(e)
		}
	}
}
