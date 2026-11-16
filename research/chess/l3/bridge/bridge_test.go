package bridge

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type memoryWords struct {
	Words         map[Word]Word
	Fail          bool
	Reads, Writes uint64
	LastWrites    []WordWrite
}

func newWords() *memoryWords                    { return &memoryWords{Words: map[Word]Word{}} }
func (m *memoryWords) Get(k Word) (Word, error) { m.Reads++; return m.Words[k], nil }
func (m *memoryWords) Apply(w []WordWrite) error {
	if m.Fail {
		return errors.New("fixture atomic commit failed")
	}
	for _, x := range w {
		m.Words[x.Key] = x.Value
	}
	m.LastWrites = append([]WordWrite(nil), w...)
	m.Writes += uint64(len(w))
	return nil
}
func fixtures(t *testing.T) ([]byte, []byte) {
	t.Helper()
	code, e := os.ReadFile("../llm/.cache/runtime.wasm")
	if e != nil {
		t.Fatal("prepare the llm fixture first:", e)
	}
	weights, e := os.ReadFile("../llm/.cache/model.bin")
	if e != nil {
		t.Fatal(e)
	}
	return code, weights
}
func fixture(t *testing.T) (*memoryWords, WordAdapter, Hash) {
	t.Helper()
	code, weights := fixtures(t)
	words := newWords()
	s := WordAdapter{words}
	id, e := Register(s, code, weights)
	if e != nil {
		t.Fatal(e)
	}
	return words, s, id
}

func TestPersistedFullModelTwoTokens(t *testing.T) {
	started := time.Now()
	words, s, model := fixture(t)
	var owner Owner
	owner[19] = 1
	var id Hash
	id[31] = 77
	engine, e := New(s, model)
	if e != nil {
		t.Fatal(e)
	}
	p, e := engine.Begin(s, owner, id, 7454)
	engine.Close()
	if e != nil {
		t.Fatal(e)
	}
	hashes := []string{"44f7ac472b255db705be0be97f0ad9b820dd985530ac16fd3534363081b2787a", "9486c642c70bd30a1a40589a5191ee9f60c89a7dea23850d309467575352fe4c"}
	tokens := []uint32{2402, 257}
	commits := 0
	records := []map[string]any{}
	for position := 0; position < 2; position++ {
		for !p.Done {
			// Recreate the entire host wrapper every commit. Every engine call
			// also creates fresh guest memory; only word-store bytes survive.
			s = WordAdapter{words}
			engine, e = New(s, model)
			if e != nil {
				t.Fatal(e)
			}
			p, e = engine.Advance(s, owner, id, p.Generation, 512, MaxChunksPerCommit)
			engine.Close()
			if e != nil {
				t.Fatal(e)
			}
			commits++
		}
		if p.BestToken != tokens[position] {
			t.Fatalf("position%d best token%d", position, p.BestToken)
		}
		engine, e = New(s, model)
		if e != nil {
			t.Fatal(e)
		}
		logits, e := engine.Logits(s, owner, id)
		if e != nil {
			t.Fatal(e)
		}
		digest := sha256.Sum256(logits)
		if hex.EncodeToString(digest[:]) != hashes[position] {
			t.Fatalf("position%d all-logit hash differs: %x", position, digest)
		}
		records = append(records, map[string]any{"position": position, "bestToken": p.BestToken, "allLogitsCompared": Vocabulary, "logitsI32LESHA256": hex.EncodeToString(digest[:]), "generation": p.Generation, "kernelStep": p.KernelStep})
		if position == 0 {
			p, e = engine.Append(s, owner, id, p.Generation, 2402)
			if e != nil {
				t.Fatal(e)
			}
		}
		engine.Close()
	}
	report := map[string]any{"scope": "Real full-model Go interpreter and word-store integration, not a running Nitro node or fraud proof", "runtime": "wazero v1.12.0 interpreter only", "modelParameters": 3745984, "weightsSHA256": hex.EncodeToString(WeightsSHA256[:]), "runtimeSHA256": hex.EncodeToString(RuntimeSHA256[:]), "positions": records, "totalLogitsCompared": Vocabulary * 2, "freshHostWrapperEachCommit": true, "freshGuestMemoryEachCommit": true, "commits": commits, "wordStoreReads": words.Reads, "wordStoreWrites": words.Writes, "localWallSeconds": time.Since(started).Seconds(), "chainBooted": false, "proverExecuted": false, "financialActions": false}
	if e = os.MkdirAll("evidence", 0755); e != nil {
		t.Fatal(e)
	}
	raw, _ := json.MarshalIndent(report, "", "  ")
	if e = os.WriteFile(filepath.Join("evidence", "full-model.json"), append(raw, '\n'), 0644); e != nil {
		t.Fatal(e)
	}
	t.Logf("two complete positions; %d logits; %d persisted commits; %.3fs", Vocabulary*2, commits, time.Since(started).Seconds())
}

