package bridge

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"reflect"
	"runtime"
	"testing"
	"time"
)

func TestNativeCompilerMatchesInterpreterState(t *testing.T) {
	if runtime.GOARCH != "arm64" && runtime.GOARCH != "amd64" {
		t.Skip("native compiler benchmark is architecture-specific; interpreter remains the replay backend")
	}
	wa, a, model := fixture(t)
	wb, b, _ := fixture(t)
	var caller Owner
	caller[19] = 3
	var job Hash
	job[31] = 31
	started := time.Now()
	ea, e := New(a, model)
	if e != nil {
		t.Fatal(e)
	}
	pa, e := ea.Begin(a, caller, job, 7454)
	ea.Close()
	if e != nil {
		t.Fatal(e)
	}
	interpreterTime := time.Since(started)
	started = time.Now()
	eb, e := NewWithBackend(b, model, NativeCompiler)
	if e != nil {
		t.Fatal(e)
	}
	pb, e := eb.Begin(b, caller, job, 7454)
	eb.Close()
	if e != nil {
		t.Fatal(e)
	}
	compilerTime := time.Since(started)
	if !reflect.DeepEqual(wa.LastWrites, wb.LastWrites) {
		t.Fatal("begin word writes differ")
	}
	totalCommits := 0
	records := []map[string]any{}
	for pos := 0; pos < 2; pos++ {
		if pa != pb {
			t.Fatal("begin state differs")
		}
		for !pa.Done {
			started = time.Now()
			ea, e = New(a, model)
			if e != nil {
				t.Fatal(e)
			}
			pa, e = ea.Advance(a, caller, job, pa.Generation, 512, MaxChunksPerCommit)
			ea.Close()
			if e != nil {
				t.Fatal(e)
			}
			interpreterTime += time.Since(started)
			started = time.Now()
			eb, e = NewWithBackend(b, model, NativeCompiler)
			if e != nil {
				t.Fatal(e)
			}
			pb, e = eb.Advance(b, caller, job, pb.Generation, 512, MaxChunksPerCommit)
			eb.Close()
			if e != nil {
				t.Fatal(e)
			}
			compilerTime += time.Since(started)
			if pa != pb {
				t.Fatalf("progress differs at commit%d", totalCommits)
			}
			if !reflect.DeepEqual(wa.LastWrites, wb.LastWrites) {
				t.Fatalf("word write set differs at commit%d", totalCommits)
			}
			ac, _ := a.Read(jobKey(caller, job, "checkpoint"))
			bc, _ := b.Read(jobKey(caller, job, "checkpoint"))
			if !bytes.Equal(ac, bc) {
				t.Fatalf("full checkpoint differs at commit%d", totalCommits)
			}
			totalCommits++
		}
		ea, e = New(a, model)
		if e != nil {
			t.Fatal(e)
		}
		la, e := ea.Logits(a, caller, job)
		if e != nil {
			t.Fatal(e)
		}
		eb, e = NewWithBackend(b, model, NativeCompiler)
		if e != nil {
			t.Fatal(e)
		}
		lb, e := eb.Logits(b, caller, job)
		if e != nil {
			t.Fatal(e)
		}
		if !bytes.Equal(la, lb) {
			t.Fatal("full logits differ")
		}
		digest := sha256.Sum256(la)
		records = append(records, map[string]any{"position": pos, "bestToken": pa.BestToken, "allLogitsCompared": Vocabulary, "logitsSHA256": hex.EncodeToString(digest[:]), "checkpointSHA256": hex.EncodeToString(pa.CheckpointSHA[:]), "allCommittedCheckpointBytesEqual": true})
		if pos == 0 {
			pa, e = ea.Append(a, caller, job, pa.Generation, 2402)
			if e != nil {
				t.Fatal(e)
			}
			pb, e = eb.Append(b, caller, job, pb.Generation, 2402)
			if e != nil {
				t.Fatal(e)
			}
		}
		ea.Close()
		eb.Close()
	}
	report := map[string]any{"scope": "Local opt-in native compiler versus interpreter, not a production node, gas or fraud-proof result", "defaultBackend": "interpreter", "nativeCompilerIsOptIn": true, "backendInCommittedState": false, "wordWriteSetsEqualEveryCommit": true, "guestStateRecreatedEveryCommit": true, "mutableStateOutsideStore": false, "positions": records, "allCommittedCheckpointsCompared": totalCommits, "interpreterLocalSeconds": interpreterTime.Seconds(), "nativeCompilerLocalSeconds": compilerTime.Seconds(), "localRatio": interpreterTime.Seconds() / compilerTime.Seconds(), "gasPricingMeasured": false, "allProgramsProvenEquivalent": false}
	raw, _ := json.MarshalIndent(report, "", "  ")
	os.MkdirAll("evidence", 0755)
	os.WriteFile("evidence/native-compiler-comparison.json", append(raw, '\n'), 0644)
	t.Logf("%d exact checkpoint commits; interpreter %.3fs; native compiler %.3fs", totalCommits, interpreterTime.Seconds(), compilerTime.Seconds())
}

