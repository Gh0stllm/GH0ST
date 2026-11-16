package bridge

import (
	"bytes"
	"errors"
	"reflect"
	"testing"
)

type dirtyWordsFixture struct {
	words      map[Word]Word
	readKeys   []Word
	readErrors map[Word]error
	applyError error
	applyCalls int
	applied    []WordWrite
}

func newDirtyWordsFixture() *dirtyWordsFixture {
	return &dirtyWordsFixture{words: make(map[Word]Word), readErrors: make(map[Word]error)}
}

func (s *dirtyWordsFixture) Get(key Word) (Word, error) {
	s.readKeys = append(s.readKeys, key)
	if err := s.readErrors[key]; err != nil {
		return Word{}, err
	}
	return s.words[key], nil
}

func (s *dirtyWordsFixture) Apply(writes []WordWrite) error {
	s.applyCalls++
	if s.applyError != nil {
		return s.applyError
	}
	s.applied = append([]WordWrite(nil), writes...)
	for _, write := range writes {
		if write.Value == (Word{}) {
			delete(s.words, write.Key)
		} else {
			s.words[write.Key] = write.Value
		}
	}
	return nil
}

func dirtyWord(n byte) (word Word) {
	word[31] = n
	return
}

func TestDirtyWordStorePreservesStateAndOrderedDuplicateWrites(t *testing.T) {
	baseline, source := newDirtyWordsFixture(), newDirtyWordsFixture()
	a, b, c, absent := dirtyWord(10), dirtyWord(11), dirtyWord(12), dirtyWord(13)
	one, two, three, four, zero := dirtyWord(1), dirtyWord(2), dirtyWord(3), dirtyWord(4), Word{}
	for _, s := range []*dirtyWordsFixture{baseline, source} {
		s.words[a], s.words[b] = one, two
	}
	writes := []WordWrite{
		{a, one}, {a, three}, {a, three}, {b, zero}, {b, zero},
		{absent, zero}, {a, zero}, {a, one}, {b, two}, {b, two},
		{c, four}, {c, zero},
	}
	want := []WordWrite{{a, three}, {b, zero}, {a, zero}, {a, one}, {b, two}, {c, four}, {c, zero}}
	if err := baseline.Apply(writes); err != nil {
		t.Fatal(err)
	}
	s := NewDirtyWordStore(source)
	if err := s.Apply(writes); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(source.words, baseline.words) {
		t.Fatalf("filtered result differs from baseline: got %v want %v", source.words, baseline.words)
	}
	if !reflect.DeepEqual(source.applied, want) {
		t.Fatalf("filtered write order changed: got %v want %v", source.applied, want)
	}
	if !reflect.DeepEqual(source.readKeys, []Word{a, b, absent, c}) {
		t.Fatalf("source read order changed: %v", source.readKeys)
	}
	for _, key := range []Word{a, b, c, absent} {
		got, err := s.Get(key)
		if err != nil || got != baseline.words[key] {
			t.Fatalf("cache differs from final state for %x: %x %v", key, got, err)
		}
	}
	if len(source.readKeys) != 4 || source.applyCalls != 1 {
		t.Fatalf("unexpected source calls: reads=%d applies=%d", len(source.readKeys), source.applyCalls)
	}
}

func TestDirtyWordStoreCachesOnlySuccessfulReads(t *testing.T) {
	source := newDirtyWordsFixture()
	key, value := dirtyWord(1), dirtyWord(2)
	readError := errors.New("read failed")
	source.words[key], source.readErrors[key] = value, readError
	s := NewDirtyWordStore(source)
	if _, err := s.Get(key); !errors.Is(err, readError) {
		t.Fatalf("read error lost: %v", err)
	}
	delete(source.readErrors, key)
	for i := 0; i < 2; i++ {
		if got, err := s.Get(key); err != nil || got != value {
			t.Fatalf("successful read differs: %x %v", got, err)
		}
	}
	if len(source.readKeys) != 2 {
		t.Fatalf("failed read was cached or successful read was repeated: %d", len(source.readKeys))
	}
}

func TestDirtyWordStoreReadFailureDoesNotWriteOrPublishStagedReads(t *testing.T) {
	source := newDirtyWordsFixture()
	a, b := dirtyWord(1), dirtyWord(2)
	source.words[a] = dirtyWord(3)
	readError := errors.New("second read failed")
	source.readErrors[b] = readError
	s := NewDirtyWordStore(source)
	if err := s.Apply([]WordWrite{{a, dirtyWord(4)}, {b, dirtyWord(5)}}); !errors.Is(err, readError) {
		t.Fatalf("read error lost: %v", err)
	}
	if source.applyCalls != 0 || len(source.words) != 1 || source.words[a] != dirtyWord(3) {
		t.Fatal("source changed after a read failure")
	}
	if got, err := s.Get(a); err != nil || got != dirtyWord(3) {
		t.Fatalf("staged write leaked: %x %v", got, err)
	}
	if !reflect.DeepEqual(source.readKeys, []Word{a, b, a}) {
		t.Fatalf("failed Apply published staged reads: %v", source.readKeys)
	}
}

