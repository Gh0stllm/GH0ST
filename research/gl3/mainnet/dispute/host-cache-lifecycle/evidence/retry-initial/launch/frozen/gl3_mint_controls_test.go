//go:build gl3_acceptance

// SPDX-License-Identifier: GPL-3.0-or-later
package arbtest

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/params"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/offchainlabs/nitro/solgen/go/precompilesgen"
)

const gl3AccessControlExecutionReason = "unauthorized caller to access-controlled method"

// A network, cancellation or generic RPC error is never evidence of a revert.
// The one non-code3 case is the pinned native precompile wrapper's exact access
// failure, accepted only for the explicitly unauthorized access-control case.
func gl3ClassifyExecutionRejection(err error, allowAccessControl bool) (map[string]any, error) {
	if err == nil || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return nil, fmt.Errorf("missing execution rejection or canceled request: %v", err)
	}
	var transport net.Error
	if errors.As(err, &transport) {
		return nil, fmt.Errorf("transport error is not a revert: %w", err)
	}
	var rpcErr rpc.Error
	if !errors.As(err, &rpcErr) {
		return nil, fmt.Errorf("unclassified non-RPC failure: %w", err)
	}
	row := map[string]any{"rpcErrorCode": rpcErr.ErrorCode(), "message": err.Error()}
	var dataErr rpc.DataError
	if errors.As(err, &dataErr) {
		row["errorData"] = dataErr.ErrorData()
	}
	if rpcErr.ErrorCode() == 3 && strings.HasPrefix(err.Error(), "execution reverted") {
		if dataErr == nil {
			return nil, fmt.Errorf("execution RPC error has no authenticated error-data shape: %w", err)
		}
		data, ok := dataErr.ErrorData().(string)
		if !ok || !strings.HasPrefix(data, "0x") {
			return nil, fmt.Errorf("invalid revert payload: %w", err)
		}
		payload, e := hex.DecodeString(data[2:])
		if e != nil {
			return nil, fmt.Errorf("malformed revert bytes: %w", e)
		}
		row["class"] = "evm_execution_revert"
		row["revertPayload"] = data
		if reason, e := abi.UnpackRevert(payload); e == nil {
			row["decodedReason"] = reason
		} else {
			row["decodedReason"] = nil
		}
		return row, nil
	}
	if allowAccessControl && rpcErr.ErrorCode() == -32000 && err.Error() == gl3AccessControlExecutionReason {
		row["class"] = "pinned_precompile_access_control_execution_error"
		row["decodedReason"] = gl3AccessControlExecutionReason
		row["source"] = "precompiles/wrapper.go access-controlled precompile call"
		return row, nil
	}
	return nil, fmt.Errorf("RPC failure is not a recognized execution rejection: %w", err)
}

type gl3ClassifierRPCError struct {
	code int
	msg  string
	data any
}

func (e gl3ClassifierRPCError) Error() string  { return e.msg }
func (e gl3ClassifierRPCError) ErrorCode() int { return e.code }
func (e gl3ClassifierRPCError) ErrorData() any { return e.data }

func TestGL3RejectionClassifierRejectsInfrastructureErrors(t *testing.T) {
	for _, e := range []error{nil, context.Canceled, context.DeadlineExceeded, errors.New("connection reset by peer"), &net.DNSError{Err: "timeout", IsTimeout: true}, gl3ClassifierRPCError{-32603, "internal error", "0x"}, gl3ClassifierRPCError{-32000, "request timed out", "0x"}, gl3ClassifierRPCError{3, "execution reverted", "not-hex"}, gl3ClassifierRPCError{3, "internal failure", "0x"}} {
		if _, rejected := gl3ClassifyExecutionRejection(e, true); rejected == nil {
			t.Fatalf("infrastructure/malformed failure accepted as execution rejection: %#v", e)
		}
	}
	if _, e := gl3ClassifyExecutionRejection(gl3ClassifierRPCError{-32000, gl3AccessControlExecutionReason, nil}, false); e == nil {
		t.Fatal("access-control exception accepted for a case that did not opt in")
	}
}

