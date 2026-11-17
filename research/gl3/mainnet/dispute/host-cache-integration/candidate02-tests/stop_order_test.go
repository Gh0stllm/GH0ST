package valnode

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/offchainlabs/nitro/util/containers"
	"github.com/offchainlabs/nitro/util/rpcclient"
	"github.com/offchainlabs/nitro/validator"
	"github.com/offchainlabs/nitro/validator/client"
	"github.com/offchainlabs/nitro/validator/server_api"
)

// Exercise the actual source shutdown order: the transport is gone before the
// retained BOLD pool invokes Close. Server idle cleanup, not an invented remote
// acknowledgment, owns the remaining registered ID.
func TestGL3IntegrationActualRPCSpawnerStopBeforePoolIdleFallback(t *testing.T) {
	run := &gl3ServerRun{}
	spawner := &gl3ServerSpawner{factory: func(int64) containers.PromiseInterface[validator.ExecutionRun] {
		return containers.NewReadyPromise[validator.ExecutionRun](run, nil)
	}}
	server := gl3ExecServer(t, spawner, 500*time.Millisecond)
	rpcServer := rpc.NewServer()
	if err := rpcServer.RegisterName(server_api.Namespace, NewExecServerAPI(spawner, server)); err != nil {
		t.Fatal(err)
	}
	defer rpcServer.Stop()
	http := httptest.NewServer(rpcServer)
	defer http.Close()
	config := rpcclient.DefaultClientConfig
	config.URL = http.URL
	config.Timeout = 3 * time.Second
	config.Retries = 0
	remote := client.NewExecutionClient(func() *rpcclient.ClientConfig { return &config }, nil)
	if err := remote.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer remote.Stop()
	bold := client.NewBOLDExecutionClient(remote)
	if err := bold.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := bold.EnableExperimentalRunCache(client.ExperimentalRunCacheConfig{MaxEntries: 1, IdleTimeout: time.Hour}); err != nil {
		t.Fatal(err)
	}
	defer bold.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, err := bold.GetProofAt(ctx, common.Hash{9}, &validator.ValidationInput{Id: 111}, 3); err != nil {
		t.Fatal(err)
	}
	remote.Stop()
	bold.Stop()
	before := server.ExperimentalCreationStats()
	if before.Charged != 1 || before.Registered != 1 || run.closeCalls.Load() != 0 {
		t.Fatal("test did not observe remaining server ownership after transport-first shutdown", before, run.closeCalls.Load())
	}
	started := time.Now()
	gl3Await(t, "registered ID not reclaimed by server idle fallback", func() bool { return server.ExperimentalCreationStats().Charged == 0 && run.closeCalls.Load() == 1 })
	if out := os.Getenv("GL3_INTEGRATION_EVIDENCE"); out != "" {
		data, _ := json.MarshalIndent(map[string]any{"passed": true, "scope": "actual transport-first client shutdown, bounded engine-run double", "configuredServerTTLMilliseconds": 500, "registeredIDRemainedAfterRPCStop": true, "beforeServerExpiry": before, "afterServerExpiry": server.ExperimentalCreationStats(), "actualUnderlyingCloseInvocations": run.closeCalls.Load(), "fallbackWaitSeconds": time.Since(started).Seconds(), "remoteCloseAcknowledgmentClaimed": false, "engineExecuted": false}, "", "  ")
		if err := os.WriteFile(filepath.Join(out, "transport-first-idle-fallback.json"), append(data, '\n'), 0600); err != nil {
			t.Fatal(err)
		}
	}
}
