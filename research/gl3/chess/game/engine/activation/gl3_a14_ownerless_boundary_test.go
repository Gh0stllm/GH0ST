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
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/core/vm"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/params"
	arbosutil "github.com/offchainlabs/nitro/arbos/util"
	"github.com/offchainlabs/nitro/arbutil"
	"github.com/offchainlabs/nitro/precompiles"
	"github.com/offchainlabs/nitro/solgen/go/bridgegen"
	"github.com/offchainlabs/nitro/solgen/go/precompilesgen"
	"github.com/offchainlabs/nitro/validator/server_api"
	"github.com/offchainlabs/nitro/validator/valnode"
)

// This runs a locally deployed L1 and a scratch ArbOS 61 chain. Its deterministic
// test keys never access production. The proof stage runs the captured inputs
// separately against the candidate machine.
// Patch only the scratch geth developer genesis command. The forwarding contract's
// code copies the arguments after the first ABI word and calls the address in
// that word, reverting if the inner call fails.
func installPrivateA14Executor(t *testing.T, address common.Address) {
	t.Helper()
	real, err := filepath.Abs(os.Getenv("NITRO_TEST_L1_GETH"))
	Require(t, err)
	realJSON, err := json.Marshal(real)
	Require(t, err)
	addrJSON, err := json.Marshal(address.Hex())
	Require(t, err)
	path := filepath.Join(t.TempDir(), "geth-a14-fixture")
	const runtime = "0x6020360360205f375f5f602036035f345f355af115601957005b5f5ffd"
	script := "#!/usr/bin/env python3\nimport json, os, subprocess, sys\n" +
		"real = " + string(realJSON) + "\naddress = " + string(addrJSON) + "\n" +
		"args = sys.argv[1:]\n" +
		"if args != ['--dev', 'dumpgenesis']:\n    os.execv(real, [real] + args)\n" +
		"genesis = json.loads(subprocess.check_output([real] + args))\n" +
		"assert genesis['config']['chainId'] == 1337\n" +
		"assert all(key.lower().removeprefix('0x') != address.lower().removeprefix('0x') for key in genesis['alloc'])\n" +
		"genesis['alloc'][address] = {'balance': '0x0', 'code': '" + runtime + "'}\n" +
		"print(json.dumps(genesis))\n"
	Require(t, os.WriteFile(path, []byte(script), 0700))
	t.Setenv("NITRO_TEST_L1_GETH", path)
}

