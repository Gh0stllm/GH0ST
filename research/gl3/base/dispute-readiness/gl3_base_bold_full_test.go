// Copyright 2026 GH0ST contributors. Derived from pinned Nitro v3.12.2 upstream challenge fixture.
//go:build challengetest && !race

package arbtest

import (
	"context"
	"encoding/json"
	ethereum "github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/params"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/offchainlabs/nitro/arbnode"
	"github.com/offchainlabs/nitro/arbnode/dataposter/storage"
	"github.com/offchainlabs/nitro/arbnode/parent"
	"github.com/offchainlabs/nitro/arbos/l2pricing"
	"github.com/offchainlabs/nitro/bold/api/db"
	"github.com/offchainlabs/nitro/bold/challenge"
	modes "github.com/offchainlabs/nitro/bold/challenge/types"
	"github.com/offchainlabs/nitro/bold/protocol"
	"github.com/offchainlabs/nitro/bold/protocol/sol"
	"github.com/offchainlabs/nitro/bold/state"
	"github.com/offchainlabs/nitro/bold/testing/setup"
	"github.com/offchainlabs/nitro/cmd/chaininfo"
	"github.com/offchainlabs/nitro/execution/gethexec"
	"github.com/offchainlabs/nitro/execution_consensus"
	"github.com/offchainlabs/nitro/solgen/go/bridgegen"
	"github.com/offchainlabs/nitro/solgen/go/challengeV2gen"
	"github.com/offchainlabs/nitro/solgen/go/mocksgen"
	"github.com/offchainlabs/nitro/solgen/go/rollupgen"
	"github.com/offchainlabs/nitro/staker"
	"github.com/offchainlabs/nitro/staker/bold"
	"github.com/offchainlabs/nitro/util"
	"github.com/offchainlabs/nitro/util/containers"
	"github.com/offchainlabs/nitro/util/redisutil"
	"github.com/offchainlabs/nitro/validator/client/redis"
	"github.com/offchainlabs/nitro/validator/server_arb"
	"github.com/offchainlabs/nitro/validator/server_common"
	"github.com/offchainlabs/nitro/validator/valnode"
	"math/big"
	"os"
	"strings"
	gotesting "testing"
	"time"
)

var gl3BaseOfficialRoot = common.HexToHash("0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97")

func TestGL3BaseBOLDFullLifecycle(t *gotesting.T) {
	tc := blockRecorderTestCase{name: "chain-tip/hash", recorderMode: gethexec.BlockRecorderModeChainTip, stateScheme: rawdb.HashScheme}
	gl3BaseFullBOLD(t, tc, false, false)
}

