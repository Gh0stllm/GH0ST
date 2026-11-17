//go:build gl3_acceptance && challengetest

// SPDX-License-Identifier: GPL-3.0-or-later
package arbtest

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/offchainlabs/nitro/arbnode"
	"github.com/offchainlabs/nitro/bold/commitment/history"
	"github.com/offchainlabs/nitro/bold/protocol"
	"github.com/offchainlabs/nitro/bold/state"
	"github.com/offchainlabs/nitro/solgen/go/challengeV2gen"
	"github.com/offchainlabs/nitro/solgen/go/rollupgen"
	"github.com/offchainlabs/nitro/util/containers"
	"github.com/offchainlabs/nitro/validator"
	"github.com/offchainlabs/nitro/validator/server_arb"
)

// Test-only dishonest claimant: the actual node and engine stay honest. Only
// claims about the completed engine block are falsified. Both parties share the
// real state backend; every returned slice/state is copied before modification.
type gl3FalseTerminalClaim struct {
	BoldStateProviderInterface
	honestFinished common.Hash
	falseFinished  common.Hash
	trueGlobal     protocol.GoGlobalState
	falseGlobal    protocol.GoGlobalState
}

func (s *gl3FalseTerminalClaim) ExecutionStateAfterPreviousState(ctx context.Context, limit uint64, prev protocol.GoGlobalState) (*protocol.ExecutionState, error) {
	actual, err := s.BoldStateProviderInterface.ExecutionStateAfterPreviousState(ctx, limit, prev)
	if err != nil {
		return nil, err
	}
	result := *actual
	if result.GlobalState == s.trueGlobal {
		result.GlobalState = s.falseGlobal
	}
	leaves, err := s.L2MessageStatesUpTo(ctx, prev, state.Batch(limit), containers.Some(state.Height(blockChallengeLeafHeight)))
	if err != nil {
		return nil, err
	}
	commitment, err := history.NewCommitment(leaves, blockChallengeLeafHeight+1)
	if err != nil {
		return nil, err
	}
	result.EndHistoryRoot = commitment.Merkle
	return &result, nil
}

func (s *gl3FalseTerminalClaim) L2MessageStatesUpTo(ctx context.Context, from protocol.GoGlobalState, limit state.Batch, to containers.Option[state.Height]) ([]common.Hash, error) {
	original, err := s.BoldStateProviderInterface.L2MessageStatesUpTo(ctx, from, limit, to)
	if err != nil {
		return nil, err
	}
	result := append([]common.Hash(nil), original...)
	for i := range result {
		if result[i] == s.honestFinished {
			result[i] = s.falseFinished
		}
	}
	return result, nil
}

func (s *gl3FalseTerminalClaim) CollectMachineHashes(ctx context.Context, cfg *state.HashCollectorConfig) ([]common.Hash, error) {
	original, err := s.BoldStateProviderInterface.CollectMachineHashes(ctx, cfg)
	if err != nil {
		return nil, err
	}
	result := append([]common.Hash(nil), original...)
	for i := range result {
		if result[i] == s.honestFinished {
			result[i] = s.falseFinished
		}
	}
	return result, nil
}

// CollectProof is deliberately the unchanged honest implementation. The false
// terminal state cannot acquire a valid proof merely by changing its claim.

