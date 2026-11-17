//go:build !gl3_checkpoint_integration

package precompiles

func insertGhostChessCheckpointProfile(insert func(addr, ArbosPrecompile) *Precompile) {}