func gl3BaseFullBOLD(t *gotesting.T, recorderCase blockRecorderTestCase, useExternalSigner bool, useRedis bool, spawnerOpts ...server_arb.SpawnerOption) {
	goodDir, err := os.MkdirTemp("", "good_*")
	Require(t, err)
	evilDir, err := os.MkdirTemp("", "evil_*")
	Require(t, err)
	t.Cleanup(func() {
		Require(t, os.RemoveAll(goodDir))
		Require(t, os.RemoveAll(evilDir))
	})
	ctx, cancelCtx := context.WithTimeout(context.Background(), 12*time.Minute)
	defer cancelCtx()
	var transferGas = util.NormalizeL2GasForL1GasInitial(800_000, params.GWei) // include room for aggregator L1 costs
	l2chainConfig := chaininfo.ArbitrumDevTestChainConfig()
	l2chainConfig.ArbitrumChainParams.InitialArbOSVersion = 61
	l2chainConfig.ArbitrumChainParams.AllowDebugPrecompiles = false
	l2info := NewBlockChainTestInfo(
		t,
		types.NewArbitrumSigner(types.NewLondonSigner(l2chainConfig.ChainID)), big.NewInt(l2pricing.InitialBaseFeeWei*2),
		transferGas,
	)
	ownerBal := big.NewInt(params.Ether)
	ownerBal.Mul(ownerBal, big.NewInt(1_000_000))
	l2info.GenerateGenesisAccount("Owner", ownerBal)
	sconf := setup.RollupStackConfig{
		UseBlobs:               true,
		UseMockBridge:          false,
		UseMockOneStepProver:   false,
		MinimumAssertionPeriod: 0,
	}

	_, l2nodeA, l2execNodeA, _, l2StackA, l1info, l1client, assertionChain, stakeTokenAddr, asserterOpts, _, _ := createCompleteTestNodeOnL1(
		t,
		ctx,
		true,
		nil,
		l2chainConfig,
		sconf,
		l2info,
		useExternalSigner,
		false,
		withBlockRecorderTestCase(recorderCase),
	)
	defer l2nodeA.StopAndWait()

	// Make sure we shut down test functionality before the rest of the node
	ctx, cancelCtx = context.WithCancel(ctx)
	defer cancelCtx()

	go keepChainMoving(t, 300*time.Millisecond, ctx, l1info, l1client)

	l2nodeConfig := arbnode.ConfigDefaultL1Test()
	l2StackB, _, l2nodeB, l2execNodeB, _ := create2ndNodeWithConfigForBoldProtocol(
		t,
		ctx,
		l2nodeA,
		l1client,
		l1info,
		&l2info.ArbInitData,
		l2nodeConfig,
		nil,
		sconf,
		stakeTokenAddr,
		asserterOpts,
		false,
		withBlockRecorderTestCase(recorderCase),
	)
	defer l2nodeB.StopAndWait()

	genesisA, err := l2nodeA.ExecutionClient.ResultAtMessageIndex(0).Await(ctx)
	Require(t, err)
	genesisB, err := l2nodeB.ExecutionClient.ResultAtMessageIndex(0).Await(ctx)
	Require(t, err)
	if genesisA.BlockHash != genesisB.BlockHash {
		Fatal(t, "genesis blocks mismatch between nodes")
	}

	balance := big.NewInt(params.Ether)
	balance.Mul(balance, big.NewInt(100))
	TransferBalanceTo(t, "Faucet", asserterOpts.From, balance, l1info, l1client, ctx)
	TransferBalance(t, "Faucet", "EvilAsserter", balance, l1info, l1client, ctx)

	redisURL := ""
	if useRedis {
		redisURL = redisutil.CreateTestRedis(ctx, t)
	}
	valStack := AddValNode(t, ctx, l2nodeConfig, false, redisURL, "")
	blockValidatorConfig := staker.TestBlockValidatorConfig
	blockValidatorConfig.RedisValidationClientConfig = redis.TestValidationClientConfig
	blockValidatorConfig.RedisValidationClientConfig.RedisURL = redisURL
	locator, err := server_common.NewMachineLocator("")
	Require(t, err)
	if locator.LatestWasmModuleRoot() != gl3BaseOfficialRoot {
		t.Fatal("nonofficial machine root", locator.LatestWasmModuleRoot())
	}
	pcdsA := l2nodeA.GetParentChainDataSource()
	statelessA, err := staker.NewStatelessBlockValidator(
		pcdsA,
		pcdsA,
		l2nodeA.TxStreamer,
		l2nodeA.ExecutionRecorder,
		l2nodeA.ConsensusDB,
		nil,
		StaticFetcherFrom(t, &blockValidatorConfig),
		valStack,
		locator.LatestWasmModuleRoot(),
	)
	Require(t, err)
	err = statelessA.Start(ctx)
	Require(t, err)
	valCfg := valnode.TestValidationConfig
	valCfg.UseJit = false
	_, valStackB := createTestValidationNode(t, ctx, &valCfg, spawnerOpts...)

	pcdsB := l2nodeB.GetParentChainDataSource()
	statelessB, err := staker.NewStatelessBlockValidator(
		pcdsB,
		pcdsB,
		l2nodeB.TxStreamer,
		l2nodeB.ExecutionRecorder,
		l2nodeB.ConsensusDB,
		nil,
		StaticFetcherFrom(t, &blockValidatorConfig),
		valStackB,
		locator.LatestWasmModuleRoot(),
	)
	Require(t, err)
	err = statelessB.Start(ctx)
	Require(t, err)

	blockValidatorA, err := staker.NewBlockValidator(
		statelessA,
		pcdsA,
		l2nodeA.TxStreamer,
		StaticFetcherFrom(t, &blockValidatorConfig),
		nil,
	)
	Require(t, err)
	Require(t, blockValidatorA.Initialize(ctx))
	Require(t, blockValidatorA.Start(ctx))

	blockValidatorB, err := staker.NewBlockValidator(
		statelessB,
		pcdsB,
		l2nodeB.TxStreamer,
		StaticFetcherFrom(t, &blockValidatorConfig),
		nil,
	)
	Require(t, err)
	Require(t, blockValidatorB.Initialize(ctx))
	Require(t, blockValidatorB.Start(ctx))

	stateManager, err := bold.NewBOLDStateProvider(
		blockValidatorA,
		statelessA,
		state.Height(blockChallengeLeafHeight),
		&bold.StateProviderConfig{
			ValidatorName:          "good",
			MachineLeavesCachePath: goodDir,
			CheckBatchFinality:     false,
		},
		goodDir,
		pcdsA,
		l2nodeA.TxStreamer,
		pcdsA,
		nil,
	)
	Require(t, err)

	stateManagerB, err := bold.NewBOLDStateProvider(
		blockValidatorB,
		statelessB,
		state.Height(blockChallengeLeafHeight),
		&bold.StateProviderConfig{
			ValidatorName:          "evil",
			MachineLeavesCachePath: evilDir,
			CheckBatchFinality:     false,
		},
		evilDir,
		pcdsB,
		l2nodeB.TxStreamer,
		pcdsB,
		nil,
	)
	Require(t, err)

	_, err = execution_consensus.InitAndStartExecutionAndConsensusNodes(ctx, l2StackA, l2execNodeA, l2nodeA)
	Require(t, err)
	_, err = execution_consensus.InitAndStartExecutionAndConsensusNodes(ctx, l2StackB, l2execNodeB, l2nodeB)
	Require(t, err)

	chalManagerAddr := assertionChain.SpecChallengeManager()
	evilOpts := l1info.GetDefaultTransactOpts("EvilAsserter", ctx)
	l1ChainId, err := l1client.ChainID(ctx)
	Require(t, err)
	dp, err := arbnode.StakerDataposter(
		ctx,
		rawdb.NewTable(l2nodeB.ConsensusDB, storage.StakerPrefix),
		l2nodeB.L1Reader,
		&evilOpts,
		NewCommonConfigFetcher(l2nodeConfig),
		l2nodeB.SyncMonitor,
		parent.NewParentChain(ctx, l1ChainId, l2nodeB.L1Reader),
	)
	Require(t, err)
	chainB, err := sol.NewAssertionChain(
		ctx,
		assertionChain.RollupAddress(),
		chalManagerAddr.Address(),
		&evilOpts,
		l1client,
		bold.NewDataPosterTransactor(dp),
		sol.WithRpcHeadBlockNumber(rpc.LatestBlockNumber),
	)
	Require(t, err)

	l2info.GenerateAccount("Destination")
	sequencerTxOpts := l1info.GetDefaultTransactOpts("Sequencer", ctx)

	honestSeqInbox := l1info.GetAddress("SequencerInbox")
	evilSeqInbox := l1info.GetAddress("EvilSequencerInbox")
	honestSeqInboxBinding, err := bridgegen.NewSequencerInbox(honestSeqInbox, l1client)
	Require(t, err)
	evilSeqInboxBinding, err := bridgegen.NewSequencerInbox(evilSeqInbox, l1client)
	Require(t, err)

	// Post batches to the honest and evil sequencer inbox that are internally equal.
	// This means the honest and evil sequencer inboxes will agree with all messages in the batch.
	seqInboxABI, err := abi.JSON(strings.NewReader(bridgegen.SequencerInboxABI))
	Require(t, err)

	honestUpgradeExec, err := mocksgen.NewUpgradeExecutorMock(l1info.GetAddress("UpgradeExecutor"), l1client)
	Require(t, err)
	data, err := seqInboxABI.Pack(
		"setIsBatchPoster",
		sequencerTxOpts.From,
		true,
	)
	Require(t, err)
	honestRollupOwnerOpts := l1info.GetDefaultTransactOpts("RollupOwner", ctx)
	_, err = honestUpgradeExec.ExecuteCall(&honestRollupOwnerOpts, honestSeqInbox, data)
	Require(t, err)

	evilUpgradeExec, err := mocksgen.NewUpgradeExecutorMock(l1info.GetAddress("EvilUpgradeExecutor"), l1client)
	Require(t, err)
	data, err = seqInboxABI.Pack(
		"setIsBatchPoster",
		sequencerTxOpts.From,
		true,
	)
	Require(t, err)
	evilRollupOwnerOpts := l1info.GetDefaultTransactOpts("RollupOwner", ctx)
	_, err = evilUpgradeExec.ExecuteCall(&evilRollupOwnerOpts, evilSeqInbox, data)
	Require(t, err)

	totalMessagesPosted := int64(0)
	numMessagesPerBatch := int64(5)
	divergeAt := int64(-1)
	makeBoldBatch(t, l2nodeA, l2info, l1client, &sequencerTxOpts, honestSeqInboxBinding, honestSeqInbox, numMessagesPerBatch, divergeAt)
	l2info.Accounts["Owner"].Nonce.Store(0)
	makeBoldBatch(t, l2nodeB, l2info, l1client, &sequencerTxOpts, evilSeqInboxBinding, evilSeqInbox, numMessagesPerBatch, divergeAt)
	totalMessagesPosted += numMessagesPerBatch

	// Next, we post another batch, this time containing more messages.
	// We diverge at message index 5 within the evil node's batch.
	l2info.Accounts["Owner"].Nonce.Store(5)
	numMessagesPerBatch = int64(10)
	makeBoldBatch(t, l2nodeA, l2info, l1client, &sequencerTxOpts, honestSeqInboxBinding, honestSeqInbox, numMessagesPerBatch, divergeAt)
	l2info.Accounts["Owner"].Nonce.Store(5)
	divergeAt = int64(5)
	makeBoldBatch(t, l2nodeB, l2info, l1client, &sequencerTxOpts, evilSeqInboxBinding, evilSeqInbox, numMessagesPerBatch, divergeAt)
	totalMessagesPosted += numMessagesPerBatch

	bcA, err := l2nodeA.GetParentChainDataSource().GetBatchCount()
	Require(t, err)
	bcB, err := l2nodeB.GetParentChainDataSource().GetBatchCount()
	Require(t, err)
	msgA, err := l2nodeA.GetParentChainDataSource().GetBatchMessageCount(bcA - 1)
	Require(t, err)
	msgB, err := l2nodeB.GetParentChainDataSource().GetBatchMessageCount(bcB - 1)
	Require(t, err)

	t.Logf("Node A batch count %d, msgs %d", bcA, msgA)
	t.Logf("Node B batch count %d, msgs %d", bcB, msgB)

	// Wait for both nodes' chains to catch up.
	nodeAExec, ok := l2nodeA.ExecutionClient.(*gethexec.ExecutionNode)
	if !ok {
		Fatal(t, "not geth execution node")
	}
	nodeBExec, ok := l2nodeB.ExecutionClient.(*gethexec.ExecutionNode)
	if !ok {
		Fatal(t, "not geth execution node")
	}
	for {
		nodeALatest := nodeAExec.Backend.APIBackend().CurrentHeader()
		nodeBLatest := nodeBExec.Backend.APIBackend().CurrentHeader()
		isCaughtUp := nodeALatest.Number.Uint64() == uint64(totalMessagesPosted)
		areEqual := nodeALatest.Number.Uint64() == nodeBLatest.Number.Uint64()
		if isCaughtUp && areEqual {
			if nodeALatest.Hash() == nodeBLatest.Hash() {
				Fatal(t, "node A L2 hash", nodeALatest, "matches node B L2 hash", nodeBLatest)
			}
			break
		}
	}

	bridgeBinding, err := bridgegen.NewBridge(l1info.GetAddress("Bridge"), l1client)
	Require(t, err)
	totalBatchesBig, err := bridgeBinding.SequencerMessageCount(&bind.CallOpts{Context: ctx})
	Require(t, err)
	totalBatches := totalBatchesBig.Uint64()

	// Wait until the validators have validated the batches.
	for {
		lastInfo, err := blockValidatorA.ReadLastValidatedInfo()
		if lastInfo == nil || err != nil {
			continue
		}
		t.Log(lastInfo.GlobalState.Batch, totalBatches-1)
		if lastInfo.GlobalState.Batch >= totalBatches-1 {
			break
		}
		time.Sleep(time.Millisecond * 200)
	}
	for {
		lastInfo, err := blockValidatorB.ReadLastValidatedInfo()
		if lastInfo == nil || err != nil {
			continue
		}
		t.Log(lastInfo.GlobalState.Batch, totalBatches-1)
		if lastInfo.GlobalState.Batch >= totalBatches-1 {
			break
		}
		time.Sleep(time.Millisecond * 200)
	}

	provider := state.NewHistoryCommitmentProvider(
		stateManager,
		stateManager,
		stateManager,
		[]state.Height{
			state.Height(blockChallengeLeafHeight),
			state.Height(bigStepChallengeLeafHeight),
			state.Height(bigStepChallengeLeafHeight),
			state.Height(bigStepChallengeLeafHeight),
			state.Height(smallStepChallengeLeafHeight),
		},
		stateManager,
		containers.None[db.Database](), // Api db
	)

	evilProvider := state.NewHistoryCommitmentProvider(
		stateManagerB,
		stateManagerB,
		stateManagerB,
		[]state.Height{
			state.Height(blockChallengeLeafHeight),
			state.Height(bigStepChallengeLeafHeight),
			state.Height(bigStepChallengeLeafHeight),
			state.Height(bigStepChallengeLeafHeight),
			state.Height(smallStepChallengeLeafHeight),
		},
		stateManagerB,
		containers.None[db.Database](), // Api db
	)

	stackOpts := []challenge.StackOpt{
		challenge.StackWithName("honest"),
		challenge.StackWithMode(modes.MakeMode),
		challenge.StackWithPostingInterval(time.Second * 3),
		challenge.StackWithPollingInterval(time.Second),
		challenge.StackWithMinimumGapToParentAssertion(0),
		challenge.StackWithAverageBlockCreationTime(300 * time.Millisecond),
		challenge.StackWithConfirmationInterval(time.Second),
	}

	manager, err := challenge.NewChallengeStack(
		assertionChain,
		provider,
		stackOpts...,
	)
	Require(t, err)

	evilStackOpts := append(stackOpts, challenge.StackWithName("evil"))

	managerB, err := challenge.NewChallengeStack(
		chainB,
		evilProvider,
		evilStackOpts...,
	)
	Require(t, err)

	managerCtx, cancelManagers := context.WithCancel(ctx)
	defer cancelManagers()
	manager.Start(managerCtx)
	managerB.Start(managerCtx)

	chalManager := assertionChain.SpecChallengeManager()
	filterer, err := challengeV2gen.NewEdgeChallengeManagerFilterer(chalManager.Address(), l1client)
	Require(t, err)

	fromBlock := uint64(0)
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			latestBlock, err := l1client.HeaderByNumber(ctx, nil)
			Require(t, err)
			toBlock := latestBlock.Number.Uint64()
			if fromBlock == toBlock {
				continue
			}
			filterOpts := &bind.FilterOpts{
				Start:   fromBlock,
				End:     &toBlock,
				Context: ctx,
			}
			it, err := filterer.FilterEdgeConfirmedByOneStepProof(filterOpts, nil, nil)
			Require(t, err)
			for it.Next() {
				if it.Error() != nil {
					t.Fatalf("Error in filter iterator: %v", it.Error())
				}
				t.Log("Received event of OSP confirmation!")
				tx, _, err := l1client.TransactionByHash(ctx, it.Event.Raw.TxHash)
				Require(t, err)
				signer := types.NewCancunSigner(tx.ChainId())
				address, err := signer.Sender(tx)
				Require(t, err)
				if address == asserterOpts.From {
					t.Log("Honest party won actual OSP; continuing to assertion confirmation and stake refund")
					Require(t, it.Close())
					gl3BaseFinishLifecycle(t, ctx, l1client, assertionChain, asserterOpts, evilOpts.From, it.Event.Raw.TxHash, func() {
						cancelManagers()
						manager.StopAndWait()
						managerB.StopAndWait()
					})
					return
				}
			}
			fromBlock = toBlock
		case <-ctx.Done():
			t.Fatal("full base challenge deadline", ctx.Err())
		}
	}
}