func TestGL3NativeMintControlsStrictBeforeAfterRestart(t *testing.T) {
	out := os.Getenv("GL3_MINT_CONTROL_EVIDENCE")
	if out == "" {
		t.Fatal("explicit evidence directory required")
	}
	Require(t, os.MkdirAll(out, 0700))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	b := NewNodeBuilder(ctx).DefaultConfig(t, false).DontParalellise().WithArbOSVersion(61).WithDatabase(rawdb.DBPebble).WithArbOSInit(&params.ArbOSInit{NativeTokenSupplyManagementEnabled: false})
	b.RequireScheme(t, rawdb.HashScheme)
	b.WithWasmRootDir(os.Getenv("GL3_SLICES_WASM_ROOT"))
	b.takeOwnership = false
	b.chainConfig.ArbitrumChainParams.AllowDebugPrecompiles = false
	b.chainConfig.ArbitrumChainParams.InitialChainOwner = b.L2Info.GetAddress("Owner")
	for i := range b.L2Info.ArbInitData.Accounts {
		if b.L2Info.ArbInitData.Accounts[i].Addr == b.L2Info.GetAddress("Owner") {
			b.L2Info.ArbInitData.Accounts[i].EthBalance = new(big.Int).Exp(big.NewInt(10), big.NewInt(21), nil)
		}
	}
	cleanup := b.Build(t)
	defer cleanup()
	ownerABI, e := precompilesgen.ArbOwnerMetaData.GetAbi()
	Require(t, e)
	mintABI, e := precompilesgen.ArbNativeTokenManagerMetaData.GetAbi()
	Require(t, e)
	records := []map[string]any{}
	check := func(phase string) {
		t.Helper()
		public, e := precompilesgen.NewArbOwnerPublic(types.ArbOwnerPublicAddress, b.L2.Client)
		Require(t, e)
		enabled, e := public.GetNativeTokenManagementFrom(&bind.CallOpts{Context: ctx})
		Require(t, e)
		owners, e := public.GetAllNativeTokenOwners(&bind.CallOpts{Context: ctx})
		Require(t, e)
		if enabled != 0 || len(owners) != 0 {
			t.Fatal("disabled native-management invariant changed", enabled, owners)
		}
		head, e := b.L2.Client.HeaderByNumber(ctx, nil)
		Require(t, e)
		from := b.L2Info.GetAddress("Owner")
		unauthorized := b.L2Info.GetAddress("Faucet")
		mint, e := mintABI.Pack("mintNativeToken", big.NewInt(1))
		Require(t, e)
		add, e := ownerABI.Pack("addNativeTokenOwner", from)
		Require(t, e)
		now := head.Time
		if now == 0 {
			now = 1
		}
		immediate, e := ownerABI.Pack("setNativeTokenManagementFrom", now)
		Require(t, e)
		future, e := ownerABI.Pack("setNativeTokenManagementFrom", now+8*24*60*60)
		Require(t, e)
		for _, tc := range []struct {
			name     string
			from, to common.Address
			data     []byte
			access   bool
		}{
			{"owner_mint_disabled", from, types.ArbNativeTokenManagerAddress, mint, false},
			{"unauthorized_mint_disabled", unauthorized, types.ArbNativeTokenManagerAddress, mint, false},
			{"owner_cannot_add_minter_while_disabled", from, types.ArbOwnerAddress, add, false},
			{"owner_cannot_enable_without_delay", from, types.ArbOwnerAddress, immediate, false},
			{"unauthorized_cannot_schedule_enable", unauthorized, types.ArbOwnerAddress, future, true},
		} {
			_, callErr := b.L2.Client.CallContract(ctx, ethereum.CallMsg{From: tc.from, To: &tc.to, Gas: 30_000_000, Data: tc.data}, nil)
			row, classErr := gl3ClassifyExecutionRejection(callErr, tc.access)
			if classErr != nil {
				t.Fatalf("%s %s: %v", phase, tc.name, classErr)
			}
			row["phase"] = phase
			row["case"] = tc.name
			row["selector"] = "0x" + hex.EncodeToString(tc.data[:4])
			row["from"] = tc.from
			row["to"] = tc.to
			records = append(records, row)
		}
		// Positive capability check: an owner can schedule later activation. It
		// is simulated only; verify no setting or balance is persisted by eth_call.
		_, e = b.L2.Client.CallContract(ctx, ethereum.CallMsg{From: from, To: &types.ArbOwnerAddress, Gas: 30_000_000, Data: future}, nil)
		Require(t, e, "owner delayed activation simulation")
		after, e := public.GetNativeTokenManagementFrom(&bind.CallOpts{Context: ctx})
		Require(t, e)
		if after != 0 {
			t.Fatal("simulated scheduling persisted state")
		}
	}
	start := time.Now()
	check("before_restart")
	head, e := b.L2.Client.HeaderByNumber(ctx, nil)
	Require(t, e)
	b.StopL2ForRestart(ctx)
	b.L2.cleanup = func() {}
	b.RestartL2Node(t)
	reopened, e := b.L2.Client.HeaderByNumber(ctx, nil)
	Require(t, e)
	if head.Hash() != reopened.Hash() || head.Root != reopened.Root {
		t.Fatal("persisted head/root changed")
	}
	check("after_restart")
	report := map[string]any{"passed": true, "scope": "short actual native ArbOS61 disabled-management execution-rejection regression before/after graceful same-process node restart; no chess search, GH0ST escrow or mainnet call", "records": records, "nativeManagementDisabled": true, "nativeMintOwnersEmpty": true, "ownerDelayedActivationSimulationAllowed": true, "simulationStateNotPersisted": true, "sameHeadAndRootAfterRestart": true, "fixtureSeconds": time.Since(start).Seconds(), "olderBroadErrorAssertionNotRetroactivelyStrengthened": true, "publicDeployment": false, "realChainSpend": 0}
	encoded, e := json.MarshalIndent(report, "", "  ")
	Require(t, e)
	Require(t, os.WriteFile(filepath.Join(out, "native-mint-controls-strict.json"), append(encoded, '\n'), 0600))
	t.Log(string(encoded))
}
