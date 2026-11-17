// Copyright 2026, GH0ST contributors.
// Uses the pinned Nitro system-test harness; research execution only.
package arbtest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"

	ethereum "github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/ethereum/go-ethereum/crypto"

	"github.com/offchainlabs/nitro/arbutil"
	"github.com/offchainlabs/nitro/validator/server_api"
	"github.com/offchainlabs/nitro/validator/valnode"
)

// Captures an ordinary, debug-disabled EVM transfer and the actual private
// parent accumulator records. It does not execute a prover or accept a root.
func TestGL3CanonicalBaseCapture(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	out := os.Getenv("GL3_CANONICAL_CAPTURE_DIR")
	if out == "" {
		t.Fatal("explicit isolated capture output required")
	}
	Require(t, os.MkdirAll(out, 0755))
	builder := NewNodeBuilder(ctx).DefaultConfig(t, true).DontParalellise().WithTakeOwnership(false).WithArbOSVersion(61).WithChainTipBlockRecorder()
	builder.chainConfig.ArbitrumChainParams.AllowDebugPrecompiles = false
	builder.nodeConfig.MessageExtraction.Enable = false
	builder.nodeConfig.BlockValidator.Enable = false
	builder.nodeConfig.Staker.Enable = false
	builder.nodeConfig.BatchPoster.Enable = true
	builder.nodeConfig.ParentChainReader.Enable = true
	builder.valnodeConfig.Wasm.RootPath = "/root/gl3-base-launch/machines"
	valConf := valnode.TestValidationConfig
	valConf.UseJit = false
	valConf.Wasm.RootPath = "/root/gl3-base-launch/machines"
	_, valStack := createTestValidationNode(t, ctx, &valConf)
	configByValidationNode(builder.nodeConfig, valStack)
	cleanup := builder.Build(t)
	defer cleanup()
	if builder.L2.ConsensusNode.StatelessBlockValidator == nil {
		t.Fatal("recording validator unavailable")
	}
	builder.L2Info.GenerateAccount("GL3CaptureReceiver")
	tx := builder.L2Info.PrepareTx("Owner", "GL3CaptureReceiver", builder.L2Info.TransferGas, big.NewInt(1), nil)
	Require(t, builder.L2.Client.SendTransaction(ctx, tx))
	receipt, err := EnsureTxSucceeded(ctx, builder.L2.Client, tx)
	Require(t, err)
	pos := arbutil.MessageIndex(receipt.BlockNumber.Uint64())
	waitForBatchContainingMessage(t, builder.L2.ConsensusNode, pos, 30*time.Second, 250*time.Millisecond)
	var input server_api.InputJSON
	retryUntilFound(t, ctx, 40, 250*time.Millisecond, "capture", "batch not found on L1", func() error {
		var e error
		input, e = builder.L2.ConsensusNode.StatelessBlockValidator.ValidationInputsAt(ctx, pos, rawdb.TargetWavm, rawdb.TargetWasm)
		return e
	})
	if input.DebugChain || input.ExpectedEndState == nil || input.ExpectedEndState.BlockHash != receipt.BlockHash {
		t.Fatal("capture must bind the actual debug-disabled transfer block")
	}
	decoded, err := server_api.ValidationInputFromJson(&input)
	Require(t, err)
	for _, modules := range decoded.UserWasms {
		if len(modules) != 0 {
			t.Fatal("base transfer unexpectedly depends on user executable modules")
		}
	}
	write := func(name string, value interface{}) {
		data, e := json.MarshalIndent(value, "", "  ")
		Require(t, e)
		Require(t, os.WriteFile(filepath.Join(out, name), append(data, '\n'), 0644))
	}
	write("input.json", input)
	write("receipt.json", receipt)
	header, err := builder.L2.Client.HeaderByHash(ctx, receipt.BlockHash)
	Require(t, err)
	write("header.json", header)
	accumulator := func(method string, index uint64) common.Hash {
		data := append(crypto.Keccak256([]byte(method + "(uint256)"))[:4], common.LeftPadBytes(new(big.Int).SetUint64(index).Bytes(), 32)...)
		result, e := builder.L1.Client.CallContract(ctx, ethereum.CallMsg{To: &builder.addresses.Bridge, Data: data}, nil)
		Require(t, e)
		if len(result) != 32 {
			t.Fatal("noncanonical parent accumulator response")
		}
		return common.BytesToHash(result)
	}
	seq := []map[string]interface{}{}
	for _, batch := range decoded.BatchInfo {
		meta, e := builder.L2.ConsensusNode.GetParentChainDataSource().GetBatchMetadata(batch.Number)
		Require(t, e)
		before := common.Hash{}
		if batch.Number != 0 {
			before = accumulator("sequencerInboxAccs", batch.Number-1)
		}
		delayed := common.Hash{}
		if meta.DelayedMessageCount != 0 {
			delayed = accumulator("delayedInboxAccs", meta.DelayedMessageCount-1)
		}
		seq = append(seq, map[string]interface{}{"index": batch.Number, "wireHex": hex.EncodeToString(batch.Data), "wireHash": crypto.Keccak256Hash(batch.Data), "beforeAcc": before, "afterAcc": accumulator("sequencerInboxAccs", batch.Number), "afterDelayedCount": meta.DelayedMessageCount, "delayedAcc": delayed, "metadata": meta})
	}
	delayed := []map[string]interface{}{}
	if decoded.HasDelayedMsg {
		before := common.Hash{}
		if decoded.DelayedMsgNr != 0 {
			before = accumulator("delayedInboxAccs", decoded.DelayedMsgNr-1)
		}
		delayed = append(delayed, map[string]interface{}{"index": decoded.DelayedMsgNr, "wireHex": hex.EncodeToString(decoded.DelayedMsg), "wireHash": crypto.Keccak256Hash(decoded.DelayedMsg), "beforeAcc": before, "afterAcc": accumulator("delayedInboxAccs", decoded.DelayedMsgNr)})
	}
	write("inbox-parent-records.json", map[string]interface{}{"privateFixture": true, "publicSettlementAccepted": false, "bridge": builder.addresses.Bridge, "sequencer": seq, "delayed": delayed})
	inputBytes, err := os.ReadFile(filepath.Join(out, "input.json"))
	Require(t, err)
	digest := sha256.Sum256(inputBytes)
	write("report.json", map[string]interface{}{"captured": true, "fullSTFExecutedInSP1": false, "proofGenerated": false, "ArbOSVersion": 61, "debugPrecompiles": false, "MEL": false, "moduleRoot": "0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97", "chainID": builder.chainConfig.ChainID.String(), "transactionHash": tx.Hash(), "blockHash": receipt.BlockHash, "nativePreState": input.StartState, "nativeExpectedPostState": input.ExpectedEndState, "inputBytes": len(inputBytes), "inputSHA256": hex.EncodeToString(digest[:]), "preimageGroups": len(decoded.Preimages), "sequencerRecords": len(seq), "delayedRecords": len(delayed), "publicWrites": false})
}
