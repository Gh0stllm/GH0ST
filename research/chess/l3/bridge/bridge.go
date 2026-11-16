package bridge

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
)

type Hash = [32]byte
type Owner = [20]byte
type Write struct {
	Key   string
	Value []byte
}
type Guard struct {
	Key      string
	Expected []byte
}

// Store is authoritative chain state. Commit must compare the guard and apply
// every write atomically, or leave state unchanged. No asynchronous call occurs
// between reading a job and committing its replacement.
type Store interface {
	Read(string) ([]byte, error)
	Commit(Guard, []Write) error
}

var (
	ErrInvalid   = errors.New("invalid or unsupported LLM input")
	ErrMissing   = errors.New("model or caller-scoped job missing")
	ErrConflict  = errors.New("stale generation or conflicting state")
	ErrIntegrity = errors.New("committed data integrity failure")
	ErrRuntime   = errors.New("deterministic runtime rejected execution")
)

const MaxChunksPerCommit = 16
const MaxRows = 512
const MaxModelBytes = 8 * 1024 * 1024
const MaxCheckpointBytes = 2 * 1024 * 1024
const Vocabulary = 50257

func parseHash(s string) (h Hash) {
	b, e := hex.DecodeString(s)
	if e != nil || len(b) != 32 {
		panic("invalid fixed hash")
	}
	copy(h[:], b)
	return
}

var RuntimeSHA256 = parseHash("d7ebddffb302ab1ffe5a13edc2d06109d8375ab143bfa923d1af9e2c139052c5")
var WeightsSHA256 = parseHash("6dc6dd216d0c4b12b81b0844244423e53bb8d7e4c726b8e6205683708971ef1f")

type Model struct {
	ID           Hash   `json:"id"`
	RuntimeSHA   Hash   `json:"runtimeSHA"`
	WeightsSHA   Hash   `json:"weightsSHA"`
	RuntimeBytes uint32 `json:"runtimeBytes"`
	WeightsBytes uint32 `json:"weightsBytes"`
}
type Job struct {
	Owner         Owner  `json:"owner"`
	ID            Hash   `json:"id"`
	ModelID       Hash   `json:"modelID"`
	Transcript    Hash   `json:"transcript"`
	Generation    uint64 `json:"generation"`
	KernelStep    uint32 `json:"kernelStep"`
	Phase         uint32 `json:"phase"`
	Position      uint32 `json:"position"`
	InputToken    uint32 `json:"inputToken"`
	BestToken     uint32 `json:"bestToken"`
	CheckpointSHA Hash   `json:"checkpointSHA"`
}
type Progress struct {
	Generation                             uint64
	KernelStep, Phase, Position, BestToken uint32
	CheckpointSHA                          Hash
	Done                                   bool
}

func modelKey(id Hash, part string) string {
	return "GH0ST_LLM_V1/model/" + hex.EncodeToString(id[:]) + "/" + part
}
func jobKey(owner Owner, id Hash, part string) string {
	return "GH0ST_LLM_V1/job/" + hex.EncodeToString(owner[:]) + "/" + hex.EncodeToString(id[:]) + "/" + part
}
func progress(j Job) Progress {
	return Progress{j.Generation, j.KernelStep, j.Phase, j.Position, j.BestToken, j.CheckpointSHA, j.Phase == 11}
}
func encode(v any) []byte {
	b, e := json.Marshal(v)
	if e != nil {
		panic(e)
	}
	return b
}
func modelID(runtime, weights Hash) Hash {
	b := append([]byte("GH0ST_LLM_FIXED_V1"), runtime[:]...)
	b = append(b, weights[:]...)
	return sha256.Sum256(b)
}
func transcript(prior Hash, token uint32) Hash {
	var b [36]byte
	copy(b[:], prior[:])
	binary.BigEndian.PutUint32(b[32:], token)
	return sha256.Sum256(b[:])
}