func TestGL3A14OwnerlessBoundary(t *testing.T) {
	const chainID int64 = 4663001
	output := os.Getenv("GL3_A14_OWNERLESS_BOUNDARY_OUT")
	machines := os.Getenv("GL3_A14_OWNERLESS_WASM_ROOT")
	if output == "" || machines == "" || os.Getenv("NITRO_TEST_L1_GETH") == "" {
		t.Fatal("explicit fresh output, candidate machine root directory, and private test L1 geth binary required")
	}
	Require(t, os.Mkdir(output, 0700))
	moduleRoot, err := os.ReadFile(filepath.Join(machines, "latest", "module-root.txt"))
	Require(t, err)

	executor := common.HexToAddress("0xA632B4c45726C779086F60d8b09BEE7b09bA2541")
	installPrivateA14Executor(t, executor)
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
	builder.chainConfig.ArbitrumChainParams.InitialChainOwner = common.Address{}
	builder.RequireScheme(t, rawdb.HashScheme)
	builder.execConfig.Sequencer.MaxBlockSpeed = 100 * time.Millisecond
	builder.nodeConfig.BlockValidator.Enable = false
	builder.nodeConfig.Staker.Enable = false
	builder.nodeConfig.BatchPoster.Enable = true
	builder.nodeConfig.DelayedSequencer.Enable = true
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

	ownerPublic, err := precompilesgen.NewArbOwnerPublic(types.ArbOwnerPublicAddress, client)
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
	assertOwners := func(height *big.Int) {
		t.Helper()
		owners, err := ownerPublic.GetAllChainOwners(&bind.CallOpts{Context: ctx, BlockNumber: height})
		Require(t, err)
		if len(owners) != 1 || owners[0] != (common.Address{}) {
			t.Fatalf("expected only the inert zero L2 owner: %v", owners)
		}
	}
	assertOwners(nil)
	inboxAddress := builder.L1Info.GetAddress("Inbox")
	inbox, err := bridgegen.NewInbox(inboxAddress, builder.L1.Client)
	Require(t, err)
	inboxABI, err := bridgegen.InboxMetaData.GetAbi()
	Require(t, err)
	bridge, err := bridgegen.NewBridge(builder.addresses.Bridge, builder.L1.Client)
	Require(t, err)
	bridgeABI, err := bridgegen.BridgeMetaData.GetAbi()
	Require(t, err)
	activation := append([]byte{3}, bytes.Repeat([]byte{0, 0, 0, 0, 0, 0, 0, 1, 3}, 7)...)
	readMessage := func(receipt *types.Receipt) *bridgegen.BridgeMessageDelivered {
		t.Helper()
		for _, log := range receipt.Logs {
			if log.Address != builder.addresses.Bridge || len(log.Topics) == 0 ||
				log.Topics[0] != bridgeABI.Events["MessageDelivered"].ID {
				continue
			}
			delivered, err := bridge.ParseMessageDelivered(*log)
			Require(t, err)
			if delivered.Kind != 3 || delivered.MessageDataHash != crypto.Keccak256Hash(activation) {
				t.Fatalf("unexpected delivered message: kind=%d hash=%x", delivered.Kind, delivered.MessageDataHash)
			}
			return delivered
		}
		t.Fatal("missing canonical Bridge.MessageDelivered log")
		return nil
	}
	waitChild := func(afterHeight uint64, index uint64) *big.Int {
		t.Helper()
		AdvanceL1(t, ctx, builder.L1.Client, builder.L1Info, 30)
		for height := afterHeight + 1; ; height++ {
			for {
				current, err := client.BlockNumber(ctx)
				Require(t, err)
				if current >= height {
					break
				}
				select {
				case <-ctx.Done():
					t.Fatal(ctx.Err())
				case <-time.After(100 * time.Millisecond):
				}
			}
			number := new(big.Int).SetUint64(height)
			header, err := client.HeaderByNumber(ctx, number)
			Require(t, err)
			if header.Nonce.Uint64() > index {
				return number
			}
		}
	}

	tip, err := client.BlockNumber(ctx)
	Require(t, err)
	unrelated := builder.L1Info.GetDefaultTransactOpts("User", ctx)
	foreignTx, err := inbox.SendL2Message(&unrelated, activation)
	Require(t, err)
	foreignReceipt, err := EnsureTxSucceeded(ctx, builder.L1.Client, foreignTx)
	Require(t, err)
	foreign := readMessage(foreignReceipt)
	expectedAlias := arbosutil.RemapL1Address(executor)
	if expectedAlias != common.HexToAddress("0xb743b4c45726c779086f60d8b09bee7b09ba3652") || foreign.Sender == expectedAlias {
		t.Fatal("invalid foreign/authorized alias setup")
	}
	foreignChild := waitChild(tip, foreign.MessageIndex.Uint64())
	if arbOS(foreignChild) != params.ArbosVersion_61 {
		t.Fatal("an unrelated parent caller triggered activation")
	}

	tip, err = client.BlockNumber(ctx)
	Require(t, err)
	calldata, err := inboxABI.Pack("sendL2Message", activation)
	Require(t, err)
	forward := append(common.LeftPadBytes(inboxAddress.Bytes(), 32), calldata...)
	parentTx := builder.L1Info.PrepareTxTo("User", &executor, 1_000_000, new(big.Int), forward)
	Require(t, builder.L1.Client.SendTransaction(ctx, parentTx))
	parentReceipt, err := EnsureTxSucceeded(ctx, builder.L1.Client, parentTx)
	Require(t, err)
	delivered := readMessage(parentReceipt)
	if delivered.Sender != expectedAlias {
		t.Fatalf("inbox did not emit the expected contract alias: %s", delivered.Sender)
	}
	after := waitChild(tip, delivered.MessageIndex.Uint64())
	before := new(big.Int).Sub(after, big.NewInt(1))
	if arbOS(before) != params.ArbosVersion_61 || arbOS(after) != params.ArbosVersion_GL3A14 {
		t.Fatal("canonical parent delayed message did not activate A14 on the exact child block")
	}
	assertOwners(after)

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
		if label == "after" && (!input.HasDelayedMsg || input.DelayedMsgNr != delivered.MessageIndex.Uint64() || input.DelayedMsgB64 == "") {
			t.Fatal("activation input does not bind the canonical delayed message")
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
		"scope":      "isolated parent-authorized A14 activation with a zero child owner",
		"moduleRoot": strings.TrimSpace(string(moduleRoot)), "nativeCapturePassed": true,
		"parentChainId": l1, "chainId": l2, "activationL1Transaction": parentReceipt.TxHash,
		"activationL1MessageIndex": delivered.MessageIndex, "activationL1Sender": delivered.Sender,
		"foreignL1Transaction": foreignReceipt.TxHash, "foreignL1Sender": foreign.Sender,
		"foreignChildBlock": foreignChild.Uint64(), "foreignActivationRejected": true,
		"childOwner":    common.Address{},
		"preActivation": preActivation, "postActivation": postActivation,
		"preActivationA14Code": hexutil.Encode(beforeCode), "preActivationA14Status": hexutil.Encode(beforeStatus),
		"postActivationA14Code": hexutil.Encode(afterCode), "postActivationA14Status": hexutil.Encode(afterStatus),
		"seedMigrationExecuted": false, "proofReplayVerified": false, "productionActivation": false,
	}
	encoded, err := json.MarshalIndent(report, "", "  ")
	Require(t, err)
	Require(t, os.WriteFile(filepath.Join(output, "boundary.json"), append(encoded, '\n'), 0600))
}
