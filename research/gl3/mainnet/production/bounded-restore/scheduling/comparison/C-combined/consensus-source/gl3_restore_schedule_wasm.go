//go:build wasm

package precompiles

import "runtime"

// A byte budget also bounds scheduling gaps when a sealed delta is large.
// These are runtime safe points only; no engine policy, state or gas changes.
func sliceRestoreSchedule(total *uint64, n int) {
	*total += uint64(n)
	if *total >= 64*1024*1024 {
		*total = 0
		runtime.GC()
	}
}

// A cold authenticated image needs headroom for the next Go/C image copies.
func sliceRestoreBeforeCompanion() { runtime.GC() }
