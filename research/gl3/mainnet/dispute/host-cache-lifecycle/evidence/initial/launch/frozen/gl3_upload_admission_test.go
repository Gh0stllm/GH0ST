// SPDX-License-Identifier: GPL-3.0-or-later
package client

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
)

func TestGL3SharedValidationUploadAdmission(t *testing.T) {
	var active, peak atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			release, err := gl3AcquireValidationUpload(context.Background())
			if err != nil {
				t.Error(err)
				return
			}
			n := active.Add(1)
			for old := peak.Load(); n > old && !peak.CompareAndSwap(old, n); old = peak.Load() {
			}
			active.Add(-1)
			release()
			release()
		}()
	}
	wg.Wait()
	if peak.Load() != 1 || active.Load() != 0 {
		t.Fatal("multiple clients admitted together")
	}
	first, err := gl3AcquireValidationUpload(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = gl3AcquireValidationUpload(ctx); !errors.Is(err, context.Canceled) {
		t.Fatal("blocked cancellation lost")
	}
	first()
	release, err := gl3AcquireValidationUpload(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	release()
	a, p := GL3ValidationUploadAdmissionStats()
	if a != 0 || p != 1 {
		t.Fatal("gate was not released", a, p)
	}
}
