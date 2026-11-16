//go:build !wasm

// SPDX-License-Identifier: GPL-3.0-or-later
//
package chessruntime

/*
#cgo darwin LDFLAGS: ${SRCDIR}/../engine/.cache/libgl3chess.a -lc++
#include <stdint.h>
#include <stdlib.h>
uint32_t gl3_execute(const unsigned char*,uint32_t,unsigned char**);
void gl3_free(void*);
*/
import "C"
import (
	"runtime"
	"unsafe"
)

func executeRaw(raw []byte) ([]byte, error) {
	var output *C.uchar
	n := C.gl3_execute((*C.uchar)(unsafe.Pointer(&raw[0])), C.uint32_t(len(raw)), &output)
	runtime.KeepAlive(raw)
	if output != nil {
		defer C.gl3_free(unsafe.Pointer(output))
	}
	if n == 0 || int(n) > MaxState+16384 || output == nil {
		return nil, ErrEngine
	}
	return C.GoBytes(unsafe.Pointer(output), C.int(n)), nil
}