func TestDirtyWordStoreFailedAtomicApplyDoesNotAdvanceCache(t *testing.T) {
	source := newDirtyWordsFixture()
	a, b, c := dirtyWord(1), dirtyWord(2), dirtyWord(3)
	source.words[a], source.words[b] = dirtyWord(4), dirtyWord(5)
	s := NewDirtyWordStore(source)
	if _, err := s.Get(a); err != nil {
		t.Fatal(err)
	}
	writes := []WordWrite{{a, dirtyWord(6)}, {b, dirtyWord(7)}, {c, dirtyWord(8)}}
	applyError := errors.New("atomic Apply failed")
	source.applyError = applyError
	if err := s.Apply(writes); !errors.Is(err, applyError) {
		t.Fatalf("Apply error lost: %v", err)
	}
	for _, item := range []WordWrite{{a, dirtyWord(4)}, {b, dirtyWord(5)}, {c, Word{}}} {
		if got, err := s.Get(item.Key); err != nil || got != item.Value {
			t.Fatalf("failed Apply advanced cache for %x: %x %v", item.Key, got, err)
		}
	}
	if !reflect.DeepEqual(source.readKeys, []Word{a, b, c, b, c}) {
		t.Fatalf("failed Apply published staged reads: %v", source.readKeys)
	}
	source.applyError = nil
	if err := s.Apply(writes); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(source.applied, writes) || source.applyCalls != 2 {
		t.Fatal("retry incorrectly suppressed failed writes")
	}
}

func TestDirtyWordStoreUnchangedBatchStillDelegatesFailure(t *testing.T) {
	source := newDirtyWordsFixture()
	key, value := dirtyWord(1), dirtyWord(2)
	source.words[key] = value
	applyError := errors.New("empty atomic Apply failed")
	source.applyError = applyError
	s := NewDirtyWordStore(source)
	if err := s.Apply([]WordWrite{{key, value}, {dirtyWord(3), Word{}}}); !errors.Is(err, applyError) {
		t.Fatalf("unchanged batch swallowed Apply failure: %v", err)
	}
	if source.applyCalls != 1 || len(s.cache) != 0 {
		t.Fatal("failed empty Apply changed cache or was not delegated")
	}
}

func TestDirtyWordStoreFreshTransitionReadsCurrentSource(t *testing.T) {
	source := newDirtyWordsFixture()
	key, initial, next := dirtyWord(1), dirtyWord(2), dirtyWord(3)
	source.words[key] = initial
	first := NewDirtyWordStore(source)
	if _, err := first.Get(key); err != nil {
		t.Fatal(err)
	}
	// End the first transition before changing the source. Its cached initial
	// value is deliberately never reused after an external state/snapshot change.
	if err := source.Apply([]WordWrite{{key, next}}); err != nil {
		t.Fatal(err)
	}
	second := NewDirtyWordStore(source)
	if got, err := second.Get(key); err != nil || got != next {
		t.Fatalf("fresh transition reused stale state: %x %v", got, err)
	}
	if err := second.Apply([]WordWrite{{key, initial}}); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(source.applied, []WordWrite{{key, initial}}) {
		t.Fatal("fresh transition suppressed a write using a stale initial read")
	}
}

func TestDirtyWordStorePreservesWordAdapterFinalPadding(t *testing.T) {
	baseline, source := newDirtyWordsFixture(), newDirtyWordsFixture()
	key := "checkpoint"
	initial := append(bytes.Repeat([]byte{1}, 32), 2, 3, 4, 5, 6)
	next := append(bytes.Repeat([]byte{1}, 32), 7, 8, 9)
	for _, value := range [][]byte{initial, next} {
		writes := []Write{{key, value}}
		if err := (WordAdapter{baseline}).Commit(Guard{"guard", nil}, writes); err != nil {
			t.Fatal(err)
		}
		// Each commit uses a fresh transaction-local wrapper.
		if err := (WordAdapter{NewDirtyWordStore(source)}).Commit(Guard{"guard", nil}, writes); err != nil {
			t.Fatal(err)
		}
	}
	if !reflect.DeepEqual(source.words, baseline.words) {
		t.Fatal("final word padding or length differs from baseline")
	}
	var padded Word
	copy(padded[:], next[32:])
	if got := source.words[wordKey(key, 1)]; got != padded {
		t.Fatalf("final word was not padded with zeros: %x", got)
	}
	if len(source.applied) != 2 || source.applied[0].Key != wordKey(key, 1) || source.applied[1].Key != wordKey(key, ^uint32(0)) {
		t.Fatalf("unchanged first word was written, or write order changed: %v", source.applied)
	}
	got, err := (WordAdapter{NewDirtyWordStore(source)}).Read(key)
	if err != nil || !bytes.Equal(got, next) {
		t.Fatalf("restored bytes differ: %x %v", got, err)
	}
}
