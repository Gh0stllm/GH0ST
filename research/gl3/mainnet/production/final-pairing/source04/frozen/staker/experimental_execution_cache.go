package staker

// Operator opt-in for the reviewed host-only execution cache. This does not
// change a guest, machine root, engine policy or the normal disabled Start path.
import (
	"context"
	"fmt"
	"reflect"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/spf13/pflag"

	"github.com/offchainlabs/nitro/validator"
	"github.com/offchainlabs/nitro/validator/client"
)

type ExperimentalBOLDExecutionCacheConfig struct {
	Enable      bool          `koanf:"enable"`
	MaxEntries  int           `koanf:"max-entries"`
	IdleTimeout time.Duration `koanf:"idle-timeout"`
}

var DefaultExperimentalBOLDExecutionCacheConfig = ExperimentalBOLDExecutionCacheConfig{
	Enable: false, MaxEntries: 1, IdleTimeout: 4 * time.Hour,
}

func (c ExperimentalBOLDExecutionCacheConfig) Validate() error {
	if !c.Enable {
		return nil
	}
	if c.MaxEntries != 1 {
		return fmt.Errorf("experimental BOLD execution cache supports exactly one retained entry per client")
	}
	if c.IdleTimeout <= 0 {
		return fmt.Errorf("experimental BOLD execution cache requires a positive idle timeout")
	}
	return nil
}

func ExperimentalBOLDExecutionCacheConfigAddOptions(prefix string, f *pflag.FlagSet) {
	d := DefaultExperimentalBOLDExecutionCacheConfig
	f.Bool(prefix+".enable", d.Enable, "opt in to one retained authenticated native execution per canonical input")
	f.Int(prefix+".max-entries", d.MaxEntries, "retained execution entries per client; reviewed profile requires one")
	f.Duration(prefix+".idle-timeout", d.IdleTimeout, "idle retention for known native executions; separate from server orphan expiry")
}

type experimentalExecutionCacheEnabler interface {
	EnableExperimentalRunCache(client.ExperimentalRunCacheConfig) error
}

func experimentalCacheNil(value any) bool {
	if value == nil {
		return true
	}
	v := reflect.ValueOf(value)
	switch v.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return v.IsNil()
	}
	return false
}

func (v *StatelessBlockValidator) experimentalExecutionCachePreflight() error {
	if v.config == nil {
		return fmt.Errorf("block validator configuration missing")
	}
	if err := v.config.ExperimentalBOLDExecutionCache.Validate(); err != nil {
		return err
	}
	if v.latestWasmModuleRoot == (common.Hash{}) {
		return fmt.Errorf("resolve a nonzero module root before enabling experimental execution cache")
	}
	if v.redisValidator != nil || v.boldRedisValidator != nil {
		return fmt.Errorf("experimental retained execution requires RPC clients; Redis is unsupported")
	}
	if len(v.execSpawners) == 0 || len(v.execSpawners) != len(v.boldExecSpawners) {
		return fmt.Errorf("experimental execution cache needs paired RPC execution and BOLD clients")
	}
	for i, spawner := range v.boldExecSpawners {
		if experimentalCacheNil(spawner) {
			return fmt.Errorf("BOLD execution client %d missing", i)
		}
		if _, ok := spawner.(experimentalExecutionCacheEnabler); !ok {
			return fmt.Errorf("BOLD execution client %d cannot enable reviewed execution cache", i)
		}
		if experimentalCacheNil(v.execSpawners[i]) {
			return fmt.Errorf("execution client %d missing", i)
		}
	}
	return nil
}

func (v *StatelessBlockValidator) startWithExperimentalExecutionCache(ctx context.Context) (err error) {
	if ctx == nil {
		return fmt.Errorf("execution cache startup context required")
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	if err = v.experimentalExecutionCachePreflight(); err != nil {
		return err
	}
	var startedExecutions []validator.ExecutionSpawner
	var startedBOLD []validator.BOLDExecutionSpawner
	committed := false
	defer func() {
		if committed {
			return
		}
		// No challenge work is admitted before Start returns. Failed startup
		// releases only resources that successfully started, in reverse order.
		for i := len(startedBOLD) - 1; i >= 0; i-- {
			startedBOLD[i].Stop()
		}
		for i := len(startedExecutions) - 1; i >= 0; i-- {
			startedExecutions[i].Stop()
		}
	}()
	targets := make(map[rawdb.WasmTarget]struct{})
	for i, spawner := range v.execSpawners {
		if err = ctx.Err(); err != nil {
			return err
		}
		if err = spawner.Start(ctx); err != nil {
			return fmt.Errorf("starting execution client %d: %w", i, err)
		}
		startedExecutions = append(startedExecutions, spawner)
		for _, target := range spawner.StylusArchs() {
			targets[target] = struct{}{}
		}
	}
	config := v.config.ExperimentalBOLDExecutionCache
	for i, spawner := range v.boldExecSpawners {
		if err = ctx.Err(); err != nil {
			return err
		}
		if err = spawner.Start(ctx); err != nil {
			return fmt.Errorf("starting BOLD execution client %d: %w", i, err)
		}
		startedBOLD = append(startedBOLD, spawner)
		if err = ctx.Err(); err != nil {
			return err
		}
		if err = spawner.(experimentalExecutionCacheEnabler).EnableExperimentalRunCache(client.ExperimentalRunCacheConfig{MaxEntries: config.MaxEntries, IdleTimeout: config.IdleTimeout}); err != nil {
			return fmt.Errorf("enabling retained execution client %d: %w", i, err)
		}
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	var resolvedTargets []rawdb.WasmTarget
	for target := range targets {
		resolvedTargets = append(resolvedTargets, target)
	}
	v.wasmTargets = resolvedTargets
	committed = true
	return nil
}
