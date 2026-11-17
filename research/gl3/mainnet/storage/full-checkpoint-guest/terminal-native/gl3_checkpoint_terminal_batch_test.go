//go:build gl3_acceptance && gl3_checkpoint_integration && gl3_checkpoint_capture

package arbtest

import (
	"context"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/offchainlabs/nitro/arbutil"
	"testing"
	"time"
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
				cpTerminalWrite(t, out, "terminal-batch-seal.json", map[string]any{
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
