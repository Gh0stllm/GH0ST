package staker

// Operator opt-in for the reviewed host-only execution cache. This does not
// change a guest, machine root, engine policy or the normal disabled Start path.
import (
	"context"
	"encoding/hex"
	"fmt"
	"reflect"
	"strings"
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

type experimentalExecutionClientLifecycle interface {
	Started() bool
	Stopped() bool
}

type experimentalExecutionCacheEnabler interface {
	EnableExperimentalRunCache(client.ExperimentalRunCacheConfig) error
}

type experimentalValidationUploadEnabler interface{ EnableValidationUploadAdmission() error }

// Enabled operator profiles require an explicit root, never the unrelated local latest alias.
func RequiredExperimentalCacheModuleRoot(c *BlockValidatorConfig) (common.Hash, error) {
	if c == nil {
		return common.Hash{}, fmt.Errorf("block validator configuration missing")
	}
	raw, err := hex.DecodeString(strings.TrimPrefix(c.CurrentModuleRoot, "0x"))
	if err != nil || len(raw) != common.HashLength {
		return common.Hash{}, fmt.Errorf("experimental execution cache requires an explicit 32-byte hexadecimal current-module-root")
	}
	root := common.BytesToHash(raw)
	if root == (common.Hash{}) {
		return common.Hash{}, fmt.Errorf("experimental execution cache requires a nonzero current-module-root")
	}
	return root, nil
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
	if _, err := RequiredExperimentalCacheModuleRoot(v.config); err != nil {
		return err
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
		if _, ok := v.execSpawners[i].(experimentalValidationUploadEnabler); !ok {
			return fmt.Errorf("execution client %d cannot enable validation upload admission", i)
		}
		lifecycle, ok := v.execSpawners[i].(experimentalExecutionClientLifecycle)
		if !ok {
			return fmt.Errorf("execution client %d lacks RPC lifecycle ownership checks", i)
		}
		if lifecycle.Started() || lifecycle.Stopped() {
			return fmt.Errorf("execution client %d is already owned or stopped", i)
		}
		if life, ok := spawner.(experimentalExecutionClientLifecycle); ok && (life.Started() || life.Stopped()) {
			return fmt.Errorf("BOLD client %d is already owned or stopped", i)
		}
	}
	return nil
}

func (v *StatelessBlockValidator) startWithExperimentalExecutionCache(ctx context.Context) (err error) {
	v.experimentalCacheStartupMu.Lock()
	defer v.experimentalCacheStartupMu.Unlock()
	if v.experimentalCacheStartupAttempted {
		return fmt.Errorf("experimental validator startup already attempted; create a fresh validator")
	}
	if ctx == nil {
		return fmt.Errorf("execution cache startup context required")
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	if err = v.experimentalExecutionCachePreflight(); err != nil {
		return err
	}
	v.experimentalCacheStartupAttempted = true
	var startedExecutions []validator.ExecutionSpawner
	var startedBOLD []validator.BOLDExecutionSpawner
	committed := false
	defer func() {
		if committed {
			return
		}
		// No challenge work is admitted before Start returns. Failed startup
		// releases successful starts in reverse order; each failed Start attempt
		// is separately stopped before returning its original error.
		for i := len(startedBOLD) - 1; i >= 0; i-- {
			startedBOLD[i].Stop()
		}
		for i := len(startedExecutions) - 1; i >= 0; i-- {
			startedExecutions[i].Stop()
		}
	}()
	requiredRoot, err := RequiredExperimentalCacheModuleRoot(v.config)
	if err != nil {
		return err
	}
	targets := make(map[rawdb.WasmTarget]struct{})
	for i, spawner := range v.execSpawners {
		if err = ctx.Err(); err != nil {
			return err
		}
		if err = spawner.(experimentalValidationUploadEnabler).EnableValidationUploadAdmission(); err != nil {
			return fmt.Errorf("enabling upload admission client %d: %w", i, err)
		}
		if err = spawner.Start(ctx); err != nil {
			// A real RPC Start may open transport before handshake failure.
			// Stop is supported before full Start and releases that attempt.
			spawner.Stop()
			return fmt.Errorf("starting execution client %d: %w", i, err)
		}
		startedExecutions = append(startedExecutions, spawner)
		roots, rootErr := spawner.WasmModuleRoots()
		if rootErr != nil {
			return fmt.Errorf("reading execution client %d module roots: %w", i, rootErr)
		}
		supported := false
		for _, root := range roots {
			if root == requiredRoot {
				supported = true
				break
			}
		}
		if !supported {
			return fmt.Errorf("execution client %d does not support required module root %s", i, requiredRoot)
		}
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
			spawner.Stop()
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