func gl3RunTerminalChallenge(t *testing.T, ctx context.Context, b *NodeBuilder, terminal *types.Receipt, final validator.GoGlobalState, out string) {
	t.Helper()
	started := time.Now()
	runID := os.Getenv("GL3_LIFECYCLE_RUN_ID")
	auditDir := os.Getenv("GL3_STRICT_AUDIT_OUTPUT")
	completionPath := os.Getenv("GL3_STRICT_AUDIT_COMPLETION")
	if runID == "" || auditDir == "" || completionPath == "" {
		t.Fatal("fresh run ID and independent audit handshake paths required")
	}
	write := func(name string, value any) {
		data, err := json.MarshalIndent(value, "", "  ")
		Require(t, err)
		path := filepath.Join(out, name)
		Require(t, os.WriteFile(path+".tmp", append(data, '\n'), 0600))
		Require(t, os.Rename(path+".tmp", path))
	}
	var manifest struct {
		SHA string `json:"SHA256"`
	}
	raw, err := os.ReadFile(filepath.Join(out, "terminal-input-manifest.json"))
	Require(t, err)
	Require(t, json.Unmarshal(raw, &manifest))
	report := map[string]any{"passed": false, "runID": runID, "scope": "Actual private terminal-block BoLD lifecycle; exact content-bound independent audit must exit successfully before parent cleanup", "fullStrengthDecisionVerified": true, "terminalComputeBlock": terminal.BlockHash, "moduleRoot": gl3SelectedLifecycleRoot, "seededChallengeEdges": false, "syntheticHistorySiblings": false, "privilegedFastConfirmation": false, "publicDeployment": false, "enginePolicyChanged": false, "allExecutionOnRunpod": true, "backgroundAllBlocksValidatorEnabled": false, "backgroundValidationGateAssumedByFixture": true, "stakeSettlementPassed": false, "assertionConfirmationPassed": false, "honestOneStepWinner": false, "claimPairContentVerified": false, "strictAuditPassedBeforeCleanup": false, "strictIndependentTargetAndSettlementAuditRequired": true}
	defer func() { report["seconds"] = time.Since(started).Seconds(); write("full-lifecycle-result.json", report) }()
	write("full-lifecycle-progress.json", map[string]any{"runID": runID, "phase": "STARTING_REAL_CHALLENGE_STACKS", "terminal": terminal.BlockHash})
	evilConfig := arbnode.ConfigDefaultL1NonSequencerTest()
	evilConfig.BlockValidator.Enable = false
	evilNode, cleanup := b.Build2ndNode(t, &SecondNodeParams{nodeConfig: evilConfig})
	defer cleanup()
	b.L1Info.GenerateAccount("HonestAsserter")
	fundBoldStaker(t, ctx, b, "HonestAsserter")
	b.L1Info.GenerateAccount("EvilAsserter")
	fundBoldStaker(t, ctx, b, "EvilAsserter")
	var shared BoldStateProviderInterface
	chain, stopHonest := startBoldChallengeManager(t, ctx, b, b.L2, "HonestAsserter", func(real BoldStateProviderInterface) BoldStateProviderInterface { shared = real; return real })
	defer stopHonest()
	if shared == nil {
		t.Fatal("missing actual state provider")
	}
	trueFinished := server_arb.NewFinishedMachine(final)
	correctHash := trueFinished.Hash()
	trueFinished.Destroy()
	forged := final
	forged.BlockHash[31] ^= 1
	falseFinished := server_arb.NewFinishedMachine(forged)
	falseHash := falseFinished.Hash()
	falseFinished.Destroy()
	actual := protocol.GoGlobalState{BlockHash: final.BlockHash, SendRoot: final.SendRoot, Batch: final.Batch, PosInBatch: final.PosInBatch}
	bad := protocol.GoGlobalState{BlockHash: forged.BlockHash, SendRoot: forged.SendRoot, Batch: forged.Batch, PosInBatch: forged.PosInBatch}
	liar := &gl3FalseTerminalClaim{BoldStateProviderInterface: shared, honestFinished: correctHash, falseFinished: falseHash, trueGlobal: actual, falseGlobal: bad}
	_, stopEvil := startBoldChallengeManager(t, ctx, b, evilNode, "EvilAsserter", func(_ BoldStateProviderInterface) BoldStateProviderInterface { return liar })
	defer stopEvil()
	managerAddr := chain.SpecChallengeManager().Address()
	manager, err := challengeV2gen.NewEdgeChallengeManager(managerAddr, b.L1.Client)
	Require(t, err)
	rollup, err := rollupgen.NewRollupUserLogic(b.addresses.Rollup, b.L1.Client)
	Require(t, err)
	report["rollup"] = b.addresses.Rollup
	report["challengeManager"] = managerAddr
	report["trueTerminalState"] = final
	report["falseTerminalState"] = forged
	report["correctFinishedHash"] = correctHash
	report["falseFinishedHash"] = falseHash
	honest := map[[32]byte]*rollupgen.RollupUserLogicAssertionCreated{}
	falseClaims := map[[32]byte]*rollupgen.RollupUserLogicAssertionCreated{}
	senders := map[[32]byte]common.Address{}
	type historyKey struct {
		Before protocol.GoGlobalState
		Limit  uint64
	}
	roots := map[historyKey][2]common.Hash{}
	var selectedHonest, selectedFalse *rollupgen.RollupUserLogicAssertionCreated
	edgeIDs := map[common.Hash]bool{}
	var honestRoot, falseRoot common.Hash
	var cursor uint64
	neutral := 0
	var refundTx common.Hash
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			t.Fatal("challenge context ended before exact audit completion", ctx.Err())
		case <-ticker.C:
			latest, err := b.L1.Client.HeaderByNumber(ctx, nil)
			Require(t, err)
			end := latest.Number.Uint64()
			if end >= cursor {
				opts := &bind.FilterOpts{Start: cursor, End: &end, Context: ctx}
				claims, err := rollup.FilterAssertionCreated(opts, nil, nil)
				Require(t, err)
				for claims.Next() {
					e := claims.Event
					g := gl3Global(e.Assertion.AfterState.GlobalState)
					if g != actual && g != bad {
						neutral++
						continue
					}
					if common.Hash(e.WasmModuleRoot) != gl3SelectedLifecycleRoot || e.ChallengeManager != managerAddr {
						t.Fatal("target assertion uses unexpected proof configuration")
					}
					key := historyKey{gl3Global(e.Assertion.BeforeState.GlobalState), g.Batch}
					rr, ok := roots[key]
					if !ok {
						a, er := shared.L2MessageStatesUpTo(ctx, key.Before, state.Batch(key.Limit), containers.Some(state.Height(blockChallengeLeafHeight)))
						Require(t, er)
						h, er := history.NewCommitment(a, blockChallengeLeafHeight+1)
						Require(t, er)
						f, er := liar.L2MessageStatesUpTo(ctx, key.Before, state.Batch(key.Limit), containers.Some(state.Height(blockChallengeLeafHeight)))
						Require(t, er)
						fh, er := history.NewCommitment(f, blockChallengeLeafHeight+1)
						Require(t, er)
						rr = [2]common.Hash{h.Merkle, fh.Merkle}
						if rr[0] == rr[1] {
							t.Fatal("false terminal history did not differ")
						}
						roots[key] = rr
					}
					kind := gl3TerminalClaimKind(e.Assertion.AfterState, actual, bad, rr[0], rr[1])
					if kind == "malformed" {
						t.Fatal("target assertion history/global state is not the controlled actual or forged claim")
					}
					tx, _, er := b.L1.Client.TransactionByHash(ctx, e.Raw.TxHash)
					Require(t, er)
					sender, er := types.Sender(types.LatestSignerForChainID(tx.ChainId()), tx)
					Require(t, er)
					senders[e.AssertionHash] = sender
					if kind == "honest" {
						honest[e.AssertionHash] = e
					}
					if kind == "false" {
						falseClaims[e.AssertionHash] = e
					}
				}
				Require(t, claims.Error())
				Require(t, claims.Close())
				for _, h := range honest {
					for _, f := range falseClaims {
						if !gl3SameTargetParent(h, f) {
							continue
						}
						if selectedHonest != nil && (selectedHonest.AssertionHash != h.AssertionHash || selectedFalse.AssertionHash != f.AssertionHash) {
							t.Fatal("multiple exact terminal rival pairs")
						}
						selectedHonest = h
						selectedFalse = f
					}
				}
				edges, err := manager.FilterEdgeAdded(opts, nil, nil, nil)
				Require(t, err)
				for edges.Next() {
					e := edges.Event
					if e.IsLayerZero && e.Level == 0 {
						edgeIDs[common.Hash(e.EdgeId)] = true
					}
				}
				Require(t, edges.Error())
				Require(t, edges.Close())
				if selectedHonest != nil {
					for id := range edgeIDs {
						edge, er := manager.GetEdge(&bind.CallOpts{Context: ctx}, id)
						Require(t, er)
						if edge.OriginId != selectedHonest.ParentAssertionHash {
							continue
						}
						if edge.ClaimId == selectedHonest.AssertionHash {
							if honestRoot != (common.Hash{}) && honestRoot != id {
								t.Fatal("multiple honest target roots")
							}
							honestRoot = id
						}
						if edge.ClaimId == selectedFalse.AssertionHash {
							if falseRoot != (common.Hash{}) && falseRoot != id {
								t.Fatal("multiple false target roots")
							}
							falseRoot = id
						}
					}
				}

				confirmations, err := rollup.FilterAssertionConfirmed(opts, nil)
				Require(t, err)
				for confirmations.Next() {
					if selectedFalse != nil && confirmations.Event.AssertionHash == selectedFalse.AssertionHash {
						t.Fatal("exact false target assertion confirmed")
					}
				}
				Require(t, confirmations.Error())
				Require(t, confirmations.Close())
				cursor = end + 1
			}
			if selectedHonest == nil || honestRoot == (common.Hash{}) || falseRoot == (common.Hash{}) {
				write("full-lifecycle-progress.json", map[string]any{"runID": runID, "phase": "WAITING_CONTENT_BOUND_TARGET_ROOTS", "parentBlock": end, "honestTargetClaims": len(honest), "falseTargetClaims": len(falseClaims), "neutralClaims": neutral})
				continue
			}
			h, f := selectedHonest, selectedFalse
			expected := gl3ExpectedAudit{RunID: runID, InputSHA: manifest.SHA, Actual: actual, Forged: bad, Block: terminal.BlockNumber.Uint64(), Honest: common.Hash(h.AssertionHash), False: common.Hash(f.AssertionHash), Parent: common.Hash(h.ParentAssertionHash), HonestHistory: common.Hash(h.Assertion.AfterState.EndHistoryRoot), FalseHistory: common.Hash(f.Assertion.AfterState.EndHistoryRoot), HonestRoot: honestRoot, FalseRoot: falseRoot, Sender: senders[h.AssertionHash], Manager: managerAddr, Rollup: b.addresses.Rollup}
			report["claimPairContentVerified"] = true
			report["targetHonestAssertion"] = expected.Honest
			report["targetFalseAssertion"] = expected.False
			report["targetParentAssertion"] = expected.Parent
			report["expectedHonestHistory"] = expected.HonestHistory
			report["expectedFalseHistory"] = expected.FalseHistory
			falseState, err := rollup.GetAssertion(&bind.CallOpts{Context: ctx}, f.AssertionHash)
			Require(t, err)
			if falseState.Status == 2 {
				t.Fatal("exact false target gained confirmed status")
			}
			audit, _, readErr := gl3ReadAudit(auditDir)
			if readErr != nil {
				continue
			}
			proof, confirmation, ready := gl3BoundAuditConfirmation(audit, expected)
			if !ready {
				write("full-lifecycle-progress.json", map[string]any{"runID": runID, "phase": "WAITING_EXACT_TERMINAL_PROOF_AND_CONFIRMATION", "seconds": time.Since(started).Seconds(), "honest": expected.Honest, "false": expected.False, "neutralClaims": neutral})
				continue
			}
			honestState, err := rollup.GetAssertion(&bind.CallOpts{Context: ctx}, h.AssertionHash)
			Require(t, err)
			if honestState.Status != 2 {
				continue
			}
			edge, err := manager.GetEdge(&bind.CallOpts{Context: ctx}, honestRoot)
			Require(t, err)
			if edge.Status != 1 || edge.Level != 0 || edge.ClaimId != h.AssertionHash || edge.OriginId != h.ParentAssertionHash || edge.Staker != expected.Sender {
				t.Fatal("audited target root does not match actual confirmed edge")
			}
			amount, err := manager.StakeAmounts(&bind.CallOpts{Context: ctx}, big.NewInt(0))
			Require(t, err)
			if amount.Sign() <= 0 {
				t.Fatal("zero collateral cannot satisfy exact settlement")
			}
			report["honestOneStepWinner"] = true
			report["oneStepEdge"] = proof.Edge
			report["oneStepTransaction"] = proof.Transaction
			report["assertionConfirmationPassed"] = true
			report["confirmedAssertion"] = expected.Honest
			report["confirmationTransaction"] = confirmation.Transaction
			report["targetRefundAmount"] = amount.String()
			report["refundEdge"] = honestRoot
			if !edge.Refunded {
				auth := b.L1Info.GetDefaultTransactOpts("HonestAsserter", ctx)
				tx, er := manager.RefundStake(&auth, honestRoot)
				Require(t, er)
				receipt, er := b.L1.EnsureTxSucceeded(tx)
				Require(t, er)
				refundTx = receipt.TxHash
				report["refundTransaction"] = refundTx
			}
			completed, digest, refund, er := gl3CompletedAudit(auditDir, completionPath, expected, amount.String())
			if er != nil {
				write("full-lifecycle-progress.json", map[string]any{"runID": runID, "phase": "KEEPING_PARENT_ALIVE_FOR_STRICT_AUDITOR_EXIT", "reason": fmt.Sprint(er), "refundEdge": honestRoot})
				continue
			}
			if refundTx != (common.Hash{}) && refund.Transaction != refundTx {
				t.Fatal("auditor accepted a different refund transaction")
			}
			report["refundTransaction"] = refund.Transaction
			report["strictAuditSHA256"] = digest
			report["strictAuditPassedBeforeCleanup"] = true
			report["stakeSettlementPassed"] = true
			report["honestLayerZeroRefunds"] = 1
			report["incorrectAssertionsRemainUnconfirmed"] = true
			report["independentAuditPassed"] = completed.Passed
			report["passed"] = true
			return
		}
	}
}
