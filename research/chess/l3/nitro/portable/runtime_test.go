package gh0stllm

import (
	"errors"
	"reflect"
	"testing"
)

type mem map[Word]Word

func (m mem) Get(k Word) (Word, error) { return m[k], nil }
func (m mem) Apply(w []Write) error {
	for _, x := range w {
		m[x.Key] = x.Value
	}
	return nil
}
func TestChunkingAndRestartParity(t *testing.T) {
	for _, chunk := range []uint32{1, 7, 31, 32, 33, 1000, 1024} {
		s := mem{}
		w := make([]int8, 4096)
		x := make([]int8, 4096)
		var expected int64
		for i := range w {
			w[i] = int8(i * 7)
			x[i] = int8(i * 13)
			expected += int64(w[i]) * int64(x[i])
		}
		model, e := RegisterModel(s, w)
		if e != nil {
			t.Fatal(e)
		}
		var owner Owner
		owner[0] = 9
		var job Word
		job[0] = 7
		if e = Begin(s, owner, job, model, x); e != nil {
			t.Fatal(e)
		}
		for {
			p, e := Step(s, owner, job, chunk)
			if e != nil {
				t.Fatal(e)
			}
			if p.Done {
				if p.Sum != expected {
					t.Fatalf("%d != %d", p.Sum, expected)
				}
				break
			}
			// Copy the full backing word map into an independent fresh store.
			next := mem{}
			for k, v := range s {
				next[k] = v
			}
			s = next
		}
		p, e := Step(s, owner, job, chunk)
		if e != nil || !p.Done || p.Sum != expected {
			t.Fatal("completed step is not idempotent")
		}
	}
}
func TestOwnerAndInputBinding(t *testing.T) {
	s := mem{}
	m, _ := RegisterModel(s, []int8{127, -128, 3})
	var a, b Owner
	a[0] = 1
	b[0] = 2
	var id Word
	if Begin(s, a, id, m, []int8{1, 2}) == nil {
		t.Fatal("accepted mismatch")
	}
	if e := Begin(s, a, id, m, []int8{2, 3, 4}); e != nil {
		t.Fatal(e)
	}
	if _, e := Step(s, b, id, 1); e == nil {
		t.Fatal("wrong owner")
	}
	if e := Begin(s, a, id, m, []int8{2, 3, 4}); e == nil {
		t.Fatal("reused job")
	}
	for _, budget := range []uint32{0, 1025, ^uint32(0)} {
		if _, e := Step(s, a, id, budget); e == nil {
			t.Fatal("invalid budget")
		}
	}
	p, e := Step(s, a, id, 3)
	if e != nil || p.Sum != -118 {
		t.Fatal(p, e)
	}
}

type failStore struct {
	mem
	fail bool
}

func (s failStore) Apply(w []Write) error {
	if s.fail {
		return errors.New("rollback")
	}
	return s.mem.Apply(w)
}
func TestFailedCommitDoesNotAdvance(t *testing.T) {
	base := mem{}
	s := failStore{base, false}
	m, _ := RegisterModel(s, []int8{1, 2, 3})
	var id Word
	var owner Owner
	_ = Begin(s, owner, id, m, []int8{4, 5, 6})
	before := mem{}
	for k, v := range base {
		before[k] = v
	}
	s.fail = true
	if _, e := Step(s, owner, id, 2); e == nil {
		t.Fatal("failed commit accepted")
	}
	if !reflect.DeepEqual(base, before) {
		t.Fatal("failed commit changed state")
	}
}
func TestNoProcessGlobalState(t *testing.T) {
	a, b := mem{}, mem{}
	m, _ := RegisterModel(a, []int8{1})
	if Begin(b, Owner{}, Word{}, m, []int8{1}) == nil {
		t.Fatal("model leaked between stores")
	}
}