// gl3BaseFinishLifecycle keeps the authentic challenge managers running after OSP.
// It accepts only a contested honest level-zero block edge and its exact claim.
func gl3BaseFinishLifecycle(t *gotesting.T, ctx context.Context, client *ethclient.Client, chain *sol.AssertionChain, honest *bind.TransactOpts, evil common.Address, ospTx common.Hash, stopManagers func()) {
	t.Helper()
	calls := &bind.CallOpts{Context: ctx}
	assertionBinding, err := challengeV2gen.NewIAssertionChain(chain.RollupAddress(), client)
	Require(t, err)
	permissionless, err := assertionBinding.ValidatorWhitelistDisabled(calls)
	Require(t, err)
	if !permissionless {
		t.Fatal("validator whitelist must be disabled")
	}
	rollup, err := rollupgen.NewRollupUserLogic(chain.RollupAddress(), client)
	Require(t, err)
	fastConfirmer, err := rollup.AnyTrustFastConfirmer(calls)
	Require(t, err)
	if fastConfirmer != (common.Address{}) {
		t.Fatal("fast confirmer must be absent", fastConfirmer)
	}
	ospReceipt, err := client.TransactionReceipt(ctx, ospTx)
	Require(t, err)
	if ospReceipt.Status != types.ReceiptStatusSuccessful {
		t.Fatal("OSP receipt failed")
	}
	edgeBinding, err := challengeV2gen.NewEdgeChallengeManager(chain.SpecChallengeManager().Address(), client)
	Require(t, err)
	var ospEdgeID [32]byte
	for _, entry := range ospReceipt.Logs {
		if entry.Address != chain.SpecChallengeManager().Address() {
			continue
		}
		if ev, parseErr := edgeBinding.ParseEdgeConfirmedByOneStepProof(*entry); parseErr == nil {
			ospEdgeID = ev.EdgeId
		}
	}
	if ospEdgeID == ([32]byte{}) {
		t.Fatal("missing actual OSP edge event")
	}
	var winningID, winningClaim, rivalClaim [32]byte
	var winningEdge challengeV2gen.ChallengeEdge
	deadline := time.NewTicker(time.Second)
	defer deadline.Stop()
	for winningID == ([32]byte{}) {
		select {
		case <-ctx.Done():
			t.Fatal("assertion confirmation deadline", ctx.Err())
		case <-deadline.C:
			events, err := edgeBinding.FilterEdgeAdded(&bind.FilterOpts{Start: 0, Context: ctx}, nil, nil, nil)
			Require(t, err)
			type candidate struct {
				id, mutual [32]byte
				edge       challengeV2gen.ChallengeEdge
				layerZero  bool
			}
			var candidates []candidate
			for events.Next() {
				e := events.Event
				edge, err := edgeBinding.GetEdge(calls, e.EdgeId)
				Require(t, err)
				candidates = append(candidates, candidate{e.EdgeId, e.MutualId, edge, e.IsLayerZero})
			}
			Require(t, events.Error())
			Require(t, events.Close())
			// Bind the leaf OSP to the same block challenge by walking each
			// onchain origin mutual-id through confirmed parent-level edges.
			ancestor, err := edgeBinding.GetEdge(calls, ospEdgeID)
			Require(t, err)
			bound := true
			for ancestor.Level > 0 {
				found := false
				for _, p := range candidates {
					if p.mutual == ancestor.OriginId && p.edge.Level+1 == ancestor.Level && p.edge.Status == 1 {
						ancestor, found = p.edge, true
						break
					}
				}
				if !found {
					bound = false
					break
				}
			}
			if !bound {
				continue
			}
			for _, a := range candidates {
				if a.edge.Level != 0 || !a.layerZero || a.edge.OriginId != ancestor.OriginId || a.edge.Staker != honest.From || a.edge.Status != 1 || a.edge.ClaimId == ([32]byte{}) {
					continue
				}
				for _, b := range candidates {
					if a.mutual != b.mutual || a.id == b.id || b.edge.Staker != evil || a.edge.ClaimId == b.edge.ClaimId {
						continue
					}
					status, err := chain.AssertionStatus(ctx, protocol.AssertionHash{Hash: a.edge.ClaimId})
					Require(t, err)
					if status != protocol.AssertionConfirmed {
						continue
					}
					badStatus, err := chain.AssertionStatus(ctx, protocol.AssertionHash{Hash: b.edge.ClaimId})
					Require(t, err)
					if badStatus == protocol.AssertionConfirmed {
						t.Fatal("rival assertion confirmed")
					}
					info, err := chain.ReadAssertionCreationInfo(ctx, protocol.AssertionHash{Hash: a.edge.ClaimId})
					Require(t, err)
					if common.Hash(info.WasmModuleRoot) != gl3BaseOfficialRoot {
						t.Fatal("assertion used nonofficial root", common.Hash(info.WasmModuleRoot))
					}
					winningID, winningClaim, rivalClaim, winningEdge = a.id, a.edge.ClaimId, b.edge.ClaimId, a.edge
					break
				}
				if winningID != ([32]byte{}) {
					break
				}
			}
		}
	}
	stopManagers()
	// Wait for already submitted honest transactions before measuring an exact refund.
	for {
		pending, err := client.PendingNonceAt(ctx, honest.From)
		Require(t, err)
		mined, err := client.NonceAt(ctx, honest.From, nil)
		Require(t, err)
		if pending == mined {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("pending transaction drain deadline", ctx.Err())
		case <-deadline.C:
		}
	}
	if winningEdge.Refunded {
		t.Fatal("refund unexpectedly already occurred before test")
	}
	stakeToken, err := edgeBinding.StakeToken(calls)
	Require(t, err)
	if stakeToken == (common.Address{}) {
		t.Fatal("nonzero real ERC20 stake token required")
	}
	amount, err := edgeBinding.StakeAmounts(calls, big.NewInt(0))
	Require(t, err)
	if amount.Sign() <= 0 {
		t.Fatal("nonzero edge stake required")
	}
	erc20, err := abi.JSON(strings.NewReader(`[{"type":"function","name":"balanceOf","inputs":[{"type":"address","name":"owner"}],"outputs":[{"type":"uint256","name":"balance"}],"stateMutability":"view"}]`))
	Require(t, err)
	readBalance := func() *big.Int {
		data, err := erc20.Pack("balanceOf", honest.From)
		Require(t, err)
		result, err := client.CallContract(ctx, ethereum.CallMsg{To: &stakeToken, Data: data}, nil)
		Require(t, err)
		if len(result) != 32 {
			t.Fatal("malformed ERC20 balance result", len(result))
		}
		return new(big.Int).SetBytes(result)
	}
	before := readBalance()
	tx, err := edgeBinding.RefundStake(honest, winningID)
	Require(t, err)
	receipt, err := EnsureTxSucceeded(ctx, client, tx)
	Require(t, err)
	after := readBalance()
	if new(big.Int).Sub(after, before).Cmp(amount) != 0 {
		t.Fatal("incorrect exact edge stake refund", before, after, amount)
	}
	refunded, err := edgeBinding.GetEdge(calls, winningID)
	Require(t, err)
	if !refunded.Refunded {
		t.Fatal("edge not marked refunded")
	}
	eventMatched := false
	for _, entry := range receipt.Logs {
		if entry.Address != chain.SpecChallengeManager().Address() {
			continue
		}
		ev, parseErr := edgeBinding.ParseEdgeRefunded(*entry)
		if parseErr == nil && ev.EdgeId == winningID && ev.StakeToken == stakeToken && ev.StakeAmount.Cmp(amount) == 0 {
			eventMatched = true
		}
	}
	if !eventMatched {
		t.Fatal("missing exact EdgeRefunded event")
	}
	replayOpts := *honest
	replayOpts.GasLimit = 1_000_000 // submit the replay so its reverted receipt is checked.
	replay, err := edgeBinding.RefundStake(&replayOpts, winningID)
	Require(t, err)
	replayReceipt, err := WaitForTx(ctx, client, replay.Hash(), time.Minute)
	Require(t, err)
	if replayReceipt.Status != types.ReceiptStatusFailed {
		t.Fatal("replayed refund did not revert")
	}
	if readBalance().Cmp(after) != 0 {
		t.Fatal("replayed refund changed token balance")
	}
	report := map[string]interface{}{"passed": true, "baseOnly": true, "customSTF": false, "chess": false, "NNUE": false, "officialModuleRoot": gl3BaseOfficialRoot.Hex(), "ArbOSVersion": 61, "debugPrecompiles": false, "validatorWhitelistDisabled": permissionless, "realBridge": true, "realOneStepProver": true, "fastConfirmationEnabled": false, "parentMiningIntervalMs": 300, "fullChallenge": true, "OSPTransaction": ospTx.Hex(), "honest": honest.From.Hex(), "evil": evil.Hex(), "winningEdge": common.Hash(winningID).Hex(), "honestAssertion": common.Hash(winningClaim).Hex(), "rivalAssertion": common.Hash(rivalClaim).Hex(), "honestAssertionConfirmed": true, "rivalAssertionConfirmed": false, "stakeToken": stakeToken.Hex(), "refundedAmount": amount.String(), "balanceBeforeRefund": before.String(), "balanceAfterRefund": after.String(), "refundTransaction": tx.Hash().Hex(), "refundReceiptStatus": receipt.Status, "refundReplayTransaction": replay.Hash().Hex(), "refundReplayReceiptStatus": replayReceipt.Status, "refundReplayTokenBalanceUnchanged": true, "publicDeployment": false, "realChainSpend": 0}
	encoded, err := json.MarshalIndent(report, "", "  ")
	Require(t, err)
	if dest := os.Getenv("GL3_BASE_BOLD_REPORT"); dest != "" {
		Require(t, os.WriteFile(dest, append(encoded, '\n'), 0600))
	}
	t.Logf("GL3_BASE_FULL_LIFECYCLE %s", encoded)
}
