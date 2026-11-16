package bridge

// DirtyWordStore filters unchanged writes against authoritative words read in
// one state transition. It does not change the word layout or create an atomic
// boundary: the underlying WordStore.Apply must provide atomicity and rollback.
//
// Construct a fresh instance for each EVM call/state transition, and discard it
// after any enclosing snapshot is reverted. The source must not be changed
// outside this wrapper during its lifetime. Cached reads intentionally are not
// refreshed, so reusing an instance across calls or snapshots could return stale
// state or incorrectly suppress a write. It is not safe for concurrent use.
type DirtyWordStore struct {
	source WordStore
	cache  map[Word]Word
}

// NewDirtyWordStore creates an empty, transaction-local cache over source.
// source must be a non-nil WordStore with atomic Apply semantics.
func NewDirtyWordStore(source WordStore) *DirtyWordStore {
	return &DirtyWordStore{source: source, cache: make(map[Word]Word)}
}

func (s *DirtyWordStore) Get(key Word) (Word, error) {
	if value, ok := s.cache[key]; ok {
		return value, nil
	}
	value, err := s.source.Get(key)
	if err != nil {
		return Word{}, err
	}
	s.cache[key] = value
	return value, nil
}

func (s *DirtyWordStore) Apply(writes []WordWrite) error {
	// Stage everything locally. Neither a failed source read nor a failed atomic
	// Apply may publish speculative values into the transaction-local cache.
	pending := make(map[Word]Word, len(writes))
	filtered := make([]WordWrite, 0, len(writes))
	for _, write := range writes {
		current, ok := pending[write.Key]
		if !ok {
			current, ok = s.cache[write.Key]
			if !ok {
				var err error
				current, err = s.source.Get(write.Key)
				if err != nil {
					return err
				}
			}
		}
		if current != write.Value {
			// Preserve input order, including changes back to an earlier value.
			// Coalescing duplicate keys would alter underlying Apply semantics.
			filtered = append(filtered, write)
		}
		pending[write.Key] = write.Value
	}
	// Delegate even an empty filtered batch, preserving source failure handling.
	if err := s.source.Apply(filtered); err != nil {
		return err
	}
	// Iterate the input, never a map, so all externally observable source reads
	// and writes have deterministic ordering independent of Go map iteration.
	for _, write := range writes {
		s.cache[write.Key] = write.Value
	}
	return nil
}

var _ WordStore = (*DirtyWordStore)(nil)
