//go:build gl3_acceptance && challengetest

// SPDX-License-Identifier: GPL-3.0-or-later
package arbtest

import (
	"context"
	"math/big"
	"os"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/offchainlabs/nitro/arbutil"
)

// A batch-posting report may create a child message after the final chess
// transaction. Hold only the final short compute window, then post a batch
// ending at that exact transaction. Never replace the target with the later
// report block merely to obtain an assertion-end match.
func gl3HoldTerminalBatch(t *testing.T, ctx context.Context, b *NodeBuilder) uint64 {
	t.Helper()
	config := *b.L2.ConsensusConfigFetcher.Get()
	config.BatchPoster.MaxDelay = 24 * time.Hour
	config.BatchPoster.WaitForMaxDelay = true
	config.BatchPoster.MaxEmptyBatchDelay = 0
	config.BatchPoster.PollInterval = time.Second
	b.L2.ConsensusConfigFetcher.Set(&config)
	deadline := time.Now().Add(30 * time.Second)
	var previousBatches, previousMessages uint64
	stable := time.Now()
	first := true
	for time.Now().Before(deadline) {
		batches, err := b.L2.ConsensusNode.InboxTracker.GetBatchCount()
		Require(t, err)
		messages, err := b.L2.ConsensusNode.TxStreamer.GetMessageCount()
		Require(t, err)
		if first || batches != previousBatches || uint64(messages) != previousMessages {
			previousBatches, previousMessages = batches, uint64(messages)
			stable = time.Now()
			first = false
		} else if time.Since(stable) >= 2*time.Second {
			return batches
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(100 * time.Millisecond):
		}
	}
	t.Fatal("terminal batch hold did not reach a stable parent/child boundary")
	return 0
}

func gl3SealTerminalBatch(t *testing.T, ctx context.Context, b *NodeBuilder, receipt *types.Receipt, heldBatchCount uint64, out string) {
	t.Helper()
	count, err := b.L2.ConsensusNode.InboxTracker.GetBatchCount()
	Require(t, err)
	if count != heldBatchCount {
		t.Fatal("unexpected batch posted during held terminal compute window", count, heldBatchCount)
	}
	head, err := b.L2.Client.HeaderByNumber(ctx, nil)
	Require(t, err)
	if head.Hash() != receipt.BlockHash {
		t.Fatal("child head advanced past exact terminal transaction before batch seal", head.Hash(), receipt.BlockHash)
	}
	position, err := arbutil.BlockNumberToMessageIndex(receipt.BlockNumber.Uint64(), b.chainConfig.ArbitrumChainParams.GenesisBlockNum)
	Require(t, err)
	config := *b.L2.ConsensusConfigFetcher.Get()
	config.BatchPoster.MaxDelay = 0
	b.L2.ConsensusConfigFetcher.Set(&config)
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		batch, found, err := b.L2.ConsensusNode.InboxTracker.FindInboxBatchContainingMessage(position)
		Require(t, err)
		if found {
			// Suppress subsequent report-only batches throughout the challenge.
			held := *b.L2.ConsensusConfigFetcher.Get()
			held.BatchPoster.MaxDelay = 24 * time.Hour
			held.BatchPoster.WaitForMaxDelay = true
			held.BatchPoster.MaxEmptyBatchDelay = 0
			b.L2.ConsensusConfigFetcher.Set(&held)
			metadata, err := b.L2.ConsensusNode.InboxTracker.GetBatchMetadata(batch)
			Require(t, err)
			if uint64(metadata.MessageCount) != uint64(position)+1 {
				t.Fatal("sealed batch does not end at the exact terminal message", batch, metadata.MessageCount, position)
			}
			if out != "" {
				gl3TransportWrite(t, out, "terminal-batch-seal.json", map[string]any{
					"passed": true, "terminalBlock": receipt.BlockNumber.Uint64(), "terminalBlockHash": receipt.BlockHash,
					"terminalMessageIndex": uint64(position), "batch": batch, "endMessageCount": uint64(metadata.MessageCount),
					"heldBatchCount": heldBatchCount, "reportOnlyBatchPostingSuppressed": true,
					"scope": "Actual batch boundary only; no engine/proof/lifecycle acceptance",
				})
			}
			return
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(25 * time.Millisecond):
		}
	}
	t.Fatal("exact terminal message was not posted within the bounded seal window")
}

func TestGL3TerminalBatchSeal(t *testing.T) {
	machines, out := os.Getenv("GL3_GEOMETRY43_MACHINES"), os.Getenv("GL3_TERMINAL_SEAL_EVIDENCE")
	if machines == "" || out == "" {
		t.Fatal("explicit private machine and batch-boundary evidence paths required")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	b := NewNodeBuilder(ctx).DefaultConfig(t, true).DontParalellise().WithLegacyBlockRecorder().WithWasmRootDir(machines)
	b.nodeConfig.BatchPoster.Enable = true
	b.nodeConfig.BlockValidator.Enable = false
	cleanup := b.Build(t)
	defer cleanup()
	go keepChainMoving(t, 100*time.Millisecond, ctx, b.L1Info, b.L1.Client)
	held := gl3HoldTerminalBatch(t, ctx, b)
	to := b.L2Info.GetAddress("Faucet")
	var receipt *types.Receipt
	for i := 0; i < 6; i++ {
		tx := b.L2Info.PrepareTxTo("Owner", &to, b.L2Info.TransferGas, big.NewInt(0), nil)
		Require(t, b.L2.Client.SendTransaction(ctx, tx))
		var err error
		receipt, err = EnsureTxSucceeded(ctx, b.L2.Client, tx)
		Require(t, err)
		// Span several normal poster polls with useful messages held.
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(500 * time.Millisecond):
		}
	}
	gl3SealTerminalBatch(t, ctx, b, receipt, held, out)
	position, err := arbutil.BlockNumberToMessageIndex(receipt.BlockNumber.Uint64(), b.chainConfig.ArbitrumChainParams.GenesisBlockNum)
	Require(t, err)
	input, err := b.L2.ConsensusNode.StatelessBlockValidator.ValidationInputsAt(ctx, position, rawdb.LocalTarget(), rawdb.TargetWasm)
	Require(t, err)
	if input.ExpectedEndState == nil || input.ExpectedEndState.BlockHash != receipt.BlockHash || input.ExpectedEndState.PosInBatch != 0 {
		t.Fatal("validation capture does not end at the exact sealed transaction", input.ExpectedEndState)
	}
	gl3TransportWrite(t, out, "terminal-batch-capture.json", map[string]any{"passed": true, "expectedEndState": input.ExpectedEndState, "terminalBlockHash": receipt.BlockHash, "usefulMessagesHeld": 6, "engineExecuted": false})
	sealedCount, err := b.L2.ConsensusNode.InboxTracker.GetBatchCount()
	Require(t, err)
	select {
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	case <-time.After(2500 * time.Millisecond):
	}
	afterCount, err := b.L2.ConsensusNode.InboxTracker.GetBatchCount()
	Require(t, err)
	if afterCount != sealedCount {
		t.Fatal("a later report-only batch advanced the assertion endpoint", sealedCount, afterCount)
	}
}
