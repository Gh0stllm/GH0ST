// Package bridge connects the pure integer Wasm model to committed state.
// It is not itself a Nitro precompile, running chain or fraud prover.
package bridge

import (
	"context"
	"github.com/tetratelabs/wazero"
	"runtime"
)

type Backend string

const Interpreter Backend = "interpreter"
const NativeCompiler Backend = "native-compiler"

// newInterpreter deliberately disables JIT/native code generation. No WASI
// modules or external host imports are installed.
func newInterpreter(ctx context.Context) wazero.Runtime {
	return wazero.NewRuntimeWithConfig(ctx, wazero.NewRuntimeConfigInterpreter().WithMemoryLimitPages(512))
}

// NativeCompiler is an explicit benchmark option, not a transaction parameter
// or production default. The Go/WASI execution path always uses Interpreter.
func newBackend(ctx context.Context, backend Backend) (wazero.Runtime, error) {
	switch backend {
	case Interpreter:
		return newInterpreter(ctx), nil
	case NativeCompiler:
		if runtime.GOARCH != "amd64" && runtime.GOARCH != "arm64" {
			return nil, ErrInvalid
		}
		return wazero.NewRuntimeWithConfig(ctx, wazero.NewRuntimeConfigCompiler().WithMemoryLimitPages(512)), nil
	default:
		return nil, ErrInvalid
	}
}
