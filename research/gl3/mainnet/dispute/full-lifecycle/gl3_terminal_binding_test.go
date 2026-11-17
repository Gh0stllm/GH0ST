//go:build gl3_acceptance && challengetest

// SPDX-License-Identifier: GPL-3.0-or-later
package arbtest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/offchainlabs/nitro/bold/protocol"
	"github.com/offchainlabs/nitro/solgen/go/challengeV2gen"
	"github.com/offchainlabs/nitro/solgen/go/rollupgen"
)

var gl3SelectedLifecycleRoot = common.HexToHash("0x865168ea04ee58578a710a5270c22495c90b1c0f2226d39fecbb9eac4ea3f086")

func gl3Global(g rollupgen.GlobalState) protocol.GoGlobalState {
	return protocol.GoGlobalState{BlockHash: common.Hash(g.Bytes32Vals[0]), SendRoot: common.Hash(g.Bytes32Vals[1]), Batch: g.U64Vals[0], PosInBatch: g.U64Vals[1]}
}

// Classification uses only exact terminal content, never the transaction sender.
func gl3TerminalClaimKind(after rollupgen.AssertionState, actual, forged protocol.GoGlobalState, honestHistory, falseHistory common.Hash) string {
	g := gl3Global(after.GlobalState)
	if g != actual && g != forged {
		return "neutral"
	}
	if after.MachineStatus != 1 {
		return "malformed"
	}
	if g == actual && common.Hash(after.EndHistoryRoot) == honestHistory {
		return "honest"
	}
	if g == forged && common.Hash(after.EndHistoryRoot) == falseHistory {
		return "false"
	}
	return "malformed"
}
func gl3SameTargetParent(a, b *rollupgen.RollupUserLogicAssertionCreated) bool {
	return a.ParentAssertionHash == b.ParentAssertionHash && a.Assertion.BeforeState == b.Assertion.BeforeState && reflect.DeepEqual(a.Assertion.BeforeStateData, b.Assertion.BeforeStateData) &&
		a.AfterInboxBatchAcc == b.AfterInboxBatchAcc && a.InboxMaxCount != nil && b.InboxMaxCount != nil && a.InboxMaxCount.Cmp(b.InboxMaxCount) == 0 &&
		a.WasmModuleRoot == b.WasmModuleRoot && a.ChallengeManager == b.ChallengeManager
}

type gl3AuditGlobal struct {
	BlockHash  common.Hash `json:"BlockHash"`
	SendRoot   common.Hash `json:"SendRoot"`
	Batch      uint64      `json:"Batch"`
	PosInBatch uint64      `json:"PosInBatch"`
}

func (g gl3AuditGlobal) matches(w protocol.GoGlobalState) bool {
	return g.BlockHash == w.BlockHash && g.SendRoot == w.SendRoot && g.Batch == w.Batch && g.PosInBatch == w.PosInBatch
}

