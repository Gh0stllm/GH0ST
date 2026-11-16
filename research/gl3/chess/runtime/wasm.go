//go:build wasm

// SPDX-License-Identifier: GPL-3.0-or-later
//
package chessruntime

import (
	"runtime"
	"unsafe"
)

//go:wasmimport gl3chess execute
func companionExecute(input unsafe.Pointer, size uint32, output unsafe.Pointer, capacity uint32) uint32
func executeRaw(raw []byte) ([]byte, error) {
	out := make([]byte, MaxState+16384)
	n := companionExecute(unsafe.Pointer(&raw[0]), uint32(len(raw)), unsafe.Pointer(&out[0]), uint32(len(out)))
	runtime.KeepAlive(raw)
	if n == 0 || int(n) > len(out) {
		return nil, ErrEngine
	}
	return out[:n], nil
}
