package slicedchess

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
	"time"
)

func TestPortableImageAndDirtyCost(t *testing.T) {
	began := time.Now()
	r, e := Shared()
	if e != nil {
		t.Fatal(e)
	}
	v, e := r.Instantiate()
	if e != nil {
		t.Fatal(e)
	}
	defer v.Close()
	if e = v.Init(); e != nil {
		t.Fatal(e)
	}
	image := v.Image()
	tree := NewTree(image.Memory)
	initialRoot := tree.Root(len(image.Memory), image.Globals)
	var rows []map[string]any
	progress := Progress{}
	warmupSeconds := time.Since(began).Seconds()
	for i := 0; i < 128; i++ {
		at := time.Now()
		if i == 0 {
			progress, e = v.Begin("e2e4")
		} else {
			progress, e = v.Advance()
		}
		if e != nil {
			t.Fatal(e)
		}
		searchSeconds := time.Since(at).Seconds()
		dirty := 0
		dirtyBytes := 0
		e = Diff(image.Memory, v.Memory(), func(page int, b []byte) error {
			dirty++
			dirtyBytes += len(b)
			tree.Set(page, b)
			copy(image.Memory[page*PageSize:], b)
			return nil
		})
		if e != nil {
			t.Fatal(e)
		}
		image.Globals = v.Globals()
		root := tree.Root(len(image.Memory), image.Globals)
		rows = append(rows, map[string]any{"step": progress.Step, "searchSeconds": searchSeconds, "snapshotSeconds": time.Since(at).Seconds() - searchSeconds, "combinedSeconds": time.Since(at).Seconds(), "dirtyPages": dirty, "dirtyBytes": dirtyBytes, "root": hex.EncodeToString(root[:])})
		if i == 63 {
			// Destroy the cached execution instance, recover exclusively from bytes.
			v.Close()
			v, e = r.Instantiate()
			if e != nil {
				t.Fatal(e)
			}
			if e = v.Restore(image); e != nil {
				t.Fatal(e)
			}
			a, e := r.Instantiate()
			if e != nil {
				t.Fatal(e)
			}
			if e = a.Restore(image); e != nil {
				t.Fatal(e)
			}
			p1, e1 := v.Advance()
			p2, e2 := a.Advance()
			if e1 != nil || e2 != nil || p1 != p2 || !bytes.Equal(v.Memory(), a.Memory()) {
				t.Fatal("restored continuation differs", e1, e2)
			}
			a.Close()
			// Restore the original cursor so the loop's input remains unchanged.
			v.Close()
			v, e = r.Instantiate()
			if e != nil {
				t.Fatal(e)
			}
			if e = v.Restore(image); e != nil {
				t.Fatal(e)
			}
		}
	}
	sum := sha256.Sum256(moduleBytes)
	report := map[string]any{"scope": "128 real portable search steps and dirty-page capture; no EVM or block cadence claim", "passed": true, "compilerBackend": true, "moduleSHA256": hex.EncodeToString(sum[:]), "initialRoot": hex.EncodeToString(initialRoot[:]), "memoryBytes": len(image.Memory), "globals": image.Globals, "warmupSeconds": warmupSeconds, "rows": rows, "coldResumeExact": true, "fixedNodes": TargetNodes, "quantum": Quantum}
	b, _ := json.MarshalIndent(report, "", "  ")
	if e = os.WriteFile(".cache/dirty-cost.json", append(b, '\n'), 0600); e != nil {
		t.Fatal(e)
	}
	t.Log(string(b[:500]))
}