func TestCallerReplayBudgetIntegrityAndAtomicity(t *testing.T) {
	words, s, model := fixture(t)
	e, err := New(s, model)
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	var owner, other Owner
	owner[0] = 1
	other[0] = 2
	var job Hash
	job[0] = 9
	p, err := e.Begin(s, owner, job, 7454)
	if err != nil {
		t.Fatal(err)
	}
	metaKey := jobKey(owner, job, "meta")
	before, _ := s.Read(metaKey)
	checkpointBefore, _ := s.Read(jobKey(owner, job, "checkpoint"))
	checks := []string{}
	assertNoChange := func(name string, operation func() error) {
		t.Helper()
		if er := operation(); er == nil {
			t.Fatal(name, "accepted")
		}
		after, _ := s.Read(metaKey)
		cp, _ := s.Read(jobKey(owner, job, "checkpoint"))
		if !bytes.Equal(before, after) || !bytes.Equal(checkpointBefore, cp) {
			t.Fatal(name, "changed committed job")
		}
		checks = append(checks, name)
	}
	assertNoChange("wrong caller", func() error { _, er := e.Advance(s, other, job, p.Generation, 512, 1); return er })
	assertNoChange("duplicate begin", func() error { _, er := e.Begin(s, owner, job, 7454); return er })
	assertNoChange("stale generation", func() error { _, er := e.Advance(s, owner, job, 9, 512, 1); return er })
	assertNoChange("zero row budget", func() error { _, er := e.Advance(s, owner, job, p.Generation, 0, 1); return er })
	assertNoChange("excessive chunk budget", func() error { _, er := e.Advance(s, owner, job, p.Generation, 512, 17); return er })
	assertNoChange("invalid vocabulary token", func() error { _, er := e.Append(s, owner, job, p.Generation, Vocabulary); return er })
	assertNoChange("append while incomplete", func() error { _, er := e.Append(s, owner, job, p.Generation, 2402); return er })
	words.Fail = true
	assertNoChange("failed backing-store transaction", func() error { _, er := e.Advance(s, owner, job, p.Generation, 512, 1); return er })
	words.Fail = false
	key := wordKey(jobKey(owner, job, "checkpoint"), 0)
	saved := words.Words[key]
	bad := saved
	bad[0] ^= 1
	words.Words[key] = bad
	_, err = e.Advance(s, owner, job, p.Generation, 512, 1)
	if !errors.Is(err, ErrIntegrity) {
		t.Fatal("corrupt checkpoint not rejected", err)
	}
	after, _ := s.Read(metaKey)
	if !bytes.Equal(before, after) {
		t.Fatal("corrupt checkpoint changed metadata")
	}
	words.Words[key] = saved
	checks = append(checks, "corrupt committed checkpoint")
	key = wordKey(modelKey(model, "weights"), 0)
	saved = words.Words[key]
	bad = saved
	bad[0] ^= 1
	words.Words[key] = bad
	_, err = e.Advance(s, owner, job, p.Generation, 512, 1)
	if !errors.Is(err, ErrIntegrity) {
		t.Fatal("corrupt model not rejected", err)
	}
	words.Words[key] = saved
	checks = append(checks, "corrupt committed model")
	if er := s.Commit(Guard{metaKey, []byte("wrong")}, []Write{{metaKey, []byte("bad")}}); !errors.Is(er, ErrConflict) {
		t.Fatal("guard mismatch accepted")
	}
	checks = append(checks, "compare-and-swap mismatch")
	code, weights := fixtures(t)
	code[0] ^= 1
	if _, er := Register(s, code, weights); !errors.Is(er, ErrIntegrity) {
		t.Fatal("arbitrary module accepted")
	}
	checks = append(checks, "unreviewed runtime rejected")
	report := map[string]any{"scope": "Local real-interpreter safety and atomic-store tests; no Nitro transaction or public state change", "passed": len(checks), "checks": checks}
	raw, _ := json.MarshalIndent(report, "", "  ")
	os.MkdirAll("evidence", 0755)
	os.WriteFile("evidence/safety.json", append(raw, '\n'), 0644)
}
