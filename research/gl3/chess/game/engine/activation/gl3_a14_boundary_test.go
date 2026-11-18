package arbtest

import (
	"bytes"
	"context"
	"encoding/json"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	sliced "github.com/Gh0stllm/GH0ST/gl3/slicedchess"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/core/vm"
	"github.com/ethereum/go-ethereum/params"
	"github.com/offchainlabs/nitro/arbutil"
	"github.com/offchainlabs/nitro/precompiles"
	"github.com/offchainlabs/nitro/solgen/go/precompilesgen"
	"github.com/offchainlabs/nitro/validator/server_api"
	"github.com/offchainlabs/nitro/validator/valnode"
)

// This runs a locally deployed L1 and a scratch ArbOS 61 chain. Its deterministic
// test keys never access production. The proof stage runs the captured inputs
// separately against the candidate machine.
func TestGL3A14ActivationBoundary(t *testing.T) {
	const chainID int64 = 4663001
	output := os.Getenv("GL3_A14_BOUNDARY_OUT")
	machines := os.Getenv("GL3_A14_WASM_ROOT")
	if output == "" || machines == "" || os.Getenv("NITRO_TEST_L1_GETH") == "" {
		t.Fatal("explicit fresh output, candidate machine root directory, and private test L1 geth binary required")
	}
	Require(t, os.Mkdir(output, 0700))
	moduleRoot, err := os.ReadFile(filepath.Join(machines, "latest", "module-root.txt"))
	Require(t, err)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	builder := NewNodeBuilder(ctx).DefaultConfig(t, true).WithPreBoldDeployment()
	builder.DontParalellise().WithArbOSVersion(params.ArbosVersion_61).
		WithLegacyBlockRecorder().WithWasmRootDir(machines)
	builder.chainConfig.ChainID = big.NewInt(chainID)
	builder.L2Info = NewArbTestInfo(t, builder.chainConfig.ChainID)
	// The generic accounts start near the uint256 limit. Use artificial balances
	// with headroom for the owner's fee receipts.
	for i := range builder.L2Info.ArbInitData.Accounts {
		builder.L2Info.ArbInitData.Accounts[i].EthBalance = new(big.Int).Exp(big.NewInt(10), big.NewInt(21), nil)
	}
	builder.takeOwnership = false
	builder.chainConfig.ArbitrumChainParams.AllowDebugPrecompiles = false
	builder.chainConfig.ArbitrumChainParams.InitialChainOwner = builder.L2Info.GetAddress("Owner")
	builder.RequireScheme(t, rawdb.HashScheme)
	builder.execConfig.Sequencer.MaxBlockSpeed = 100 * time.Millisecond
	builder.nodeConfig.BlockValidator.Enable = false
	builder.nodeConfig.Staker.Enable = false
	builder.nodeConfig.BatchPoster.Enable = true
	builder.nodeConfig.ParentChainReader.Enable = true

	validation := valnode.TestValidationConfig
	validation.UseJit = false
	validation.Wasm.RootPath = machines
	_, validationStack := createTestValidationNode(t, ctx, &validation)
	configByValidationNode(builder.nodeConfig, validationStack)
	cleanup := builder.Build(t)
	defer cleanup()
	client := builder.L2.Client
	l1, err := builder.L1.Client.ChainID(ctx)
	Require(t, err)
	l2, err := client.ChainID(ctx)
	Require(t, err)
	if !l1.IsInt64() || l1.Int64() != 1337 || !l2.IsInt64() || l2.Int64() != chainID {
		t.Fatalf("unexpected private chain IDs: parent=%s child=%s", l1, l2)
	}

	owner, err := precompilesgen.NewArbOwner(types.ArbOwnerAddress, client)
	Require(t, err)
	system, err := precompilesgen.NewArbSys(types.ArbSysAddress, client)
	Require(t, err)
	arbOS := func(height *big.Int) uint64 {
		t.Helper()
		version, err := system.ArbOSVersion(&bind.CallOpts{Context: ctx, BlockNumber: height})
		Require(t, err)
		// ArbSys adds 55 to Nitro's internal format version.
		if !version.IsUint64() || version.Uint64() < 55 {
			t.Fatalf("invalid ArbSys version %s", version)
		}
		return version.Uint64() - 55
	}

	contract, err := abi.JSON(strings.NewReader(precompiles.GhostChessSlicesABI))
	Require(t, err)
	statusCall, err := contract.Pack("engineStatus")
	Require(t, err)
	address := params.GL3A14Address()
	from := builder.L2Info.GetAddress("Owner")
	probe := func(height *big.Int) (code, response []byte) {
		t.Helper()
		code, err := client.CodeAt(ctx, address, height)
		Require(t, err)
		response, err = client.CallContract(ctx, ethereum.CallMsg{
			From: from, To: &address, Data: statusCall, Gas: 1_000_000,
		}, height)
		Require(t, err)
		return code, response
	}
	postProbe := func() *types.Receipt {
		t.Helper()
		tx := builder.L2Info.PrepareTxTo("Owner", &address, 1_000_000, new(big.Int), statusCall)
		Require(t, client.SendTransaction(ctx, tx))
		receipt, err := EnsureTxSucceeded(ctx, client, tx)
		Require(t, err)
		return receipt
	}

	firstProbe := postProbe()
	if arbOS(firstProbe.BlockNumber) != params.ArbosVersion_61 {
		t.Fatal("pre-upgrade probe did not execute on ArbOS 61")
	}
	auth := builder.L2Info.GetDefaultTransactOpts("Owner", ctx)
	auth.GasLimit = 1_000_000
	schedule, err := owner.ScheduleArbOSUpgrade(&auth, params.ArbosVersion_GL3A14, 0)
	Require(t, err)
	scheduled, err := EnsureTxSucceeded(ctx, client, schedule)
	Require(t, err)
	secondProbe := postProbe()
	if arbOS(scheduled.BlockNumber) != params.ArbosVersion_61 ||
		arbOS(secondProbe.BlockNumber) != params.ArbosVersion_GL3A14 {
		t.Fatal("the private scheduling and activation receipts straddle the wrong versions")
	}
	firstActivated := scheduled.BlockNumber.Uint64() + 1
	for firstActivated < secondProbe.BlockNumber.Uint64() &&
		arbOS(new(big.Int).SetUint64(firstActivated)) == params.ArbosVersion_61 {
		firstActivated++
	}
	before := new(big.Int).SetUint64(firstActivated - 1)
	after := new(big.Int).SetUint64(firstActivated)
	if arbOS(before) != params.ArbosVersion_61 || arbOS(after) != params.ArbosVersion_GL3A14 {
		t.Fatal("could not identify adjacent ArbOS 61 and A14 blocks")
	}
	beforeCode, beforeStatus := probe(before)
	if len(beforeCode) != 0 || len(beforeStatus) != 0 {
		t.Fatal("A14 exists before the scheduled fork")
	}
	afterCode, afterStatus := probe(after)
	if !bytes.Equal(afterCode, []byte{byte(vm.INVALID)}) {
		t.Fatalf("unexpected A14 account marker: %x", afterCode)
	}
	status, err := contract.Unpack("engineStatus", afterStatus)
	Require(t, err)
	if len(status) != 3 || status[0] != sliced.ModuleSHA || status[1] != ([32]byte{}) || status[2] != false {
		t.Fatalf("unexpected status of the newly activated, unseeded engine: %v", status)
	}

	record := func(label string, height *big.Int) map[string]any {
		t.Helper()
		header, err := client.HeaderByNumber(ctx, height)
		Require(t, err)
		position, err := arbutil.BlockNumberToMessageIndex(height.Uint64(), builder.chainConfig.ArbitrumChainParams.GenesisBlockNum)
		Require(t, err)
		waitForBatchContainingMessage(t, builder.L2.ConsensusNode, position, 45*time.Second, 250*time.Millisecond)
		var input server_api.InputJSON
		retryUntilFound(t, ctx, 100, 250*time.Millisecond, "A14 boundary ValidationInputsAt", "batch not found", func() error {
			var err error
			input, err = builder.L2.ConsensusNode.StatelessBlockValidator.ValidationInputsAt(ctx, position, rawdb.LocalTarget(), rawdb.TargetWasm)
			return err
		})
		if input.ExpectedEndState == nil || input.ExpectedEndState.BlockHash != header.Hash() {
			t.Fatal("recorder expected block does not match the private chain")
		}
		encoded, err := input.Marshal()
		Require(t, err)
		name := "input-" + label + ".json"
		Require(t, os.WriteFile(filepath.Join(output, name), encoded, 0600))
		return map[string]any{
			"block": height.Uint64(), "arbOS": arbOS(height), "blockHash": header.Hash(),
			"stateRoot": header.Root, "parentHash": header.ParentHash, "input": name,
			"expectedEndState": input.ExpectedEndState,
		}
	}
	preActivation := record("before", before)
	postActivation := record("after", after)
	if preActivation["blockHash"] != postActivation["parentHash"] {
		t.Fatal("recorded boundary blocks are not consecutive")
	}
	report := map[string]any{
		"scope":      "isolated A14 activation on a private L1 and GL3-ID scratch chain",
		"moduleRoot": strings.TrimSpace(string(moduleRoot)), "nativeCapturePassed": true,
		"parentChainId": l1, "chainId": l2, "scheduleTransaction": scheduled.TxHash,
		"preActivation": preActivation, "postActivation": postActivation,
		"preActivationA14Code": hexutil.Encode(beforeCode), "preActivationA14Status": hexutil.Encode(beforeStatus),
		"postActivationA14Code": hexutil.Encode(afterCode), "postActivationA14Status": hexutil.Encode(afterStatus),
		"seedMigrationExecuted": false, "proofReplayVerified": false, "productionActivation": false,
	}
	encoded, err := json.MarshalIndent(report, "", "  ")
	Require(t, err)
	Require(t, os.WriteFile(filepath.Join(output, "boundary.json"), append(encoded, '\n'), 0600))
}