type gl3AuditLink struct {
	From common.Hash `json:"from"`
	To   common.Hash `json:"to"`
	Kind string      `json:"kind"`
}
type gl3AuditEvent struct {
	Path          []gl3AuditLink `json:"path"`
	Edge          common.Hash    `json:"edge"`
	Transaction   common.Hash    `json:"transaction"`
	Order         []string       `json:"order"`
	ReceiptStatus string         `json:"receiptStatus"`
}
type gl3AuditConfirmation struct {
	Hash        common.Hash `json:"hash"`
	Transaction common.Hash `json:"transaction"`
	Order       []string    `json:"order"`
}
type gl3AuditRefund struct {
	Edge                   common.Hash    `json:"edge"`
	Transaction            common.Hash    `json:"transaction"`
	Level                  string         `json:"level"`
	Amount                 string         `json:"amount"`
	Receiver               common.Address `json:"receiver"`
	ExactTransfer          bool           `json:"exactTransfer"`
	BlockBalancesReconcile bool           `json:"blockBalancesReconcile"`
	Order                  []string       `json:"order"`
}
type gl3AuditPair struct {
	Honest                     common.Hash    `json:"honest"`
	False                      common.Hash    `json:"false"`
	Parent                     common.Hash    `json:"parent"`
	HonestHistory              common.Hash    `json:"honestHistory"`
	FalseHistory               common.Hash    `json:"falseHistory"`
	HonestSender               common.Address `json:"honestSender"`
	Manager                    common.Address `json:"manager"`
	Rollup                     common.Address `json:"rollup"`
	ActualTerminalGlobalsMatch bool           `json:"actualTerminalGlobalsMatch"`
	SameBeforeStateAndBatch    bool           `json:"sameBeforeStateAndBatch"`
}
type gl3StrictAudit struct {
	Passed        bool           `json:"passed"`
	RunID         string         `json:"runID"`
	ModuleRoot    common.Hash    `json:"moduleRoot"`
	TargetBound   bool           `json:"targetBound"`
	RefundExact   bool           `json:"refundExact"`
	InputVerified bool           `json:"terminalInputBytesVerified"`
	InputSHA      string         `json:"terminalInputSHA256"`
	Terminal      gl3AuditGlobal `json:"terminal"`
	Forged        gl3AuditGlobal `json:"forgedTerminal"`
	Pair          gl3AuditPair   `json:"pair"`
	Roots         struct {
		Honest []common.Hash `json:"honest"`
		False  []common.Hash `json:"false"`
	} `json:"targetRootEdges"`
	Transition struct {
		Verified           bool        `json:"verified"`
		Terminal           uint64      `json:"terminalBlockNumber"`
		Start              uint64      `json:"startHeight"`
		End                uint64      `json:"endHeight"`
		BlockClaimEdge     common.Hash `json:"blockClaimEdge"`
		MachineRoot        common.Hash `json:"machineSubchallengeRoot"`
		OneStepEdge        common.Hash `json:"oneStepEdge"`
		OneStepTransaction common.Hash `json:"oneStepTransaction"`
	} `json:"terminalTransitionBinding"`
	Proofs        []gl3AuditEvent        `json:"boundOneStepEvents"`
	Confirmations []gl3AuditConfirmation `json:"boundConfirmations"`
	Refunds       []gl3AuditRefund       `json:"boundCollateralRefunds"`
}
type gl3AuditCompletion struct {
	Completed  bool        `json:"completed"`
	RunID      string      `json:"runID"`
	ModuleRoot common.Hash `json:"moduleRoot"`
	ExitCode   *int        `json:"auditExitCode"`
	SHA        string      `json:"strictAuditSHA256"`
}

func gl3ReadAudit(dir string) (*gl3StrictAudit, string, error) {
	b, e := os.ReadFile(filepath.Join(dir, "strict-audit.json"))
	if e != nil {
		return nil, "", e
	}
	var a gl3StrictAudit
	if e = json.Unmarshal(b, &a); e != nil {
		return nil, "", e
	}
	sum := sha256.Sum256(b)
	return &a, hex.EncodeToString(sum[:]), nil
}
func gl3AuditOrder(xs []string) ([3]uint64, error) {
	var out [3]uint64
	if len(xs) != 3 {
		return out, fmt.Errorf("incomplete event order")
	}
	for i, s := range xs {
		if s == "" || strings.Trim(s, "0123456789") != "" || len(s) > 1 && s[0] == '0' {
			return out, fmt.Errorf("noncanonical event order")
		}
		n, e := strconv.ParseUint(s, 10, 64)
		if e != nil {
			return out, e
		}
		out[i] = n
	}
	return out, nil
}
func gl3Later(a, b []string) bool {
	x, e := gl3AuditOrder(a)
	if e != nil {
		return false
	}
	y, e := gl3AuditOrder(b)
	if e != nil {
		return false
	}
	for i := 0; i < 3; i++ {
		if x[i] != y[i] {
			return x[i] > y[i]
		}
	}
	return false
}

