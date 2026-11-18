// SPDX-License-Identifier: GPL-3.0-or-later
// Additive A14 game-coordinator overlay. Apply only to the pinned sliced precompile.
package precompiles

import sliced "github.com/Gh0stllm/GH0ST/gl3/slicedchess"

var sliceGameCoordinatorSlot = []byte("GL3_CHESS_GAME_COORDINATOR_V1")

func (p ArbGhostChessSlices) GameCoordinator(c ctx, evm mech) (addr, error) {
	var coordinator addr
	store := sliceStore(evm.StateDB, c, sliceGameCoordinatorSlot)
	length, err := store.GetBytesSize()
	if err != nil || length == 0 {
		return coordinator, err
	}
	if length != 20 {
		return coordinator, errGhostChess
	}
	value, err := store.GetBytes()
	if err != nil {
		return coordinator, err
	}
	if len(value) != len(coordinator) {
		return coordinator, errGhostChess
	}
	copy(coordinator[:], value)
	return coordinator, nil
}

// SetGameCoordinator authorizes one contract to reserve the Stockfish engine.
// It does not give the contract any ArbOS ownership powers. Zero revokes access.
func (p ArbGhostChessSlices) SetGameCoordinator(c ctx, evm mech, coordinator addr) error {
	if evm.ChainConfig().ArbitrumChainParams.AllowDebugPrecompiles {
		return errGhostChess
	}
	owner, err := c.State.ChainOwners().IsMember(c.caller)
	if err != nil {
		return err
	}
	if !owner {
		return errGhostChess
	}
	active, err := sliceStore(evm.StateDB, c, sliceReservation).GetBytesSize()
	if err != nil {
		return err
	}
	if active != 0 {
		return errGhostChess
	}
	store := sliceStore(evm.StateDB, c, sliceGameCoordinatorSlot)
	if coordinator == (addr{}) {
		return store.SetBytes(nil)
	}
	if evm.StateDB.GetCodeSize(coordinator) == 0 {
		return errGhostChess
	}
	return store.SetBytes(coordinator[:])
}

func (p ArbGhostChessSlices) EngineStatus(c ctx, evm mech) (bytes32, bytes32, bool, error) {
	store := sliceStore(evm.StateDB, c, sliceSeedNamespace)
	length, err := store.GetBytesSize()
	if err != nil || length == 0 {
		return sliced.ModuleSHA, bytes32{}, false, err
	}
	seed, err := sliceMetaRead(store)
	if err != nil {
		return sliced.ModuleSHA, bytes32{}, false, err
	}
	return seed.Module, seed.Root, validSliceGameSeed(seed) && !evm.ChainConfig().ArbitrumChainParams.AllowDebugPrecompiles, nil
}

func validSliceGameSeed(seed sliceMeta) bool {
	return seed.Root != (bytes32{}) && seed.Generation == 1 && seed.Operation == 0 &&
		seed.Deltas == 0 && !seed.Released && !seed.Progress.Pending
}
