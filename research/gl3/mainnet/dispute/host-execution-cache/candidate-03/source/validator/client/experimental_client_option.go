// Copyright 2026 GH0ST contributors.
// Explicit private opt-in; default BOLDExecutionClient behavior is unchanged.
package client

import (
	"context"
	"fmt"
)

// EnableExperimentalRunCache must be called after Start and before challenge
// work is admitted. It retains real underlying runs, not execution results from
// an external engine. The cached path requires an explicit nonzero module root.
func (b *BOLDExecutionClient) EnableExperimentalRunCache(cfg ExperimentalRunCacheConfig) error {
	b.experimentalMu.Lock()
	defer b.experimentalMu.Unlock()
	if b.experimentalOwnerContext == nil || b.experimentalStopped {
		return fmt.Errorf("start BOLD client before enabling experimental run cache")
	}
	if err := b.experimentalOwnerContext.Err(); err != nil {
		return err
	}
	if b.experimentalPool != nil {
		return fmt.Errorf("experimental run cache already configured")
	}
	pool, err := newExperimentalRunCache(b.experimentalOwnerContext, b.executionSpawner, cfg)
	if err != nil {
		return err
	}
	b.experimentalPool = pool
	return nil
}

func (b *BOLDExecutionClient) experimentalStart(ctx context.Context) error {
	b.experimentalMu.Lock()
	defer b.experimentalMu.Unlock()
	if b.experimentalPool != nil {
		return fmt.Errorf("experimental BOLD client cannot be restarted in place")
	}
	b.experimentalOwnerContext = ctx
	b.experimentalStopped = false
	return nil
}

func (b *BOLDExecutionClient) experimentalStop() {
	b.experimentalMu.Lock()
	b.experimentalStopped = true
	pool := b.experimentalPool
	b.experimentalMu.Unlock()
	if pool != nil {
		pool.stop()
	}
}

func (b *BOLDExecutionClient) getExperimentalRunCache() *experimentalRunCache {
	b.experimentalMu.Lock()
	defer b.experimentalMu.Unlock()
	return b.experimentalPool
}

func (b *BOLDExecutionClient) ExperimentalRunCacheStats() ExperimentalRunCacheStats {
	pool := b.getExperimentalRunCache()
	if pool == nil {
		return ExperimentalRunCacheStats{}
	}
	return pool.stats()
}
