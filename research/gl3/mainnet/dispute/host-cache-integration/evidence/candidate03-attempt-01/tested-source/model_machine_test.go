package server_arb

// This test-only bounded interface model has deterministic opaque hashes and
// proof bytes. They are NOT selected865 witnesses or a substitute for OSP checks.
import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"sync"
	"sync/atomic"

	"github.com/ethereum/go-ethereum/common"
	"github.com/offchainlabs/nitro/validator"
)

type integrationWork struct {
	calls     atomic.Uint64
	requested atomic.Uint64
	stepped   atomic.Uint64
	clones    atomic.Int64
	live      atomic.Int64
	destroyed atomic.Int64
	hook      func(context.Context, uint64, uint64) error
}
type integrationMachine struct {
	mu             sync.Mutex
	seed           byte
	position, halt uint64
	frozen, dead   bool
	work           *integrationWork
}

func newIntegrationMachine(halt uint64, seed byte, work *integrationWork) *integrationMachine {
	work.live.Add(1)
	return &integrationMachine{halt: halt, seed: seed, work: work}
}
func (m *integrationMachine) alive() {
	if m.dead {
		panic("integration model: use after Destroy")
	}
}
func (m *integrationMachine) CloneMachineInterface() MachineInterface {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.alive()
	m.work.clones.Add(1)
	m.work.live.Add(1)
	return &integrationMachine{position: m.position, halt: m.halt, seed: m.seed, work: m.work}
}
func (m *integrationMachine) GetStepCount() uint64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.alive()
	return m.position
}
func (m *integrationMachine) IsRunning() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.alive()
	return m.position < m.halt
}
func (m *integrationMachine) IsErrored() bool { return false }
func (m *integrationMachine) ValidForStep(requested uint64) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.alive()
	return m.position == requested || (m.position == m.halt && requested >= m.position)
}
func (m *integrationMachine) Status() uint8 {
	if m.IsRunning() {
		return 0
	}
	return 1
}
func (m *integrationMachine) Step(ctx context.Context, count uint64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.alive()
	if m.frozen {
		return errors.New("integration model: frozen machine mutated")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	delta := count
	if delta > m.halt-m.position {
		delta = m.halt - m.position
	}
	m.work.calls.Add(1)
	m.work.requested.Add(count)
	if m.work.hook != nil {
		if err := m.work.hook(ctx, m.position, delta); err != nil {
			return err
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	m.position += delta
	m.work.stepped.Add(delta)
	return nil
}
func integrationHash(seed byte, position, halt uint64) common.Hash {
	data := make([]byte, 0, 80)
	data = append(data, []byte("GL3_OPAQUE_BOUNDED_INTERFACE_MODEL_NOT_ACTUAL_WAVM")...)
	data = append(data, seed)
	var b [8]byte
	binary.BigEndian.PutUint64(b[:], position)
	data = append(data, b[:]...)
	binary.BigEndian.PutUint64(b[:], halt)
	data = append(data, b[:]...)
	if position == halt {
		data = append(data, 1)
	} else {
		data = append(data, 0)
	}
	return common.Hash(sha256.Sum256(data))
}
func (m *integrationMachine) Hash() common.Hash {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.alive()
	return integrationHash(m.seed, m.position, m.halt)
}
func (m *integrationMachine) GetGlobalState() validator.GoGlobalState {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.alive()
	return validator.GoGlobalState{BlockHash: common.Hash{m.seed}, SendRoot: common.Hash{byte(m.position)}, Batch: m.position, PosInBatch: m.halt}
}
func (m *integrationMachine) ProveNextStep() []byte {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.alive()
	next := m.position
	if next < m.halt {
		next++
	}
	before := integrationHash(m.seed, m.position, m.halt)
	after := integrationHash(m.seed, next, m.halt)
	out := append([]byte("OPAQUE_MODEL_PROOF_NOT_OSP"), before[:]...)
	return append(out, after[:]...)
}
func (m *integrationMachine) Freeze() { m.mu.Lock(); defer m.mu.Unlock(); m.alive(); m.frozen = true }
func (m *integrationMachine) Destroy() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.dead {
		return
	}
	m.dead = true
	m.work.destroyed.Add(1)
	m.work.live.Add(-1)
}

var _ MachineInterface = (*integrationMachine)(nil)