type gl3ExpectedAudit struct {
	RunID, InputSHA                                                           string
	Actual, Forged                                                            protocol.GoGlobalState
	Block                                                                     uint64
	Honest, False, Parent, HonestHistory, FalseHistory, HonestRoot, FalseRoot common.Hash
	Sender, Manager, Rollup                                                   common.Address
}

func gl3AuditMatches(a *gl3StrictAudit, w gl3ExpectedAudit) bool {
	return a.RunID == w.RunID && a.ModuleRoot == gl3SelectedLifecycleRoot && a.InputVerified && a.InputSHA == w.InputSHA && a.Terminal.matches(w.Actual) && a.Forged.matches(w.Forged) &&
		a.Pair.Honest == w.Honest && a.Pair.False == w.False && a.Pair.Parent == w.Parent && a.Pair.HonestHistory == w.HonestHistory && a.Pair.FalseHistory == w.FalseHistory && a.Pair.HonestSender == w.Sender && a.Pair.Manager == w.Manager && a.Pair.Rollup == w.Rollup && a.Pair.ActualTerminalGlobalsMatch && a.Pair.SameBeforeStateAndBatch &&
		len(a.Roots.Honest) == 1 && a.Roots.Honest[0] == w.HonestRoot && len(a.Roots.False) == 1 && a.Roots.False[0] == w.FalseRoot
}
func gl3AuditPathBound(p gl3AuditEvent, root, blockClaim, machineRoot common.Hash) bool {
	cursor := root
	seen := map[common.Hash]bool{root: true}
	firstSubchallenge := false
	for _, link := range p.Path {
		if link.From != cursor || seen[link.To] || link.To == (common.Hash{}) {
			return false
		}
		switch link.Kind {
		case "bisection-lower", "bisection-upper":
		case "subchallenge-claim":
			if !firstSubchallenge {
				if link.From != blockClaim || link.To != machineRoot {
					return false
				}
				firstSubchallenge = true
			}
		default:
			return false
		}
		cursor = link.To
		seen[cursor] = true
	}
	return firstSubchallenge && cursor == p.Edge
}
func gl3BoundAuditProof(a *gl3StrictAudit, w gl3ExpectedAudit) (gl3AuditEvent, bool) {
	if !gl3AuditMatches(a, w) || !a.Transition.Verified || a.Transition.Terminal != w.Block || a.Transition.End != w.Block || w.Block == 0 || a.Transition.Start != w.Block-1 {
		return gl3AuditEvent{}, false
	}
	for _, p := range a.Proofs {
		if p.ReceiptStatus == "0x1" && p.Edge != (common.Hash{}) && p.Transaction != (common.Hash{}) && p.Edge == a.Transition.OneStepEdge && p.Transaction == a.Transition.OneStepTransaction && gl3AuditPathBound(p, w.HonestRoot, a.Transition.BlockClaimEdge, a.Transition.MachineRoot) {
			if _, e := gl3AuditOrder(p.Order); e == nil {
				return p, true
			}
		}
	}
	return gl3AuditEvent{}, false
}
func gl3BoundAuditConfirmation(a *gl3StrictAudit, w gl3ExpectedAudit) (gl3AuditEvent, gl3AuditConfirmation, bool) {
	p, ok := gl3BoundAuditProof(a, w)
	if !ok {
		return p, gl3AuditConfirmation{}, false
	}
	for _, c := range a.Confirmations {
		if c.Hash == w.Honest && c.Transaction != (common.Hash{}) && gl3Later(c.Order, p.Order) {
			return p, c, true
		}
	}
	return p, gl3AuditConfirmation{}, false
}
func gl3CompletedAudit(dir, completionPath string, w gl3ExpectedAudit, amount string) (*gl3StrictAudit, string, gl3AuditRefund, error) {
	a, digest, e := gl3ReadAudit(dir)
	if e != nil {
		return nil, "", gl3AuditRefund{}, e
	}
	_, confirm, ok := gl3BoundAuditConfirmation(a, w)
	if !ok || !a.Passed || !a.TargetBound || !a.RefundExact {
		return nil, "", gl3AuditRefund{}, fmt.Errorf("strict audit remains incomplete")
	}
	raw, e := os.ReadFile(completionPath)
	if e != nil {
		return nil, "", gl3AuditRefund{}, e
	}
	var c gl3AuditCompletion
	if e = json.Unmarshal(raw, &c); e != nil {
		return nil, "", gl3AuditRefund{}, e
	}
	if !c.Completed || c.ExitCode == nil || *c.ExitCode != 0 || c.RunID != w.RunID || c.ModuleRoot != gl3SelectedLifecycleRoot || c.SHA != digest {
		return nil, "", gl3AuditRefund{}, fmt.Errorf("auditor completion/hash/nonce mismatch")
	}
	for _, f := range a.Refunds {
		if f.Edge == w.HonestRoot && f.Level == "0" && f.Amount == amount && amount != "0" && f.Receiver == w.Sender && f.ExactTransfer && f.BlockBalancesReconcile && gl3Later(f.Order, confirm.Order) {
			return a, digest, f, nil
		}
	}
	return nil, "", gl3AuditRefund{}, fmt.Errorf("exact target collateral refund missing")
}
func gl3RequireLaunchReceipt(t *testing.T) {
	t.Helper()
	file := os.Getenv("GL3_LIFECYCLE_LAUNCH_RECEIPT")
	if file == "" {
		t.Fatal("explicit accepted interpreter, reviewed geometry and root launch receipt required")
	}
	b, e := os.ReadFile(file)
	Require(t, e)
	var v struct {
		Passed         bool        `json:"passed"`
		RunID          string      `json:"runID"`
		ModuleRoot     common.Hash `json:"moduleRoot"`
		Raw            uint64      `json:"rawExactFinalSteps"`
		PlusOne        uint64      `json:"rawCounterPlusOne"`
		Capacity       uint64      `json:"stepsPerBlockCapacity"`
		InterpreterSHA string      `json:"interpreterResultSHA256"`
		GeometrySHA    string      `json:"geometryReviewSHA256"`
	}
	Require(t, json.Unmarshal(b, &v))
	if !v.Passed || v.RunID != os.Getenv("GL3_LIFECYCLE_RUN_ID") || v.ModuleRoot != gl3SelectedLifecycleRoot || v.Raw == 0 || v.Raw >= uint64(1)<<40 || v.PlusOne != v.Raw+1 || v.Capacity != uint64(1)<<40 || v.PlusOne > v.Capacity || len(v.InterpreterSHA) != 64 || len(v.GeometrySHA) != 64 || strings.Trim(v.InterpreterSHA, "0123456789abcdef") != "" || strings.Trim(v.GeometrySHA, "0123456789abcdef") != "" {
		t.Fatal("launch receipt is not the selected accepted interpreter and reviewed geometry")
	}
}