func TestBackendRejectionsMatch(t *testing.T) {
	if runtime.GOARCH != "arm64" && runtime.GOARCH != "amd64" {
		t.Skip("native compiler unavailable")
	}
	wa, a, model := fixture(t)
	wb, b, _ := fixture(t)
	ea, e := New(a, model)
	if e != nil {
		t.Fatal(e)
	}
	defer ea.Close()
	eb, e := NewWithBackend(b, model, NativeCompiler)
	if e != nil {
		t.Fatal(e)
	}
	defer eb.Close()
	var owner, other Owner
	owner[0] = 1
	other[0] = 2
	var id Hash
	id[0] = 3
	pa, e := ea.Begin(a, owner, id, 7454)
	if e != nil {
		t.Fatal(e)
	}
	pb, e := eb.Begin(b, owner, id, 7454)
	if e != nil {
		t.Fatal(e)
	}
	if pa != pb {
		t.Fatal("begin differs")
	}
	tests := []struct {
		name string
		call func(*Engine, WordAdapter) (Progress, error)
	}{
		{"wrong caller", func(x *Engine, s WordAdapter) (Progress, error) { return x.Advance(s, other, id, 0, 512, 1) }},
		{"duplicate begin", func(x *Engine, s WordAdapter) (Progress, error) { return x.Begin(s, owner, id, 7454) }},
		{"stale generation", func(x *Engine, s WordAdapter) (Progress, error) { return x.Advance(s, owner, id, 10, 512, 1) }},
		{"zero rows", func(x *Engine, s WordAdapter) (Progress, error) { return x.Advance(s, owner, id, 0, 0, 1) }},
		{"oversized chunk count", func(x *Engine, s WordAdapter) (Progress, error) { return x.Advance(s, owner, id, 0, 512, 17) }},
		{"append incomplete", func(x *Engine, s WordAdapter) (Progress, error) { return x.Append(s, owner, id, 0, 2402) }},
	}
	passed := []string{}
	for _, tc := range tests {
		_, ax := tc.call(ea, a)
		_, bx := tc.call(eb, b)
		if ax == nil || bx == nil || ax.Error() != bx.Error() {
			t.Fatalf("%s errors differ: %v/%v", tc.name, ax, bx)
		}
		am, _ := a.Read(jobKey(owner, id, "meta"))
		bm, _ := b.Read(jobKey(owner, id, "meta"))
		if !bytes.Equal(am, bm) || !reflect.DeepEqual(wa.LastWrites, wb.LastWrites) {
			t.Fatal("error changed state or writes")
		}
		passed = append(passed, tc.name)
	}
	report := map[string]any{"scope": "Local cross-backend rejection equivalence cases, not all-program proof", "checks": passed, "errorsAndCommittedStateEqual": true}
	raw, _ := json.MarshalIndent(report, "", "  ")
	os.MkdirAll("evidence", 0755)
	os.WriteFile("evidence/backend-rejections.json", append(raw, '\n'), 0644)
}
