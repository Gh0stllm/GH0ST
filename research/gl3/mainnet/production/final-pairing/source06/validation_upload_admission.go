package client

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
)

// Same one-slot, context-aware gate as the accepted fixture. Only clients that
// cold-opt-in participate. It bounds their conversion/upload callbacks, not
// typed-key copies, other processes, backend VMs or arbitrary bypassing clients.
var gl3ValidationUploads = make(chan struct{}, 1)
var gl3ValidationUploadsActive atomic.Int64
var gl3ValidationUploadsPeak atomic.Int64
var gl3ValidationUploadsWaiting atomic.Int64

type validationUploadAdmissionPolicy struct{ enabled atomic.Bool }

// Enable before Start. The ordinary default is off; no hot-disable API exists.
func (c *ValidationClient) EnableValidationUploadAdmission() error {
	if c == nil || c.Started() || c.Stopped() {
		return fmt.Errorf("enable upload admission only on a fresh validation client")
	}
	c.uploadAdmission.enabled.Store(true)
	return nil
}

func gl3AcquireValidationUpload(ctx context.Context) (func(), error) {
	gl3ValidationUploadsWaiting.Add(1)
	defer gl3ValidationUploadsWaiting.Add(-1)
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
	for old := gl3ValidationUploadsPeak.Load(); n > old && !gl3ValidationUploadsPeak.CompareAndSwap(old, n); old = gl3ValidationUploadsPeak.Load() {
	}
	var once sync.Once
	return func() { once.Do(func() { gl3ValidationUploadsActive.Add(-1); <-gl3ValidationUploads }) }, nil
}

func GL3ValidationUploadAdmissionStats() (active, peak int64) {
	return gl3ValidationUploadsActive.Load(), gl3ValidationUploadsPeak.Load()
}

func ValidationUploadAdmissionWaiting() int64 { return gl3ValidationUploadsWaiting.Load() }