// Pinned EdgeChallengeManager.getLayerZeroEndHeight takes EdgeType (0=Block,
// 1=BigStep,2=SmallStep), NOT a challenge level. levelToType maps levels 1..N
// to BigStep and N+1 to SmallStep. Query every type and expand the actual count.
func gl3GeometryVector(levels uint8, types []*big.Int) ([]uint64, uint64, error) {
	if levels != 3 || len(types) != 3 {
		return nil, 0, fmt.Errorf("unexpected level count/type vector")
	}
	for i, want := range []uint64{8192, 1024, 1024} {
		if types[i] == nil || !types[i].IsUint64() || types[i].Uint64() != want {
			return nil, 0, fmt.Errorf("actual edge type %d differs from reviewed height %d", i, want)
		}
	}
	heights := []uint64{types[0].Uint64()}
	capacity := uint64(1)
	for i := uint8(0); i < levels; i++ {
		height := types[1].Uint64()
		heights = append(heights, height)
		capacity *= height
	}
	heights = append(heights, types[2].Uint64())
	capacity *= types[2].Uint64()
	if capacity != uint64(1)<<40 {
		return nil, 0, fmt.Errorf("actual machine-step capacity differs")
	}
	return heights, capacity, nil
}
func gl3CheckOnchainGeometry(t *testing.T, ctx context.Context, b *NodeBuilder, out string) {
	t.Helper()
	r, e := rollupgen.NewRollupUserLogic(b.addresses.Rollup, b.L1.Client)
	Require(t, e)
	addr, e := r.ChallengeManager(&bind.CallOpts{Context: ctx})
	Require(t, e)
	m, e := challengeV2gen.NewEdgeChallengeManager(addr, b.L1.Client)
	Require(t, e)
	levels, e := m.NUMBIGSTEPLEVEL(&bind.CallOpts{Context: ctx})
	Require(t, e)
	actualTypes := []*big.Int{}
	for edgeType := uint8(0); edgeType < 3; edgeType++ {
		n, er := m.GetLayerZeroEndHeight(&bind.CallOpts{Context: ctx}, edgeType)
		Require(t, er)
		actualTypes = append(actualTypes, n)
	}
	values, capacity, e := gl3GeometryVector(levels, actualTypes)
	Require(t, e)
	raw, e := json.MarshalIndent(map[string]any{"runID": os.Getenv("GL3_LIFECYCLE_RUN_ID"), "moduleRoot": gl3SelectedLifecycleRoot, "manager": addr, "numBigStepLevels": levels, "edgeTypeHeights": actualTypes, "levelHeights": values, "finalSmallStepLevel": levels + 1, "stepsPerBlockCapacity": capacity, "getterArgument": "EdgeType enum: 0=Block,1=BigStep,2=SmallStep; expanded levels use levelToType", "scope": "actual private configuration readback, not step-budget or proof acceptance"}, "", "  ")
	Require(t, e)
	Require(t, os.WriteFile(filepath.Join(out, "geometry-onchain.json"), append(raw, '\n'), 0600))
}

