package bridge

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"runtime"
	"sort"
	"testing"
	"time"
)

// A missing storage word is zero in ArbOS. Compare every key in the union so
// omitted zero writes do not invent a map-presence difference in chain state.
func equalCompleteWordState(t *testing.T, a, b *memoryWords) {
	t.Helper()
	for k, v := range a.Words {
		if b.Words[k] != v {
			t.Fatalf("complete state differs at baseline key %x", k)
		}
	}
	for k, v := range b.Words {
		if a.Words[k] != v {
			t.Fatalf("complete state differs at optimized key %x", k)
		}
	}
}

func canonicalWordStateHash(words *memoryWords) (Hash, int) {
	keys := make([]Word, 0, len(words.Words))
	for k, v := range words.Words {
		if v != (Word{}) {
			keys = append(keys, k)
		}
	}
	sort.Slice(keys, func(i, j int) bool { return bytes.Compare(keys[i][:], keys[j][:]) < 0 })
	h := sha256.New()
	for _, k := range keys {
		h.Write(k[:])
		v := words.Words[k]
		h.Write(v[:])
	}
	var digest Hash
	copy(digest[:], h.Sum(nil))
	return digest, len(keys)
}

func TestDirtyWordStoreFullModelMatchesBaseline(t *testing.T) {
	if runtime.GOARCH != "amd64" && runtime.GOARCH != "arm64" {
		t.Skip("fast parity fixture uses native compiler; interpreter remains default")
	}
	started := time.Now()
	code, weights := fixtures(t)
	baseline, optimized := newWords(), newWords()
	// This constructor is called for every operation, including setup and reads.
	// No cache can carry guest state or words into a later transition.
	store := func(words *memoryWords, dirty bool) WordAdapter {
		if dirty {
			return WordAdapter{Words: NewDirtyWordStore(words)}
		}
		return WordAdapter{Words: words}
	}
	model, err := Register(store(baseline, false), code, weights)
	if err != nil {
		t.Fatal(err)
	}
	otherModel, err := Register(store(optimized, true), code, weights)
	if err != nil || model != otherModel {
		t.Fatal("registration mismatch", err)
	}
	equalCompleteWordState(t, baseline, optimized)
	registrationBaselineReads, registrationBaselineWrites := baseline.Reads, baseline.Writes
	registrationOptimizedReads, registrationOptimizedWrites := optimized.Reads, optimized.Writes
	owner, job := Owner{19: 5}, Hash{31: 91}
	type operation func(*Engine, WordAdapter) (Progress, error)
	run := func(words *memoryWords, dirty bool, fn operation) Progress {
		t.Helper()
		s := store(words, dirty)
		e, eErr := NewWithBackend(s, model, NativeCompiler)
		if eErr != nil {
			t.Fatal(eErr)
		}
		p, eErr := fn(e, s)
		e.Close()
		if eErr != nil {
			t.Fatal(eErr)
		}
		return p
	}
	pa := run(baseline, false, func(e *Engine, s WordAdapter) (Progress, error) { return e.Begin(s, owner, job, 7454) })
	pb := run(optimized, true, func(e *Engine, s WordAdapter) (Progress, error) { return e.Begin(s, owner, job, 7454) })
	checkpointsCompared, stateComparisons := 0, 1
	compare := func() {
		t.Helper()
		if pa != pb {
			t.Fatal("progress/metadata mismatch", pa, pb)
		}
		a, e := store(baseline, false).Read(jobKey(owner, job, "checkpoint"))
		if e != nil {
			t.Fatal(e)
		}
		b, e := store(optimized, true).Read(jobKey(owner, job, "checkpoint"))
		if e != nil || !bytes.Equal(a, b) {
			t.Fatal("complete checkpoint bytes mismatch", e)
		}
		equalCompleteWordState(t, baseline, optimized)
		checkpointsCompared++
		stateComparisons++
	}
	compare()
	positions := []map[string]any{}
	commits := 0
	wantHashes := []string{"44f7ac472b255db705be0be97f0ad9b820dd985530ac16fd3534363081b2787a", "9486c642c70bd30a1a40589a5191ee9f60c89a7dea23850d309467575352fe4c"}
	wantTokens := []uint32{2402, 257}
	for pos := 0; pos < 2; pos++ {
		for !pa.Done {
			ga, gb := pa.Generation, pb.Generation
			pa = run(baseline, false, func(e *Engine, s WordAdapter) (Progress, error) {
				return e.Advance(s, owner, job, ga, 512, MaxChunksPerCommit)
			})
			pb = run(optimized, true, func(e *Engine, s WordAdapter) (Progress, error) {
				return e.Advance(s, owner, job, gb, 512, MaxChunksPerCommit)
			})
			compare()
			commits++
		}
		if pa.BestToken != wantTokens[pos] {
			t.Fatal("wrong full-model best token", pos, pa.BestToken)
		}
		var logits [2][]byte
		for i, words := range []*memoryWords{baseline, optimized} {
			s := store(words, i == 1)
			e, eErr := NewWithBackend(s, model, NativeCompiler)
			if eErr != nil {
				t.Fatal(eErr)
			}
			logits[i], eErr = e.Logits(s, owner, job)
			e.Close()
			if eErr != nil {
				t.Fatal(eErr)
			}
		}
		digest := sha256.Sum256(logits[0])
		if !bytes.Equal(logits[0], logits[1]) || hex.EncodeToString(digest[:]) != wantHashes[pos] {
			t.Fatal("full logits or independent oracle mismatch", pos)
		}
		positions = append(positions, map[string]any{"position": pos, "bestToken": pa.BestToken, "allLogitsCompared": Vocabulary, "logitsI32LESHA256": wantHashes[pos], "checkpointSHA256": hex.EncodeToString(pa.CheckpointSHA[:])})
		if pos == 0 {
			ga, gb := pa.Generation, pb.Generation
			pa = run(baseline, false, func(e *Engine, s WordAdapter) (Progress, error) { return e.Append(s, owner, job, ga, 2402) })
			pb = run(optimized, true, func(e *Engine, s WordAdapter) (Progress, error) { return e.Append(s, owner, job, gb, 2402) })
			compare()
		}
	}
	stateA, countA := canonicalWordStateHash(baseline)
	stateB, countB := canonicalWordStateHash(optimized)
	if stateA != stateB || countA != countB || optimized.Writes >= baseline.Writes {
		t.Fatal("complete canonical state or write reduction mismatch", stateA, stateB, baseline.Writes, optimized.Writes)
	}
	report := map[string]any{
		"scope":   "Full reviewed model: baseline versus transaction-local dirty-word filtering in a local atomic word-store fixture",
		"backend": NativeCompiler, "defaultBackendChanged": false, "positions": positions, "totalLogitsCompared": 2 * Vocabulary,
		"advanceCommits": commits, "completeCheckpointsCompared": checkpointsCompared, "completeWordStateComparisons": stateComparisons,
		"allCheckpointsProgressAndCompleteWordStatesEqual": true, "freshDirtyWrapperEveryOperation": true,
		"zeroWordsCanonicalizedAsAbsent": true, "finalCanonicalNonzeroWords": countA, "finalCanonicalWordStateSHA256": hex.EncodeToString(stateA[:]),
		"baselineWordReads": baseline.Reads, "optimizedWordReads": optimized.Reads, "baselineAppliedWordWrites": baseline.Writes, "optimizedAppliedWordWrites": optimized.Writes,
		"registrationBaselineReads": registrationBaselineReads, "registrationBaselineWrites": registrationBaselineWrites,
		"registrationOptimizedReads": registrationOptimizedReads, "registrationOptimizedWrites": registrationOptimizedWrites,
		"appliedWriteReductionFraction": 1 - float64(optimized.Writes)/float64(baseline.Writes),
		"localWallSeconds":              time.Since(started).Seconds(), "actualArbOSGasOrStateRootMeasured": false,
		"productionFeeQuote": false, "chainBooted": false, "proverExecuted": false, "financialActions": false,
	}
	if err = os.MkdirAll("evidence", 0755); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.MarshalIndent(report, "", "  ")
	if err = os.WriteFile("evidence/dirty-wordstore-full-model.json", append(raw, '\n'), 0644); err != nil {
		t.Fatal(err)
	}
	t.Logf("%d exact checkpoints; applied word writes %d -> %d", checkpointsCompared, baseline.Writes, optimized.Writes)
}
