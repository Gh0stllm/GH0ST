//go:build gl3_acceptance && challengetest

// SPDX-License-Identifier: GPL-3.0-or-later
package arbtest

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/log"
	"github.com/ethereum/go-ethereum/node"
	"github.com/offchainlabs/nitro/validator/client"
	"github.com/offchainlabs/nitro/validator/valnode"
)

func gl3InstallLifecyclePayloadFilter(t *testing.T) {
	t.Helper()
	old := log.Root()
	log.SetDefault(log.NewLogger(&gl3PayloadFilter{next: old.Handler()}))
	t.Cleanup(func() { log.SetDefault(old) })
}

// Full lifecycle helper deliberately creates the ordinary, UNGUARDED backend.
// The positive-step stop wrapper belongs only to the separately named transport
// preflight. No machine/STF/engine byte is replaced here.
func gl3CreateLargeInputValidationNode(t *testing.T, ctx context.Context, config *valnode.Config) (*valnode.ValidationNode, *node.Node) {
	t.Helper()
	stackConf := node.DefaultConfig
	stackConf.HTTPPort = 0
	stackConf.DataDir = ""
	stackConf.WSHost = "127.0.0.1"
	stackConf.WSPort = 0
	stackConf.WSModules = []string{"validation"}
	stackConf.WSReadLimit = gl3PrivateRequestCap
	stackConf.P2P.NoDiscovery = true
	stackConf.P2P.ListenAddr = ""
	stackConf.P2P.MaxPeers = 0
	valnode.EnsureValidationExposedViaAuthRPC(&stackConf)
	stack, err := node.New(&stackConf)
	Require(t, err)
	fetcher := func() *valnode.Config { return config }
	validation, err := valnode.CreateValidationNode(fetcher, stack, nil)
	Require(t, err)
	Require(t, stack.Start())
	Require(t, validation.Start(ctx))
	out := os.Getenv("GL3_RESTART_EVIDENCE")
	if out != "" {
		gl3TransportWrite(t, out, "validation-transport-config.json", map[string]any{
			"loopbackEndpoint": stack.WSEndpoint(), "serverWSReadLimit": gl3PrivateRequestCap,
			"sharedBeforeConversionUploadAdmission": true, "maximumConcurrentUploads": 1,
			"clientArgLogLimit": 2048, "clientTimeout": 0, "clientRetries": 0,
			"runIdleEviction":            config.Arbitrator.ExecutionRunTimeout.String(),
			"positiveStepGuardInstalled": false, "backend": "ordinary real ArbitratorSpawner",
			"experimentalBoundExecutionCreations": config.Arbitrator.ExperimentalBoundExecutionCreations,
			"experimentalRecordedHashStride":      config.Arbitrator.Execution.ExperimentalRecordedHashStride,
			"experimentalMaximumRecordedHashes":   config.Arbitrator.Execution.ExperimentalMaxRecordedHashes,
			"experimentalSerializeQueries":        config.Arbitrator.Execution.ExperimentalSerializeQueries,
			"experimentalRefineRanges":            config.Arbitrator.Execution.ExperimentalRefineRanges,
			"scope":                               "Private host transport and explicitly enabled cache/admission configuration; no performance acceptance from configuration alone",
		})
	}
	telemetryContext, stopTelemetry := context.WithCancel(ctx)
	telemetryDone := make(chan struct{})
	go func() {
		defer close(telemetryDone)
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-telemetryContext.Done():
				return
			case <-ticker.C:
				if out != "" {
					gl3TransportWrite(t, out, "host-cache-server-live.json", map[string]any{"stats": validation.ExperimentalHostCacheStats(), "at": time.Now().UTC()})
				}
			}
		}
	}()
	t.Cleanup(func() {
		stopTelemetry()
		<-telemetryDone
		if out != "" {
			gl3TransportWrite(t, out, "host-cache-server-before-stop.json", validation.ExperimentalHostCacheStats())
		}
		stack.Close()
		validation.Stop()
		if out != "" {
			gl3TransportWrite(t, out, "host-cache-server-after-stop.json", validation.ExperimentalHostCacheStats())
			active, peak := client.GL3ValidationUploadAdmissionStats()
			gl3TransportWrite(t, out, "validation-upload-admission.json", map[string]any{"activeAfter": active, "peak": peak, "maximum": 1})
		}
	})
	return validation, stack
}