// Register admits only the reviewed TinyStories code/data pair. Arbitrary Wasm
// requires a real instruction-metering and validation policy before admission.
func Register(s Store, module, weights []byte) (Hash, error) {
	if len(module) > 65536 || len(weights) > MaxModelBytes || sha256.Sum256(module) != RuntimeSHA256 || sha256.Sum256(weights) != WeightsSHA256 {
		return Hash{}, ErrIntegrity
	}
	id := modelID(RuntimeSHA256, WeightsSHA256)
	m := Model{id, RuntimeSHA256, WeightsSHA256, uint32(len(module)), uint32(len(weights))}
	key := modelKey(id, "meta")
	old, e := s.Read(key)
	if e != nil {
		return Hash{}, e
	}
	if len(old) > 0 {
		if !bytes.Equal(old, encode(m)) {
			return Hash{}, ErrConflict
		}
		return id, nil
	}
	e = s.Commit(Guard{key, nil}, []Write{{modelKey(id, "runtime"), append([]byte(nil), module...)}, {modelKey(id, "weights"), append([]byte(nil), weights...)}, {key, encode(m)}})
	return id, e
}

// Engine holds only immutable compiled code. Every Begin/Advance/Append creates
// a fresh guest memory and loads model/checkpoint data from the supplied store.
// There is no persistent guest instance or model-state cache between commits.
type Engine struct {
	r        wazero.Runtime
	compiled wazero.CompiledModule
	model    Model
	ctx      context.Context
}

func New(s Store, id Hash) (*Engine, error) {
	return NewWithBackend(s, id, Interpreter)
}

func NewWithBackend(s Store, id Hash, backend Backend) (*Engine, error) {
	raw, e := s.Read(modelKey(id, "meta"))
	if e != nil {
		return nil, e
	}
	if len(raw) == 0 {
		return nil, ErrMissing
	}
	var m Model
	if json.Unmarshal(raw, &m) != nil || m.ID != id || m.ID != modelID(m.RuntimeSHA, m.WeightsSHA) || m.RuntimeSHA != RuntimeSHA256 || m.WeightsSHA != WeightsSHA256 || m.WeightsBytes > MaxModelBytes {
		return nil, ErrIntegrity
	}
	code, e := s.Read(modelKey(id, "runtime"))
	if e != nil {
		return nil, e
	}
	if len(code) != int(m.RuntimeBytes) || sha256.Sum256(code) != m.RuntimeSHA {
		return nil, ErrIntegrity
	}
	ctx := context.Background()
	r, er := newBackend(ctx, backend)
	if er != nil {
		return nil, er
	}
	compiled, e := r.CompileModule(ctx, code)
	if e != nil {
		r.Close(ctx)
		return nil, e
	}
	if len(compiled.ImportedFunctions()) != 0 || len(compiled.ImportedMemories()) != 0 {
		r.Close(ctx)
		return nil, ErrInvalid
	}
	return &Engine{r, compiled, m, ctx}, nil
}
func (e *Engine) Close() error { return e.r.Close(e.ctx) }

