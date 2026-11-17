//go:build gl3_checkpoint_integration

package precompiles

// cpCheckpointReady is an admission rule, not an image verifier. Successful
// Work/Verify/Finalize already authenticate the complete immutable GSD1 chain.
// Rebuild the frozen metadata identity after undoing exactly Finalize's two
// permitted metadata changes. No image, TT, history or engine bytes are altered.
func cpCheckpointReady(m sliceMeta, b cpState, owner addr, job bytes32) bool {
	if m.Generation == 1 {
		return m.Deltas == 0 && m.Head == ([32]byte{})
	}
	expected := (uint64(m.MemoryBytes) + cpMemoryRange - 1) / cpMemoryRange
	if b.Version != 1 || b.Nonce == 0 || b.Active || b.Owner != owner || b.Job != job ||
		b.Generation != m.Generation || b.Root != m.Root || b.MemoryBytes != m.MemoryBytes ||
		b.Cursor != m.MemoryBytes || expected == 0 || uint64(len(b.Pieces)) != expected ||
		b.Verified != uint32(len(b.Pieces)) || m.Deltas != uint32(len(b.Pieces)) ||
		b.Head != m.Head || b.Head != b.Pieces[len(b.Pieces)-1] {
		return false
	}
	frozen := m
	frozen.Head, frozen.Deltas = b.OldHead, b.OldDeltas
	return b.FrozenMeta == cpMetaHash(frozen)
}
