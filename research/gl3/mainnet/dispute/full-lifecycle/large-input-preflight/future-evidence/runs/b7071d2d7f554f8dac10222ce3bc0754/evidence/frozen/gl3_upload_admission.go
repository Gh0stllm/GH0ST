// SPDX-License-Identifier: GPL-3.0-or-later
package client

import (
	"context"
	"sync"
	"sync/atomic"
)

// This host-only gate is shared by every validator/client instance in this
// fixture process. Call sites acquire it before ValidationInputToJson and hold
// it through the RPC response/error. It limits transient uploads, not resident
// execution runs, backend cache population, or clients bypassing this package.
var gl3ValidationUploads = make(chan struct{}, 1)
var gl3ValidationUploadsActive atomic.Int64
var gl3ValidationUploadsPeak atomic.Int64

func gl3AcquireValidationUpload(ctx context.Context) (func(), error) {
	select {
	case gl3ValidationUploads <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	if err := ctx.Err(); err != nil {
		<-gl3ValidationUploads
		return nil, err
	}
	n := gl3ValidationUploadsActive.Add(1)
	for old := gl3ValidationUploadsPeak.Load(); n > old && !gl3ValidationUploadsPeak.CompareAndSwap(old, n); old = gl3ValidationUploadsPeak.Load() {}
	var once sync.Once
	return func() { once.Do(func() { gl3ValidationUploadsActive.Add(-1); <-gl3ValidationUploads }) }, nil
}

func GL3ValidationUploadAdmissionStats() (active, peak int64) {
	return gl3ValidationUploadsActive.Load(), gl3ValidationUploadsPeak.Load()
}