func (e *Engine) guest(s Store) (api.Module, error) {
	data, er := s.Read(modelKey(e.model.ID, "weights"))
	if er != nil {
		return nil, er
	}
	if len(data) != int(e.model.WeightsBytes) || sha256.Sum256(data) != e.model.WeightsSHA {
		return nil, ErrIntegrity
	}
	mod, er := e.r.InstantiateModule(e.ctx, e.compiled, wazero.NewModuleConfig().WithName("").WithStartFunctions())
	if er != nil {
		return nil, er
	}
	ptr, er := e.value(mod, "gh_model_ptr")
	if er == nil {
		var n uint32
		n, er = e.value(mod, "gh_model_len")
		if er == nil && (int(n) != len(data) || !mod.Memory().Write(ptr, data)) {
			er = ErrIntegrity
		}
	}
	if er == nil {
		// The Go loader is part of the state transition, not an untrusted API.
		// It already checked SHA256 of every committed weight byte above and
		// copied exactly those bytes. The guest checks the verified root; this
		// avoids hashing the same 4.4MB again through the nested interpreter.
		var p, cap uint32
		p, er = e.value(mod, "gh_checkpoint_ptr")
		if er == nil {
			cap, er = e.value(mod, "gh_checkpoint_capacity")
		}
		if er == nil && (cap < 64 || !mod.Memory().Write(p+cap-32, e.model.WeightsSHA[:])) {
			er = ErrIntegrity
		}
		if er == nil {
			er = e.ok(mod, "gh_accept_preverified_model", uint64(p+cap-32))
		}
	}
	if er == nil {
		er = e.ok(mod, "gh_reset")
	}
	if er != nil {
		mod.Close(e.ctx)
		return nil, er
	}
	return mod, nil
}
func (e *Engine) value(m api.Module, name string, args ...uint64) (uint32, error) {
	f := m.ExportedFunction(name)
	if f == nil {
		return 0, ErrInvalid
	}
	v, er := f.Call(e.ctx, args...)
	if er != nil || len(v) != 1 {
		return 0, fmt.Errorf("%w: %s", ErrRuntime, name)
	}
	return uint32(v[0]), nil
}
func (e *Engine) ok(m api.Module, name string, args ...uint64) error {
	v, er := e.value(m, name, args...)
	if er != nil {
		return er
	}
	if int32(v) != 0 {
		return fmt.Errorf("%w: %s returned %d", ErrRuntime, name, int32(v))
	}
	return nil
}
func (e *Engine) checkpoint(m api.Module) ([]byte, error) {
	n, er := e.value(m, "gh_checkpoint_export")
	if er != nil {
		return nil, er
	}
	p, er := e.value(m, "gh_checkpoint_ptr")
	if er != nil {
		return nil, er
	}
	if n == 0 || n > MaxCheckpointBytes {
		return nil, ErrIntegrity
	}
	b, ok := m.Memory().Read(p, n)
	if !ok {
		return nil, ErrIntegrity
	}
	return append([]byte(nil), b...), nil
}
func (e *Engine) restore(s Store, m api.Module, j Job) error {
	b, er := s.Read(jobKey(j.Owner, j.ID, "checkpoint"))
	if er != nil {
		return er
	}
	if len(b) == 0 || len(b) > MaxCheckpointBytes || sha256.Sum256(b) != j.CheckpointSHA {
		return ErrIntegrity
	}
	p, er := e.value(m, "gh_checkpoint_ptr")
	if er != nil {
		return er
	}
	cap, er := e.value(m, "gh_checkpoint_capacity")
	if er != nil {
		return er
	}
	if uint32(len(b))+64 > cap || !m.Memory().Write(p, b) || !m.Memory().Write(p+cap-32, j.CheckpointSHA[:]) {
		return ErrIntegrity
	}
	if er = e.ok(m, "gh_checkpoint_restore", uint64(len(b)), uint64(p+cap-32)); er != nil {
		return er
	}
	for _, field := range []struct {
		name string
		want uint32
	}{{"gh_step", j.KernelStep}, {"gh_phase", j.Phase}, {"gh_position", j.Position}} {
		got, er := e.value(m, field.name)
		if er != nil || got != field.want {
			return ErrIntegrity
		}
	}
	return nil
}
func (e *Engine) load(s Store, caller Owner, id Hash) (Job, []byte, error) {
	raw, er := s.Read(jobKey(caller, id, "meta"))
	if er != nil {
		return Job{}, nil, er
	}
	if len(raw) == 0 {
		return Job{}, nil, ErrMissing
	}
	var j Job
	if json.Unmarshal(raw, &j) != nil || j.Owner != caller || j.ID != id || j.ModelID != e.model.ID {
		return Job{}, nil, ErrIntegrity
	}
	return j, raw, nil
}
func (e *Engine) save(s Store, m api.Module, j Job, expected []byte) (Progress, error) {
	var er error
	if j.KernelStep, er = e.value(m, "gh_step"); er != nil {
		return Progress{}, er
	}
	if j.Phase, er = e.value(m, "gh_phase"); er != nil {
		return Progress{}, er
	}
	if j.Position, er = e.value(m, "gh_position"); er != nil {
		return Progress{}, er
	}
	if j.BestToken, er = e.value(m, "gh_best_token"); er != nil {
		return Progress{}, er
	}
	if j.Phase > 11 {
		return Progress{}, ErrRuntime
	}
	b, er := e.checkpoint(m)
	if er != nil {
		return Progress{}, er
	}
	j.CheckpointSHA = sha256.Sum256(b)
	key := jobKey(j.Owner, j.ID, "meta")
	er = s.Commit(Guard{key, expected}, []Write{{jobKey(j.Owner, j.ID, "checkpoint"), b}, {key, encode(j)}})
	if er != nil {
		return Progress{}, er
	}
	return progress(j), nil
}
func (e *Engine) Begin(s Store, caller Owner, id Hash, token uint32) (Progress, error) {
	if token >= Vocabulary {
		return Progress{}, ErrInvalid
	}
	key := jobKey(caller, id, "meta")
	old, er := s.Read(key)
	if er != nil {
		return Progress{}, er
	}
	if len(old) > 0 {
		return Progress{}, ErrConflict
	}
	m, er := e.guest(s)
	if er != nil {
		return Progress{}, er
	}
	defer m.Close(e.ctx)
	if er = e.ok(m, "gh_begin", uint64(token)); er != nil {
		return Progress{}, er
	}
	j := Job{Owner: caller, ID: id, ModelID: e.model.ID, InputToken: token, Transcript: transcript(Hash{}, token)}
	return e.save(s, m, j, nil)
}
func (e *Engine) Advance(s Store, caller Owner, id Hash, generation uint64, rows, chunks uint32) (Progress, error) {
	if rows == 0 || rows > MaxRows || chunks == 0 || chunks > MaxChunksPerCommit {
		return Progress{}, ErrInvalid
	}
	j, raw, er := e.load(s, caller, id)
	if er != nil {
		return Progress{}, er
	}
	if j.Generation != generation || j.Phase == 11 || j.Generation == ^uint64(0) {
		return Progress{}, ErrConflict
	}
	m, er := e.guest(s)
	if er != nil {
		return Progress{}, er
	}
	defer m.Close(e.ctx)
	if er = e.restore(s, m, j); er != nil {
		return Progress{}, er
	}
	for i := uint32(0); i < chunks; i++ {
		step, er := e.value(m, "gh_step")
		if er != nil {
			return Progress{}, er
		}
		if er = e.ok(m, "gh_advance", uint64(step), uint64(rows)); er != nil {
			return Progress{}, er
		}
		phase, er := e.value(m, "gh_phase")
		if er != nil {
			return Progress{}, er
		}
		if phase == 11 {
			break
		}
	}
	j.Generation++
	return e.save(s, m, j, raw)
}
func (e *Engine) Append(s Store, caller Owner, id Hash, generation uint64, token uint32) (Progress, error) {
	if token >= Vocabulary {
		return Progress{}, ErrInvalid
	}
	j, raw, er := e.load(s, caller, id)
	if er != nil {
		return Progress{}, er
	}
	if j.Generation != generation || j.Phase != 11 || j.Position >= 63 || j.Generation == ^uint64(0) {
		return Progress{}, ErrConflict
	}
	m, er := e.guest(s)
	if er != nil {
		return Progress{}, er
	}
	defer m.Close(e.ctx)
	if er = e.restore(s, m, j); er != nil {
		return Progress{}, er
	}
	if er = e.ok(m, "gh_begin", uint64(token)); er != nil {
		return Progress{}, er
	}
	j.Generation++
	j.InputToken = token
	j.Transcript = transcript(j.Transcript, token)
	return e.save(s, m, j, raw)
}
func (e *Engine) Inspect(s Store, caller Owner, id Hash) (Progress, error) {
	j, _, er := e.load(s, caller, id)
	return progress(j), er
}
func (e *Engine) Logits(s Store, caller Owner, id Hash) ([]byte, error) {
	j, _, er := e.load(s, caller, id)
	if er != nil {
		return nil, er
	}
	if j.Phase != 11 {
		return nil, ErrConflict
	}
	m, er := e.guest(s)
	if er != nil {
		return nil, er
	}
	defer m.Close(e.ctx)
	if er = e.restore(s, m, j); er != nil {
		return nil, er
	}
	p, er := e.value(m, "gh_logits_ptr")
	if er != nil {
		return nil, er
	}
	b, ok := m.Memory().Read(p, Vocabulary*4)
	if !ok {
		return nil, ErrIntegrity
	}
	return append([]byte(nil), b...), nil
}