func gl3LogOrder(log types.Log) []string {
	return []string{strconv.FormatUint(log.BlockNumber, 10), strconv.FormatUint(uint64(log.TxIndex), 10), strconv.FormatUint(uint64(log.Index), 10)}
}

// These tests exercise only classification, captured JSON bindings and geometry
// arithmetic. They never start a node, instantiate the engine or run a proof.
func TestGL3LifecycleBindingClaimContent(t *testing.T) {
	actual := protocol.GoGlobalState{BlockHash: common.HexToHash("0x10"), Batch: 2470}
	forged := actual
	forged.BlockHash[31] ^= 1
	h, f := common.HexToHash("0x20"), common.HexToHash("0x21")
	makeState := func(g protocol.GoGlobalState, history common.Hash) rollupgen.AssertionState {
		return rollupgen.AssertionState{GlobalState: rollupgen.GlobalState{Bytes32Vals: [2][32]byte{[32]byte(g.BlockHash), [32]byte(g.SendRoot)}, U64Vals: [2]uint64{g.Batch, g.PosInBatch}}, MachineStatus: 1, EndHistoryRoot: [32]byte(history)}
	}
	cases := []struct {
		name  string
		state rollupgen.AssertionState
		want  string
	}{
		{"actual terminal with honest history", makeState(actual, h), "honest"},
		{"forged terminal with forged history", makeState(forged, f), "false"},
		{"actual terminal cannot use forged history", makeState(actual, f), "malformed"},
		{"forged terminal cannot use honest history", makeState(forged, h), "malformed"},
		{"pretarg actual claim from either sender stays neutral", makeState(protocol.GoGlobalState{BlockHash: common.HexToHash("0x99")}, h), "neutral"},
	}
	invalid := makeState(actual, h)
	invalid.MachineStatus = 0
	cases = append(cases, struct {
		name  string
		state rollupgen.AssertionState
		want  string
	}{"unfinished target rejected", invalid, "malformed"})
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := gl3TerminalClaimKind(c.state, actual, forged, h, f); got != c.want {
				t.Fatal(got, c.want)
			}
		})
	}
}
func TestGL3LifecycleBindingCommonParent(t *testing.T) {
	base := func() *rollupgen.RollupUserLogicAssertionCreated {
		return &rollupgen.RollupUserLogicAssertionCreated{InboxMaxCount: big.NewInt(2471)}
	}
	if !gl3SameTargetParent(base(), base()) {
		t.Fatal("identical predecessor rejected")
	}
	cases := map[string]func(*rollupgen.RollupUserLogicAssertionCreated){
		"parent":              func(x *rollupgen.RollupUserLogicAssertionCreated) { x.ParentAssertionHash[31] = 1 },
		"before global":       func(x *rollupgen.RollupUserLogicAssertionCreated) { x.Assertion.BeforeState.GlobalState.U64Vals[0] = 1 },
		"batch accumulator":   func(x *rollupgen.RollupUserLogicAssertionCreated) { x.AfterInboxBatchAcc[31] = 1 },
		"batch limit":         func(x *rollupgen.RollupUserLogicAssertionCreated) { x.InboxMaxCount = big.NewInt(2472) },
		"missing batch limit": func(x *rollupgen.RollupUserLogicAssertionCreated) { x.InboxMaxCount = nil },
		"machine":             func(x *rollupgen.RollupUserLogicAssertionCreated) { x.WasmModuleRoot[31] = 1 },
		"manager":             func(x *rollupgen.RollupUserLogicAssertionCreated) { x.ChallengeManager[19] = 1 },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			x := base()
			mutate(x)
			if gl3SameTargetParent(base(), x) {
				t.Fatal("different predecessor accepted")
			}
		})
	}
}
func gl3BindingTestAudit() (gl3StrictAudit, gl3ExpectedAudit) {
	h := func(n int64) common.Hash { return common.BigToHash(big.NewInt(n)) }
	addr := common.HexToAddress("0x1234")
	w := gl3ExpectedAudit{RunID: strings.Repeat("a", 32), InputSHA: strings.Repeat("b", 64), Actual: protocol.GoGlobalState{BlockHash: h(4), Batch: 2470}, Forged: protocol.GoGlobalState{BlockHash: h(5), Batch: 2470}, Block: 4921, Honest: h(21), False: h(22), Parent: h(23), HonestHistory: h(24), FalseHistory: h(25), HonestRoot: h(8), FalseRoot: h(9), Sender: addr, Manager: common.HexToAddress("0x2345"), Rollup: common.HexToAddress("0x3456")}
	a := gl3StrictAudit{Passed: true, TargetBound: true, RefundExact: true, RunID: w.RunID, ModuleRoot: gl3SelectedLifecycleRoot, InputVerified: true, InputSHA: w.InputSHA, Terminal: gl3AuditGlobal{BlockHash: h(4), Batch: 2470}, Forged: gl3AuditGlobal{BlockHash: h(5), Batch: 2470}, Pair: gl3AuditPair{Honest: w.Honest, False: w.False, Parent: w.Parent, HonestHistory: w.HonestHistory, FalseHistory: w.FalseHistory, HonestSender: addr, Manager: w.Manager, Rollup: w.Rollup, ActualTerminalGlobalsMatch: true, SameBeforeStateAndBatch: true}}
	a.Roots.Honest = []common.Hash{h(8)}
	a.Roots.False = []common.Hash{h(9)}
	a.Transition.Verified = true
	a.Transition.Terminal = 4921
	a.Transition.Start = 4920
	a.Transition.End = 4921
	a.Transition.BlockClaimEdge = h(10)
	a.Transition.MachineRoot = h(12)
	a.Transition.OneStepEdge = h(11)
	a.Transition.OneStepTransaction = h(31)
	a.Proofs = []gl3AuditEvent{{Edge: h(11), Transaction: h(31), Order: []string{"11", "0", "0"}, ReceiptStatus: "0x1", Path: []gl3AuditLink{{From: h(8), To: h(10), Kind: "bisection-upper"}, {From: h(10), To: h(12), Kind: "subchallenge-claim"}, {From: h(12), To: h(11), Kind: "bisection-upper"}}}}
	a.Confirmations = []gl3AuditConfirmation{{Hash: w.Honest, Transaction: h(32), Order: []string{"12", "0", "0"}}}
	a.Refunds = []gl3AuditRefund{{Edge: w.HonestRoot, Level: "0", Amount: "5", Receiver: addr, Transaction: h(33), ExactTransfer: true, BlockBalancesReconcile: true, Order: []string{"13", "0", "0"}}}
	return a, w
}
func TestGL3LifecycleBindingAuditPrerefund(t *testing.T) {
	a, w := gl3BindingTestAudit()
	if _, _, ok := gl3BoundAuditConfirmation(&a, w); !ok {
		t.Fatal("exact captured proof and confirmation rejected")
	}
	cases := map[string]func(*gl3StrictAudit){
		"nonce": func(a *gl3StrictAudit) { a.RunID = "old" }, "input bytes": func(a *gl3StrictAudit) { a.InputVerified = false }, "input hash": func(a *gl3StrictAudit) { a.InputSHA = "other" },
		"machine": func(a *gl3StrictAudit) { a.ModuleRoot[31] ^= 1 }, "honest history": func(a *gl3StrictAudit) { a.Pair.HonestHistory[31] ^= 1 }, "false history": func(a *gl3StrictAudit) { a.Pair.FalseHistory[31] ^= 1 },
		"sender": func(a *gl3StrictAudit) { a.Pair.HonestSender[19] ^= 1 }, "wrong terminal interval": func(a *gl3StrictAudit) { a.Transition.Start-- }, "wrong terminal": func(a *gl3StrictAudit) { a.Transition.Terminal-- },
		"wrong first machine claim": func(a *gl3StrictAudit) { a.Transition.MachineRoot[31] ^= 1 }, "wrong block claim": func(a *gl3StrictAudit) { a.Transition.BlockClaimEdge[31] ^= 1 },
		"unrelated path": func(a *gl3StrictAudit) { a.Proofs[0].Path[0].From[31] ^= 1 }, "path cycle": func(a *gl3StrictAudit) { a.Proofs[0].Path[2].To = a.Roots.Honest[0] }, "unknown path": func(a *gl3StrictAudit) { a.Proofs[0].Path[1].Kind = "invented" },
		"proof receipt failed": func(a *gl3StrictAudit) { a.Proofs[0].ReceiptStatus = "0x0" }, "zero proof transaction": func(a *gl3StrictAudit) { a.Proofs[0].Transaction = common.Hash{} },
		"wrong proof transaction": func(a *gl3StrictAudit) { a.Transition.OneStepTransaction[31] ^= 1 }, "wrong confirmed assertion": func(a *gl3StrictAudit) { a.Confirmations[0].Hash[31] ^= 1 },
		"confirmation precedes proof": func(a *gl3StrictAudit) { a.Confirmations[0].Order[0] = "10" }, "noncanonical order": func(a *gl3StrictAudit) { a.Proofs[0].Order[0] = "+11" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			x, w := gl3BindingTestAudit()
			mutate(&x)
			if _, _, ok := gl3BoundAuditConfirmation(&x, w); ok {
				t.Fatal("unbound evidence could trigger refund")
			}
		})
	}
}
func TestGL3LifecycleBindingCompletedAuditHandshake(t *testing.T) {
	run := func(t *testing.T, mutateAudit func(*gl3StrictAudit), mutateAck func(*gl3AuditCompletion), want bool) {
		t.Helper()
		a, w := gl3BindingTestAudit()
		if mutateAudit != nil {
			mutateAudit(&a)
		}
		dir := t.TempDir()
		raw, e := json.Marshal(a)
		Require(t, e)
		Require(t, os.WriteFile(filepath.Join(dir, "strict-audit.json"), raw, 0600))
		sum := sha256.Sum256(raw)
		code := 0
		c := gl3AuditCompletion{Completed: true, RunID: w.RunID, ModuleRoot: gl3SelectedLifecycleRoot, ExitCode: &code, SHA: hex.EncodeToString(sum[:])}
		if mutateAck != nil {
			mutateAck(&c)
		}
		b, e := json.Marshal(c)
		Require(t, e)
		cp := filepath.Join(dir, "completion.json")
		Require(t, os.WriteFile(cp, b, 0600))
		_, _, _, e = gl3CompletedAudit(dir, cp, w, "5")
		if (e == nil) != want {
			t.Fatal("completion acceptance", e, want)
		}
	}
	t.Run("exact independent exit and audited bytes", func(t *testing.T) { run(t, nil, nil, true) })
	cases := map[string]func(*gl3AuditCompletion){"not completed": func(c *gl3AuditCompletion) { c.Completed = false }, "missing exit": func(c *gl3AuditCompletion) { c.ExitCode = nil }, "failed exit": func(c *gl3AuditCompletion) { x := 1; c.ExitCode = &x }, "stale nonce": func(c *gl3AuditCompletion) { c.RunID = "old" }, "wrong module": func(c *gl3AuditCompletion) { c.ModuleRoot[31] ^= 1 }, "different report bytes": func(c *gl3AuditCompletion) { c.SHA = strings.Repeat("0", 64) }}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) { run(t, nil, mutate, false) })
	}
	bad := map[string]func(*gl3StrictAudit){"pending audit": func(a *gl3StrictAudit) { a.Passed = false }, "target not bound": func(a *gl3StrictAudit) { a.TargetBound = false }, "refund not exact": func(a *gl3StrictAudit) { a.RefundExact = false }, "wrong refund edge": func(a *gl3StrictAudit) { a.Refunds[0].Edge[31] ^= 1 }, "wrong refund amount": func(a *gl3StrictAudit) { a.Refunds[0].Amount = "4" }, "wrong refund receiver": func(a *gl3StrictAudit) { a.Refunds[0].Receiver[19] ^= 1 }, "balances not reconciled": func(a *gl3StrictAudit) { a.Refunds[0].BlockBalancesReconcile = false }, "refund predates confirmation": func(a *gl3StrictAudit) { a.Refunds[0].Order[0] = "11" }}
	for name, mutate := range bad {
		t.Run(name, func(t *testing.T) { run(t, mutate, nil, false) })
	}
}
func TestGL3LifecycleBindingGeometry(t *testing.T) {
	makeHeights := func(small int64) []*big.Int { return []*big.Int{big.NewInt(8192), big.NewInt(1024), big.NewInt(small)} }
	got, capacity, e := gl3GeometryVector(3, makeHeights(1024))
	Require(t, e)
	if !reflect.DeepEqual(got, []uint64{8192, 1024, 1024, 1024, 1024}) || capacity != uint64(1)<<40 {
		t.Fatal(got, capacity)
	}
	t.Run("final small type drift rejected", func(t *testing.T) {
		if _, _, e := gl3GeometryVector(3, makeHeights(512)); e == nil {
			t.Fatal("final small level drift accepted")
		}
	})
	t.Run("big count drift rejected", func(t *testing.T) {
		if _, _, e := gl3GeometryVector(2, makeHeights(1024)); e == nil {
			t.Fatal("big count drift accepted")
		}
	})
}
